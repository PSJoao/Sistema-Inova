// Em controllers/blingWebhookController.js
const blingWebhookService = require('../services/blingWebhookService');

exports.handleWebhook = (req, res) => {
    // 1. REGRA DE OURO: Responda ao Bling imediatamente (status 200 OK) para evitar retentativas/bloqueio
    res.status(200).send('OK');

    try {
        let payload = req.body;

        // Bling V2 (legado) envia form-urlencoded com o campo 'dados' contendo JSON string
        // Bling V3 (API v3 / Developer portal) envia application/json direto na raiz do body
        if (payload && payload.dados) {
            payload = typeof payload.dados === 'string' ? JSON.parse(payload.dados) : payload.dados;
        } else if (typeof payload === 'string') {
            payload = JSON.parse(payload);
        }

        // Se após a conversão não houver objeto válido, ignora
        if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
            //console.log('[Bling Webhook] Corpo da requisição recebido está vazio ou inválido:', req.body);
            return;
        }

        //console.log(`[Bling Webhook] Evento recebido: "${payload.event || 'desconhecido'}" | CompanyID: "${payload.companyId || 'N/A'}" | EventID: "${payload.eventId || 'N/A'}"`);

        // Dispara o processamento assíncrono
        blingWebhookService.processWebhook(payload);

    } catch (err) {
        console.error('[Bling Webhook] Erro ao interpretar payload:', err.message, 'Body bruto:', req.body);
    }
};