// services/rastreioService.js

const axios = require('axios');
const { poolInova, poolMonitora } = require('../config/db');
const gmailService = require('./gmailService');
const { atualizarStatusPedidosRisso } = require('./rissoRastreioService');
const { atualizarStatusPedidosJew } = require('./jewRastreioService');

// =============================================================================
// SEÇÃO DE INSERÇÃO DE NOVOS PEDIDOS (CÓDIGO ORIGINAL MANTIDO)
// =============================================================================
async function inserirNovosPedidosParaRastreio() {
    console.log('[Rastreio Service] Buscando novos pedidos para inserir...');
    const nfeQuery = `SELECT enr.nfe_numero, bling_account_type AS bling_account, enr.transportador_nome AS transportadora, enr.nfe_chave_acesso_44d AS chave_nfe, enr.data_processamento AS data_envio, ac.plataforma AS plataforma FROM emission_nfe_reports enr INNER JOIN acompanhamentos_consolidados ac ON enr.nfe_numero = ac.numero_nfe WHERE status_para_relacao = 'relacionada'`;
    const resNfes = await poolMonitora.query(nfeQuery);
    const nfesElegiveis = resNfes.rows || [];
    if (nfesElegiveis.length === 0) { console.log('[Rastreio Service] Nenhum novo pedido elegível encontrado.'); return; }
    const chavesExistentesQuery = `SELECT chave_nfe FROM pedidos_em_rastreamento`;
    const resChaves = await poolInova.query(chavesExistentesQuery);
    const chavesSet = new Set((resChaves.rows || []).map(r => r.chave_nfe.trim()));
    const nfesParaInserir = nfesElegiveis.filter(nfe => nfe.chave_nfe && !chavesSet.has(nfe.chave_nfe.trim()));
    if (nfesParaInserir.length === 0) { console.log('[Rastreio Service] Todos os pedidos elegíveis já estão na tabela de rastreio.'); return; }
    for (const nfe of nfesParaInserir) {
        const pedidoQuery = `SELECT documento AS documento_cliente, numero_pedido FROM acompanhamentos_consolidados WHERE numero_nfe = $1 LIMIT 1`;
        const resPedido = await poolInova.query(pedidoQuery, [nfe.nfe_numero]);
        const pedidoInfo = (resPedido.rows || [{}])[0];
        if (pedidoInfo) {
            const insertQuery = `INSERT INTO pedidos_em_rastreamento (numero_pedido, documento_cliente, transportadora, numero_nfe, chave_nfe, data_envio, plataforma, situacao_atual, bling_account) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (chave_nfe) DO NOTHING`;
            const values = [pedidoInfo.numero_pedido, pedidoInfo.documento_cliente, nfe.transportadora, nfe.nfe_numero, nfe.chave_nfe.trim(), nfe.data_envio, nfe.plataforma, 'Aguardando Sincronização', nfe.bling_account];
            await poolInova.query(insertQuery, values);
        }
    }
}

// =============================================================================
// SEÇÃO DE SERVIÇOS ESPECÍFICOS (SSW e E-mail)
// =============================================================================

/**
 * [NOVO] PADRONIZA o status do pedido da SSW.
 */
function mapearStatusSsw(codigoSsw) {
    if (String(codigoSsw) === '01') {
        return 'Entregue - Conferir';
    }
    // Qualquer outro status que não seja de entrega é considerado "Em Trânsito"
    return 'Em Trânsito';
}

