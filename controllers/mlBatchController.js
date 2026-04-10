// controllers/mlBatchController.js

const path = require('path');
const fs = require('fs');
const mlBatchService = require('../services/mlBatchService');

/**
 * Renderiza a página de upload da conferência em lote (ML).
 */
exports.renderUploadPage = (req, res) => {
    res.render('conferencia/ml-batch-upload', {
        title: 'Conferência ML em Lote (Upload)',
        user: req.session.username // Mantendo o padrão de mostrar o usuário logado
    });
};

/**
 * Processa o upload da planilha e retorna o relatório para download.
 */
exports.processUpload = async (req, res) => {
    // O Multer (middleware nas rotas) já deve ter salvo o arquivo em req.file
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado. Por favor, selecione uma planilha.');
    }

    const inputFilePath = req.file.path;

    try {
        // Chama o serviço que criamos anteriormente
        // Ele vai demorar um pouco (pois tem os delays de 400ms), 
        // então o navegador vai ficar "carregando" até o download começar.
        const reportFileName = await mlBatchService.processarArquivoDePedidos(inputFilePath);

        const reportsDir = path.join(__dirname, '..', 'reports');
        const reportPath = path.join(reportsDir, reportFileName);

        // Envia o arquivo gerado para download
        res.download(reportPath, reportFileName, (err) => {
            if (err) {
                console.error('[ML Batch Controller] Erro no download:', err);
                if (!res.headersSent) {
                    res.status(500).send('Erro ao baixar o relatório gerado.');
                }
            }

            // Limpeza (Opcional, mas recomendada): 
            // Apaga o arquivo de UPLOAD original para não encher o disco
            try {
                if (fs.existsSync(inputFilePath)) {
                    fs.unlinkSync(inputFilePath);
                }
            } catch (cleanupErr) {
                console.error('[ML Batch Controller] Erro ao limpar arquivo de upload:', cleanupErr);
            }
            
            // Nota: Não apagamos o relatório gerado imediatamente pois o usuário pode querer baixar de novo se der erro de rede,
            // mas você pode criar um cron job para limpar a pasta 'reports' depois.
        });

    } catch (error) {
        console.error('[ML Batch Controller] Erro no processamento:', error);
        
        // Se der erro, tentamos limpar o upload também
        try {
            if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
        } catch (e) {}

        res.status(500).render('conferencia/ml-batch-upload', {
            title: 'Conferência ML em Lote (Upload)',
            error: 'Erro ao processar a planilha: ' + error.message,
            user: req.session.username
        });
    }
};

exports.renderMappingPage = (req, res) => {
    res.render('conferencia/ml-mapping-upload', {
        title: 'Mapeamento Pack ID (Upload)',
        user: req.session.username
    });
};

// [NOVO] Processa o upload da planilha de Mapeamento
exports.processMappingUpload = async (req, res) => {
    // Verifica se o arquivo chegou
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
    }

    const inputFilePath = req.file.path;

    try {
        // Chama a nova função do service que criamos
        const result = await mlBatchService.processarArquivoDeMapeamento(inputFilePath);
        
        // Retorna JSON para o modal.js exibir o sucesso
        res.json(result);

    } catch (error) {
        console.error('[ML Mapping Controller] Erro:', error);
        
        // Limpeza de arquivo em caso de erro
        try { 
            if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath); 
        } catch (e) {}

        // Retorna erro em JSON
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao processar planilha: ' + error.message 
        });
    }
};