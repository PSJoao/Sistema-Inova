const express = require('express');
const router = express.Router();
const emissaoController = require('../controllers/emissaoController'); // Controller da Emissão
const authController = require('../controllers/authController');     // Seu controller de autenticação

// Middleware de autenticação para todas as rotas deste router
// Se a página de emissão não precisar de autenticação, você pode remover ou comentar esta linha.
router.use(authController.requireAuth);
// Rotas serão protegidas individualmente abaixo

router.get('/emissao', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.getEmissaoPage);

router.get('/emissao/all', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.getAllEmissions);

router.post('/emissao/save-finalized', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.createAndFinalizeEmissao);

router.get('/emissao/:id/details', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.getEmissaoDetails);

router.delete('/emissao/:id/remove', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.removeEmissao);

router.post('/emissao/acquire-lock', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.acquireEmissionLock);

router.post('/emissao/release-lock', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.releaseEmissionLock);

router.post('/emissao/api/nfe-sync/trigger', authController.requireModule('faturamento_gerenciar_emissoes'), emissaoController.triggerManualNfeSync);

router.get('/emissao/nfe-management', authController.requireModule('faturamento_gerar_etiquetas'), emissaoController.getNfeManagementPage);

router.get('/api/emissao/nfe-cache', authController.requireModule('faturamento_gerar_etiquetas'), emissaoController.getNfeCacheApi);

router.get('/emissao/print-labels', authController.requireModule('faturamento_gerar_etiquetas'), emissaoController.getPrintLabelsPage);

module.exports = router;