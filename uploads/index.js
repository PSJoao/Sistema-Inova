require('dotenv').config();
const express = require('express');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const exphbs = require('express-handlebars');
const emissaoRoutes = require('./routes/emissaoRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');
const madeiraRoutes = require('./routes/madeiraRoutes');
const viaVarejoRoutes = require('./routes/viaVarejoRoutes'); // Importar as rotas do Via Varejo
const relacaoRoutes = require('./routes/relacaoRoutes');
const rastreioRoutes = require('./routes/rastreioRoutes');
const pedidosRoutes = require('./routes/pedidosRoutes');
const handlebarsHelpers = require('./helpers/handlebarsHelpers');
const authRoutes = require('./routes/authRoutes');
const authController = require('./controllers/authController');
const anunciosController = require('./controllers/anunciosController');
const rastreioService = require('./services/rastreioService');
const nfeHistoryRoutes = require('./routes/nfeHistoryRoutes');
const { updatePrices } = require('./updatePrices.js');
const { updatePricesMM } = require('./updatePricesMM.js');
const { runScheduledTokenRefresh } = require('./services/blingTokenManager');
const mlRoutes = require('./routes/mercadoLivreRoutes');
const assistenciaRoutes = require('./routes/assistenciaRoutes');
const etiquetasRoutes = require('./routes/etiquetasRoutes');
const tiposRoutes = require('./routes/tiposRoutes');
const prodSyncRoutes = require('./routes/productSyncRoutes');
const estoqueRoutes = require('./routes/estoqueRoutes');
const conferenciaRoutes = require('./routes/conferenciaRoutes.js');
const produtosRoutes = require('./routes/produtosRoutes');
const anunciosRoutes = require('./routes/anunciosRoutes');
const faturamentoAutomaticoRoutes = require('./routes/faturamentoAutomaticoRoutes');
const { syncBlingProductsLucas, syncBlingProductsEliane, syncEstoqueBling } = require('./blingSyncService.js');
const hubProdutosService = require('./hub/services/hubProdutosService');
const { updateUrlCostsAndData } = require('./costUpdater.js');
const mercadoLivreSyncService = require('./services/mercadoLivreSyncService');
const etiquetasService = require('./services/etiquetasService');
const blingWebhookRoutes = require('./routes/blingWebhookRoutes');
const stockHistoryRoutes = require('./routes/stockHistoryRoutes');
const path = require('path');
const fs = require('fs').promises;
const PDF_STORAGE_DIR_CLEANUP = path.join(__dirname, 'pdfEtiquetas');
const MAX_FILE_AGE_DAYS = 30;
const favicon = require('serve-favicon');
const cron = require('node-cron');
const { exec } = require('child_process');
const hubRoutes = require('./hub/routes/hubRoutes');
const hubMlService = require('./hub/services/hubMercadoLivreService');
const HubPedidosService = require('./services/HubPedidosService');

const app = express();
const PORT = 3000;

// Configurar o body-parser para analisar solicitações com o corpo em formato URL-encoded e JSON
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
app.use(bodyParser.json({ limit: '500mb' }));

// === WEBHOOK DO BLING: Deve ficar ANTES de qualquer middleware de autenticação ===
// O Bling envia POSTs externos sem cookie/token, então precisa estar fora da cadeia de auth
app.use('/webhooks/bling', blingWebhookRoutes);

// Configuração do Handlebars com helpers personalizados
app.engine('handlebars', exphbs.engine({
    defaultLayout: 'main',
    helpers: handlebarsHelpers
}));
app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');

// Configuração de arquivos estáticos
app.use('/public', express.static('public'));
app.use(favicon(path.join(__dirname, 'public/icons', 'favicon.ico')));

// Cookie parser para ler JWT dos cookies
app.use(cookieParser());

// Middleware JWT: popula req.user a partir do cookie token (antes de qualquer rota)
app.use(authController.jwtMiddleware);

app.use('/hub', hubRoutes);

