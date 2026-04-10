const express = require('express');
const router = express.Router();
const emissaoController = require('../controllers/emissaoController'); // Controller da Emissão
const authController = require('../controllers/authController');     // Seu controller de autenticação

// Middleware de autenticação para todas as rotas deste router
// Se a página de emissão não precisar de autenticação, você pode remover ou comentar esta linha.
router.use(authController.requireAuth);

router.get('/emissao', emissaoController.getEmissaoPage);

router.get('/emissao/all', emissaoController.getAllEmissions);

router.post('/emissao/save-finalized', emissaoController.createAndFinalizeEmissao);

router.get('/emissao/:id/details', emissaoController.getEmissaoDetails);

router.delete('/emissao/:id/remove', emissaoController.removeEmissao);

router.post('/emissao/acquire-lock', emissaoController.acquireEmissionLock);

router.post('/emissao/release-lock', emissaoController.releaseEmissionLock);

router.post('/emissao/api/nfe-sync/trigger', emissaoController.triggerManualNfeSync);

router.get('/emissao/nfe-management', emissaoController.getNfeManagementPage);

router.get('/api/emissao/nfe-cache', emissaoController.getNfeCacheApi);

router.get('/emissao/print-labels', emissaoController.getPrintLabelsPage);

module.exports = router;