// routes/etiquetasRoutes.js
const express = require('express');
const router = express.Router();
const etiquetasController = require('../controllers/etiquetasController');
const authController = require('../controllers/authController');

// Protege todas as rotas deste módulo com autenticação
router.use('/etiquetas', authController.requireAuth);

// Rota para exibir a página de upload de etiquetas
// GET /etiquetas
router.get('/etiquetas', etiquetasController.renderEtiquetasPage);

router.get('/etiquetas/bipagem', etiquetasController.renderBipagemPage);

router.post('/etiquetas/validar-produto-fechado', etiquetasController.validarProdutoFechado);

// Rota para finalizar a bipagem e gerar o PDF
// POST /etiquetas/finalizar-bipagem
router.post('/etiquetas/finalizar-bipagem', etiquetasController.finalizarBipagem);

router.post('/etiquetas/bipagem/save-state', etiquetasController.saveMlBipagemState);

router.get('/etiquetas/bipagem/load-state', etiquetasController.loadMlBipagemState);

// Rota para processar os arquivos PDF enviados
// POST /etiquetas/processar
router.post('/etiquetas/processar', etiquetasController.processAndOrganizeEtiquetas);

router.post('/etiquetas/buscar-nf', etiquetasController.buscarNfIndividual);

router.get('/etiquetas/download-individual/:nf', etiquetasController.downloadNfIndividual);

router.get('/etiquetas/listagem', etiquetasController.renderMlEtiquetasListPage);

router.get('/api/etiquetas/listagem', etiquetasController.getMlEtiquetasApi);

router.get('/api/etiquetas/exportar', etiquetasController.exportMlEtiquetasExcel);

router.get('/api/etiquetas/exportar-sku-qtd', etiquetasController.exportMlSkuQuantityReport);

module.exports = router;