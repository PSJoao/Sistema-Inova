const express = require('express');
const router = express.Router();
const assistenciaController = require('../controllers/assistenciaController');
const authController = require('../controllers/authController');

// Middleware para garantir que todas as rotas de assistência exijam login
router.use(authController.requireAuth);

// --- ROTAS DA API (para consumo do frontend via JavaScript) ---
router.get('/api/assistencias', assistenciaController.getAssistenciasAPI);
router.get('/api/nf-origem/:numero', assistenciaController.findNfOrigemAPI);
router.post('/api/find-nfe-bling/:numero', assistenciaController.findNfInBlingAPI);
router.get('/api/solicitantes', assistenciaController.getSolicitantes);
router.get('/api/fabricas', assistenciaController.getFabricas);
router.post('/api/solicitantes', assistenciaController.addSolicitante);
router.post('/api/fabricas', assistenciaController.addFabrica);
router.get('/api/assistencia-by-chave/:chave', assistenciaController.findAssistenciaByChaveAPI);
router.post('/api/bulk-resolve-volumes', assistenciaController.bulkResolveVolumesAPI);
// LINHA A SER ADICIONADA ABAIXO
router.post('/api/update-volume-status/:produto_id', assistenciaController.updateVolumeStatusAPI);


// --- ROTAS DE PÁGINAS E AÇÕES ---
router.get('/', assistenciaController.showListagemPage);
router.get('/nova', assistenciaController.showNovaAssistenciaForm);
router.get('/resolucao-massa', assistenciaController.showResolucaoMassaPage);
router.post('/', assistenciaController.createAssistencia);
router.get('/:id', assistenciaController.showDetalhesAssistencia);
router.post('/resolver/:id', assistenciaController.resolveAssistencia);

// --- ROTAS DE EDIÇÃO (AGORA ATIVADAS) ---
router.get('/editar/:id', assistenciaController.showEditForm);
router.post('/update/:id', assistenciaController.updateAssistencia);

router.get('/pdf/:id', assistenciaController.generatePdf);

router.get('/etiqueta/:id/:produto_id', assistenciaController.generateAssistenciaLabel);

router.get('/excel/run-excel-import-script', assistenciaController.importFromExcel);

router.post('/api/bulk-update-status', assistenciaController.bulkUpdateStatusAPI);

router.post('/api/update-status/:id', assistenciaController.updateSingleStatusAPI);

router.get('/api/sku/:sku', assistenciaController.getSkuDetailsAPI);

router.get('/api/product-structures/:sku', assistenciaController.getProductStructuresAPI);

router.get('/api/exportar-assistencias', assistenciaController.exportAssistenciasExcel);

router.get('/etiquetas-estrutura/:id', assistenciaController.generateStructureLabels);

module.exports = router;