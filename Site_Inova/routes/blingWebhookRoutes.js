// Em routes/blingWebhookRoutes.js
const express = require('express');
const router = express.Router();
const blingWebhookController = require('../controllers/blingWebhookController');

// Rota principal que recebe TODOS os POSTs do Bling
// A URL final será /webhooks/bling
router.post('/', blingWebhookController.handleWebhook);

module.exports = router;