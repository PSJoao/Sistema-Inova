// routes/nfeHistoryRoutes.js

const express = require('express');
const router = express.Router();
const nfeHistoryController = require('../controllers/nfeHistoryController');
const authController = require('../controllers/authController');

// Middleware de autenticação para todas as rotas deste arquivo
router.use(authController.requireAuth);

/**
 * Rota principal para renderizar a nova página de Histórico de NF-e.
 * Acessível via: GET /historico-nfe
 */
router.get('/', nfeHistoryController.renderNfeHistoryPage);

/**
 * Rota da API para buscar os dados da tabela de histórico com filtros.
 * Acessível via: GET /historico-nfe/api/history
 */
router.get('/api/history', nfeHistoryController.getNfeHistoryApi);

/**
 * Rota da API para contar as estruturas dos produtos.
 * Acessível via: POST /historico-nfe/api/missing-product-count
 */
router.post('/api/missing-product-count', nfeHistoryController.getMissingProductCountApi);

router.get('/api/report/missing-products', nfeHistoryController.generateMissingProductsReport);

router.post('/api/nfe/clear-justification', nfeHistoryController.limparJustificativaNfe);

router.post('/api/nfe/update-justification', nfeHistoryController.updateNfeJustification);

router.post('/api/nfe/cancel', nfeHistoryController.cancelarNfe);

router.get('/api/nfe/generate-report', nfeHistoryController.generateMissingProductsReport);

router.get('/api/nfe/generate-report-justifications', nfeHistoryController.generateJustificationsReport);

module.exports = router;