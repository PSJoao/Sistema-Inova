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
            return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        }

        const username = req.session.username || 'desconhecido';

        // 1. Tenta adquirir a trava ANTES de processar os arquivos
        const lockResult = await acquireProductSyncLock(username);
        if (!lockResult.success) {
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
            return res.status(400).json({ success: false, message: parseErrors.join('<br>') });
        }

        // Se não há SKUs para processar
        if (skusLucas.length === 0 && skusEliane.length === 0) {
            await releaseProductSyncLock(username); // Libera a trava
            return res.status(400).json({ success: false, message: 'Nenhuma planilha com SKUs válida foi enviada.' });
        }

        // 2. Executa as sincronizações em paralelo
        console.log(`[ProductSyncUpload] Iniciando sincronizações por ${username}... Lucas: ${skusLucas.length}, Eliane: ${skusEliane.length}`);
        let syncResults;
        try {
            syncResults = await Promise.allSettled([
                // Chama o serviço OU resolve imediatamente com a estrutura correta se não houver SKUs
                skusLucas.length > 0
                    ? productSyncService.syncProductsBySku(skusLucas, 'lucas')
                    : Promise.resolve({ successCount: 0, errorCount: 0, errors: [] }),
                skusEliane.length > 0
                    ? productSyncService.syncProductsBySku(skusEliane, 'eliane')
                    : Promise.resolve({ successCount: 0, errorCount: 0, errors: [] })
            ]);
            console.log('[ProductSyncUpload] Sincronizações concluídas.');
        } catch (syncError) {
             // Captura erros inesperados durante o Promise.allSettled (raro, mas possível)
             console.error('[ProductSyncUpload] Erro inesperado durante Promise.allSettled:', syncError);
             // Libera a trava ANTES de retornar o erro
             await releaseProductSyncLock(username);
             return res.status(500).json({ success: false, message: 'Erro inesperado durante a execução das sincronizações.' });
        } finally {
             // 3. Garante que a trava seja liberada APÓS a conclusão (ou falha) das sincronizações
             // Colocar no finally garante a liberação mesmo se o Promise.allSettled falhar internamente
             await releaseProductSyncLock(username);
        }

        // 4. Formata a resposta JSON
        const [lucasResult, elianeResult] = syncResults;
        const responseData = {
            success: true, // Começa assumindo sucesso
            message: "Sincronização concluída.", // Mensagem padrão
            results: {}
        };

        // Processa resultado Lucas
        if (lucasResult.status === 'fulfilled') {
            // Garante que value exista e tenha a estrutura esperada
            responseData.results.lucas = lucasResult.value || { successCount: 0, errorCount: 0, errors: [] };
            console.log(`  Resultado Lucas: ${responseData.results.lucas.successCount} sucesso(s), ${responseData.results.lucas.errorCount} erro(s).`);
            // Verifica se errors é um array antes de logar
            if (Array.isArray(responseData.results.lucas.errors) && responseData.results.lucas.errors.length > 0) {
                 console.error('  Erros Lucas:', responseData.results.lucas.errors);
            }
        } else { // status === 'rejected'
            responseData.success = false; // Falha geral
            responseData.results.lucas = { error: lucasResult.reason?.message || 'Erro desconhecido' };
            console.error('  Erro GERAL na sincronização Lucas:', lucasResult.reason);
        }

        // Processa resultado Eliane
        if (elianeResult.status === 'fulfilled') {
            // Garante que value exista e tenha a estrutura esperada
            responseData.results.eliane = elianeResult.value || { successCount: 0, errorCount: 0, errors: [] };
            console.log(`  Resultado Eliane: ${responseData.results.eliane.successCount} sucesso(s), ${responseData.results.eliane.errorCount} erro(s).`);
             // Verifica se errors é um array antes de logar
             if (Array.isArray(responseData.results.eliane.errors) && responseData.results.eliane.errors.length > 0) {
                 console.error('  Erros Eliane:', responseData.results.eliane.errors);
            }
        } else { // status === 'rejected'
             responseData.success = false; // Falha geral
             responseData.results.eliane = { error: elianeResult.reason?.message || 'Erro desconhecido' };
            console.error('  Erro GERAL na sincronização Eliane:', elianeResult.reason);
        }

        // Ajusta a mensagem final se houve alguma falha
        if (!responseData.success) {
            responseData.message = "Sincronização concluída com erros em uma ou ambas as contas.";
        }

        // Define o status HTTP apropriado
        // 200 OK: Tudo sucesso OU processo rodou mas SKUs tiveram erros individuais (ex: não encontrado)
        // 500 Internal Server Error: Se uma das promessas foi rejeitada (erro geral na sincronização da conta)
        const httpStatus = (lucasResult.status === 'rejected' || elianeResult.status === 'rejected') ? 500 : 200;

        // Envia a resposta JSON detalhada
        return res.status(httpStatus).json(responseData);
    });
};