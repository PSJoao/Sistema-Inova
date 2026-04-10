const { poolHub } = require('../config/database');

exports.handleNotification = async (req, res) => {
    try {
        // O Mercado Livre envia um POST com { resource, user_id, topic, application_id }
        const { topic, resource, user_id } = req.body;

        console.log(`[HUB Webhook] Notificação recebida: Tópico ${topic} | Resource: ${resource} | User: ${user_id}`);

        // AQUI É O PULO DO GATO:
        // O ML só avisa "algo mudou". Nós precisamos responder "200 OK" rápido
        // e depois processar os dados em segundo plano (ou deixar o Cron pegar depois).
        // Por enquanto, apenas respondemos OK para manter a integração saudável.
        
        res.status(200).send('OK');

    } catch (error) {
        console.error('[HUB Webhook] Erro ao processar notificação:', error);
        res.status(500).send('Erro interno');
    }
};