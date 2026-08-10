// routes/anunciosRoutes.js
const express = require('express');
const router = express.Router();
const anunciosController = require('../controllers/anunciosController');
const authController = require('../controllers/authController');

// Protege todas as rotas deste módulo (reusa a permissão de produtos_gerenciar)
router.use('/anuncios', authController.requireAuth, authController.requireModule('produtos_gerenciar'));

// --- Rotas de Renderização de View ---

// Rota para exibir a página principal de listagem de anúncios
// GET /anuncios
router.get('/anuncios', anunciosController.renderAnunciosPage);

// Rota para exibir a subpágina de gerenciamento de promoções
// GET /anuncios/promocoes
router.get('/anuncios/promocoes', anunciosController.renderPromocoesPage);

// --- Rotas de API ---

// Rota de API para buscar os dados da tabela dinamicamente
// GET /api/anuncios/listagem
router.get('/api/anuncios/listagem', anunciosController.getAnunciosApi);

// Rota de API para exportar relatório Excel respeitando filtros
// GET /api/anuncios/exportar
router.get('/api/anuncios/exportar', authController.requireAuth, authController.requireModule('produtos_gerenciar'), anunciosController.exportarAnunciosExcel);

// Rota para disparar a sincronização com o Hub
// POST /api/anuncios/sync
router.post('/api/anuncios/sync', anunciosController.sincronizarAnuncios);

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Rotas para salvar/buscar ordem personalizada de colunas
router.get('/api/anuncios/column-order', authController.requireAuth, anunciosController.getColumnOrder);
router.post('/api/anuncios/column-order', authController.requireAuth, anunciosController.saveColumnOrder);

// Rota para importar planilha de custos e impostos por SKU
router.post('/api/anuncios/importar-custos', authController.requireAuth, upload.single('planilha'), anunciosController.importarCustosEImpostos);

// Rotas de API para Gerenciar Promoções
router.get('/api/anuncios/promocoes/listagem', authController.requireAuth, anunciosController.getPromocoesApi);
router.get('/api/anuncios/promocoes/exportar', authController.requireAuth, authController.requireModule('produtos_gerenciar'), anunciosController.exportarPromocoesExcel);

// --- Central de Promoções (Listagem Única) ---
router.get('/anuncios/central-promocoes', anunciosController.renderCentralPromocoesPage);
router.get('/api/anuncios/central-promocoes/listagem', authController.requireAuth, anunciosController.getCentralPromocoesApi);
router.post('/api/anuncios/central-promocoes/reembolso', authController.requireAuth, anunciosController.salvarReembolsoMaximo);

module.exports = router;
