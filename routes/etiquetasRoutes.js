// routes/etiquetasRoutes.js
const express = require('express');
const router = express.Router();
const etiquetasController = require('../controllers/etiquetasController');
const shopeeEtiquetasController = require('../controllers/shopeeEtiquetasController'); 
const authController = require('../controllers/authController');
const multer = require('multer');
const uploadExcel = multer({ storage: multer.memoryStorage() });

// Protege todas as rotas deste módulo com autenticação
router.use('/etiquetas', authController.requireAuth);

// Rota para exibir a página de upload de etiquetas
// GET /etiquetas
router.get('/etiquetas', etiquetasController.renderEtiquetasPage);

router.get('/etiquetas/bipagem', etiquetasController.renderBipagemPage);

router.post('/etiquetas/validar-produto-fechado', etiquetasController.validarProdutoFechado);

// Rota para finalizar a bipagem e gerar o PDF
// POST /etiquetas/finalizar-bipagem
router.post('/etiquetas/finalizar-bipagem', etiquetasController.finalizarBipagem);

router.post('/etiquetas/bipagem/save-state', etiquetasController.saveMlBipagemState);

router.get('/etiquetas/bipagem/load-state', etiquetasController.loadMlBipagemState);

router.post('/etiquetas/buscar-nf-lote', etiquetasController.buscarNfLote);

// Rota para processar os arquivos PDF enviados
// POST /etiquetas/processar
router.post('/etiquetas/processar', etiquetasController.processAndOrganizeEtiquetas);

router.post('/etiquetas/buscar-nf', etiquetasController.buscarNfIndividual);

router.get('/etiquetas/recentes/:filename', etiquetasController.downloadRecentPdf);

router.get('/etiquetas/download-individual/:nf', etiquetasController.downloadNfIndividual);

router.get('/etiquetas/listagem', etiquetasController.renderMlEtiquetasListPage);

router.get('/api/etiquetas/listagem', etiquetasController.getMlEtiquetasApi);

// Rota para geração do ZIP com etiquetas de 40x25mm dos carregadores
router.post('/etiquetas/carregadores/gerar', etiquetasController.gerarEtiquetasCarregadores);

// Rota para exibir o painel central de expedição e carregadores
router.get('/etiquetas/dashboard-expedicao', etiquetasController.renderDashboardExpedicao);

// Rotas de API para o Dashboard de Expedição (Tempo Real)
router.get('/api/expedicao/dashboard-dados', etiquetasController.apiGetDashboardExpedicao);
router.post('/api/expedicao/atualizar-status', etiquetasController.apiAtualizarStatusPendencia);

router.get('/api/expedicao/historico', etiquetasController.apiGetHistoricoExpedicoes);
router.get('/api/expedicao/historico/relatorio/:data', etiquetasController.apiDownloadRelatorioExpedicao);

// Controle do Dia Virtual
router.get('/api/expedicao/data-virtual', etiquetasController.apiGetVirtualDate);
router.post('/api/expedicao/avancar-dia', etiquetasController.apiAvancarDiaVirtual);

router.post('/api/expedicao/exportar-dinamico', etiquetasController.apiExportarDinamicoExcel);

router.post('/api/expedicao/imprimir-lote', etiquetasController.apiImprimirLotePDF);

router.get('/etiquetas/expedicao/bipagem', etiquetasController.renderBipagemExpedicao);

// ==========================================
// ROTAS: BIPAGEM EM MASSA (MOBILE)
// ==========================================
router.get('/etiquetas/bipagem-massa', etiquetasController.renderBipagemMassa);
router.post('/api/expedicao/bipagem-massa/validar', etiquetasController.apiValidarBipagemMassa);
router.post('/api/expedicao/bipagem-massa/atualizar', etiquetasController.apiAtualizarBipagemMassa);

// API RESTful para a Tela de Bipagem
router.get('/api/expedicao/hierarquia-hoje', etiquetasController.apiGetHierarquiaHoje);
router.post('/api/expedicao/nf/movimentar', etiquetasController.apiMovimentarNfHierarquia);
router.get('/api/expedicao/coletas', etiquetasController.apiGetColetas);
router.post('/api/expedicao/coletas', etiquetasController.apiPostColeta);
router.delete('/api/expedicao/coletas/:id', etiquetasController.apiDeleteColeta);
router.get('/api/expedicao/paletes/:coletaId', etiquetasController.apiGetPaletes);
router.post('/api/expedicao/paletes', etiquetasController.apiPostPalete);
router.delete('/api/expedicao/paletes/:id', etiquetasController.apiDeletePalete);

router.get('/api/expedicao/carregadores/ativos', etiquetasController.apiGetCarregadoresAtivos);
router.post('/api/expedicao/carregadores', etiquetasController.apiPostCarregador);
router.delete('/api/expedicao/carregadores/:id', etiquetasController.apiDeleteCarregador);

router.post('/api/expedicao/registrar-bipagem', etiquetasController.apiRegistrarBipagemExpedicao);
router.post('/api/expedicao/identificar-codigo', etiquetasController.apiIdentificarCodigo);
router.post('/api/expedicao/validar-pin', etiquetasController.apiValidarPinExpedicao);

router.get('/api/etiquetas/exportar', etiquetasController.exportMlEtiquetasExcel);

router.get('/api/etiquetas/exportar-sku-qtd', etiquetasController.exportMlSkuQuantityReport);

router.get('/etiquetas/gondola', etiquetasController.renderGondolaPage);
router.post('/api/gondola/buscar-estrutura', etiquetasController.buscarEstruturaGondola);
router.post('/api/gondola/salvar', etiquetasController.salvarRelatorioGondola);
router.get('/api/gondola/listar', etiquetasController.listarRelatoriosGondola);
router.delete('/api/gondola/:id', etiquetasController.excluirRelatorioGondola);

router.post('/etiquetas/pre-processar', etiquetasController.preProcessarEtiquetas);
router.post('/etiquetas/finalizar-processamento', etiquetasController.finalizarProcessamentoEtiquetas);

router.post('/api/separados-excel/upload', uploadExcel.single('excelFile'), etiquetasController.uploadSeparadosExcel);
router.post('/api/separados-excel/validar-senha', etiquetasController.validarSenhaExcel);

router.post('/shopee/pre-processar', shopeeEtiquetasController.preProcessarEtiquetasShopee);
router.post('/shopee/finalizar-processamento', shopeeEtiquetasController.finalizarProcessamentoEtiquetasShopee);

router.post('/api/ondas-excel/upload', uploadExcel.single('excelOndas'), etiquetasController.uploadOndasExcel)

router.get('/api/separados-excel/historico', etiquetasController.listarHistoricoSeparadosExcel);

// ==========================================
// ROTAS: RELATÓRIO DA TARDE
// ==========================================
router.get('/etiquetas/relatorio-tarde', etiquetasController.renderRelatorioTardePage);
router.post('/api/relatorio-tarde/upload', uploadExcel.single('excelVendas'), etiquetasController.uploadRelatorioTarde);
router.get('/api/relatorio-tarde/historico', etiquetasController.listarHistoricoRelatorioTarde);
router.delete('/api/relatorio-tarde/:id', etiquetasController.excluirHistoricoRelatorioTarde);
router.get('/api/relatorio-tarde/download/:id', etiquetasController.downloadHistoricoRelatorioTarde);
router.post('/api/expedicao/dashboard-massa-update', etiquetasController.atualizarGlobalDashboardEmLote);

module.exports = router;