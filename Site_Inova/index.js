require('dotenv').config();
const express = require('express');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const exphbs = require('express-handlebars');
const emissaoRoutes = require('./routes/emissaoRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');
const madeiraRoutes = require('./routes/madeiraRoutes');
const viaVarejoRoutes = require('./routes/viaVarejoRoutes');
const pedidosRoutes = require('./routes/pedidosRoutes');
const relacaoRoutes = require('./routes/relacaoRoutes');
const rastreioRoutes = require('./routes/rastreioRoutes'); 
const handlebarsHelpers = require('./helpers/handlebarsHelpers');
const authRoutes = require('./routes/authRoutes');
const authController = require('./controllers/authController');
const rastreioService = require('./services/rastreioService');
const nfeHistoryRoutes = require('./routes/nfeHistoryRoutes');
const assistenciaRoutes = require('./routes/assistenciaRoutes');
const etiquetasRoutes = require('./routes/etiquetasRoutes');
const tiposRoutes = require('./routes/tiposRoutes');
const produtosRoutes = require('./routes/produtosRoutes');
const prodSyncRoutes = require('./routes/productSyncRoutes')
//const { updatePrices } = require('./updatePrices.js');
//const { runScheduledTokenRefresh } = require('./services/blingTokenManager');
const { syncRecentEmittedNFe, syncNFeEliane, syncNFeLucas } = require('./blingSyncService.js');
//const { updateUrlCostsAndData } = require('./costUpdater.js');
const path = require('path');
const fs = require('fs').promises;
const PDF_STORAGE_DIR_CLEANUP = path.join(__dirname, 'pdfEtiquetas');
const MAX_FILE_AGE_DAYS = 23;
const favicon = require('serve-favicon');
const cron = require('node-cron'); 
const { exec } = require('child_process');

const app = express();
const PORT = 3000;


// Configurar o body-parser para analisar solicitações com o corpo em formato URL-encoded e JSON
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
app.use(bodyParser.json({ limit: '500mb' }));

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

// Rotas de login
app.use('/', authRoutes);// Usar rotas de autenticação
app.use(authController.sessionMiddleware);
app.use(flash());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success'); // Para mensagens de sucesso
  res.locals.error_msg = req.flash('error');     // Para mensagens de erro
  res.locals.info_msg = req.flash('info');       // Para mensagens de aviso/info

  // Dados da Sessão para as Views
  if (req.session && req.session.userId) { // Verifica se o usuário está logado
    res.locals.isAuthenticated = true; // Uma flag útil para o template
    res.locals.username = req.session.username; // Torna {{username}} disponível
    res.locals.cargo = req.session.role;    // Torna {{userCargo}} disponível (para usar como {{userCargo}} nos templates)
                                                // Se quiser usar {{cargo}} como na rota do mainMenu, pode ser res.locals.cargo = req.session.role;
  } else {
    res.locals.isAuthenticated = false;
    res.locals.username = null;
    res.locals.userCargo = null;
  }

  next();
});

//Proteger o menu principal para exigir login
app.get('/', authController.requireAuth, (req, res) => {
  res.render('mainMenu', { 
    title: 'Menu Principal', 
    username: req.session.username,
    cargo: req.session.role,
    layout: false 
  });
});

app.use('/', pedidosRoutes);
// Usar rotas de monitoramento
app.use('/', madeiraRoutes);
app.use('/', monitoringRoutes); // Usar rotas da Madeira Madeira
app.use('/', viaVarejoRoutes); // Usar rotas do Via Varejo
app.use('/', emissaoRoutes); // Usar rotas de emissão
app.use('/', relacaoRoutes); // Usar rotas de relações
app.use('/rastreio', rastreioRoutes);
app.use('/historico-nfe', nfeHistoryRoutes); // Define o prefixo da nova página
app.use('/assistencias', assistenciaRoutes);
app.use('/', etiquetasRoutes);
app.use('/', tiposRoutes);
app.use('/', produtosRoutes);
app.use('/product-sync', prodSyncRoutes);

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
//cron.schedule('*/20 * * * *', async () => {
  //console.log(`${new Date().toISOString()}: Executando tarefa agendada de atualização de preços...`);
  //try {
    //await updatePrices();
  //} catch (error) {
    //console.error(`${new Date().toISOString()}: Erro pego na execução agendada de updatePrices:`, error);
  //}
//})//;
//0 */5 * * *
//cron.schedule('0 */2 * * *', async () => { // A cada 2 horas
  //console.log(`${new Date().toISOString()}: Disparando job agendado de atualização de tokens Bling...`);
  //try {
    //await runScheduledTokenRefresh();
  //} catch (error) {
    // O runScheduledTokenRefresh já deve logar seus próprios erros internos,
    // mas podemos logar um erro geral do agendador aqui se a promessa for rejeitada.
    //console.error(`${new Date().toISOString()}: Erro pego pelo agendador node-cron ao executar runScheduledTokenRefresh:`, error);
  //}
//});
//console.log('Job de refresh de tokens Bling agendado para rodar a cada 5 horas.');

// Sincroniza produtos uma vez por semana (às 4h da manhã de todo domingo)

//cron.schedule('0 4 * * 0', async () => {
    //console.log(`${new Date().toISOString()}: Disparando job agendado semanal de sincronização de PRODUTOS.`);
    //try {
        //await syncAllBlingProducts();
    //} catch (error) {
        //console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar produtos:`, error);
    //}
//});
//console.log('Job de sincronização de produtos agendado para rodar todo Domingo às 4h da manhã.');

// Sincroniza as NF-e emitidas a cada 1 hora
//0 * * * *
//cron.schedule('1-59/1 * * * *', async () => {
    //console.log(`${new Date().toISOString()}: Disparando job agendado de sincronização de NF-e.`);
    //try {
        //await Promise.all([
            //syncNFeEliane(),
            //syncNFeLucas()
        //]);
    //} catch (error) {
        //console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao sincronizar NF-e:`, error);
    //}
//});
//console.log('Job de sincronização de NF-e emitidas agendado para rodar a cada hora.');

//0 5 * * 3
//cron.schedule('0 5 * * 3', async () => {
    //console.log(`${new Date().toISOString()}: Disparando job agendado de atualização de custos e dados de anúncios...`);
    //try {
        //await updateUrlCostsAndData();
    //} catch (error) {
        //console.error(`${new Date().toISOString()}: Erro pego pelo agendador ao executar updateUrlCostsAndData:`, error);
    //}
//});

console.log('Job de atualização de custos e dados de URLs agendado para rodar semanalmente.');
let isRastreioJobRunning = false;
console.log('[CRON] Agendando rotina de rastreio para executar a cada hora.');
// A expressão '0 * * * *' executa no minuto 0 de cada hora.
//1-59/1 * * * *
cron.schedule('*/1 * * * *', async () => {
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

// Rota para lidar com páginas não encontradas
app.use((req, res) => {
  res.status(404).send('Página não encontrada');
});


// Iniciar o servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

server.setTimeout(1800000); // 30 minutos em milissegundos