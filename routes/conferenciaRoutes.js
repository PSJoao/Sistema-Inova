// routes/conferenciaRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer'); // Necessário para processar uploads de arquivos
const conferenciaController = require('../controllers/conferenciaController');
const mlBatchController = require('../controllers/mlBatchController'); // Controller do ML Batch
const authController = require('../controllers/authController');

// Configuração do Multer para upload de fotos de conferência
const fs = require('fs');
const path = require('path');
const uploadDir = path.join(__dirname, '../uploads/fotos-conferencia');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '.jpg')
    }
})
const uploadFotos = multer({ storage: storage });

// Configuração padrão do Multer para planilhas e uploads gerais
const upload = multer({ dest: 'uploads/' });
router.use(authController.requireAuth);

// Interceptador dinâmico de permissões para Conferência (botão a botão)
router.use((req, res, next) => {
    const urlPath = req.path;
    
    // 1. Conf. para Faturamento (ML Batch)
    if (urlPath.startsWith('/ml-batch') || urlPath.startsWith('/ml-mapping') || urlPath.includes('/ml-batch/') || urlPath.includes('/ml-mapping/')) {
        return authController.requireModule('conferencia_ml_batch')(req, res, next);
    }
    // 2. Gerenciar Códigos
    if (urlPath.startsWith('/gerenciamento-codigos') || urlPath.includes('/produtos-sem-ean')) {
        return authController.requireModule('conferencia_codigos')(req, res, next);
    }
    
    // 3. Conferência de Pedidos (Caso padrão)
    if (urlPath.startsWith('/bipagem') || urlPath.startsWith('/api/') || urlPath.startsWith('/api/nfe') || urlPath.startsWith('/api/state') || urlPath.startsWith('/api/finalize') || urlPath.startsWith('/api/upload-foto') || urlPath.startsWith('/api/paletes')) {
        return authController.requireModule('conferencia_bipagem')(req, res, next);
    }
    
    next();
});

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

// --- API: FOTOS DE CONFERÊNCIA ---
router.post('/api/upload-foto', uploadFotos.single('foto'), conferenciaController.uploadFoto);
router.delete('/api/delete-foto', conferenciaController.deleteFoto);
router.get('/api/foto/:filename', conferenciaController.getFoto);


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


// --- API: CONTROLE DE PALETES ---

router.get('/api/paletes', conferenciaController.getPaletes);
router.post('/api/paletes/save', conferenciaController.savePalete);
router.post('/api/paletes/set-atual', conferenciaController.setPaleteAtual);
router.post('/api/paletes/reset', conferenciaController.resetPaletes);

module.exports = router;