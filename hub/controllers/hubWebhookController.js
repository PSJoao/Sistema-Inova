const { poolHub } = require('../config/database');
const hubMercadoLivreService = require('../services/hubMercadoLivreService');

exports.handleNotification = async (req, res) => {
    try {
        // O Mercado Livre envia um POST com { resource, user_id, topic, application_id }
        const { topic, resource, user_id } = req.body;

        // Responder rapidamente ao ML para evitar timeout e retries desnecessários
        res.status(200).send('OK');

        // Disparar o processamento em segundo plano, SEM travar a resposta
        if (topic === 'orders_v2' || topic === 'shipments') {
            hubMercadoLivreService.processarWebhookStatus(topic, resource, user_id).catch(err => {
                console.error('[HUB Webhook Background] Erro não tratado no background:', err);
            });
        }

    } catch (error) {
        console.error('[HUB Webhook] Erro ao processar notificação:', error);
        if (!res.headersSent) {
            res.status(500).send('Erro interno');
        }
    }
};