// Sessão mantida apenas para connect-flash e fluxo PKCE do Mercado Livre
app.use(authController.sessionMiddleware);
app.use(flash());

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success'); // Para mensagens de sucesso
    res.locals.error_msg = req.flash('error');     // Para mensagens de erro
    res.locals.info_msg = req.flash('info');       // Para mensagens de aviso/info

    // Dados do JWT para as Views
    if (req.user) { // Verifica se o usuário está logado (via JWT)
        res.locals.isAuthenticated = true; // Uma flag útil para o template
        res.locals.username = req.user.username; // Torna {{username}} disponível
        res.locals.cargo = req.user.role;    // Torna {{cargo}} disponível nos templates
        res.locals.tipo_conta = req.user.tipo_conta;
        res.locals.sidebar_collapsed = req.user.sidebar_collapsed;
        
        // Flags de nível de permissão
        const isAdmin = req.user.tipo_conta === 0 || req.user.tipo_conta === 1;
        res.locals.isAdmin = isAdmin;
        res.locals.isMaster = req.user.tipo_conta === 0;

        // Permissões granulares detalhadas (botão a botão)
        const modulos = req.user.modulos_permitidos || [];
        
        // Monitoramento
        res.locals.permit_monitoramento_madeira_lucas = isAdmin || modulos.includes('monitoramento_madeira_lucas');
        res.locals.permit_monitoramento_madeira_eliane = isAdmin || modulos.includes('monitoramento_madeira_eliane');
        res.locals.permit_monitoramento_viavarejo = isAdmin || modulos.includes('monitoramento_viavarejo');
        
        // Faturamento
        res.locals.permit_faturamento_gerenciar_emissoes = isAdmin || modulos.includes('faturamento_gerenciar_emissoes');
        res.locals.permit_faturamento_gerar_etiquetas = isAdmin || modulos.includes('faturamento_gerar_etiquetas');
        res.locals.permit_faturamento_automatico = isAdmin || modulos.includes('faturamento_automatico');
        res.locals.permit_faturamento_gerenciar_pedidos = isAdmin || modulos.includes('faturamento_gerenciar_pedidos');
        res.locals.permit_faturamento_assistencias = isAdmin || modulos.includes('faturamento_assistencias');
        res.locals.permit_faturamento_historico_notas = isAdmin || modulos.includes('faturamento_historico_notas');
        
        // Produtos
        res.locals.permit_produtos_gerenciar = isAdmin || modulos.includes('produtos_gerenciar');
        res.locals.permit_produtos_tipos = isAdmin || modulos.includes('produtos_tipos');
        res.locals.permit_produtos_sincronizar = isAdmin || modulos.includes('produtos_sincronizar');
        res.locals.permit_produtos_estoque_dev = isAdmin || modulos.includes('produtos_estoque_dev');
        res.locals.permit_produtos_bipagem_pecas = isAdmin || modulos.includes('produtos_bipagem_pecas');
        res.locals.permit_produtos_anuncios = isAdmin || modulos.includes('produtos_gerenciar');
        
        // Expedição
        res.locals.permit_expedicao_ordenador = isAdmin || modulos.includes('expedicao_ordenador');
        res.locals.permit_expedicao_gondolas = isAdmin || modulos.includes('expedicao_gondolas');
        res.locals.permit_expedicao_rel_tarde = isAdmin || modulos.includes('expedicao_rel_tarde');
        res.locals.permit_expedicao_bipagem_produtos = isAdmin || modulos.includes('expedicao_bipagem_produtos');
        res.locals.permit_expedicao_dashboard = isAdmin || modulos.includes('expedicao_dashboard');
        res.locals.permit_expedicao_bipagem_exp = isAdmin || modulos.includes('expedicao_bipagem_exp');
        res.locals.permit_expedicao_massa = isAdmin || modulos.includes('expedicao_massa');
        
        // Conferência
        res.locals.permit_conferencia_bipagem = isAdmin || modulos.includes('conferencia_bipagem');
        res.locals.permit_conferencia_codigos = isAdmin || modulos.includes('conferencia_codigos');
        res.locals.permit_conferencia_ml_batch = isAdmin || modulos.includes('conferencia_ml_batch');
        
        // Logística
        res.locals.permit_logistica_relacoes = isAdmin || modulos.includes('logistica_relacoes');
        res.locals.permit_logistica_rastreio = isAdmin || modulos.includes('logistica_rastreio');

        // Permissões gerais de visualização de módulos (exibição de cards inteiros)
        res.locals.permit_monitoramento = res.locals.permit_monitoramento_madeira_lucas || res.locals.permit_monitoramento_madeira_eliane || res.locals.permit_monitoramento_viavarejo;
        res.locals.permit_faturamento = res.locals.permit_faturamento_gerenciar_emissoes || res.locals.permit_faturamento_gerar_etiquetas || res.locals.permit_faturamento_automatico || res.locals.permit_faturamento_gerenciar_pedidos || res.locals.permit_faturamento_assistencias || res.locals.permit_faturamento_historico_notas;
        res.locals.permit_produtos = res.locals.permit_produtos_gerenciar || res.locals.permit_produtos_tipos || res.locals.permit_produtos_sincronizar || res.locals.permit_produtos_estoque_dev || res.locals.permit_produtos_bipagem_pecas || res.locals.permit_produtos_anuncios;
        res.locals.permit_expedicao = res.locals.permit_expedicao_ordenador || res.locals.permit_expedicao_gondolas || res.locals.permit_expedicao_rel_tarde || res.locals.permit_expedicao_bipagem_produtos || res.locals.permit_expedicao_dashboard || res.locals.permit_expedicao_bipagem_exp || res.locals.permit_expedicao_massa;
        res.locals.permit_conferencia = res.locals.permit_conferencia_bipagem || res.locals.permit_conferencia_codigos || res.locals.permit_conferencia_ml_batch;
        res.locals.permit_logistica = res.locals.permit_logistica_relacoes || res.locals.permit_logistica_rastreio;
    } else {
        res.locals.isAuthenticated = false;
        res.locals.username = null;
        res.locals.cargo = null;
        res.locals.tipo_conta = null;
        res.locals.isAdmin = false;
        res.locals.isMaster = false;
        res.locals.sidebar_collapsed = false;
        
        res.locals.permit_monitoramento = false;
        res.locals.permit_faturamento = false;
        res.locals.permit_produtos = false;
        res.locals.permit_expedicao = false;
        res.locals.permit_conferencia = false;
        res.locals.permit_logistica = false;
    }

    next();
});

