// controllers/etiquetasController.js
const multer = require('multer');
const { processarEtiquetas, buscarEtiquetaPorNF, validarProdutoPorEstruturas, finalizarBipagem, processarLoteNf, preProcessarEtiquetasService, finalizarEtiquetasService } = require('../services/etiquetasService');
const etiquetasService = require('../services/etiquetasService');
const archiver = require('archiver');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const { blingApiGet } = require('../services/blingApiService');
const { gerarZipEtiquetasCarregadores } = require('../services/carregadoresPdfService');
//0 19 * * *
cron.schedule('0 19 * * *', async () => {
    console.log('[CRON 19h] Verificando condições para reset do Contador de Paletes e Cancelamento de Etiquetas Pendentes...');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Inicia a transação
        // --- 1. Reset do Contador de Paletes ---
        const checkQuery = `SELECT state_json FROM ml_bipagem_state WHERE state_key = 'mercado_livre_bipagem'`;
        const res = await client.query(checkQuery);
        const currentState = res.rows[0]?.state_json || {};
        const scanList = currentState.scanList || [];
        if (scanList.length > 0) {
            console.log(`[CRON 19h] ABORTADO RESET PALETES. Existem ${scanList.length} itens na lista de bipagem.`);
        } else {
            const updateQuery = `
                UPDATE ml_bipagem_state 
                SET state_json = state_json || '{"isPalletCounterActive": true, "palletCount": 1}'::jsonb
                WHERE state_key = 'mercado_livre_bipagem';
            `;
            await client.query(updateQuery);
            console.log('[CRON 19h] SUCESSO. Contador de paletes resetado.');
        }
        // --- 2. Cancelar Etiquetas Pendentes (Fim do Expediente) ---
        const cancelQuery = `
            UPDATE cached_etiquetas_ml 
            SET status = 'cancelado' 
            WHERE status = 'pendente';
        `;
        const resultCancel = await client.query(cancelQuery);
        console.log(`[CRON 19h] SUCESSO. ${resultCancel.rowCount} etiquetas pendentes foram canceladas.`);
        await client.query('COMMIT'); // Finaliza transação
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CRON 19h] Erro na rotina das 19h:', error);
    } finally {
        client.release();
    }
}, {
    timezone: "America/Sao_Paulo"
});
// --- Geração de Etiquetas de Carregadores ---
exports.gerarEtiquetasCarregadores = async (req, res) => {
    try {
        const { carregadores } = req.body; // Array esperado: [{ nome: "João", codigo_barras: "EMP-001", quantidade: 50 }]
        
        if (!carregadores || !Array.isArray(carregadores) || carregadores.length === 0) {
            return res.status(400).json({ error: 'Nenhum carregador informado.' });
        }
        const zipBuffer = await gerarZipEtiquetasCarregadores(carregadores);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="etiquetas_carregadores.zip"');
        res.send(zipBuffer);
    } catch (error) {
        console.error('[EtiquetasController] Erro ao gerar ZIP dos carregadores:', error);
        res.status(500).json({ error: 'Erro interno ao gerar o arquivo ZIP de etiquetas.' });
    }
};
// --- Renderizar Painel de Gestão da Expedição ---
exports.renderDashboardExpedicao = (req, res) => {
    try {
        res.render('etiquetas/dashboard-expedicao', {
            title: 'Dashboard de Expedição',
            // Variáveis de contexto podem ser passadas aqui futuramente
        });
    } catch (error) {
        console.error('[EtiquetasController] Erro ao renderizar Dashboard de Expedição:', error);
        res.status(500).send('Erro ao carregar o painel de expedição.');
    }
};
// --- NOVOS MÉTODOS: DASHBOARD DE EXPEDIÇÃO (API AJAX) ---
exports.apiGetDashboardExpedicao = async (req, res) => {
    try {
        const dados = await etiquetasService.obterDadosDashboardExpedicao();
        res.json(dados);
    } catch (error) {
        console.error('[EtiquetasController] Erro ao buscar dados do dashboard:', error);
        res.status(500).json({ error: 'Erro ao carregar dados.' });
    }
};

exports.apiGetHistoricoExpedicoes = async (req, res) => {
    try {
        const historico = await etiquetasService.obterHistoricoExpedicoes();
        res.json(historico);
    } catch (error) {
        console.error('[EtiquetasController] Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro ao carregar histórico.' });
    }
};

exports.apiDownloadRelatorioExpedicao = async (req, res) => {
    try {
        const { data } = req.params;
        const buffer = await etiquetasService.gerarRelatorioExcelExpedicao(data);
        
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Expedicao_${data}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('[EtiquetasController] Erro ao gerar Excel:', error);
        res.status(500).send('Erro ao gerar relatório Excel.');
    }
};

