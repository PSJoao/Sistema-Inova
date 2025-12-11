// Em controllers/blingWebhookController.js
const blingWebhookService = require('../services/blingWebhookService');

exports.handleWebhook = (req, res) => {
    // 1. REGRA DE OURO: Responda ao Bling antes de processar!
    res.status(200).send('OK');

    const { dados } = req.body;

    // Se veio vazio, ignora
    if (!dados) return;

    try {
        // O Bling envia um JSON string dentro do campo 'dados' do form-urlencoded
        const payload = JSON.parse(dados);

        // Dispara o processamento sem 'await' para não segurar a resposta (se por acaso a resposta não tivesse sido enviada antes)
        blingWebhookService.processWebhook(payload);

    } catch (err) {
        console.error('[Bling Webhook] Erro de Parse:', err.message);
    }
};