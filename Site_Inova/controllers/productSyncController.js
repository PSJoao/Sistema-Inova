// controllers/productSyncController.js
const { Pool } = require('pg');
const multer = require('multer');
const xlsx = require('xlsx');
const productSyncService = require('../services/productSyncService');

// Pool de conexão para a tabela app_locks
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Configuração do Multer (inalterada)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Use apenas .xlsx ou .xls'), false);
        }
    }
}).fields([
    { name: 'planilhaLucas', maxCount: 1 },
    { name: 'planilhaEliane', maxCount: 1 }
]);

// Funções acquireProductSyncLock e releaseProductSyncLock (inalteradas)
async function acquireProductSyncLock(username) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const lockResult = await client.query("SELECT * FROM app_locks WHERE lock_key = 'PRODUCT_SYNC_LOCK' FOR UPDATE NOWAIT");
        const lock = lockResult.rows[0];
        const fiveMinutesAgo = new Date(new Date().getTime() - (5 * 60 * 1000));
        if (!lock || !lock.is_locked || new Date(lock.locked_at) < fiveMinutesAgo) {
            await client.query(
                "UPDATE app_locks SET is_locked = true, locked_by = $1, locked_at = NOW() WHERE lock_key = 'PRODUCT_SYNC_LOCK'",
                [username]
            );
            await client.query('COMMIT');
            console.log(`[Lock ProductSync] Trava adquirida por ${username}`);
            return { success: true };
        } else {
            await client.query('ROLLBACK');
            console.warn(`[Lock ProductSync] Falha ao adquirir trava. Já em uso por ${lock.locked_by}.`);
            return { success: false, message: `Outra sincronização de produtos já está em andamento (iniciada por ${lock.locked_by}). Tente novamente mais tarde.` };
        }
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '55P03') { // lock_not_available
             console.warn(`[Lock ProductSync] Falha ao adquirir trava (NOWAIT). Já em uso.`);
             const currentLock = await client.query("SELECT locked_by FROM app_locks WHERE lock_key = 'PRODUCT_SYNC_LOCK'");
             const lockedBy = currentLock.rows.length > 0 ? currentLock.rows[0].locked_by : 'outro usuário';
             return { success: false, message: `Outra sincronização de produtos já está em andamento (iniciada por ${lockedBy}). Tente novamente mais tarde.` };
        }
        console.error('[Lock ProductSync] Erro ao tentar adquirir trava:', error);
        return { success: false, message: 'Erro interno ao verificar o estado da sincronização.' };
    } finally {
        client.release();
    }
}
async function releaseProductSyncLock(username) {
    try {
        const result = await pool.query(
            "UPDATE app_locks SET is_locked = false, locked_by = NULL, locked_at = NULL WHERE lock_key = 'PRODUCT_SYNC_LOCK' AND locked_by = $1",
            [username]
        );
        if (result.rowCount > 0) console.log(`[Lock ProductSync] Trava liberada por ${username}`);
        else console.log(`[Lock ProductSync] Tentativa de liberar trava por ${username}, mas não pertencia a ele ou já estava livre.`);
    } catch (error) {
        console.error('[Lock ProductSync] Erro ao liberar trava:', error);
    }
}

/**
 * Renderiza a página de upload (inalterada).
 */
exports.renderProductSyncPage = (req, res) => {
    res.render('product-sync/index', { // Certifique-se que o caminho está correto
        title: 'Sincronizar Produtos Bling por Planilha',
        layout: 'main'
    });
};

/**
 * Processa o upload e a sincronização, agora com trava e resposta JSON.
 */