async function atualizarStatusPedidosSsw(pedidosSsw) {
    if (pedidosSsw.length === 0) return;
    console.log(`[SSW Service] Iniciando atualização para ${pedidosSsw.length} pedido(s) da SSW.`);
    for (const pedido of pedidosSsw) {
        try {
            const response = await axios.post('https://ssw.inf.br/api/trackingdanfe', { chave_nfe: pedido.chave_nfe }, { headers: { 'Content-Type': 'application/json' } });
            const dadosRastreioRaw = response.data;
            if (!dadosRastreioRaw || !dadosRastreioRaw.success || !dadosRastreioRaw.documento || !dadosRastreioRaw.documento.tracking || dadosRastreioRaw.documento.tracking.length === 0) {
                continue;
            }
            
            const historico = dadosRastreioRaw.documento.tracking;
            const situacaoMaisRecente = historico[historico.length - 1];

            // [CORREÇÃO APLICADA AQUI] Usa a função de mapeamento para padronizar o status
            const situacaoNovaPadronizada = mapearStatusSsw(situacaoMaisRecente.codigo_ssw);
            
            if (pedido.status_manual || pedido.situacao_atual === situacaoNovaPadronizada) continue;

            const marcarParaConferencia = !pedido.status_manual && pedido.situacao_atual !== situacaoNovaPadronizada;

            let dataPrevisaoEntrega = null;
            const regexPrevisao = /Previsao de entrega: (\d{2}\/\d{2}\/\d{2})/;
            for (const evento of historico) {
                const match = evento.descricao.match(regexPrevisao);
                if (match && match[1]) {
                    const partes = match[1].split('/');
                    dataPrevisaoEntrega = `20${partes[2]}-${partes[1]}-${partes[0]}`;
                    break;
                }
            }
            
            let dataEntrega = (String(situacaoMaisRecente.codigo_ssw) === '01') ? situacaoMaisRecente.data_hora_efetiva : null;

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
            if (dataPrevisaoEntrega && !pedido.previsao_atu) fieldsToUpdate.push(`data_previsao_entrega = $${queryParams.push(dataPrevisaoEntrega)}`);
            
            updateQuery += fieldsToUpdate.join(', ') + ` WHERE id = $${queryParams.push(pedido.id)}`;
            await poolInova.query(updateQuery, queryParams);
        } catch (error) {
            console.error(`[SSW Service] Erro ao consultar API para chave ${pedido.chave_nfe}:`, error.message);
        }
    }
}

async function verificarEmailsParaPedidosAtrasados() {
    console.log('[Email Service] Verificando e-mails para pedidos fora do prazo...');
    const query = `SELECT id, numero_nfe, email_thread_id FROM pedidos_em_rastreamento WHERE data_previsao_entrega < CURRENT_DATE AND data_entrega IS NULL AND situacao_atual <> 'Entregue - Confirmado' AND (email_status IS NULL OR email_status NOT IN ('Email - Resolvido'))`;
    const { rows: pedidosAtrasados } = await poolInova.query(query);
    for (const pedido of pedidosAtrasados) {
        try {
            await gmailService.processarEmailParaPedido(pedido);
        } catch (error) {
            console.error(`[Email Service] Erro ao processar e-mail para NFE ${pedido.numero_nfe}:`, error);
        }
    }
}

async function verificarRespostasDeEmails() {
    console.log('[Email Service] Verificando respostas de e-mails enviados...');
    const query = `SELECT id, numero_nfe, email_thread_id, transportadora FROM pedidos_em_rastreamento WHERE email_status IN ('Email - Enviado', 'Email - Visto')`;
    const { rows: pedidosComEmail } = await poolInova.query(query);
    for (const pedido of pedidosComEmail) {
        try {
            await gmailService.verificarRespostas(pedido);
        } catch (error) {
            console.error(`[Email Service] Erro ao verificar resposta para NFE ${pedido.numero_nfe}:`, error);
        }
    }
}

// =============================================================================
// SEÇÃO DO ORQUESTRADOR PRINCIPAL
// =============================================================================

