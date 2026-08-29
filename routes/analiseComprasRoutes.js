const express = require('express');
const router = express.Router();
const analiseComprasController = require('../controllers/analiseComprasController');
const authController = require('../controllers/authController');

// Protege todas as rotas deste módulo
router.use(authController.requireAuth);

// Renderizar view principal
router.get('/', analiseComprasController.renderPage);

// Renderizar view de importação de vendas (Excel)
router.get('/importar-vendas', analiseComprasController.renderImportarVendasPage);

// Renderizar view de controle de pedidos de compra
router.get('/pedidos', analiseComprasController.renderPedidosPage);

// Renderizar view de controle de pesos dos produtos
router.get('/pesos', analiseComprasController.renderPesosPage);

// Listar produtos agrupados (API)
router.get('/api/produtos', analiseComprasController.listarProdutos);

// Upload dos relatórios de vendas Excel
router.post('/upload-vendas', analiseComprasController.uploadVendas);

// Upload de planilha de pesos Excel/CSV
router.post('/upload-pesos', analiseComprasController.uploadPesos);

// Atualizar valor "Chegando" via fetch
router.post('/atualizar-chegando', analiseComprasController.atualizarChegando);

// Gerar e Criar Pedido (PDF e registro no banco)
router.post('/gerar-pedido', analiseComprasController.gerarPedidoPDF);

// Gerar Romaneio de Carga (PDF consolidado dos pedidos selecionados)
router.post('/gerar-romaneio', analiseComprasController.gerarRomaneioPDF);

// Endpoints da API de Pedidos
router.get('/api/pedidos', analiseComprasController.listarPedidos);
router.get('/api/pedidos/:id', analiseComprasController.obterPedido);
router.put('/api/pedidos/:id', analiseComprasController.atualizarPedido);
router.post('/api/pedidos/:id/finalizar', analiseComprasController.finalizarPedido);
router.post('/api/pedidos/:id/cancelar', analiseComprasController.cancelarPedido);
router.delete('/api/pedidos/:id', analiseComprasController.cancelarPedido);
router.get('/pedidos/:id/pdf', analiseComprasController.baixarPdfPedidoSalvo);

// Endpoints da API de Pesos
router.get('/api/pesos', analiseComprasController.listarPesos);
router.post('/api/pesos', analiseComprasController.salvarPesoIndividual);
router.delete('/api/pesos/:sku', analiseComprasController.excluirPeso);
router.put('/api/pesos/salvar-lote', analiseComprasController.salvarLotePesos);

module.exports = router;

