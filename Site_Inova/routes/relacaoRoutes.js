// routes/relacaoRouter.js
const express = require('express');
const router = express.Router();
const relacaoController = require('../controllers/relacaoController');
const authController = require('../controllers/authController'); // Seu controller de autenticação

// Middleware de autenticação para todas as rotas deste router
router.use(authController.requireAuth);

// --- Rotas Principais do Módulo de Relações ---

// Página inicial do módulo: lista de transportadoras com NF-e pendentes
router.get('/relacoes', relacaoController.getIndexRelacoes);

// Página de bipagem para uma transportadora específica
router.get('/relacoes/:transportadoraApelido', relacaoController.getBipagemPage);

// POST para finalizar uma relação, salvar dados e preparar para geração de Excel
router.post('/relacoes/:transportadoraApelido/finalize', relacaoController.finalizeRelacao);

// GET para download do arquivo Excel de uma relação gerada
//router.get('/relacoes/download/workbook/:filename', relacaoController.downloadRelacaoExcel);

router.get('/relacoes/download/:relationId', relacaoController.downloadRelacaoExcel);

router.get('/relacoes/print/:relationId', relacaoController.getPrintableRelacaoPage);
// --- Rotas para a Funcionalidade de NF-e Canceladas ---

// Página para visualizar NF-e marcadas como "cancelada_permanente"
router.get('/relacoes/canceladas', relacaoController.getCanceladasPage);

// API: GET para buscar a lista de todas as NF-e canceladas permanentemente
router.get('/api/relacoes/canceladas/all', relacaoController.getNfesCanceladasApi);

// Rota para buscar todas as NF-e que JÁ FORAM TRATADAS (justificadas, canceladas, relacionadas)
//router.get('/api/relacoes/justificadas/all', relacaoController.getJustificadasApi);

// Rota para buscar todas as Relações já salvas
router.get('/api/relacoes/salvas/all', relacaoController.getSalvasApi);

// Rota para atualizar o status de uma NF-e específica (ex: de 'cancelada' para 'pendente')
router.post('/api/relacoes/nfe/:nfeReportId/update-status', relacaoController.updateNfeStatusApi);


// Rota para reativar (vamos manter por enquanto, mas a nova pode substituí-la)
router.post('/api/relacoes/nfe/:nfeReportId/reativar', relacaoController.reativarNfeCanceladaApi);

router.post('/api/relacoes/:transportadoraApelido/save-state', relacaoController.saveBipagemState);

router.delete('/api/relacoes/:transportadoraApelido/clear-state', relacaoController.clearBipagemState);

router.post('/api/relacoes/:relationId/validate', relacaoController.validateRelacao);

router.post('/api/relacoes/:relationId/check', relacaoController.checkRelacao);

router.post('/api/relacoes/nfe/:nfeReportId/update-justification', relacaoController.updateNfeJustificationApi);

router.post('/api/relacoes/nfe/:nfeReportId/update-volumes', relacaoController.updateNfeVolumes);

router.get('/api/relacoes/pendentes/:transportadoraApelido', relacaoController.getPendentesApi);

router.post('/api/relacoes/get-nfe-weight', relacaoController.getNfeWeightApi)

module.exports = router;