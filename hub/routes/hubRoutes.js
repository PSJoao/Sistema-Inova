const express = require('express');
const router = express.Router();
const hubApiController = require('../controllers/hubApiController');
const { verifyHubToken } = require('../middleware/auth');
// Importaremos os controllers de integração OAuth abaixo
const hubOAuthController = require('../controllers/hubOAuthController'); 
const hubAmazonOAuthController = require('../controllers/hubAmazonOAuthController');
const hubWebhookController = require('../controllers/hubWebhookController');

// Rotas Públicas (Login)
router.post('/api/login', hubApiController.login);

// Rotas Privadas (Dados) - Exige Token
router.get('/api/pedidos', verifyHubToken, hubApiController.getPedidos);
router.get('/api/pedidos/monitoramento-instantaneo', verifyHubToken, hubApiController.monitoramentoInstantaneo);

// Novas Rotas On-Demand de Sincronização (Gatilhos HTTP sem chamada à API de Etiquetas)
router.post('/api/pedidos/sincronizar/novos', verifyHubToken, hubApiController.sincronizarNovosPedidos);
router.post('/api/pedidos/sincronizar/diferentes', verifyHubToken, hubApiController.sincronizarPedidosDiferentes);
router.post('/api/pedidos/sincronizar/existentes', verifyHubToken, hubApiController.sincronizarPedidosExistentes);
router.post('/api/pedidos/sincronizar/devolucoes', verifyHubToken, hubApiController.sincronizarDevolucoes);

// Rota Dedicada e Isolada para Obtenção/Download Real de Etiquetas
router.post('/api/pedidos/etiquetas/obter', verifyHubToken, hubApiController.obterEtiquetasEnvio);
router.get('/api/pedidos/etiquetas/:id_envio', verifyHubToken, hubApiController.baixarEtiquetaPorEnvio);

// Rota para buscar todos os pedidos vinculados a um ID de Envio específico
router.get('/api/envios/:id_envio', verifyHubToken, hubApiController.getEnvioPorId);

// Rotas de Integração (Para conectar o ML)
router.get('/auth/mercadolibre', hubOAuthController.iniciarAuth);
router.get('/auth/mercadolibre/callback', hubOAuthController.processarCallback);

// Rotas de Integração (Para conectar a Amazon SP-API)
router.get('/auth/amazon', hubAmazonOAuthController.iniciarAuth);
router.get('/auth/amazon/callback', hubAmazonOAuthController.processarCallback);

// Rota de Webhook (Mercado Livre)
router.post('/webhooks/mercadolibre', hubWebhookController.handleNotification);

//router.post('/api/produtos/sync', verifyHubToken, hubApiController.sincronizarProdutos);

router.get('/api/produtos', verifyHubToken, hubApiController.getProdutos);

// Rota para sincronização manual de anúncios por seller_ids
router.post('/api/produtos/sync-manual', verifyHubToken, hubApiController.sincronizarProdutosManuais);

// Rota para busca específica (aceita ID do Anúncio MLB... ou o SKU)
router.get('/api/produtos/:identificador', verifyHubToken, hubApiController.getProdutoPorId);

// Rotas de Prazo de Disponibilidade (MANUFACTURING_TIME)
router.put('/api/anuncios/prazo-disponibilidade', verifyHubToken, hubApiController.setPrazoDisponibilidade);
router.delete('/api/anuncios/prazo-disponibilidade', verifyHubToken, hubApiController.removerPrazoDisponibilidade);

// Rotas de Gestão de Promoções (Opt-In / Opt-Out)
router.post('/api/promocoes/opt-in', verifyHubToken, hubApiController.aderirPromocao);
router.post('/api/promocoes/opt-out', verifyHubToken, hubApiController.removerPromocao);
router.delete('/api/promocoes/opt-out', verifyHubToken, hubApiController.removerPromocao);

module.exports = router;