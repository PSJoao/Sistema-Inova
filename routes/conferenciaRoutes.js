// routes/conferenciaRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer'); // Necessário para processar uploads de arquivos
const conferenciaController = require('../controllers/conferenciaController');
const mlBatchController = require('../controllers/mlBatchController'); // Controller do ML Batch
const authController = require('../controllers/authController');

// Configuração básica do Multer (salva temporariamente na pasta 'uploads/')
const upload = multer({ dest: 'uploads/' });

// Middleware de autenticação: Protege todas as rotas abaixo para exigir login
router.use(authController.requireAuth);

// --- VIEWS (Páginas Renderizadas) ---

// Página Principal de Bipagem (Conferência)
router.get('/bipagem', conferenciaController.renderBipagemPage);

// Página de Gerenciamento de Produtos Sem EAN
router.get('/gerenciamento-codigos', conferenciaController.renderGerenciamentoPage);

// [NOVO] Módulo ML Batch: Tela Principal (Upload de Pedidos)
router.get('/ml-batch', mlBatchController.renderUploadPage);

// [NOVO] Módulo ML Batch: Tela de Mapeamento (Pack ID -> Venda Real)
router.get('/ml-mapping', mlBatchController.renderMappingPage);


// --- API: OPERAÇÃO DE CONFERÊNCIA & ESTADO ---

// Busca dados da Nota Fiscal pela Chave ou Número
router.get('/api/nfe/:chave', conferenciaController.searchNfeByChave);

// Recupera o estado anterior (Rascunho) do usuário logado
router.get('/api/state', conferenciaController.getState);

// Salva o estado atual (Auto-Save)
router.post('/api/state', conferenciaController.saveState);

// Finaliza a conferência (Atualiza Bling e Banco Local)
router.post('/api/finalize', conferenciaController.finalizeConferencia);


// --- API: MÓDULO ML BATCH (PROCESSAMENTO) ---

// Processa o upload da planilha de Pedidos (Processo Principal)
// Campo do formulário: 'planilha'
router.post('/ml-batch/process', upload.single('planilha'), mlBatchController.processUpload);

// [NOVO] Processa o upload da planilha de Mapeamento (Pack ID)
// Campo do formulário: 'planilhaMapeamento'
router.post('/ml-mapping/process', upload.single('planilhaMapeamento'), mlBatchController.processMappingUpload);


// --- API: GERENCIAMENTO DE CÓDIGOS (DATA TABLES & EDIÇÃO) ---

// Retorna lista de produtos para a tabela de gerenciamento (com filtros e paginação)
router.get('/api/produtos-sem-ean', conferenciaController.getProdutosSemEanApi);

// Atualiza informações de um produto (GTIN, Código Fábrica, Escondido)
router.post('/api/produtos-sem-ean/update', conferenciaController.updateStructureInfo);

module.exports = router;