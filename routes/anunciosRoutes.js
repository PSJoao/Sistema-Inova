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

// Rotas para salvar/buscar preferências (ordem e larguras) de colunas
router.get('/api/anuncios/column-order', authController.requireAuth, anunciosController.getColumnOrder);
router.post('/api/anuncios/column-order', authController.requireAuth, anunciosController.saveColumnOrder);
router.get('/api/anuncios/column-preferences', authController.requireAuth, anunciosController.getColumnPreferences);
router.post('/api/anuncios/column-preferences', authController.requireAuth, anunciosController.saveColumnPreferences);
router.get('/api/anuncios/promocoes/column-preferences', authController.requireAuth, anunciosController.getColumnPreferences);
router.post('/api/anuncios/promocoes/column-preferences', authController.requireAuth, anunciosController.saveColumnPreferences);

// Rota para importar planilha de custos e impostos por SKU
router.post('/api/anuncios/importar-custos', authController.requireAuth, upload.single('planilha'), anunciosController.importarCustosEImpostos);

// Rotas de API para Gerenciar Promoções
router.get('/api/anuncios/promocoes/listagem', authController.requireAuth, anunciosController.getPromocoesApi);
router.post('/api/anuncios/promocoes/sync', authController.requireAuth, anunciosController.sincronizarPromocoes);
router.post('/api/anuncios/promocoes/opt-in', authController.requireAuth, authController.requireModule('produtos_gerenciar'), anunciosController.aderirPromocaoApi);
router.post('/api/anuncios/promocoes/opt-out', authController.requireAuth, authController.requireModule('produtos_gerenciar'), anunciosController.removerPromocaoApi);
router.get('/api/anuncios/promocoes/exportar', authController.requireAuth, authController.requireModule('produtos_gerenciar'), anunciosController.exportarPromocoesExcel);

// --- Central de Promoções (Listagem Única) ---
router.get('/anuncios/central-promocoes', anunciosController.renderCentralPromocoesPage);
router.get('/api/anuncios/central-promocoes/listagem', authController.requireAuth, anunciosController.getCentralPromocoesApi);
router.post('/api/anuncios/central-promocoes/reembolso', authController.requireAuth, anunciosController.salvarReembolsoMaximo);

// --- Configuração de Prazos de Disponibilidade ---
router.get('/anuncios/configurar-prazos', anunciosController.renderConfigurarPrazosPage);
router.get('/api/anuncios/configurar-prazos/fornecedores', authController.requireAuth, anunciosController.getConfigPrazosFornecedoresApi);
router.post('/api/anuncios/configurar-prazos/fornecedores', authController.requireAuth, anunciosController.salvarPrazoFornecedorApi);
router.post('/api/anuncios/configurar-prazos/fornecedores/lote', authController.requireAuth, anunciosController.salvarPrazoFornecedoresLoteApi);
router.get('/api/anuncios/configurar-prazos/produtos', authController.requireAuth, anunciosController.getConfigPrazosProdutosApi);
router.post('/api/anuncios/configurar-prazos/produtos', authController.requireAuth, anunciosController.salvarPrazoProdutoApi);
router.post('/api/anuncios/configurar-prazos/produtos/lote', authController.requireAuth, anunciosController.salvarPrazoProdutosLoteApi);
router.post('/api/anuncios/configurar-prazos/produtos/temporizador', authController.requireAuth, anunciosController.salvarTemporizadorProdutoApi);
router.post('/api/anuncios/configurar-prazos/produtos/temporizador/lote', authController.requireAuth, anunciosController.salvarTemporizadorProdutosLoteApi);
router.post('/api/anuncios/configurar-prazos/produtos/indeterminado', authController.requireAuth, anunciosController.salvarIndeterminadoProdutoApi);
router.post('/api/anuncios/configurar-prazos/produtos/indeterminado/lote', authController.requireAuth, anunciosController.salvarIndeterminadoProdutosLoteApi);
router.post('/api/anuncios/configurar-prazos/aplicar', authController.requireAuth, anunciosController.aplicarPrazosManualApi);
router.get('/api/anuncios/configurar-prazos/historico', authController.requireAuth, anunciosController.getHistoricoPrazosApi);

module.exports = router;