async function atualizarStatusPedidosEmRastreio() {
    console.log('[Rastreio Service] Orquestrador iniciando ciclo de atualização...');
    const pedidosAtivosQuery = `SELECT id, chave_nfe, transportadora, situacao_atual, status_manual, previsao_atu, numero_nfe, bling_account FROM pedidos_em_rastreamento WHERE situacao_atual <> 'Entregue - Confirmado'`;
    const { rows: pedidosAtivos } = await poolInova.query(pedidosAtivosQuery);
    if (pedidosAtivos.length === 0) { console.log('[Rastreio Service] Nenhum pedido ativo para atualizar.'); return; }

    const pedidosPorTransportadora = { ssw: [], risso: [], jew: [], ignorado: [] };
    const transportadorasIgnoradas = ['frenet'];

    for (const pedido of pedidosAtivos) {
        const transportadoraLower = (pedido.transportadora || '').toLowerCase();
        if (transportadoraLower.includes('risso')) {
            pedidosPorTransportadora.risso.push(pedido);
        } else if (transportadoraLower.includes('jew')) {
            pedidosPorTransportadora.jew.push(pedido);
        } else if (transportadorasIgnoradas.some(ex => transportadoraLower.includes(ex))) {
            pedidosPorTransportadora.ignorado.push(pedido);
        } else {
            pedidosPorTransportadora.ssw.push(pedido);
        }
    }

    console.log(`[Rastreio Service] Pedidos a processar: SSW(${pedidosPorTransportadora.ssw.length}), Risso(${pedidosPorTransportadora.risso.length}), Jew(${pedidosPorTransportadora.jew.length}), Ignorados(${pedidosPorTransportadora.ignorado.length})`);

    await Promise.all([
        atualizarStatusPedidosSsw(pedidosPorTransportadora.ssw),
        atualizarStatusPedidosRisso(pedidosPorTransportadora.risso),
        atualizarStatusPedidosJew(pedidosPorTransportadora.jew)
    ]);
    
    await verificarEmailsParaPedidosAtrasados();
    await verificarRespostasDeEmails();

    console.log('[Rastreio Service] Orquestrador finalizou o ciclo de atualização.');
}

// =============================================================================
// SEÇÃO DE FUNÇÕES AUXILIARES (CÓDIGO ORIGINAL MANTIDO)
// =============================================================================
async function marcarTodosComoConferidos() {
    console.log("[Rastreio Service] Marcando todos os pedidos como conferidos...");
    try {
        const query = `UPDATE pedidos_em_rastreamento SET conferencia_necessaria = FALSE WHERE conferencia_necessaria = TRUE`;
        const result = await poolInova.query(query);
        console.log(`[Rastreio Service] ${result.rowCount} pedido(s) foram marcados como conferidos.`);
        return { success: true, count: result.rowCount };
    } catch (error) {
        console.error("[Rastreio Service] Erro ao marcar pedidos como conferidos:", error);
        throw error;
    }
}

async function getConferenciaStatus() {
    const query = `SELECT EXISTS (SELECT 1 FROM pedidos_em_rastreamento WHERE conferencia_necessaria = TRUE)`;
    const result = await poolInova.query(query);
    return result.rows[0].exists;
}

async function getDistinctTransportadoras() {
    const query = `SELECT DISTINCT CASE WHEN transportadora = 'I. AMORIN TRANSPORTES EIRELI' THEN 'I AMORIN TRANSPORTES EIRELLI' ELSE transportadora END as transportadora_unificada FROM pedidos_em_rastreamento WHERE transportadora IS NOT NULL AND transportadora <> '' AND transportadora <> 'JEW TRANSPORTES LTDA' ORDER BY transportadora_unificada ASC`;
    const result = await poolInova.query(query);
    return result.rows.map(row => row.transportadora_unificada);
}

async function getDistinctObservacoes() {
    const query = `SELECT DISTINCT observacao FROM pedidos_em_rastreamento WHERE observacao IS NOT NULL AND observacao != '' ORDER BY observacao ASC`;
    const result = await poolInova.query(query);
    return result.rows.map(row => row.observacao);
}

async function getDistinctPlataformas() {
    const query = `SELECT DISTINCT plataforma FROM pedidos_em_rastreamento WHERE plataforma IS NOT NULL AND plataforma <> '' ORDER BY plataforma ASC`;
    const result = await poolInova.query(query);
    return result.rows.map(row => row.plataforma);
}

// =============================================================================
// EXPORTAÇÕES
// =============================================================================
module.exports = {
    inserirNovosPedidosParaRastreio,
    atualizarStatusPedidosEmRastreio,
    marcarTodosComoConferidos,
    getConferenciaStatus,
    verificarRespostasDeEmails,
    getDistinctTransportadoras,
    getDistinctObservacoes,
    getDistinctPlataformas
};