// Rotas de login e administração de usuários (agora com res.locals já populado)
app.use('/', authRoutes);

//Proteger o menu principal para exigir login
app.get('/', authController.requireAuth, (req, res) => {
    res.render('mainMenu', {
        title: 'Menu Principal',
        username: req.user.username,
        cargo: req.user.role,
        layout: false // Adicione esta linha
    });
});

// Usar rotas de monitoramento
app.use('/', madeiraRoutes);
app.use('/', monitoringRoutes); // Usar rotas da Madeira Madeira
app.use('/', viaVarejoRoutes); // Usar rotas do Via Varejo
app.use('/', emissaoRoutes); // Usar rotas de emissão
app.use('/', relacaoRoutes);
app.use('/', pedidosRoutes);
app.use('/rastreio', rastreioRoutes);
app.use('/historico-nfe', nfeHistoryRoutes);
app.use('/assistencias', assistenciaRoutes);
app.use('/', mlRoutes);
app.use('/', etiquetasRoutes);
app.use('/', tiposRoutes);
app.use('/', produtosRoutes);
app.use('/', anunciosRoutes);
app.use('/faturamento-automatico', faturamentoAutomaticoRoutes);
app.use('/product-sync', prodSyncRoutes);
app.use('/conferencia', conferenciaRoutes);
app.use('/estoque', estoqueRoutes);
// NOTA: blingWebhookRoutes foi movido para ANTES do middleware de auth (linha ~57)
app.use('/api/stock-history', stockHistoryRoutes);

//mercadoLivreSyncService.startOrderSync(300000);

let isHubDevolucoesSyncRunning = false;

