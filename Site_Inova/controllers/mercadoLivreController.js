const mercadoLivreService = require('../services/mercadoLivreService');

// Mostra a página de upload
exports.showOrganizerPage = (req, res) => {
    res.render('mercado-livre/organizer', {
        title: 'Organizador de Etiquetas Mercado Livre',
        username: req.session.username,
        cargo: req.session.role
    });
};

// Processa o arquivo PDF enviado
exports.processLabels = async (req, res) => {
    if (!req.file) {
        req.flash('error_msg', 'Nenhum arquivo foi enviado.');
        return res.redirect('/mercado-livre/organizer');
    }

    try {
        const pdfBuffer = req.file.buffer;
        const organizedPdfBuffer = await mercadoLivreService.organizeLabelsPdf(pdfBuffer);

        // Define o nome do arquivo para download
        const fileName = `etiquetas-organizadas-${Date.now()}.pdf`;

        // Envia o PDF organizado para o cliente
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(organizedPdfBuffer);

    } catch (error) {
        console.error('Erro ao processar o PDF:', error);
        req.flash('error_msg', 'Ocorreu um erro ao processar o arquivo PDF. Verifique se o formato está correto.');
        res.redirect('/mercado-livre/organizer');
    }
};