exports.apiExportarDinamicoExcel = async (req, res) => {
    try {
        const { tipo, linhas } = req.body;
        if (!linhas || linhas.length === 0) {
            return res.status(400).send('Lista vazia.');
        }

        const buffer = await etiquetasService.gerarExcelDinamicoDataTable(linhas, tipo);
        
        res.setHeader('Content-Disposition', `attachment; filename="Base_Dinamica.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('[EtiquetasController] Erro ao gerar Excel Dinâmico:', error);
        res.status(500).send('Erro ao gerar relatório Excel Dinâmico.');
    }
};
exports.renderBipagemExpedicao = (req, res) => { res.render('etiquetas/bipagem-expedicao', { title: 'Bipagem Expedição' }); };
exports.apiGetColetas = async (req, res) => { res.json(await etiquetasService.listarColetasAtivas()); };
exports.apiPostColeta = async (req, res) => { res.json(await etiquetasService.criarColeta()); };
exports.apiDeleteColeta = async (req, res) => { 
    try {
        await etiquetasService.deletarColeta(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
};
exports.apiGetPaletes = async (req, res) => { res.json(await etiquetasService.listarPaletesPorColeta(req.params.coletaId)); };
exports.apiPostPalete = async (req, res) => { res.json(await etiquetasService.criarPalete(req.body.coleta_id)); };
exports.apiDeletePalete = async (req, res) => { 
    try {
        await etiquetasService.deletarPalete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
};
exports.apiGetCarregadoresAtivos = async (req, res) => { res.json(await etiquetasService.listarCarregadoresAtivos()); };
exports.apiPostCarregador = async (req, res) => {
    try {
        const { nome, codigo_barras } = req.body;
        if (!nome || !codigo_barras) return res.status(400).json({ error: 'Nome e código são obrigatórios.' });
        const novo = await etiquetasService.criarCarregador(nome, codigo_barras);
        res.json(novo);
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao criar carregador.' });
    }
};
exports.apiDeleteCarregador = async (req, res) => {
    try {
        await etiquetasService.deletarCarregador(req.params.id);
        res.json({ success: true });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao deletar carregador.' });
    }
};
exports.apiIdentificarCodigo = async (req, res) => {
    try {
        const result = await etiquetasService.identificarCodigoBipado(req.body.codigo);
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao identificar código.' });
    }
};
exports.apiRegistrarBipagemExpedicao = async (req, res) => {
    try {
        const { palete_id, nf, carregadores } = req.body;
        await etiquetasService.registrarBipagemExpedicaoFinal(palete_id, nf, carregadores);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao registrar bipagem' });
    }
};
exports.apiValidarPinExpedicao = async (req, res) => {
    const { senhaDigitada } = req.body;
    if (!senhaDigitada) return res.status(400).json({ success: false, message: 'Senha não fornecida.' });
    const client = await pool.connect();
    try {
        const resSenha = await client.query('SELECT senha FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
        if (resSenha.rows.length === 0) return res.json({ success: false, message: 'Nenhuma senha (PIN) diária configurada ainda.' });
        if (senhaDigitada === resSenha.rows[0].senha) {
            return res.json({ success: true, message: 'PIN correto.' });
        } else {
            return res.json({ success: false, message: 'PIN incorreto.' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Erro ao validar senha.' });
    } finally {
        client.release();
    }
};
exports.apiAtualizarStatusPendencia = async (req, res) => {
    try {
        const { id, status } = req.body;
        // Validação de segurança para não aceitarem status malucos
        if (!['pendente', 'sem_estoque', 'cancelado'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido.' });
        }
        
        await etiquetasService.atualizarStatusPendenciaExpedicao(id, status);
        res.json({ success: true, message: 'Status atualizado com sucesso.' });
    } catch (error) {
        console.error('[EtiquetasController] Erro ao atualizar status da pendência:', error);
        res.status(500).json({ error: 'Erro ao atualizar o status.' });
    }
};
// ==========================================
// CRON: GERAÇÃO DA PALAVRA-PASSE DIÁRIA (00:00) 0 0 * * *
// ==========================================
cron.schedule('0 0 * * *', async () => {
    console.log('[CRON 00h] Gerando nova senha diária para o Excel de Separados...');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM senha_diaria_separacao');
    
        // Gera nova senha de 3 dígitos
        const novaSenha = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        await client.query('INSERT INTO senha_diaria_separacao (data_referencia, senha) VALUES (CURRENT_DATE, $1)', [novaSenha]);
        console.log(`[CRON 00h] Nova senha diária gerada com sucesso: ${novaSenha}`);
        
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[CRON 00h] Erro na rotina de Excel Separados:', error);
    } finally {
        client.release();
    }
});
const PDF_STORAGE_DIR = path.join(__dirname, '..', 'pdfEtiquetas');
const RECENT_PDF_DIR = path.join(__dirname, '..', 'pdfBipagensFinalizadas');
async function ensureRecentPdfDir() {
    try {
        await fs.mkdir(RECENT_PDF_DIR, { recursive: true });
        console.log(`Diretório de PDFs recentes criado em: ${RECENT_PDF_DIR}`);
    } catch (error) {
        console.error('Erro ao criar diretório de PDFs recentes:', error);
    }
}
ensureRecentPdfDir(); 
async function ensurePdfStorageDir() {
    try {
        await fs.mkdir(PDF_STORAGE_DIR, { recursive: true });
        console.log(`Diretório de armazenamento de PDFs verificado/criado em: ${PDF_STORAGE_DIR}`);
    } catch (error) {
        console.error('Erro ao criar diretório de armazenamento de PDFs:', error);
    }
}
ensurePdfStorageDir();
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});
// Configuração do Multer para upload de arquivos PDF em memória
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 450 * 1024 * 1024 }, // Limite de 450MB por requisição
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas PDFs são permitidos.'), false);
        }
    }
}).array('etiquetasPdfs', 500); // Permite até 500 arquivos com o name 'etiquetasPdfs'
const excelStorage = multer.memoryStorage();
const uploadExcel = multer({
    storage: excelStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10MB para Excel
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel' // .xls
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas Excel (.xlsx, .xls) é permitido.'), false);
        }
    }
}).single('nfExcelFile')
/**
 * Renderiza a página principal para upload das etiquetas e ativa a trava de sincronização.
 */
exports.renderEtiquetasPage = async (req, res) => {
    try {
        // --- LÓGICA NOVA: Limpeza de arquivos com mais de 1 dia (24h) ---
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let recentFiles = [];
        try {
            const files = await fs.readdir(RECENT_PDF_DIR);
            
            // Processa, deleta antigos e lista os recentes
            const fileStats = await Promise.all(files.map(async (file) => {
                const filePath = path.join(RECENT_PDF_DIR, file);
                const stats = await fs.stat(filePath);
                const fileAge = now - stats.birthtime.getTime();
                if (fileAge > ONE_DAY_MS) {
                    // Se tiver mais de 1 dia, deleta
                    await fs.unlink(filePath);
                    console.log(`[Limpeza Automática] Arquivo removido (expirado > 24h): ${file}`);
                    return null; // Retorna null para filtrar depois
                }
                return { 
                    name: file, 
                    date: stats.birthtime, 
                    timestamp: stats.birthtime.getTime() 
                };
            }));
            // Filtra os nulls e ordena do mais recente para o mais antigo
            recentFiles = fileStats
                .filter(f => f !== null)
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (err) {
            console.error("Erro ao gerenciar arquivos recentes:", err);
        }
        // ---------------------------------------------
        res.render('etiquetas/index', {
            title: 'Organizador de Etiquetas Mercado Livre',
            layout: 'main',
            recentFiles: recentFiles,
            helpers: {
                formatDateShort: (date) => {
                    if(!date) return '';
                    return new Date(date).toLocaleString('pt-BR');
                }
            }
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de etiquetas:', error);
        req.flash('error_msg', 'Não foi possível carregar a página do organizador de etiquetas.');
        res.redirect('/');
    }
};
async function getEstoqueParaEtiquetas(etiquetasInfo) {
    if (!etiquetasInfo || etiquetasInfo.length === 0) return {};
    
    const client = await pool.connect();
    try {
        const estoqueMapa = {};
        const skusParaConsultar = new Set();
        const nfesParaConsultar = [];
        // 1. Verificar Cache no Banco de Dados
        for (const info of etiquetasInfo) {
            const res = await client.query(
                'SELECT quantidade_estoque FROM nfe_estoque_relacao WHERE numero_nfe = $1 AND sku = $2',
                [info.nf, info.sku]
            );
            if (res.rows.length > 0) {
                estoqueMapa[info.nf] = res.rows[0].quantidade_estoque;
            } else {
                nfesParaConsultar.push(info);
                skusParaConsultar.add(info.sku);
            }
        }
        if (nfesParaConsultar.length === 0) return estoqueMapa;
        // 2. Buscar bling_id na cached_products
        const skusArray = Array.from(skusParaConsultar);
        const produtosRes = await client.query(
            'SELECT sku, bling_id FROM cached_products WHERE sku = ANY($1)',
            [skusArray]
        );
        const skuToBlingId = {};
        produtosRes.rows.forEach(p => skuToBlingId[p.sku] = p.bling_id);
        // 3. Consultar Bling API
        const blingIds = Object.values(skuToBlingId).filter(id => id != null);
        
        if (blingIds.length > 0) {
            const idsQuery = blingIds.map(id => `idsProdutos[]=${id}`).join('&');
            const url = `https://www.bling.com.br/Api/v3/estoques/saldos?${idsQuery}`;
            
            // Conforme sua regra, usando a conta 'lucas'
            const blingData = await blingApiGet(url, 'lucas');
            
            const estoquePorBlingId = {};
            if (blingData && blingData.data) {
                blingData.data.forEach(item => {
                    estoquePorBlingId[item.produto.id] = item.saldoFisicoTotal;
                });
            }
            // 4. Mapear para NF e salvar cache
            for (const info of nfesParaConsultar) {
                const blingId = skuToBlingId[info.sku];
                const saldo = estoquePorBlingId[blingId] || 0;
                estoqueMapa[info.nf] = saldo;
                await client.query(
                    `INSERT INTO nfe_estoque_relacao (numero_nfe, sku, quantidade_estoque) 
                     VALUES ($1, $2, $3) ON CONFLICT (numero_nfe, sku) DO NOTHING`,
                    [info.nf, info.sku, saldo]
                );
            }
        }
        return estoqueMapa;
    } catch (error) {
        console.error('Erro ao buscar estoque:', error);
        return {};
    } finally {
        client.release();
    }
}
exports.renderBipagemPage = (req, res) => {
    try {
        res.render('etiquetas/bipagem', {
            title: 'Bipagem de Etiquetas por Palete',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de bipagem:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de bipagem.');
        res.redirect('/');
    }
};
exports.validarProdutoFechado = async (req, res) => {
    const { componentSkus: scannedCodes } = req.body;
    if (!scannedCodes || !Array.isArray(scannedCodes) || scannedCodes.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum código de estrutura fornecido.' });
    }
    try {
        const resultado = await validarProdutoPorEstruturas(scannedCodes);
        return res.json(resultado);
    } catch (error) {
        console.error(`[Validar Produto] Erro ao processar conjunto de códigos:`, error);
        return res.status(500).json({ success: false, message: `Erro interno: ${error.message}` });
    }
};
exports.finalizarBipagem = async (req, res) => {
    const { scanList } = req.body;
    if (!scanList || !Array.isArray(scanList) || scanList.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum item bipado para finalizar.' });
    }
    try {
        // O serviço irá processar a lista, atualizar o DB e gerar o PDF
        const pdfBytes = await finalizarBipagem(scanList);
        const timestamp = Date.now();
        const pdfName = `Bipagem-Finalizada-${timestamp}.pdf`;
        // Salva no servidor de forma assíncrona (não precisa esperar para responder ao user)
        this.saveAndRotateRecentPdf(pdfBytes, pdfName);
        // Envia o PDF como resposta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfName}"`);
        res.send(pdfBytes);
    } catch (error) {
        console.error('[Finalizar Bipagem] Erro catastrófico:', error);
        // Retorna um JSON de erro em vez de um PDF
        return res.status(500).json({ success: false, message: `Erro ao gerar PDF: ${error.message}` });
    }
};
exports.downloadRecentPdf = async (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(RECENT_PDF_DIR, filename);
    // Segurança básica para evitar Directory Traversal
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).send('Nome de arquivo inválido.');
    }
    try {
        await fs.access(filePath); // Verifica se existe
        res.download(filePath);
    } catch (error) {
        res.status(404).send('Arquivo não encontrado ou expirado.');
    }
};
/**
 * Processa os arquivos PDF enviados, organiza e gera o relatório.
 */