// Agendamento para Monitorar Exclusivamente Devoluções e Mediações do Hub
// Expressão '0 5 * * *' executa todos os dias às 05:00 da manhã.
cron.schedule('0 18 * * *', async () => {
    if (isHubDevolucoesSyncRunning) {
        console.log(`[HUB Devoluções Cron] Monitoramento de devoluções já em andamento. Pulando este ciclo...`);
        return;
    }

    isHubDevolucoesSyncRunning = true;
    console.log('[HUB Devoluções Cron] Iniciando ciclo exclusivo de devoluções e mediações...');

    try {
        await hubMlService.monitorarDevolucoes();
        console.log('[HUB Devoluções Cron] Ciclo de devoluções finalizado com sucesso.');
    } catch (error) {
        console.error('[HUB Devoluções Cron] Erro durante o monitoramento de devoluções:', error);
    } finally {
        isHubDevolucoesSyncRunning = false;
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

let isHubSyncRunning = false;

//Agendamento do hub
cron.schedule('*/1 * * * *', async () => {
    // 1. Verifica se já está rodando
    if (isHubSyncRunning) {
        console.log(`[HUB Cron] Sincronização anterior ainda em andamento. Pulando este ciclo...`);
        return; // Sai da função e espera o próximo minuto
    }

    // 2. Ativa a trava
    isHubSyncRunning = true;
    console.log('[HUB Cron] Iniciando ciclo de sincronização...');

    try {
        // 3. Executa as tarefas críticas
        await hubMlService.capturarNovosPedidos();
        await hubMlService.monitorarPedidosDiferentes();
        await hubMlService.monitorarPedidosExistentes();
        console.log('[HUB Cron] Ciclo finalizado com sucesso.');

    } catch (error) {
        // 4. Tratamento de erro para não derrubar o servidor
        console.error('[HUB Cron] Erro durante a sincronização:', error);

    } finally {
        // 5. IMPORTANTE: Solta a trava independente de sucesso ou erro
        isHubSyncRunning = false;
    }
});

let isAnunciosLocalSyncRunning = false;

// Sincronização agendada de anúncios de 1 em 1 minuto (Hub -> Inova)
cron.schedule('*/1 * * * *', async () => {
    if (isAnunciosLocalSyncRunning) {
        console.log('[Anúncios Cron] Sincronização já em andamento. Pulando este ciclo...');
        return;
    }

    isAnunciosLocalSyncRunning = true;
    console.log('[Anúncios Cron] Iniciando sincronização automática de anúncios...');

    try {
        const resultado = await anunciosController.sincronizarAnunciosInterno();
        console.log(`[Anúncios Cron] Concluída com sucesso! Total: ${resultado.total || 0}, Novos: ${resultado.novos || 0}, Atualizados: ${resultado.atualizados || 0}`);
    } catch (error) {
        console.error('[Anúncios Cron] Erro durante a sincronização:', error.message);
    } finally {
        isAnunciosLocalSyncRunning = false;
    }
});

let isHubProdutosSyncRunning = false;

// Agendamento para Sincronizar os Produtos do Hub
// A expressão '0 22 * * *' faz rodar todos os dias às 22:00.
// Se quiser mudar, ex: '0 */4 * * *' (a cada 4 horas), ou '0 0 * * 0' (todo domingo).
cron.schedule('0 6 * * *', async () => {
    if (isHubProdutosSyncRunning) {
        console.log(`[HUB Produtos Cron] Sincronização de anúncios já em andamento. Pulando este ciclo...`);
        return;
    }

    isHubProdutosSyncRunning = true;
    console.log('[HUB Produtos Cron] Iniciando ciclo de sincronização de anúncios e tarifas...');

    try {
        await hubProdutosService.sincronizarAnuncios();
        console.log('[HUB Produtos Cron] Ciclo de sincronização de produtos finalizado com sucesso.');

    } catch (error) {
        console.error('[HUB Produtos Cron] Erro durante a sincronização de produtos:', error);

    } finally {
        isHubProdutosSyncRunning = false;
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

cron.schedule('0 9 * * *', async () => {
    if (isHubProdutosSyncRunning) {
        console.log(`[HUB Produtos Cron] Sincronização de anúncios já em andamento. Pulando este ciclo...`);
        return;
    }

    isHubProdutosSyncRunning = true;
    console.log('[HUB Produtos Cron] Iniciando ciclo de sincronização de anúncios e tarifas...');

    try {
        await hubProdutosService.sincronizarAnuncios();
        console.log('[HUB Produtos Cron] Ciclo de sincronização de produtos finalizado com sucesso.');

    } catch (error) {
        console.error('[HUB Produtos Cron] Erro durante a sincronização de produtos:', error);

    } finally {
        isHubProdutosSyncRunning = false;
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

cron.schedule('0 14 * * *', async () => {
    if (isHubProdutosSyncRunning) {
        console.log(`[HUB Produtos Cron] Sincronização de anúncios já em andamento. Pulando este ciclo...`);
        return;
    }

    isHubProdutosSyncRunning = true;
    console.log('[HUB Produtos Cron] Iniciando ciclo de sincronização de anúncios e tarifas...');

    try {
        await hubProdutosService.sincronizarAnuncios();
        console.log('[HUB Produtos Cron] Ciclo de sincronização de produtos finalizado com sucesso.');

    } catch (error) {
        console.error('[HUB Produtos Cron] Erro durante a sincronização de produtos:', error);

    } finally {
        isHubProdutosSyncRunning = false;
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

cron.schedule('0 16 * * *', async () => {
    if (isHubProdutosSyncRunning) {
        console.log(`[HUB Produtos Cron] Sincronização de anúncios já em andamento. Pulando este ciclo...`);
        return;
    }

    isHubProdutosSyncRunning = true;
    console.log('[HUB Produtos Cron] Iniciando ciclo de sincronização de anúncios e tarifas...');

    try {
        await hubProdutosService.sincronizarAnuncios();
        console.log('[HUB Produtos Cron] Ciclo de sincronização de produtos finalizado com sucesso.');

    } catch (error) {
        console.error('[HUB Produtos Cron] Erro durante a sincronização de produtos:', error);

    } finally {
        isHubProdutosSyncRunning = false;
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});


cron.schedule('0 3 * * *', async () => {
    console.log(`[CRON Limpeza] Iniciando verificação de PDFs antigos em ${PDF_STORAGE_DIR_CLEANUP}...`);
    try {
        const files = await fs.readdir(PDF_STORAGE_DIR_CLEANUP);
        const now = Date.now();
        const maxAgeMs = MAX_FILE_AGE_DAYS * 24 * 60 * 60 * 1000;
        let deletedCount = 0;

        for (const file of files) {
            // Considera apenas os arquivos gerados pelo sistema
            if (file.startsWith('Etiquetas-Organizadas-') && file.endsWith('.pdf')) {
                const filePath = path.join(PDF_STORAGE_DIR_CLEANUP, file);
                try {
                    const stats = await fs.stat(filePath);
                    const fileAgeMs = now - stats.mtimeMs; // mtimeMs é o tempo da última modificação

                    if (fileAgeMs > maxAgeMs) {
                        await fs.unlink(filePath);
                        console.log(`[CRON Limpeza] Arquivo antigo deletado: ${file}`);
                        deletedCount++;
                    }
                } catch (statOrDeleteError) {
                    console.error(`[CRON Limpeza] Erro ao processar/deletar ${file}:`, statOrDeleteError);
                }
            }
        }
        console.log(`[CRON Limpeza] Verificação concluída. ${deletedCount} arquivos antigos deletados.`);
    } catch (readDirError) {
        if (readDirError.code === 'ENOENT') {
            console.log(`[CRON Limpeza] Diretório ${PDF_STORAGE_DIR_CLEANUP} não encontrado. Nenhuma limpeza necessária.`);
        } else {
            console.error('[CRON Limpeza] Erro ao ler o diretório de PDFs:', readDirError);
        }
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

//Agendar tarefa para atualizar preços da madeira a cada 20 minutos
cron.schedule('*/20 * * * *', async () => {
    console.log(`${new Date().toISOString()}: Executando tarefa agendada de atualização de preços...`);
    try {
        await Promise.all([
            updatePrices(),
            updatePricesMM()
        ]);
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego na execução agendada de updatePrices:`, error);
    }
});
//0 */2 * * *
cron.schedule('0 */2 * * *', async () => { // A cada 2 horas
    console.log(`${new Date().toISOString()}: Disparando job agendado de atualização de tokens Bling...`);
    try {
        await runScheduledTokenRefresh();
    } catch (error) {
        // O runScheduledTokenRefresh já deve logar seus próprios erros internos,
        // mas podemos logar um erro geral do agendador aqui se a promessa for rejeitada.
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador node-cron ao executar runScheduledTokenRefresh:`, error);
    }
});
console.log('Job de refresh de tokens Bling agendado para rodar a cada 5 horas.');

/*cron.schedule('0 0 * * *', async () => {
    console.log(`[CRON Expedição] Disparando rotina de virada de dia (Pausar Notas Pendentes)...`);
    try {
        await etiquetasService.pausarNotasViradaDoDia();
    } catch (e) {
        console.error('[CRON Expedição] Erro ao executar pausarNotasViradaDoDia:', e);
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});*/

// Sincroniza produtos uma vez por semana (às 4h da manhã de todo domingo)
//0 23 * * *
/*cron.schedule('0 4 * * 0', async () => {
    console.log(`${new Date().toISOString()}: Disparando job agendado semanal de sincronização de PRODUTOS.`);
    try {
        await syncBlingProductsLucas();
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar produtos:`, error);
    }
});

cron.schedule('0 4 * * 0', async () => {
    console.log(`${new Date().toISOString()}: Disparando job agendado semanal de sincronização de PRODUTOS.`);
    try {
        await syncBlingProductsEliane();
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar produtos:`, error);
    }
});
console.log('Job de sincronização de produtos agendado para rodar todo Domingo às 4h da manhã.');*/
// Sincroniza as NF-e emitidas a cada 1 hora
//0 * * * *
//*/15 1-59 * * * *
//cron.schedule('*/15 1-59 * * * *', async () => {
//    console.log(`${new Date().toISOString()}: Disparando job agendado de sincronização de NF-e.`);
//    try {
//        await Promise.all([
//            syncNFeEliane(),
//            syncNFeLucas()
//        ]);
//    } catch (error) {
//        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar NF-e:`, error);
//    }
//});
//console.log('Job de sincronização de NF-e emitidas agendado para rodar a cada hora.');

//0 5 * * 3
cron.schedule('0 * * * *', async () => {
    console.log(`${new Date().toISOString()}: Disparando job agendado de atualização de custos e dados de anúncios...`);
    try {
        await updateUrlCostsAndData();
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao executar updateUrlCostsAndData:`, error);
    }
});
console.log('Job de atualização de custos e dados de URLs agendado para rodar semanalmente.');

let isRastreioJobRunning = false;

console.log('[CRON] Agendando rotina de rastreio para executar a cada hora.');
// A expressão '0 * * * *' executa no minuto 0 de cada hora.
//1-59/1 * * * *
cron.schedule('0 * * * *', async () => {
    const dataHora = new Date().toLocaleString('pt-BR');

    if (isRastreioJobRunning) {
        console.log(`[CRON] A rotina de rastreio já está em execução. Pulando esta chamada. - ${dataHora}`);
        return; // Sai da função para não executar novamente
    }

    console.log('-------------------------------------');
    console.log(`[CRON] INICIANDO rotina de rastreio de pedidos - ${dataHora}`);

    try {

        isRastreioJobRunning = true;
        // Passo 1: Inserir novos pedidos que se tornaram elegíveis
        await rastreioService.inserirNovosPedidosParaRastreio();

        // Passo 2: Atualizar o status dos pedidos já em rastreamento
        await rastreioService.atualizarStatusPedidosEmRastreio();

        await rastreioService.verificarRespostasDeEmails();

        console.log(`[CRON] FINALIZADA rotina de rastreio com sucesso.`);

    } catch (error) {
        console.error('[CRON] ERRO ao executar a rotina de rastreio:', error);
    } finally {
        isRastreioJobRunning = false;
        console.log('-------------------------------------');
    }
}, {
    scheduled: true,
    timezone: "America/Sao_Paulo"
});

cron.schedule('*/10 * * * *', async () => {
    try {
        await HubPedidosService.monitorarPadrao();
    } catch (e) {
        console.error('[CRON MonitorarPadrao] Erro:', e);
    }
});

cron.schedule('0 12 * * *', async () => {
    try {
        await HubPedidosService.monitorarAprofundado();
    } catch (e) {
        console.error('[CRON MonitorarAprofundado] Erro:', e);
    }
});

// Sincroniza estoques uma vez por dia (às 2h da manhã) 0 2 * * *
cron.schedule('0 2 * * *', async () => {
    console.log(`${new Date().toISOString()}: Disparando job agendado diário de sincronização de ESTOQUES.`);
    try {
        await syncEstoqueBling();
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar estoques:`, error);
    }
});

// Sincroniza estoques uma vez por dia (às 5h da manhã)
cron.schedule('0 14 * * *', async () => {
    console.log(`${new Date().toISOString()}: Disparando job agendado diário de sincronização de ESTOQUES.`);
    try {
        await syncEstoqueBling(false);
    } catch (error) {
        console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar estoques:`, error);
    }
});

// Limpeza diária das fotos de conferência (às 00:00)
//cron.schedule('0 0 * * *', async () => {
/*    console.log('[CRON] Iniciando limpeza da pasta de fotos de conferência...');
    const dirPath = path.join(__dirname, 'uploads', 'fotos-conferencia');
    try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
            // Pode adicionar verificação para deletar apenas .jpg, mas como a pasta é exclusiva:
            await fs.unlink(path.join(dirPath, file)).catch(e => console.error(`Erro ao deletar foto: ${file}`, e));
        }
        console.log(`[CRON] Limpeza concluída. ${files.length} fotos removidas.`);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('[CRON] Erro ao acessar pasta de fotos:', err);
        }
    }
});*/

// Rota para lidar com páginas não encontradas
app.use((req, res) => {
    res.status(404).send('Página não encontrada');
});


// Iniciar o servidor
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

server.setTimeout(1800000); // 30 minutos em milissegundos
