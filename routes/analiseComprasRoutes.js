const express = require('express');
const router = express.Router();
const analiseComprasController = require('../controllers/analiseComprasController');

// Proteção da rota com um middleware existente (se houver, ex: checkAuth).
// Caso exista um const { checkAuth } = require('../middlewares/auth'); usar aqui.
// Por ora, segue o padrão das outras rotas que validam a sessão ou deixam livre dependendo do sistema.

// Renderizar view principal
router.get('/', analiseComprasController.renderPage);

// Listar produtos agrupados (API)
router.get('/api/produtos', analiseComprasController.listarProdutos);

// Upload dos relatórios de vendas Excel
router.post('/upload-vendas', analiseComprasController.uploadVendas);

// Atualizar valor "Chegando" via fetch
router.post('/atualizar-chegando', analiseComprasController.atualizarChegando);

// Gerar PDF de Pedidos
router.post('/gerar-pedido', analiseComprasController.gerarPedidoPDF);

module.exports = router;
