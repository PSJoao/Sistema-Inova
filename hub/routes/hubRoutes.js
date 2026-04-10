const express = require('express');
const router = express.Router();
const hubApiController = require('../controllers/hubApiController');
const { verifyHubToken } = require('../middleware/auth');
// Importaremos o controller de integração OAuth abaixo
const hubOAuthController = require('../controllers/hubOAuthController'); 
const hubWebhookController = require('../controllers/hubWebhookController');

// Rotas Públicas (Login)
router.post('/api/login', hubApiController.login);

// Rotas Privadas (Dados) - Exige Token
router.get('/api/pedidos', verifyHubToken, hubApiController.getPedidos);

// Rota para buscar todos os pedidos vinculados a um ID de Envio específico
router.get('/api/envios/:id_envio', verifyHubToken, hubApiController.getEnvioPorId);

// Rotas de Integração (Para conectar o ML)
router.get('/auth/mercadolibre', hubOAuthController.iniciarAuth);
router.get('/auth/mercadolibre/callback', hubOAuthController.processarCallback);

// Rota de Webhook
router.post('/webhooks/mercadolibre', hubWebhookController.handleNotification);

//router.post('/api/produtos/sync', verifyHubToken, hubApiController.sincronizarProdutos);

router.get('/api/produtos', verifyHubToken, hubApiController.getProdutos);

// Rota para busca específica (aceita ID do Anúncio MLB... ou o SKU)
router.get('/api/produtos/:identificador', verifyHubToken, hubApiController.getProdutoPorId);

module.exports = router;