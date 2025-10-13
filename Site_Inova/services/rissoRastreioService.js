// services/rissoRastreioService.js

const axios = require('axios');
const { poolInova } = require('../config/db');

const RISSO_API_URL = 'http://200.206.77.27:9000/v1/nfe/';
const RISSO_API_USER = process.env.RISSO_API_USER;
const RISSO_API_PASS = process.env.RISSO_API_PASS;

function mapearStatusRisso(codigoOcorrencia) {
    const codigo = String(codigoOcorrencia);
    const mapaStatus = {
        '134': 'Em Trânsito',
        '130': 'Em Trânsito',
        '131': 'Em Trânsito',
        '135': 'Em Trânsito',
        '1': 'Entregue - Conferir'
    };
    return mapaStatus[codigo] || 'Fora do Comum';
}

function formatarDataRisso(dataString) {
    if (!dataString || typeof dataString !== 'string') return null;
    const [data, hora] = dataString.split('T');
    const [dia, mes, ano] = data.split('/');
    if (!dia || !mes || !ano || !hora) return null;
    return `${ano}-${mes}-${dia} ${hora}:00`;
}

async function atualizarStatusPedidosRisso(pedidosRisso) {
    if (!RISSO_API_USER || !RISSO_API_PASS) {
        console.error('[Risso Service] Credenciais da API da Risso não configuradas. Abortando.');
        return;
    }

    const authToken = Buffer.from(`${RISSO_API_USER}:${RISSO_API_PASS}`).toString('base64');
    const headers = { 'Authorization': `Basic ${authToken}`, 'Cache-Control': 'no-cache' };

    console.log(`[Risso Service] Iniciando atualização para ${pedidosRisso.length} pedido(s) da Risso.`);

    for (const pedido of pedidosRisso) {
        try {
            const response = await axios.get(`${RISSO_API_URL}${pedido.chave_nfe}`, { headers });
            const dadosRastreioRaw = response.data;

            if (!dadosRastreioRaw || !dadosRastreioRaw.Ocorrencias || dadosRastreioRaw.Ocorrencias.length === 0) continue;

            const ultimaOcorrencia = dadosRastreioRaw.Ocorrencias[dadosRastreioRaw.Ocorrencias.length - 1];
            const situacaoNovaPadronizada = mapearStatusRisso(ultimaOcorrencia.cd_Ocorrencia);

            if (pedido.status_manual || pedido.situacao_atual === situacaoNovaPadronizada) continue;
            
            const dataEntrega = situacaoNovaPadronizada === 'Entregue - Conferir' ? formatarDataRisso(ultimaOcorrencia.dt_Ocorrencia) : null;
            const marcarParaConferencia = !pedido.status_manual && pedido.situacao_atual !== situacaoNovaPadronizada;

            const queryParams = [];
            let updateQuery = 'UPDATE pedidos_em_rastreamento SET ';
            let fieldsToUpdate = [
                `dados_rastreio_raw = $${queryParams.push(dadosRastreioRaw)}`,
                `ultima_atualizacao_api = NOW()`,
                `atualizado_em = NOW()`,
                `conferencia_necessaria = $${queryParams.push(marcarParaConferencia)}`,
                `situacao_atual = $${queryParams.push(situacaoNovaPadronizada)}`
            ];
            if (dataEntrega) fieldsToUpdate.push(`data_entrega = $${queryParams.push(dataEntrega)}`);
            
            updateQuery += fieldsToUpdate.join(', ') + ` WHERE id = $${queryParams.push(pedido.id)}`;
            await poolInova.query(updateQuery, queryParams);
        } catch (error) {
            if (error.response && error.response.status === 400) {
                console.warn(`[Risso Service] API da Risso retornou erro 400 para a chave ${pedido.chave_nfe}: ${error.response.data.Erro}`);
            } else {
                console.error(`[Risso Service] Erro ao consultar API da Risso para a chave ${pedido.chave_nfe}:`, error.message);
            }
        }
    }
}

module.exports = { atualizarStatusPedidosRisso };