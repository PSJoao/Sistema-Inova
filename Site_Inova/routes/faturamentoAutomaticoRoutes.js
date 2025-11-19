const express = require('express');
const router = express.Router();
const faturamentoController = require('../controllers/faturamentoAutomaticoController');
const authController = require('../controllers/authController');

// Rota POST para iniciar o faturamento
// Protegida por login (requireAuth) para segurança
router.use(authController.requireAuth);

router.post('/iniciar', faturamentoController.handleFaturamentoManual);

module.exports = router;