// routes/pedidosMlRoutes.js
// Rotas do módulo de Controle de Pedidos do Mercado Livre
const express = require('express');
const router = express.Router();
const pedidosMlController = require('../controllers/pedidosMlController');
const authController = require('../controllers/authController');

// Protege todas as rotas deste módulo
router.use(authController.requireAuth);

// --- Rotas de Renderização de View ---
// GET /pedidos-ml
router.get('/pedidos-ml', pedidosMlController.renderPedidosPage);

// --- Rotas de API ---
// GET /api/pedidos-ml e GET /api/pedidos-ml/listagem
router.get('/api/pedidos-ml', pedidosMlController.getPedidosApi);
router.get('/api/pedidos-ml/listagem', pedidosMlController.getPedidosApi);

// POST /api/pedidos-ml/sync (Sincronização manual com o Hub)
router.post('/api/pedidos-ml/sync', pedidosMlController.sincronizarPedidosApi);

// GET /api/pedidos-ml/detalhes/:id (Detalhes completos do pedido)
router.get('/api/pedidos-ml/detalhes/:id', pedidosMlController.getDetalhesPedidoApi);

// GET /api/pedidos-ml/etiqueta/:id (Etiqueta ZPL individual)
router.get('/api/pedidos-ml/etiqueta/:id', pedidosMlController.getEtiquetaZplApi);

// POST /api/pedidos-ml/etiquetas/obter (Obter etiquetas em lote ou individuais autenticadas com todos os clientes)
router.post('/api/pedidos-ml/etiquetas/obter', pedidosMlController.obterEtiquetasApi);

// GET /api/pedidos-ml/etiquetas/pdf (Download/Stream direto do PDF consolidado de etiquetas)
router.get('/api/pedidos-ml/etiquetas/pdf', pedidosMlController.baixarEtiquetasPdfApi);

// GET /api/pedidos-ml/exportar (Exportar para Excel)
router.get('/api/pedidos-ml/exportar', pedidosMlController.exportarPedidosExcel);

// GET & POST /api/pedidos-ml/column-preferences (Preferências de colunas)
router.get('/api/pedidos-ml/column-preferences', pedidosMlController.getColumnPreferences);
router.post('/api/pedidos-ml/column-preferences', pedidosMlController.saveColumnPreferences);

module.exports = router;
