// routes/produtosRoutes.js
const express = require('express');
const router = express.Router();
const produtosController = require('../controllers/produtosController');
const authController = require('../controllers/authController');

// Protege todas as rotas deste módulo
router.use('/produtos', authController.requireAuth);

// --- Rotas de Renderização de View (Handlebars) ---

// Rota para exibir a página principal de listagem (a "casca")
// GET /produtos/listagem
router.get('/produtos/listagem', produtosController.renderProdutosListPage);

// Rota para exibir o formulário de EDIÇÃO de um PRODUTO (baseado no SKU)
// GET /produtos/editar/produto/:sku
router.get('/produtos/editar/produto/:sku', produtosController.renderEditProdutoPage);

// Rota para exibir o formulário de EDIÇÃO de uma ESTRUTURA (baseado no SKU do componente)
// GET /produtos/editar/estrutura/:sku
router.get('/produtos/editar/estrutura/:sku', produtosController.renderEditEstruturaPage);


// --- Rotas de Ação (Formulários e API) ---

// Rota de API para buscar os dados da tabela dinamicamente (igual ao /api/etiquetas/listagem)
// GET /api/produtos/listagem
router.get('/api/produtos/listagem', produtosController.getProdutosApi);

// Rota para receber o POST do formulário de edição de PRODUTO
// POST /produtos/editar/produto
router.post('/produtos/editar/produto', produtosController.updateProduto);

// Rota para receber o POST do formulário de edição de ESTRUTURA
// POST /produtos/editar/estrutura
router.post('/produtos/editar/estrutura', produtosController.updateEstrutura);


module.exports = router;