exports.handleProductSyncUpload = async (req, res) => {
    // Chama o middleware do multer
    upload(req, res, async (err) => {
        if (err) {
            console.error("Erro no upload:", err.message);
            // Erros de upload (ex: arquivo errado) AINDA retornam JSON
            return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        }

        const username = req.session.username || 'desconhecido';

        // 1. Tenta adquirir a trava ANTES de processar os arquivos
        const lockResult = await acquireProductSyncLock(username);
        if (!lockResult.success) {
            // Erro de trava AINDA retorna JSON (para o modal de erro funcionar)
            return res.status(409).json({ success: false, message: lockResult.message }); // 409 Conflict
        }

        // Se adquiriu a trava, continua...
        let skusLucas = [];
        let skusEliane = [];
        let parseErrors = [];
        const files = req.files;

        // Função auxiliar para extrair SKUs
        const extractSkus = (fileBuffer) => {
             try {
                const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                // range: 1 pula a primeira linha (cabeçalho)
                const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, range: 1 });
                // Pega apenas o valor da primeira coluna (índice 0), converte para string e remove espaços. Filtra vazios.
                return data.map(row => String(row[0] ?? '').trim()).filter(sku => sku);
            } catch (error) {
                // Lança erro para ser capturado no bloco principal
                throw new Error(`Falha ao ler o arquivo Excel: ${error.message}`);
            }
        };

        // Processa arquivos e extrai SKUs
        if (files.planilhaLucas && files.planilhaLucas[0]) {
             try { skusLucas = extractSkus(files.planilhaLucas[0].buffer); }
             catch (e) { parseErrors.push(`Planilha Lucas: ${e.message}`); }
        }
        if (files.planilhaEliane && files.planilhaEliane[0]) {
            try { skusEliane = extractSkus(files.planilhaEliane[0].buffer); }
            catch (e) { parseErrors.push(`Planilha Eliane: ${e.message}`); }
        }

        // Se houve erro na leitura das planilhas
        if (parseErrors.length > 0) {
            await releaseProductSyncLock(username); // Libera a trava
             // Erro de parse AINDA retorna JSON
            return res.status(400).json({ success: false, message: parseErrors.join('<br>') });
        }

        // Se não há SKUs para processar
        if (skusLucas.length === 0 && skusEliane.length === 0) {
            await releaseProductSyncLock(username); // Libera a trava
            // Erro de "nada a fazer" AINDA retorna JSON
            return res.status(400).json({ success: false, message: 'Nenhuma planilha com SKUs válida foi enviada.' });
        }

        // 2. Executa as sincronizações em background
        console.log(`[ProductSyncUpload] Iniciando sincronizações por ${username}... Lucas: ${skusLucas.length}, Eliane: ${skusEliane.length}`);
        
        // Função assíncrona que roda em background
        const runSyncInBackground = async () => {
            try {
                const syncResults = await Promise.allSettled([
                    // Chama o serviço OU resolve imediatamente com a estrutura correta se não houver SKUs
                    skusLucas.length > 0
                        ? productSyncService.syncProductsBySku(skusLucas, 'lucas')
                        : Promise.resolve({ successCount: 0, errorCount: 0, errors: [] }),
                    skusEliane.length > 0
                        ? productSyncService.syncProductsBySku(skusEliane, 'eliane')
                        : Promise.resolve({ successCount: 0, errorCount: 0, errors: [] })
                ]);
                console.log('[ProductSyncUpload] Sincronizações em background concluídas.');

                // Log dos resultados para debug do servidor
                const [lucasResult, elianeResult] = syncResults;
                if (lucasResult.status === 'fulfilled') {
                    console.log(`  Resultado BKG Lucas: ${lucasResult.value.successCount} sucesso(s), ${lucasResult.value.errorCount} erro(s).`);
                } else {
                    console.error('  Erro GERAL BKG na sincronização Lucas:', lucasResult.reason?.message || lucasResult.reason);
                }
                if (elianeResult.status === 'fulfilled') {
                     console.log(`  Resultado BKG Eliane: ${elianeResult.value.successCount} sucesso(s), ${elianeResult.value.errorCount} erro(s).`);
                } else {
                    console.error('  Erro GERAL BKG na sincronização Eliane:', elianeResult.reason?.message || elianeResult.reason);
                }

            } catch (syncError) {
                 // Captura erros inesperados durante o Promise.allSettled (raro, mas possível)
                 console.error('[ProductSyncUpload] Erro inesperado durante Promise.allSettled (background):', syncError);
            } finally {
                 // 3. Garante que a trava seja liberada APÓS a conclusão (ou falha) das sincronizações
                 await releaseProductSyncLock(username);
                 console.log('[ProductSyncUpload] Trava liberada (job em background finalizado).');
            }
        };

        // *** AQUI ESTÁ A MUDANÇA PRINCIPAL ***
        // Dispara a função acima em background e NÃO espera (await) por ela.
        runSyncInBackground();

        // 4. Retorna uma resposta VAZIA (204 No Content) IMEDIATAMENTE.
        // O front-end (productSyncManager.js) vai receber isso, fechar o modal
        // de "carregando" e resetar o form. O processo de sync continuará
        // rodando no servidor em background.
        return res.status(204).end();
    });
};