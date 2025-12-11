const express = require('express');
const router = express.Router();
const faturamentoController = require('../controllers/faturamentoAutomaticoController');
const authController = require('../controllers/authController');

// Protegida por login (requireAuth) para segurança
router.use(authController.requireAuth);

// Rota POST para iniciar o faturamento (Existente)
router.post('/iniciar', faturamentoController.handleFaturamentoManual);

// --- NOVAS ROTAS ---

// 1. Página HTML de listagem
router.get('/', faturamentoController.renderListPage);

// 2. API JSON para buscar dados do grid (com filtros e paginação)
router.get('/api/list', faturamentoController.getPendingNotes);

// 3. Rota para download do Excel
router.get('/api/report', faturamentoController.generateReport);

module.exports = router;