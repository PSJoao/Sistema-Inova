const express = require('express');
const router = express.Router();
const conferenciaController = require('../controllers/conferenciaController');
const authController = require('../controllers/authController');

// Middleware de autenticação: Protege todas as rotas abaixo para exigir login
router.use(authController.requireAuth);

// --- VIEWS (Páginas Renderizadas) ---

// Página Principal de Bipagem (Conferência)
// URL esperada: /conferencia/bipagem
router.get('/bipagem', conferenciaController.renderBipagemPage);

// Página de Gerenciamento de Produtos Sem EAN
// URL esperada: /conferencia/gerenciamento-codigos
router.get('/gerenciamento-codigos', conferenciaController.renderGerenciamentoPage);


// --- API: OPERAÇÃO DE CONFERÊNCIA & ESTADO ---

// Busca dados da Nota Fiscal pela Chave ou Número
router.get('/api/nfe/:chave', conferenciaController.searchNfeByChave);

// Recupera o estado anterior (Rascunho) do usuário logado
router.get('/api/state', conferenciaController.getState);

// Salva o estado atual (Auto-Save)
router.post('/api/state', conferenciaController.saveState);

// Finaliza a conferência (Atualiza Bling e Banco Local)
router.post('/api/finalize', conferenciaController.finalizeConferencia);


// --- API: GERENCIAMENTO DE CÓDIGOS (DATA TABLES & EDIÇÃO) ---

// Retorna lista de produtos para a tabela de gerenciamento (com filtros e paginação)
router.get('/api/produtos-sem-ean', conferenciaController.getProdutosSemEanApi);

// Atualiza informações da estrutura (EAN Transformado, Código Fábrica, Escondido)
router.post('/api/structure/update', conferenciaController.updateStructureInfo);

module.exports = router;