exports.processAndOrganizeEtiquetas = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Erro no upload do multer:', err.message);
            req.flash('error_msg', `Erro no upload: ${err.message}`);
            return res.redirect('/etiquetas');
        }
        if (!req.files || req.files.length === 0) {
            req.flash('error_msg', 'Nenhum arquivo PDF foi enviado. Por favor, selecione os arquivos.');
            return res.redirect('/etiquetas');
        }
        try {
            console.log(`[Etiquetas] Recebidos ${req.files.length} arquivo(s) para processamento.`);
            const pdfInputs = req.files.map(file => ({
                buffer: file.buffer,
                originalFilename: file.originalname // Captura o nome original aqui
            }));
            // 1. Geramos o nome do arquivo ANTES de chamar o serviço.
            const timestamp = Date.now();
            const organizedPdfFilename = `Etiquetas-Organizadas-${timestamp}.pdf`;
            // 2. Passamos o nome do arquivo gerado (organizedPdfFilename) como segundo argumento.
            const { etiquetasPdf, relatorioPdf } = await processarEtiquetas(
                pdfInputs, 
                organizedPdfFilename, 
                async (dados) => await getEstoqueParaEtiquetas(dados) // <--- Injeção da lógica de estoque
            );
            
            //const timestamp = Date.now();
            //const organizedPdfFilename = `Etiquetas-Organizadas-${timestamp}.pdf`;
            const organizedPdfPath = path.join(PDF_STORAGE_DIR, organizedPdfFilename);
            try {
                await fs.writeFile(organizedPdfPath, etiquetasPdf);
                console.log(`PDF de etiquetas organizado salvo em: ${organizedPdfPath}`);
            } catch (saveError) {
                console.error('Erro ao salvar o PDF de etiquetas organizado:', saveError);
                // Continua mesmo se não salvar, mas loga o erro
            }
            // Configura a resposta para enviar um arquivo ZIP
            const zipName = `Etiquetas_e_Relatorio_${Date.now()}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
            const archive = archiver('zip', {
                zlib: { level: 9 } // Nível de compressão
            });
            // Finaliza a resposta quando o arquivo zip for fechado
            archive.on('end', () => res.end());
            // Trata erros durante a criação do zip
            archive.on('error', (err) => { throw err; });
            // Adiciona o stream de resposta ao archive
            archive.pipe(res);
            // Adiciona os PDFs ao arquivo zip
            archive.append(etiquetasPdf, { name: `Etiquetas-Organizadas.pdf` });
            archive.append(relatorioPdf, { name: `Relatorio-de-Produtos.pdf` });
            // Finaliza o processo de criação do zip
            await archive.finalize();
        } catch (error) {
            console.error('Erro catastrófico ao processar as etiquetas:', error);
            req.flash('error_msg', `Erro ao processar os PDFs: ${error.message}`);
            res.redirect('/etiquetas');
        }
    });
};
exports.buscarNfIndividual = async (req, res) => {
    const { nfNumero } = req.body;
    console.log(`[Busca NF] Recebida solicitação para NF: ${nfNumero}`);
    if (!nfNumero || !/^\d+$/.test(nfNumero)) {
        return res.status(400).json({ success: false, message: 'Número da Nota Fiscal inválido.' });
    }
    try {
        // Chama o serviço para buscar a etiqueta
        const resultado = await buscarEtiquetaPorNF(nfNumero);
        if (resultado.success) {
            console.log(`[Busca NF] Etiqueta para NF ${nfNumero} encontrada.`);
            // Responde com sucesso, indicando que a etiqueta foi encontrada
            // O frontend usará essa resposta para mostrar o modal de confirmação
            return res.json({ success: true, nf: nfNumero });
        } else {
            console.log(`[Busca NF] Etiqueta para NF ${nfNumero} não encontrada nos PDFs recentes.`);
            return res.status(404).json({ success: false, message: 'Etiqueta não encontrada nos arquivos armazenados.' });
        }
    } catch (error) {
        console.error(`[Busca NF] Erro ao buscar etiqueta para NF ${nfNumero}:`, error);
        return res.status(500).json({ success: false, message: 'Erro interno ao buscar a etiqueta.' });
    }
};
exports.downloadNfIndividual = async (req, res) => {
    const { nf } = req.params;
    console.log(`[Download NF] Recebida solicitação para download da NF: ${nf}`);
    if (!nf || !/^\d+$/.test(nf)) {
        res.status(400).send('Número da Nota Fiscal inválido.');
        return;
    }
    try {
        // Re-executa a busca para obter o buffer do PDF da etiqueta
        const resultado = await buscarEtiquetaPorNF(nf);
        if (resultado.success && resultado.pdfBuffer) {
            console.log(`[Download NF] Gerando PDF individual para NF ${nf}`);
            const fileName = `Etiqueta-NF-${nf}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(resultado.pdfBuffer);
        } else {
            console.log(`[Download NF] NF ${nf} não encontrada para download.`);
            res.status(404).send('Etiqueta não encontrada.');
        }
    } catch (error) {
        console.error(`[Download NF] Erro ao gerar PDF para NF ${nf}:`, error);
        res.status(500).send('Erro interno ao gerar o PDF da etiqueta.');
    }
};
exports.saveMlBipagemState = async (req, res) => {
    const stateData = req.body; // Espera o objeto { scanList, productAggregates, ... }
    const stateKey = 'mercado_livre_bipagem'; // Chave fixa
    if (!stateData || typeof stateData !== 'object') {
        return res.status(400).json({ success: false, message: "Dados de estado inválidos ou ausentes." });
    }
    const client = await pool.connect();
    try {
        // UPSERT: Insere se não existir, atualiza se existir
        const query = `
            INSERT INTO ml_bipagem_state (state_key, state_json)
            VALUES ($1, $2)
            ON CONFLICT (state_key)
            DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW();
        `;
        await client.query(query, [stateKey, stateData]);
        res.status(200).json({ success: true, message: "Estado da bipagem salvo com sucesso." });
    } catch (error) {
        console.error(`Erro ao salvar estado da bipagem ML:`, error);
        res.status(500).json({ success: false, message: "Erro interno ao salvar o estado." });
    } finally {
        client.release();
    }
};
exports.loadMlBipagemState = async (req, res) => {
    const stateKey = 'mercado_livre_bipagem'; // Chave fixa
    const client = await pool.connect();
    try {
        const query = `
            SELECT state_json FROM ml_bipagem_state WHERE state_key = $1;
        `;
        const result = await client.query(query, [stateKey]);
        if (result.rows.length > 0 && result.rows[0].state_json) {
            // Retorna o estado encontrado
            res.status(200).json({ success: true, state: result.rows[0].state_json });
        } else {
            // Retorna sucesso, mas com estado nulo (indica que não há nada salvo)
            res.status(200).json({ success: true, state: null });
        }
    } catch (error) {
        console.error(`Erro ao carregar estado da bipagem ML:`, error);
        res.status(500).json({ success: false, message: "Erro interno ao carregar o estado." });
    } finally {
        client.release();
    }
};
exports.renderMlEtiquetasListPage = async (req, res) => {
    try {
        // Busca os status distintos para popular o filtro
        const statusResult = await pool.query(`
            SELECT DISTINCT situacao FROM cached_etiquetas_ml
            WHERE situacao IS NOT NULL ORDER BY situacao ASC
        `);
        const statusList = statusResult.rows.map(row => row.situacao);
        res.render('etiquetas/listagem', { // Aponta para a nova view
            title: 'Listagem de Etiquetas Mercado Livre',
            layout: 'main',
            statusList: statusList, // Passa a lista de status para o <select>
            // Passa helpers que podem ser úteis no template
            helpers: {
                eq: (v1, v2) => v1 === v2,
                formatDate: (dateString) => {
                    if (!dateString) return 'N/A';
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return 'Inválido';
                    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' }); // Formato dd/mm/aaaa
                },
                 formatDateTime: function(dateString) {
                    if (!dateString) return 'N/A';
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return 'Data/Hora Inválida';
                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${day}/${month}/${year} ${hours}:${minutes}`;
                  }
            }
        });
    } catch (error) {
        console.error("Erro ao carregar a página de listagem de etiquetas ML:", error);
        req.flash('error', 'Erro ao carregar a página.');
        res.redirect('/etiquetas'); // Redireciona de volta para a página principal de etiquetas
    }
};
exports.getMlEtiquetasApi = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', situacao = '', startDate, endDate, sortBy = 'last_processed_at', sortOrder = 'DESC' } = req.query;
        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;
        if (situacao) {
            whereClauses.push(`situacao = $${paramIndex++}`);
            queryParams.push(situacao);
        }
        if (startDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') >= $${paramIndex++}`); // Compara apenas a data
            queryParams.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') <= $${paramIndex++}`); // Compara apenas a data
            queryParams.push(endDate);
        }
        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                nfe_numero ILIKE $${paramIndex} OR
                numero_loja ILIKE $${paramIndex} OR
                pack_id ILIKE $${paramIndex} OR
                skus ILIKE $${paramIndex} OR
                pdf_arquivo_origem ILIKE $${paramIndex}
            )`);
            queryParams.push(searchTerm);
            paramIndex++;
        }
        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        // Validação da ordenação para evitar SQL Injection
        const allowedSortColumns = ['id', 'nfe_numero', 'numero_loja', 'pack_id', 'skus', 'quantidade_total', 'pdf_pagina', 'pdf_arquivo_origem', 'situacao', 'created_at', 'last_processed_at'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'last_processed_at'; // Default seguro
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'; // Default seguro
        const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder} NULLS LAST`; // NULLS LAST é bom para datas
        // Query para buscar os dados da página
        const dataQuery = `
            SELECT
                id, nfe_numero, numero_loja, pack_id, skus, quantidade_total,
                locations, pdf_pagina, pdf_arquivo_origem, situacao,
                created_at, last_processed_at
            FROM cached_etiquetas_ml
            ${whereCondition}
            ${orderByClause}
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        const dataResult = await pool.query(dataQuery, [...queryParams, limit, offset]);
        // Query para contar o total de itens filtrados (para paginação)
        const countQuery = `SELECT COUNT(*) FROM cached_etiquetas_ml ${whereCondition};`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));
        res.status(200).json({
            etiquetasData: dataResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems }
        });
    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao buscar dados:", error);
        res.status(500).json({ message: "Erro ao buscar dados das etiquetas." });
    }
};
exports.exportMlEtiquetasExcel = async (req, res) => {
    try {
         const { search = '', situacao = '', startDate, endDate, sortBy = 'last_processed_at', sortOrder = 'DESC' } = req.query;
        // Reutiliza a lógica de filtros da API de busca
        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;
        if (situacao) {
            whereClauses.push(`situacao = $${paramIndex++}`);
            queryParams.push(situacao);
        }
        if (startDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') >= $${paramIndex++}`);
            queryParams.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') <= $${paramIndex++}`);
            queryParams.push(endDate);
        }
         if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                nfe_numero ILIKE $${paramIndex} OR
                numero_loja ILIKE $${paramIndex} OR
                pack_id ILIKE $${paramIndex} OR
                skus ILIKE $${paramIndex} OR
                pdf_arquivo_origem ILIKE $${paramIndex}
            )`);
            queryParams.push(searchTerm);
            paramIndex++;
        }
        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        // Ordenação (mesma lógica da API)
        const allowedSortColumns = ['id', 'nfe_numero', 'numero_loja', 'pack_id', 'skus', 'quantidade_total', 'pdf_pagina', 'pdf_arquivo_origem', 'situacao', 'created_at', 'last_processed_at'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'last_processed_at';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder} NULLS LAST`;
        // Busca TODOS os dados filtrados (sem LIMIT/OFFSET)
        const query = `
            SELECT
                nfe_numero AS "NF-e",
                numero_loja AS "Venda",
                pack_id AS "Pack ID",
                skus AS "SKUs",
                quantidade_total AS "Qtd. Total",
                locations AS "Localização",
                pdf_arquivo_origem AS "Arquivo PDF",
                pdf_pagina AS "Página",
                situacao AS "Situação",
                last_processed_at AS "Última Atualização"
            FROM cached_etiquetas_ml
            ${whereCondition}
            ${orderByClause};
        `;
        const result = await pool.query(query, queryParams);
        const data = result.rows;
        if (data.length === 0) {
            // Se não houver dados, retorna erro 404 (ou redireciona com flash)
            return res.status(404).send('Nenhum dado encontrado para os filtros selecionados.');
        }
        // Gera o Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Etiquetas Mercado Livre');
        // Adiciona cabeçalhos baseados nas chaves do primeiro objeto (que já estão renomeadas com AS)
        worksheet.columns = Object.keys(data[0]).map(key => ({
            header: key, // Usa o nome da coluna SQL (com AS) como cabeçalho
            key: key,
            width: key === 'SKUs' || key === 'Arquivo PDF' ? 30 : (key === 'Localização' ? 20 : 15) // Ajusta larguras
        }));
        // Formata cabeçalho
        worksheet.getRow(1).font = { bold: true };
        // Adiciona os dados
        worksheet.addRows(data);
        // Formata colunas de data/hora
        const dateColumn = worksheet.getColumn('Última Atualização');
        dateColumn.numFmt = 'dd/mm/yyyy hh:mm:ss';
        const pageColumn = worksheet.getColumn('Página');
        // Adiciona 1 à página para exibição (índice 0 -> página 1)
        pageColumn.eachCell({ includeEmpty: false }, (cell) => {
            if (cell.value !== null && cell.value !== undefined && cell.row > 1) { // Pula cabeçalho
                cell.value = cell.value + 1;
            }
        });
        // Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Etiquetas_ML_${Date.now()}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao gerar relatório Excel:", error);
        res.status(500).send("Erro ao gerar o relatório Excel.");
    }
};
exports.buscarNfLote = (req, res) => {
    uploadExcel(req, res, async (err) => {
        if (err) {
            // Erros do Multer (tipo/tamanho)
            console.error('Erro no upload do Excel (Multer):', err.message);
            // Retorna JSON para o fetch() do frontend
            return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo Excel foi enviado.' });
        }
        try {
            // Chama o novo serviço
            const { pdfBuffer, notFoundNfs } = await processarLoteNf(req.file.buffer);
            // Se o serviço rodou, envia o PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Etiquetas_Lote_NF_${Date.now()}.pdf"`);
            
            // **IMPORTANTE**: Passa as NFs não encontradas para o frontend através de um header customizado
            if (notFoundNfs.length > 0) {
                res.setHeader('X-Not-Found-NFs', notFoundNfs.join(','));
            }
            
            res.send(pdfBuffer);
        } catch (error) {
            // Erros do Service (Nenhuma NF encontrada, etc)
            console.error('Erro ao processar lote de NFs:', error);
            res.status(500).json({ success: false, message: `Erro ao processar o lote: ${error.message}` });
        }
    });
};
exports.saveAndRotateRecentPdf = async (pdfBuffer, filename) => {
    try {
        const filePath = path.join(RECENT_PDF_DIR, filename);
        
        // 1. Salva o novo arquivo
        await fs.writeFile(filePath, pdfBuffer);
        
        // 2. Lê todos os arquivos da pasta
        const files = await fs.readdir(RECENT_PDF_DIR);
        
        // 3. Mapeia para obter estatísticas (data de criação)
        const fileStats = await Promise.all(files.map(async (file) => {
            const fullPath = path.join(RECENT_PDF_DIR, file);
            const stats = await fs.stat(fullPath);
            return { file, time: stats.birthtime.getTime(), fullPath };
        }));
        // 4. Ordena do mais novo para o mais antigo
        fileStats.sort((a, b) => b.time - a.time);
        // 5. Se tiver mais de 5, apaga os excedentes (os mais antigos)
        /*if (fileStats.length > 5) {
            const filesToDelete = fileStats.slice(5);
            for (const fileData of filesToDelete) {
                await fs.unlink(fileData.fullPath);
                console.log(`[Rotação] Arquivo antigo removido: ${fileData.file}`);
            }
        }*/
    } catch (error) {
        console.error('Erro na rotação de PDFs recentes:', error);
    }
}
exports.exportMlSkuQuantityReport = async (req, res) => {
    console.log("[API Etiquetas ML] Iniciando geração de relatório SKU/Qtd Pendente...");
    const client = await pool.connect();
    try {
        // 1. Busca todas as etiquetas com situação 'pendente'
        const query = `
            SELECT skus, quantidade_total
            FROM cached_etiquetas_ml
            WHERE situacao = 'pendente';
        `;
        const result = await client.query(query);
        const etiquetasPendentes = result.rows;
        if (etiquetasPendentes.length === 0) {
            console.log("[API Etiquetas ML] Nenhuma etiqueta pendente encontrada.");
            // Retorna um status indicando que não há dados, em vez de um arquivo vazio
            return res.status(404).send('Nenhuma etiqueta pendente encontrada para gerar o relatório.');
        }
        // 2. Agrega as quantidades por SKU
        const skuQuantityMap = new Map();
        etiquetasPendentes.forEach(etiqueta => {
            const skusString = etiqueta.skus || '';
            const quantidade = etiqueta.quantidade_total || 0; // Quantidade da ETIQUETA (geralmente 1?)
            const skusArray = skusString.split(',').map(s => s.trim()).filter(Boolean);
            skusArray.forEach(sku => {
                // Aqui estamos somando a 'quantidade_total' da etiqueta para cada SKU nela contido.
                // Se uma etiqueta tem 2 SKUs e quantidade_total=1, ambos SKUs terão +1 na contagem.
                // Se precisar da quantidade específica do SKU na NF, a lógica muda.
                skuQuantityMap.set(sku, (skuQuantityMap.get(sku) || 0) + quantidade);
            });
        });
        // 3. Prepara os dados para o Excel e calcula o total geral
        let totalGeral = 0;
        const dataForExcel = [];
        // Ordena por SKU alfabeticamente
        const sortedSkus = Array.from(skuQuantityMap.keys()).sort();
        sortedSkus.forEach(sku => {
            const quantidade = skuQuantityMap.get(sku);
            dataForExcel.push({ SKU: sku, Quantidade: quantidade });
            totalGeral += quantidade;
        });
        // Adiciona a linha de total
        dataForExcel.push({}); // Linha em branco
        dataForExcel.push({ SKU: 'TOTAL GERAL', Quantidade: totalGeral });
        // 4. Gera o arquivo Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('SKUs Pendentes');
        worksheet.columns = [
            { header: 'SKU', key: 'SKU', width: 40 },
            { header: 'Quantidade Pendente', key: 'Quantidade', width: 25, style: { numFmt: '0' } } // Formata como número inteiro
        ];
        // Formata cabeçalho
        worksheet.getRow(1).font = { bold: true };
        // Adiciona os dados
        worksheet.addRows(dataForExcel);
        // Formata a linha de total
        const totalRow = worksheet.getRow(worksheet.rowCount); // Pega a última linha
        totalRow.font = { bold: true };
        totalRow.getCell('A').alignment = { horizontal: 'right' };
        totalRow.getCell('B').numFmt = '0'; // Garante formatação de número
        console.log("[API Etiquetas ML] Relatório SKU/Qtd Pendente gerado com sucesso.");
        // 5. Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_SKU_Quantidade_Pendente_${Date.now()}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao gerar relatório SKU/Qtd Pendente:", error);
        res.status(500).send("Erro ao gerar o relatório de SKUs pendentes.");
    } finally {
        if (client) client.release();
    }
};
exports.renderGondolaPage = async (req, res) => {
    const client = await pool.connect();
    try {
        // Tenta buscar a senha de hoje
        let resSenha = await client.query('SELECT senha FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
        let senhaDoDia = '';
        // Se por algum motivo (ex: servidor foi reiniciado e perdeu o cron) não tiver, gera agora (Fallback)
        if (resSenha.rows.length > 0) {
            senhaDoDia = resSenha.rows[0].senha;
        } else {
            senhaDoDia = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            await client.query('INSERT INTO senha_diaria_separacao (data_referencia, senha) VALUES (CURRENT_DATE, $1)', [senhaDoDia]);
        }
        res.render('etiquetas/gondola', {
            title: 'Gerenciamento de Gôndola',
            layout: 'main',
            senhaDoDia: senhaDoDia // Passamos a variável nativamente para o Handlebars
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de gôndola:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de Gôndola.');
        res.redirect('/etiquetas');
    } finally {
        client.release();
    }
};
exports.buscarEstruturaGondola = async (req, res) => {
    const { codigoBipado } = req.body;
    if (!codigoBipado) return res.status(400).json({ success: false, message: 'Código não fornecido.' });
    const client = await pool.connect();
    try {
        // Busca a estrutura pelo SKU, GTIN ou GTIN_EMBALAGEM
        const structQuery = `
            SELECT component_sku, structure_name
            FROM cached_structures
            WHERE component_sku = $1 OR gtin = $1 OR gtin_embalagem = $1
            LIMIT 1;
        `;
        const structRes = await client.query(structQuery, [codigoBipado]);
        
        if (structRes.rows.length === 0) {
            return res.json({ success: false, message: 'Estrutura não encontrada no sistema.' });
        }
        // Retorna a estrutura encontrada para o frontend ir agrupando e somando
        res.json({ success: true, estrutura: structRes.rows[0] });
    } catch (error) {
        console.error('[Gôndola] Erro ao buscar estrutura:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao buscar estrutura.' });
    } finally {
        client.release();
    }
};
exports.salvarRelatorioGondola = async (req, res) => {
    const { state_json } = req.body;
    
    if (!state_json || !state_json.itens || state_json.itens.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum item bipado para salvar.' });
    }
    const client = await pool.connect();
    try {
        const now = new Date();
        const dataStr = now.toLocaleDateString('pt-BR');
        const horaStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const nomeRelatorio = `Gôndola - ${dataStr} e ${horaStr}`;
        const query = `
            INSERT INTO relatorios_gondola (nome, state_json, created_at)
            VALUES ($1, $2, NOW())
            RETURNING id, nome, created_at;
        `;
        
        const result = await client.query(query, [nomeRelatorio, state_json]);
        res.json({ success: true, relatorio: result.rows[0] });
    } catch (error) {
        console.error('[Gôndola] Erro ao salvar relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar relatório de gôndola.' });
    } finally {
        client.release();
    }
};
/*exports.salvarRelatorioGondola = async (req, res) => {
    const { state_json } = req.body;
    
    if (!state_json || !state_json.itens || state_json.itens.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum item bipado para salvar.' });
    }
    const client = await pool.connect();
    try {
        const now = new Date();
        const dataStr = now.toLocaleDateString('pt-BR');
        const horaStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const nomeRelatorio = `Gôndola - ${dataStr} e ${horaStr}`;
        const query = `
            INSERT INTO relatorios_gondola (nome, state_json, created_at)
            VALUES ($1, $2, NOW())
            RETURNING id, nome, created_at;
        `;
        
        const result = await client.query(query, [nomeRelatorio, state_json]);
        res.json({ success: true, relatorio: result.rows[0] });
    } catch (error) {
        console.error('[Gôndola] Erro ao salvar relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar relatório de gôndola.' });
    } finally {
        client.release();
    }
};*/
exports.listarRelatoriosGondola = async (req, res) => {
    const client = await pool.connect();
    try {
        const query = `
            SELECT id, nome, created_at, state_json
            FROM relatorios_gondola
            ORDER BY created_at DESC;
        `;
        const result = await client.query(query);
        res.json({ success: true, relatorios: result.rows });
    } catch (error) {
        console.error('[Gôndola] Erro ao listar relatórios:', error);
        res.status(500).json({ success: false, message: 'Erro ao carregar histórico.' });
    } finally {
        client.release();
    }
};
exports.excluirRelatorioGondola = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM relatorios_gondola WHERE id = $1', [id]);
        res.json({ success: true, message: 'Relatório excluído com sucesso.' });
    } catch (error) {
        console.error('[Gôndola] Erro ao excluir relatório:', error);
        res.status(500).json({ success: false, message: 'Erro ao excluir relatório.' });
    } finally {
        client.release();
    }
};
// Passo 1: Recebe os PDFs, extrai tudo e devolve um resumo pro Modal
exports.preProcessarEtiquetas = (req, res) => {
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: 'Nenhum PDF enviado.' });
        try {
            const pdfInputs = req.files.map(file => ({
                buffer: file.buffer,
                originalFilename: file.originalname
            }));
            // Cria o nome do arquivo aqui para passar para o service
            const timestamp = Date.now();
            const organizedPdfFilename = `Etiquetas-Organizadas-${timestamp}.pdf`;
            // Chama o Service de verdade!
            const resultado = await preProcessarEtiquetasService(pdfInputs, organizedPdfFilename);
            
            // NOVO: Verifica no banco se existe uma senha/excel gerado HOJE
            let excelDisponivel = false;
            const client = await pool.connect();
            try {
                const resSenha = await client.query('SELECT id FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
                if (resSenha.rows.length > 0) excelDisponivel = true;
            } finally {
                client.release();
            }
            
            // Retorna os dados calculados + a flag do Excel
            res.json({ 
                success: true, 
                batchId: resultado.batchId, 
                resumoProdutos: resultado.resumoProdutos,
                excelDisponivel: excelDisponivel // Manda para o frontend
            });
            
        } catch (error) {
            console.error('[Pré-processamento] Erro:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
};
// Passo 2: Recebe as confirmações do Modal (Abatimentos + ID da Gôndola) e GERA o ZIP
exports.finalizarProcessamentoEtiquetas = async (req, res) => {
    try {
        const { batchId, abatimentosManuais, gondolaId } = req.body;
        
        let gondolaState = null;
        let nomeGondolaFormatado = 'Relatorio-Gondola'; // Fallback de segurança
        if (gondolaId) {
            const client = await pool.connect();
            try {
                // Modificado para resgatar também o NOME do relatório
                const result = await client.query('SELECT nome, state_json FROM relatorios_gondola WHERE id = $1', [gondolaId]);
                if (result.rows.length > 0) {
                    gondolaState = result.rows[0].state_json;
                    
                    // Formata o nome para ser seguro como ficheiro no Windows/Linux (troca barras e dois pontos)
                    // Ex: "Gôndola - 10/10/2023 e 15:30" vira "Gôndola - 10-10-2023 e 15h30"
                    nomeGondolaFormatado = result.rows[0].nome.replace(/\//g, '-').replace(/:/g, 'h');
                }
            } finally {
                client.release();
            }
        }
        // Chama o Service para gerar os PDFs (agora extraindo relatorioGondolaPdf)
        const { etiquetasPdf, relatorioPdf, relatorioGondolaPdf, organizedPdfFilename } = await finalizarEtiquetasService(batchId, abatimentosManuais, gondolaState);
        // Salva o PDF de etiquetas na pasta do servidor
        const organizedPdfPath = path.join(PDF_STORAGE_DIR, organizedPdfFilename);
        try {
            await fs.writeFile(organizedPdfPath, etiquetasPdf);
        } catch (saveError) {
            console.error('Erro ao salvar o PDF de etiquetas organizado:', saveError);
        }
        // Configura a resposta para baixar um arquivo ZIP contendo os PDFs
        const zipName = `Etiquetas_e_Relatorios_${Date.now()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.on('end', () => res.end());
        archive.on('error', (err) => { throw err; });
        
        archive.pipe(res);
        archive.append(etiquetasPdf, { name: `Etiquetas-Organizadas.pdf` });
        archive.append(relatorioPdf, { name: `Relatorio-de-Produtos-Prateleiras.pdf` });
        
        // NOVO: Adiciona o relatório da Gôndola ao ZIP apenas se ele tiver sido gerado (se houver produtos)
        if (relatorioGondolaPdf) {
            archive.append(relatorioGondolaPdf, { name: `${nomeGondolaFormatado}.pdf` });
        }
        
        await archive.finalize();
    } catch (error) {
        console.error('[Finalizar Processamento] Erro:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// ==========================================
// MÓDULO DE RELATÓRIO EXCEL (JÁ SEPARADOS)
// ==========================================
exports.uploadSeparadosExcel = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Lê o Excel enviado
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];
        let totalLidos = 0;
        const dadosExcel = {};
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Ignora o cabeçalho
            const sku = row.getCell(1).value;
            const qtdStr = row.getCell(2).value;
            //const ondaValue = row.getCell(3).value; 
            // TRAVA DE SEGURANÇA
            if (!sku || !qtdStr /*|| !ondaValue*/) return;
            const quantidade = parseInt(qtdStr, 10) || 0;
            /*const onda = ondaValue.toString().trim().toUpperCase();*/
            const skuUpper = sku.toString().trim().toUpperCase();
            if (quantidade > 0) {
                const chave = `${skuUpper}`;
                // Acumula as quantidades se a mesma chave aparecer mais de uma vez na planilha
                dadosExcel[chave] = (dadosExcel[chave] || 0) + quantidade;
                totalLidos++;
            }
        });
        if (totalLidos === 0) {
            throw new Error('A planilha está vazia ou num formato inválido.');
        }
        // Cria o nome do relatório com a data atual
        const dataAtual = new Date();
        const nomeRelatorio = `Planilha de Separação - ${dataAtual.toLocaleDateString('pt-BR')} às ${dataAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        // Insere o relatório no histórico
        await client.query(
            'INSERT INTO historico_separados_excel (nome, state_json) VALUES ($1, $2)', 
            [nomeRelatorio, JSON.stringify(dadosExcel)]
        );
        // Limpeza Automática: Mantém apenas os 5 mais recentes e apaga o resto
        await client.query(`
            DELETE FROM historico_separados_excel 
            WHERE id NOT IN (
                SELECT id FROM historico_separados_excel 
                ORDER BY created_at DESC 
                LIMIT 5
            )
        `);
        // Gerencia a Senha Diária
        let senhaDoDia = '';
        const resSenha = await client.query('SELECT senha FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
        
        if (resSenha.rows.length > 0) {
            senhaDoDia = resSenha.rows[0].senha;
        } else {
            senhaDoDia = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            await client.query('INSERT INTO senha_diaria_separacao (data_referencia, senha) VALUES (CURRENT_DATE, $1)', [senhaDoDia]);
        }
        await client.query('COMMIT');
        res.json({ 
            success: true, 
            message: `${totalLidos} linhas importadas e guardadas no histórico com sucesso!`,
            senha: senhaDoDia
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Excel Separados] Erro no upload:', error);
        res.status(500).json({ success: false, message: error.message || 'Erro ao processar o arquivo Excel.' });
    } finally {
        client.release();
    }
};
exports.validarSenhaExcel = async (req, res) => {
    // Agora recebe também o historicoId selecionado pelo usuário
    const { senhaDigitada, historicoId } = req.body;
    
    if (!senhaDigitada) return res.status(400).json({ success: false, message: 'Senha não fornecida.' });
    if (!historicoId) return res.status(400).json({ success: false, message: 'Nenhum relatório selecionado.' });
    const client = await pool.connect();
    try {
        const resSenha = await client.query('SELECT senha FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
        
        if (resSenha.rows.length === 0) {
            return res.json({ success: false, message: 'Nenhum Excel de separados foi enviado hoje.' });
        }
        const senhaCorreta = resSenha.rows[0].senha;
        if (senhaDigitada === senhaCorreta) {
            // Busca diretamente os dados do relatório que o usuário selecionou na combobox
            const excelRes = await client.query('SELECT state_json FROM historico_separados_excel WHERE id = $1', [historicoId]);
            
            if (excelRes.rows.length === 0) {
                return res.json({ success: false, message: 'Relatório selecionado não encontrado no histórico.' });
            }
            const dadosExcel = excelRes.rows[0].state_json;
            res.json({ success: true, message: 'Senha validada com sucesso.', dadosExcel });
        } else {
            res.json({ success: false, message: 'PIN Incorreto.' });
        }
    } catch (error) {
        console.error('[Excel Separados] Erro na validação da senha:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao validar senha.' });
    } finally {
        client.release();
    }
};
// ==========================================
// ROTA: LISTAR HISTÓRICO DE SEPARADOS EXCEL
// ==========================================
exports.listarHistoricoSeparadosExcel = async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT id, nome, created_at FROM historico_separados_excel ORDER BY created_at DESC LIMIT 5');
        res.json({ success: true, relatorios: result.rows });
    } catch (error) {
        console.error('[Excel Separados] Erro ao listar histórico:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar histórico de planilhas.' });
    } finally {
        client.release();
    }
};
// ==========================================
// MÓDULO DE ONDAS (UPLOAD EXCEL)
// ==========================================
exports.uploadOndasExcel = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 1. Limpa a tabela atual (Substituição 100%)
        await client.query('TRUNCATE TABLE ondas_ml');
        // 2. Lê o Excel enviado
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0]; 
        let totalImportados = 0;
        worksheet.eachRow((row, rowNumber) => {
            const codigo = row.getCell(1).value?.toString().trim();
            let horario = row.getCell(2).value;
            const cor = row.getCell(3).value?.toString().trim();
            // Pula cabeçalhos (se houver) e linhas vazias
            if (codigo && horario && cor && codigo.toLowerCase() !== 'código') {
                // Trata o formato de hora do Excel (que pode vir como objeto Date)
                if (horario instanceof Date) {
                    // Extrai apenas o HH:mm:ss usando os métodos UTC para evitar fuso horário errado
                    horario = `${String(horario.getUTCHours()).padStart(2, '0')}:${String(horario.getUTCMinutes()).padStart(2, '0')}:00`;
                } else {
                    horario = horario.toString().trim();
                }
                client.query('INSERT INTO ondas_ml (codigo, horario, cor) VALUES ($1, $2, $3)', [codigo, horario, cor]);
                totalImportados++;
            }
        });
        await client.query('COMMIT');
        res.json({ success: true, message: `${totalImportados} rotas de onda importadas com sucesso!` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Ondas Excel] Erro no upload:', error);
        res.status(500).json({ success: false, message: 'Erro ao processar a planilha de Ondas.' });
    } finally {
        client.release();
    }
};
// ==========================================
// MÓDULO: RELATÓRIO DA TARDE
// ==========================================
exports.renderRelatorioTardePage = (req, res) => {
    res.render('etiquetas/relatorioTarde', {
        title: 'Gerador de Relatório da Tarde',
        layout: 'main'
    });
};
exports.uploadRelatorioTarde = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 1. Carrega o mapeamento de CEPs para a memória
        const resCeps = await client.query('SELECT cep_cabeca, onda FROM ceps_onda');
        const cepsMap = new Map();
        resCeps.rows.forEach(row => {
            cepsMap.set(row.cep_cabeca, row.onda);
        });
        // 2. Lê a planilha de Vendas do Mercado Livre
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];
        let totalProcessados = 0;
        const dadosRelatorio = {};
        worksheet.eachRow((row, rowNumber) => {
            // Regra: Os pedidos começam a partir da linha 7
            if (rowNumber < 7) return; 
            // Coluna G = 7, Coluna U = 21, Coluna AM = 39
            const qtdValue = row.getCell(7).value; 
            const skuValue = row.getCell(21).value; 
            const cepValue = row.getCell(39).value; 
            if (!skuValue || !qtdValue || !cepValue) return;
            const quantidade = parseInt(qtdValue, 10) || 0;
            const sku = skuValue.toString().trim();
            
            // Extrai rigorosamente os ÚLTIMOS 5 dígitos do CEP
            const cepStr = String(cepValue).replace(/\D/g, '').padStart(8, '0');
            const cepCabeca = cepStr.slice(-4);
            if (quantidade > 0 && sku) {
                // Formata o CEP da planilha
                const cepStr = String(cepValue).replace(/\D/g, '').padStart(8, '0');
                
                let cepCabeca;
                if (cepStr.startsWith('0')) {
                    cepCabeca = cepStr.substring(1, 5);
                } else {
                    cepCabeca = cepStr.substring(0, 5);
                }
                // Busca a cor. Se não achar, assume INDEFINIDA.
                const ondaCor = cepsMap.get(cepCabeca) || 'INDEFINIDA';
                
                const chave = `${sku}|${ondaCor}`;
                if (!dadosRelatorio[chave]) {
                    dadosRelatorio[chave] = { sku: sku, onda: ondaCor, quantidade: 0 };
                }
                dadosRelatorio[chave].quantidade += quantidade;
                totalProcessados++;
            }
        });
        if (totalProcessados === 0) {
            throw new Error('Nenhum dado válido de pedido encontrado a partir da linha 7.');
        }
        // Transforma o objeto num array estruturado para salvar
        const arrayRelatorio = Object.values(dadosRelatorio);
        // Cria o nome do relatório
        const dataAtual = new Date();
        const nomeRelatorio = `Relatório da Tarde - ${dataAtual.toLocaleDateString('pt-BR')} às ${dataAtual.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        // Salva no banco de dados (histórico)
        await client.query(
            'INSERT INTO historico_relatorio_tarde (nome, state_json) VALUES ($1, $2)',
            [nomeRelatorio, JSON.stringify(arrayRelatorio)]
        );
        // Limpeza Automática: Mantém apenas os 5 mais recentes
        await client.query(`
            DELETE FROM historico_relatorio_tarde 
            WHERE id NOT IN (
                SELECT id FROM historico_relatorio_tarde 
                ORDER BY created_at DESC 
                LIMIT 5
            )
        `);
        await client.query('COMMIT');
        res.json({ success: true, message: 'Relatório da Tarde gerado e salvo no histórico com sucesso!' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Relatório Tarde] Erro no upload:', error);
        res.status(500).json({ success: false, message: error.message || 'Erro ao processar a planilha de vendas.' });
    } finally {
        client.release();
    }
};
exports.listarHistoricoRelatorioTarde = async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT id, nome, created_at FROM historico_relatorio_tarde ORDER BY created_at DESC LIMIT 5');
        res.json({ success: true, relatorios: result.rows });
    } catch (error) {
        console.error('[Relatório Tarde] Erro ao listar histórico:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar histórico.' });
    } finally {
        client.release();
    }
};
exports.excluirHistoricoRelatorioTarde = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('DELETE FROM historico_relatorio_tarde WHERE id = $1', [id]);
        res.json({ success: true, message: 'Relatório excluído com sucesso.' });
    } catch (error) {
        console.error('[Relatório Tarde] Erro ao excluir:', error);
        res.status(500).json({ success: false, message: 'Erro ao tentar excluir o relatório.' });
    } finally {
        client.release();
    }
};
exports.downloadHistoricoRelatorioTarde = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT nome, state_json FROM historico_relatorio_tarde WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Relatório não encontrado.');
        }
        const { nome, state_json } = result.rows[0];
        
        // 1. Coletar os SKUs e buscar os tipo_ml agilmente no Banco
        const skusArray = [...new Set(state_json.map(s => s.sku))];
        let tipoMap = {};
        if (skusArray.length > 0) {
            const prodRes = await client.query('SELECT sku, tipo_ml FROM cached_products WHERE sku = ANY($1::text[])', [skusArray]);
            prodRes.rows.forEach(p => {
                tipoMap[p.sku] = p.tipo_ml ? p.tipo_ml.trim().toUpperCase() : 'OUTROS';
            });
        }
        
        // 2. Agrupar os itens do Excel pelo Tipo 
        const grupos = {}; 
        state_json.forEach(item => {
            let t = tipoMap[item.sku];
            if (!t) t = 'OUTROS';
            if (!grupos[t]) grupos[t] = [];
            grupos[t].push(item);
        });

        // 3. Montar as colunas dinâmicas par a par no Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Relatório da Tarde');
        
        const types = Object.keys(grupos).sort();
        let columns = [];
        types.forEach(t => {
            columns.push({ header: `${t} - SKU`, key: `sku_${t}`, width: 35 });
            columns.push({ header: `QTD`, key: `qtd_${t}`, width: 12 });
            columns.push({ header: `ONDA`, key: `onda_${t}`, width: 18 });
            columns.push({ header: '', key: `space_${t}`, width: 3 }); // Espaçador
        });
        worksheet.columns = columns;

        // Estilização do Header
        worksheet.getRow(1).eachCell(cell => {
            if(cell.value) { // Ignorar header nulo do espaçador
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1F1F' } };
                cell.alignment = { horizontal: 'center' };
            }
        });

        // 4. Inserir linha a linha respeitando a capacidade máxima do maior grupo
        const maxRows = Math.max(...types.map(t => grupos[t].length));
        for (let i = 0; i < maxRows; i++) {
            let rowObj = {};
            types.forEach(t => {
                const item = grupos[t][i];
                if (item) {
                    rowObj[`sku_${t}`] = item.sku;
                    rowObj[`qtd_${t}`] = item.quantidade;
                    rowObj[`onda_${t}`] = item.onda;
                }
            });
            const excelRow = worksheet.addRow(rowObj);
            
            // Centralizar Qtd e Onda
            types.forEach(t => {
                const qtdCell = excelRow.getCell(`qtd_${t}`);
                if(qtdCell) qtdCell.alignment = { horizontal: 'center' };
                const ondaCell = excelRow.getCell(`onda_${t}`);
                if(ondaCell) ondaCell.alignment = { horizontal: 'center' };
            });
        }

        const nomeSeguro = nome.replace(/[\/\:]/g, '-');
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeSeguro}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('[Relatório Tarde] Erro ao gerar Excel:', error);
        res.status(500).send('Erro ao gerar arquivo de Excel.');
    } finally {
        client.release();
    }
};
// ==========================================
// CONTROLLERS: BIPAGEM EM MASSA (MOBILE)
// ==========================================
exports.renderBipagemMassa = (req, res) => {
    res.render('etiquetas/bipagem-massa', {
        title: 'Bipagem em Massa - Expedição',
        layout: 'main'
    });
};
exports.apiValidarBipagemMassa = async (req, res) => {
    try {
        const { codigo } = req.body;
        if (!codigo) return res.status(400).json({ success: false, message: 'Código não fornecido.' });
        const result = await etiquetasService.validarNftBipagemMassa(codigo);
        res.json(result);
    } catch (error) {
        console.error('[Bipagem em Massa] Erro na validação:', error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao validar NF.' });
    }
};
exports.apiAtualizarBipagemMassa = async (req, res) => {
    try {
        const { nfList, novoStatus } = req.body;
        if (!nfList || nfList.length === 0 || !novoStatus) {
            return res.status(400).json({ success: false, message: 'Lista vazia ou status ausente.' });
        }
        const result = await etiquetasService.atualizarStatusEmLote(nfList, novoStatus);
        res.json(result);
    } catch (error) {
        console.error('[Bipagem em Massa] Erro ao atualizar lote:', error);
        res.status(500).json({ success: false, message: error.message || 'Erro ao processar lote.' });
    }
};
exports.apiGetHierarquiaHoje = async (req, res) => {
    try {
        const dados = await etiquetasService.obterHierarquiaExpedicaoHoje();
        res.json({ success: true, data: dados });
    } catch (error) {
        console.error('[Expedição] Erro ao buscar hierarquia de hoje:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar hierarquia.' });
    }
};