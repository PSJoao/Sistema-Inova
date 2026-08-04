// Em routes/blingWebhookRoutes.js
const express = require('express');
const router = express.Router();
const blingWebhookController = require('../controllers/blingWebhookController');

// === DIAGNÓSTICO: Log de QUALQUER requisição que chega nesta rota ===
router.use((req, res, next) => {
    console.log(`[Bling Webhook DIAGNÓSTICO] ${req.method} ${req.originalUrl} recebido de IP: ${req.ip} | Content-Type: ${req.headers['content-type']} | Body vazio? ${!req.body || Object.keys(req.body).length === 0}`);
    next();
});

// === DIAGNÓSTICO: Endpoint GET para testar acessibilidade pelo navegador ===
// Acesse https://inovaxpress.org/webhooks/bling no navegador - deve retornar JSON
router.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Endpoint de webhook do Bling está ativo e acessível!',
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    });
});

// Rota principal que recebe TODOS os POSTs do Bling
router.post('/', blingWebhookController.handleWebhook);

module.exports = router;