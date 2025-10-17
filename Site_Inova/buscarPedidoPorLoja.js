// buscaPedidoPorLoja.js
require('dotenv').config();
// --- CORREÇÃO APLICADA ---
// Importa a função correta do arquivo correto.
const { blingApiGet } = require('./services/blingApiService'); 
const { getValidBlingToken } = require('./services/blingTokenManager');

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';
const ACCOUNT_TYPE = 'lucas';

// --- CORREÇÃO APLICADA ---
// A função de retentativa, que é interna no blingSyncService, foi replicada aqui
// para que o script funcione de forma independente sem alterar os arquivos originais.
async function apiRequestWithRetry(url, accountType, retries = 5, delay = 1000) {
    try {
        // Agora usa a função 'blingApiGet' que realmente é exportada.
        const response = await blingApiGet(url, accountType);
        return response;
    } catch (error) {
        if (error.status === 429 && retries > 0) {
            console.warn(`[API Retry] Limite de requisições atingido. Tentando novamente em ${delay / 1000}s... (${retries} tentativas restantes)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return apiRequestWithRetry(url, accountType, retries - 1, delay * 2);
        }
        // Propaga o erro se não for 429 ou se as tentativas se esgotarem
        throw error;
    }
}


/**
 * Script autônomo para buscar e exibir detalhes de um pedido no Bling
 * a partir do seu 'numeroLoja' (Pack ID).
 */
async function buscarPedido() {
    const numeroLoja = process.argv[2];

    if (!numeroLoja) {
        console.error('ERRO: Por favor, forneça o "número loja" (Pack ID) como argumento.');
        console.log('Exemplo: node buscaPedidoPorLoja.js SEU_NUMERO_LOJA_AQUI');
        return;
    }

    console.log(`--- Iniciando busca pelo Pedido Loja: ${numeroLoja} na conta '${ACCOUNT_TYPE}' ---`);

    try {
        await getValidBlingToken(ACCOUNT_TYPE);
        
        console.log('\n[PASSO 1] Buscando ID do pedido...');
        const pedidoSearchUrl = `${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${numeroLoja}`;
        const pedidoSearchResponse = await apiRequestWithRetry(pedidoSearchUrl, ACCOUNT_TYPE);

        if (!pedidoSearchResponse.data || pedidoSearchResponse.data.length === 0) {
            console.error('\n[ERRO] Nenhum pedido encontrado com este número de loja.');
            return;
        }

        const pedidoId = pedidoSearchResponse.data[0].id;
        console.log(`[SUCESSO] ID do pedido encontrado: ${pedidoId}`);

        console.log('\n[PASSO 2] Buscando detalhes completos do pedido...');
        const pedidoDetalhesUrl = `${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}`;
        const pedidoDetalhes = (await apiRequestWithRetry(pedidoDetalhesUrl, ACCOUNT_TYPE)).data;

        console.log('\n--- DETALHES DO PEDIDO ENCONTRADO ---');
        console.log(JSON.stringify(pedidoDetalhes, null, 2));
        console.log('--- FIM DA BUSCA ---');

    } catch (error) {
        console.error('\n[ERRO CRÍTICO] Ocorreu uma falha durante a busca:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Mensagem:', error.message);
        }
    }
}

buscarPedido();