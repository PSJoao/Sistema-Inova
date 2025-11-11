// Em controllers/blingWebhookController.js
const blingWebhookService = require('../services/blingWebhookService');

exports.handleWebhook = (req, res) => {
    // 1. RESPONDA 200 OK IMEDIATAMENTE!
    res.status(200).send('OK');

    // 2. Pegue os dados e processe de forma assíncrona (depois de já ter respondido)
    const { dados } = req.body;

    if (!dados) {
        console.log('[Bling Webhook] Requisição recebida sem o campo "dados".');
        return;
    }

    try {
        // 3. Parseie o JSON que veio dentro do campo "dados"
        const payload = JSON.parse(dados);

        // 4. Envie para o Service decidir o que fazer
        blingWebhookService.processWebhook(payload);

    } catch (err) {
        console.error('[Bling Webhook] Erro ao processar webhook:', err.message);
        console.error(err.stack);
    }
};