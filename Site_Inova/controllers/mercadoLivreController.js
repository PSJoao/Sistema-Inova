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

// NOVO: Recebe notificações (Webhooks) do MELI
exports.handleWebhook = (req, res) => {
    console.log('[MELI Webhook] Notificação recebida:');
    
    // Apenas logamos o corpo da requisição para fins de debug futuro
    // Quando formos usar, o req.body terá a informação do evento
    console.log(JSON.stringify(req.body, null, 2));

    // Responde imediatamente com 200 OK para o Mercado Livre.
    // Isso é obrigatório para que o MELI saiba que recebemos 
    // e pare de enviar a mesma notificação.
    res.status(200).send('OK');
};