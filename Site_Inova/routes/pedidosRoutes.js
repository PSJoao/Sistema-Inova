// ✍️ /routes/pedidosRoutes.js (VERSÃO ATUALIZADA)

const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidosController');
const authController = require('../controllers/authController');
const pedidosFullController = require('../controllers/pedidosFullController');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });
router.use(authController.requireAuth);

// --- ROTAS ATUALIZADAS ---
// Rota principal para a NOVA dashboard com a tabela de pedidos
router.get('/acompanhamento/pedidos', pedidosController.exibirPaginaPedidos);

// Nova rota para a página de UPLOAD de relatórios
router.get('/acompanhamento/pedidos/upload-reports', pedidosController.exibirPaginaUpload);

router.delete('/api/acompanhamento/pedido/:id', pedidosController.deletePedido);

router.get('/api/acompanhamento/pedidos', pedidosController.getPedidosApi);

router.post('/api/acompanhamento/bulk-update-comissao', pedidosController.bulkUpdateComissao);

// Rota para PROCESSAR as planilhas (permanece a mesma)
router.post('/acompanhamento/pedidos/upload', upload.fields([
    { name: 'relatorioMagalu', maxCount: 1 },
    { name: 'relatorioViaVarejo', maxCount: 1 },
    { name: 'relatorioMadeira', maxCount: 1 },
    { name: 'relatorioMercadoLivre', maxCount: 1 },
    { name: 'relatorioAmazon', maxCount: 1 },
    { name: 'relatorioAmericanas', maxCount: 1 }
]), pedidosController.processarPlanilhas);

// Rota para BAIXAR o relatório consolidado (permanece a mesma)
router.get('/acompanhamento/pedidos/download', pedidosController.baixarRelatorioConsolidado);

router.post('/api/pedidos-full/sync', pedidosFullController.iniciarSincronizacaoFull);

module.exports = router;