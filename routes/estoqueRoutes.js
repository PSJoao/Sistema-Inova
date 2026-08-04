const express = require('express');
const router = express.Router();
const estoqueController = require('../controllers/estoqueController');
const authController = require('../controllers/authController');

// Middleware para garantir que todas as rotas de estoque exijam login
router.use(authController.requireAuth);
// Rotas serão protegidas individualmente abaixo

// --- ROTAS DA API (para consumo do frontend via JavaScript) ---
router.get('/api/pecas', authController.requireModule('produtos_estoque_dev'), estoqueController.getPecasAPI);
router.get('/api/search-produto-pai', authController.requireModule('produtos_estoque_dev'), estoqueController.searchProdutoPaiAPI);
router.get('/api/search-nome-peca', authController.requireModule('produtos_estoque_dev'), estoqueController.searchNomePecaAPI);
router.get('/api/fabricas', authController.requireModule('produtos_estoque_dev'), estoqueController.getFabricas);
router.post('/api/fabricas', authController.requireModule('produtos_estoque_dev'), estoqueController.addFabrica);
router.get('/api/verificar-sku/:sku', authController.requireModule('produtos_estoque_dev'), estoqueController.verificarSkuAPI);
router.get('/api/verificar-numero-peca/:numero', authController.requireModule('produtos_estoque_dev'), estoqueController.verificarNumeroPecaAPI);
router.post('/api/bipar', authController.requireModule('produtos_bipagem_pecas'), estoqueController.biparPecaAPI);
router.post('/api/state', authController.requireModule('produtos_estoque_dev'), estoqueController.savePageState);

// --- ROTAS DE PÁGINAS E AÇÕES ---
router.get('/', authController.requireModule('produtos_estoque_dev'), estoqueController.showListagemPage);
router.get('/nova', authController.requireModule('produtos_estoque_dev'), estoqueController.showNovaPecaForm);
router.get('/editar/:id', authController.requireModule('produtos_estoque_dev'), estoqueController.showEditForm);
router.get('/bipagem', authController.requireModule('produtos_bipagem_pecas'), estoqueController.showBipagemPage);
router.get('/pdf-etiquetas/:id', authController.requireModule('produtos_estoque_dev'), estoqueController.gerarEtiquetasPdf);
router.post('/', authController.requireModule('produtos_estoque_dev'), estoqueController.createPeca);
router.post('/update/:id', authController.requireModule('produtos_estoque_dev'), estoqueController.updatePeca);
router.post('/delete/:id', authController.requireModule('produtos_estoque_dev'), estoqueController.deletePeca);

module.exports = router;
