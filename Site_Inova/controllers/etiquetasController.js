// controllers/etiquetasController.js
const multer = require('multer');
const { processarEtiquetas } = require('../services/etiquetasService');
const archiver = require('archiver');

// Configuração do Multer para upload de arquivos PDF em memória
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 250 * 1024 * 1024 }, // Limite de 250MB por requisição
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas PDFs são permitidos.'), false);
        }
    }
}).array('etiquetasPdfs', 20); // Permite até 20 arquivos com o name 'etiquetasPdfs'

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

            const pdfBuffers = req.files.map(file => file.buffer);

            // O serviço agora retorna um objeto com os dois PDFs
            const { etiquetasPdf, relatorioPdf } = await processarEtiquetas(pdfBuffers);

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