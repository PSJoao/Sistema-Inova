// routes/rastreioRoutes.js

const express = require('express');
const router = express.Router();
const rastreioController = require('../controllers/rastreioController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Rota para renderizar a página principal de rastreamento
// GET /rastreio
router.get('/', rastreioController.renderRastreioPage);

// Rota da API para alimentar o DataTable com os dados dos pedidos
// GET /rastreio/api
router.get('/api', rastreioController.getPedidosRastreioApi);

// Rota para renderizar a página de detalhes de um pedido específico
// GET /rastreio/detalhe/:id
router.get('/detalhe/:id', rastreioController.renderDetalheRastreioPage);

router.post('/api/upload-dominalog-report', upload.single('relatorioDominalog'), rastreioController.processarBoletimDominalog);

// (NOVA ROTA)
// Rota da API para marcar todos os pedidos como conferidos
// POST /rastreio/api/marcar-conferidos
router.post('/api/marcar-conferidos', rastreioController.marcarComoConferidosApi);

router.get('/api/gerar-relatorio', rastreioController.gerarRelatorioRastreio);

router.post('/api/salvar-observacao', rastreioController.salvarObservacao);

router.post('/api/update-status', rastreioController.updateStatusManual);

// Rota da API para buscar o histórico de e-mails de um pedido específico
// GET /rastreio/api/email-history/:id
router.get('/api/email-history/:id', rastreioController.getEmailHistory);

// Rota da API para marcar a thread de e-mail de um pedido como resolvida
// POST /rastreio/api/resolve-email/:id
router.post('/api/resolve-email/:id', rastreioController.resolveEmailThread);

// Rota da API para marcar que a notificação de nova resposta de e-mail foi visualizada
// POST /rastreio/api/mark-email-notified/:id
router.post('/api/mark-email-notified/:id', rastreioController.markEmailAsNotified);

router.post('/api/enviar-email-cobranca/:id', rastreioController.enviarEmailCobranca);


module.exports = router;