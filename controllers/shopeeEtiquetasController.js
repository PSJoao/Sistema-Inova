// controllers/shopeeEtiquetasController.js
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const shopeeEtiquetasService = require('../services/shopeeEtiquetasService');

// Configuração do banco de dados para buscar a gôndola e o status do excel
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const PDF_STORAGE_DIR = path.join(__dirname, '..', 'pdfEtiquetas');

// Configuração do Multer (mantendo o limite de 450MB igual ao do ML)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 450 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas PDFs são permitidos.'), false);
        }
    }
}).array('etiquetasPdfs', 500); 

/**
 * Passo 1 (Shopee): Recebe os PDFs, extrai tudo e devolve um resumo pro Modal
 */
exports.preProcessarEtiquetasShopee = (req, res) => {
    upload(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: 'Nenhum PDF enviado.' });

        try {
            const pdfInputs = req.files.map(file => ({
                buffer: file.buffer,
                originalFilename: file.originalname
            }));

            const timestamp = Date.now();
            const organizedPdfFilename = `Etiquetas-Shopee-Organizadas-${timestamp}.pdf`;

            // Recebe o status da chave (vem como string 'true' ou 'false' do FormData)
            const umaPorPagina = req.body.umaPorPagina === 'true';

            // Chama o Service da Shopee passando a nova flag
            const resultado = await shopeeEtiquetasService.preProcessarEtiquetasShopee(pdfInputs, organizedPdfFilename, umaPorPagina);
            
            // Verifica no banco se existe uma senha/excel gerado HOJE para abater manualmente
            let excelDisponivel = false;
            const client = await pool.connect();
            try {
                const resSenha = await client.query('SELECT id FROM senha_diaria_separacao WHERE data_referencia = CURRENT_DATE');
                if (resSenha.rows.length > 0) excelDisponivel = true;
            } finally {
                client.release();
            }
            
            // Retorna os dados calculados + a flag do Excel para montar o Modal no frontend
            res.json({ 
                success: true, 
                batchId: resultado.batchId, 
                resumoProdutos: resultado.resumoProdutos,
                excelDisponivel: excelDisponivel 
            });
            
        } catch (error) {
            console.error('[Shopee Pré-processamento] Erro:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    });
};

/**
 * Passo 2 (Shopee): Recebe as confirmações do Modal (Abatimentos + ID da Gôndola) e GERA o ZIP
 */
exports.finalizarProcessamentoEtiquetasShopee = async (req, res) => {
    try {
        const { batchId, abatimentosManuais, gondolaId } = req.body;
        
        let gondolaState = null;
        let nomeGondolaFormatado = 'Relatorio-Gondola-Shopee';

        if (gondolaId) {
            const client = await pool.connect();
            try {
                const result = await client.query('SELECT nome, state_json FROM relatorios_gondola WHERE id = $1', [gondolaId]);
                if (result.rows.length > 0) {
                    gondolaState = result.rows[0].state_json;
                    nomeGondolaFormatado = result.rows[0].nome.replace(/\//g, '-').replace(/:/g, 'h');
                }
            } finally {
                client.release();
            }
        }

        // Chama o Service para gerar os PDFs da Shopee
        const { etiquetasPdf, relatorioPdf, relatorioGondolaPdf, organizedPdfFilename } = await shopeeEtiquetasService.finalizarEtiquetasShopee(batchId, abatimentosManuais, gondolaState);

        // Salva o PDF de etiquetas na pasta do servidor
        const organizedPdfPath = path.join(PDF_STORAGE_DIR, organizedPdfFilename);
        try {
            await fs.writeFile(organizedPdfPath, etiquetasPdf);
        } catch (saveError) {
            console.error('Erro ao salvar o PDF de etiquetas Shopee organizado:', saveError);
        }

        // Configura a resposta para baixar um arquivo ZIP contendo os PDFs
        const zipName = `Etiquetas_e_Relatorios_Shopee_${Date.now()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 9 } });
        
        archive.on('end', () => res.end());
        archive.on('error', (err) => { throw err; });
        
        archive.pipe(res);
        archive.append(etiquetasPdf, { name: `Etiquetas-Shopee-Organizadas.pdf` });
        archive.append(relatorioPdf, { name: `Relatorio-de-Produtos-Prateleiras-Shopee.pdf` });
        
        // Adiciona o relatório da Gôndola ao ZIP apenas se ele tiver sido gerado
        if (relatorioGondolaPdf) {
            archive.append(relatorioGondolaPdf, { name: `${nomeGondolaFormatado}.pdf` });
        }
        
        await archive.finalize();

    } catch (error) {
        console.error('[Shopee Finalizar Processamento] Erro:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};