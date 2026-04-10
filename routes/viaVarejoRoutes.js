const express = require('express');
const router = express.Router();
const viaVarejoController = require('../controllers/viaVarejoController');
const authController = require('../controllers/authController');

//Rota de login
router.use(authController.requireAuth);

// Rota para exibir as URLs do Via Varejo
router.get('/viavarejo/urls', viaVarejoController.getViaVarejoUrls);

// Rota para exibir os produtos sem concorrentes
router.get('/viavarejo/non-competitive-products', viaVarejoController.getNonCompetitiveProducts);

// Rota para exibir a página de produtos vazios
router.get('/viavarejo/empty-products', viaVarejoController.getEmptyProducts);

// Rota para exibir a página inicial
router.get('/viavarejo/home', viaVarejoController.getMonitoringProducts);

module.exports = router;
