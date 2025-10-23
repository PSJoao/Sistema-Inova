// controllers/etiquetasController.js
const multer = require('multer');
const { processarEtiquetas, buscarEtiquetaPorNF, validarProdutoPorEstruturas, finalizarBipagem } = require('../services/etiquetasService');
const archiver = require('archiver');
const fs = require('fs').promises;
const path = require('path');

const PDF_STORAGE_DIR = path.join(__dirname, '..', 'pdfEtiquetas');

async function ensurePdfStorageDir() {
    try {
        await fs.mkdir(PDF_STORAGE_DIR, { recursive: true });
        console.log(`Diretório de armazenamento de PDFs verificado/criado em: ${PDF_STORAGE_DIR}`);
    } catch (error) {
        console.error('Erro ao criar diretório de armazenamento de PDFs:', error);
    }
}
ensurePdfStorageDir();

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
}).array('etiquetasPdfs', 50); // Permite até 50 arquivos com o name 'etiquetasPdfs'

/**
 * Renderiza a página principal para upload das etiquetas e ativa a trava de sincronização.
 */
exports.renderEtiquetasPage = (req, res) => {
    try {
        res.render('etiquetas/index', {
            title: 'Organizador de Etiquetas Mercado Livre',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de etiquetas:', error);
        req.flash('error_msg', 'Não foi possível carregar a página do organizador de etiquetas.');
        res.redirect('/');
    }
};

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
            const { etiquetasPdf, relatorioPdf } = await processarEtiquetas(pdfInputs, organizedPdfFilename);

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