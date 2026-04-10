// services/jewRastreioService.js

const axios = require('axios');
const { poolInova } = require('../config/db');

// --- Configuração da API Jew ---
const JEW_API_URL = 'https://app.tmselite.com/api/ocorrencias/ocorrencianotafiscaldepara';
const JEW_API_TOKEN = process.env.JEW_API_TOKEN;

// --- Contas Bling e CNPJs correspondentes ---
const BLING_ACCOUNT_LUCAS = 'lucas'; 
const BLING_ACCOUNT_ELIANE = 'eliane'; 
const CNPJ_LUCAS = '40.062.295/0001-45';
const CNPJ_ELIANE = '34.321.153/0001-52';

/**
 * PADRONIZA o status do pedido da Jew.
 */
function mapearStatusJew(codigoOcorrencia) {
    const codigo = String(codigoOcorrencia);
    const mapaStatus = {
        '0': 'Em Trânsito', '12': 'Em Trânsito', '15': 'Em Trânsito',
        '22': 'Em Trânsito', '31': 'Em Trânsito', '35': 'Entregue - Confirmado'
    };
    return mapaStatus[codigo] || 'Fora do Comum';
}

/**
 * Tenta rastrear uma única nota fiscal com uma série específica.
 */
async function tentarRastreioComSerie(pedido, serie, headers) {
    const blingAccount = pedido.bling_account;
    const cnpjEmbarcador = blingAccount === BLING_ACCOUNT_LUCAS ? CNPJ_LUCAS : CNPJ_ELIANE;

    console.log(cnpjEmbarcador);

    let numeroNota = String(pedido.numero_nfe);
    // Se a conta for da Eliane e o número da nota começar com '0', remove o primeiro caractere.
    if (blingAccount === BLING_ACCOUNT_ELIANE && numeroNota.startsWith('0')) {
        numeroNota = numeroNota.substring(1);
    }

    const listaNotasFiscais = [`${numeroNota}/${serie}`];

    try {
        const response = await axios.post(JEW_API_URL, {
            cnpjEmbarcador,
            listaNotasFiscais
        }, { headers });
        
        // Se a API retornar sucesso e tiver resultados, retorna os dados.
        if (response.data && !response.data.flagErro && response.data.listaResultados && response.data.listaResultados.length > 0) {
            return response.data;
        }
    } catch (error) {
        // Ignora erros individuais de requisição (ex: 404 Not Found), pois vamos tentar outras séries.
        console.warn(`[Jew Service] Tentativa para NFe ${numeroNota}/${serie} falhou.`, error.response ? `Status: ${error.response.status}`: '');
    }
    return null; // Retorna nulo se não encontrar nada ou der erro.
}


/**
 * Busca e atualiza o status de pedidos específicos da transportadora Jew.
 */
async function atualizarStatusPedidosJew(pedidosJew) {
    if (!JEW_API_TOKEN) {
        console.error('[Jew Service] Token da API da Jew não configurado no .env. Abortando.');
        return;
    }
    if (pedidosJew.length === 0) return;

    console.log(`[Jew Service] Iniciando atualização para ${pedidosJew.length} pedido(s) da Jew.`);

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JEW_API_TOKEN}`
    };
    
    const seriesParaTentar = ['1', '3', '5'];

    for (const pedido of pedidosJew) {
        let dadosRastreioRaw = null;

        // --- Lógica de Tentativa de Séries ---
        for (const serie of seriesParaTentar) {
            console.log(`[Jew Service] Tentando NFe ${pedido.numero_nfe} com série ${serie}...`);
            const resultado = await tentarRastreioComSerie(pedido, serie, headers);
            if (resultado) {
                dadosRastreioRaw = resultado;
                console.log(`[Jew Service] Sucesso! NFe ${pedido.numero_nfe} encontrada com série ${serie}.`);
                break; // Para o loop assim que encontrar a série correta
            }
        }

        if (!dadosRastreioRaw) {
            console.log(`[Jew Service] NFe ${pedido.numero_nfe} não encontrada em nenhuma série (1, 3, 5).`);
            continue; // Pula para o próximo pedido
        }

        const ocorrencias = dadosRastreioRaw.listaResultados.sort((a, b) => new Date(a.dtOcorrencia) - new Date(b.dtOcorrencia));
        const ultimaOcorrencia = ocorrencias[ocorrencias.length - 1];
        const situacaoNovaPadronizada = mapearStatusJew(ultimaOcorrencia.codigoOcorrencia);

        if (pedido.status_manual || pedido.situacao_atual === situacaoNovaPadronizada) continue;
        
        const dataEntrega = situacaoNovaPadronizada === 'Entregue - Conferir' ? new Date(ultimaOcorrencia.dtOcorrencia) : null;
        const marcarParaConferencia = !pedido.status_manual && pedido.situacao_atual !== situacaoNovaPadronizada;

        const queryParams = [];
        let updateQuery = 'UPDATE pedidos_em_rastreamento SET ';
        let fieldsToUpdate = [
            `dados_rastreio_raw = $${queryParams.push({ listaResultados: ocorrencias })}`,
            `ultima_atualizacao_api = NOW()`,
            `atualizado_em = NOW()`,
            `conferencia_necessaria = $${queryParams.push(marcarParaConferencia)}`,
            `situacao_atual = $${queryParams.push(situacaoNovaPadronizada)}`
        ];

        if (dataEntrega) fieldsToUpdate.push(`data_entrega = $${queryParams.push(dataEntrega)}`);
        
        updateQuery += fieldsToUpdate.join(', ') + ` WHERE id = $${queryParams.push(pedido.id)}`;
        await poolInova.query(updateQuery, queryParams);
    }
}

module.exports = {
    atualizarStatusPedidosJew
};