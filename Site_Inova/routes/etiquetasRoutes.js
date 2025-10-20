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

// Rota para processar os arquivos PDF enviados
// POST /etiquetas/processar
router.post('/etiquetas/processar', etiquetasController.processAndOrganizeEtiquetas);

router.post('/etiquetas/buscar-nf', etiquetasController.buscarNfIndividual);

router.get('/etiquetas/download-individual/:nf', etiquetasController.downloadNfIndividual);

module.exports = router;