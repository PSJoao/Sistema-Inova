// services/rastreioService.js

const axios = require('axios');
const { poolInova, poolMonitora } = require('../config/db');
const gmailService = require('./gmailService');
const ExcelJS = require('exceljs');
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

// services/rastreioService.js

async function verificarEmailsParaPedidosAtrasados() {
    const agora = new Date();
    const horaAtual = agora.getHours(); // Usa o fuso horário do servidor (America/Sao_Paulo)

    // Regra 1: Só executa a lógica dentro do horário comercial (7h às 17h)
    if (horaAtual < 7 || horaAtual >= 17) {
        return;
    }
    
    console.log('[Email Service] Verificando pedidos para envio de e-mail automático...');

    // Regra 2: Busca pedidos com exatamente 3 dias de atraso e que nunca tiveram e-mail enviado
    // Passo 1: Busca APENAS os pedidos atrasados do banco de dados principal (Inova)
    const pedidosQuery = `
        SELECT * FROM pedidos_em_rastreamento
        WHERE 
            data_previsao_entrega = CURRENT_DATE - INTERVAL '3 days' 
            AND data_entrega IS NULL
            AND situacao_atual <> 'Entregue - Confirmado'
            AND (email_status IS NULL OR email_status = 'Nenhum')
    `;
    const { rows: pedidosAtrasados } = await poolInova.query(pedidosQuery);

    if (pedidosAtrasados.length === 0) {
        return;
    }

    console.log(`[Email Service] ${pedidosAtrasados.length} pedido(s) encontrado(s) para envio de cobrança.`);

    for (const pedido of pedidosAtrasados) {
        try {
            // Passo 2: Para CADA pedido atrasado, busca os dados do cliente no banco de monitoramento
            const nfeDetailsQuery = `
                SELECT etiqueta_nome, etiqueta_municipio, etiqueta_uf 
                FROM cached_nfe 
                WHERE nfe_numero = $1 
                LIMIT 1
            `;
            const nfeDetailsResult = await poolMonitora.query(nfeDetailsQuery, [pedido.numero_nfe]);

            if (nfeDetailsResult.rows.length === 0) {
                console.warn(`[Email Service] Não foram encontrados detalhes na cached_nfe para a NFe ${pedido.numero_nfe}. Pulando e-mail.`);
                continue; // Pula para o próximo pedido
            }

            // Passo 3: Combina os dados do pedido com os detalhes do cliente
            const dadosCompletosPedido = {
                ...pedido, // Dados do rastreamento (id, transportadora, etc)
                ...nfeDetailsResult.rows[0] // Adiciona etiqueta_nome, etiqueta_municipio, etiqueta_uf
            };
            
            // Passo 4: Chama a função de envio com o objeto de dados completo
            await gmailService.sendPositionRequestEmail(dadosCompletosPedido);

        } catch (error) {
            console.error(`[Email Service] Falha ao processar e-mail automático para NFE ${pedido.numero_nfe}:`, error);
        }
    }
}

async function verificarRespostasDeEmails() {
    console.log('[Email Service] Verificando respostas de e-mails enviados...');
    const query = `SELECT id, numero_nfe, email_thread_id, transportadora FROM pedidos_em_rastreamento WHERE email_status IN ('Email - Enviado', 'Email - Visto', 'Email - Em Andamento')`;
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

async function atualizarPrevisaoComBoletimDominalog(fileBuffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];

    let atualizados = 0;
    let naoEncontrados = 0;
    let semAlteracao = 0;
    const promises = [];

    // Itera a partir da linha 2 (pulando o cabeçalho)
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;

        const nfeCrua = row.getCell('L').value;
        const novaPrevisaoCrua = row.getCell('Q').value;

        if (!nfeCrua || !novaPrevisaoCrua) return;

        // Normaliza o número da NFe para ter 6 dígitos com zero à esquerda
        const nfeNormalizada = String(nfeCrua).padStart(6, '0');
        
        // Converte a data do Excel para um formato que o DB entende
        const novaPrevisao = new Date(novaPrevisaoCrua);
        if (isNaN(novaPrevisao.getTime())) return; // Pula se a data for inválida

        const promise = poolInova.query(
            `UPDATE pedidos_em_rastreamento
             SET 
                data_previsao_entrega = $1,
                observacao = 'Nova Previsão de Entrega via Boletim',
                atualizado_em = NOW(),
                status_manual = TRUE
             WHERE 
                transportadora = 'DOMINALOG' 
                AND numero_nfe = $2 
                AND data_previsao_entrega IS DISTINCT FROM $1`,
            [novaPrevisao, nfeNormalizada]
        ).then(result => {
            if (result.rowCount > 0) {
                atualizados++;
            } else {
                // Se não atualizou, pode ser que não encontrou ou a data já era a mesma
                return poolInova.query('SELECT 1 FROM pedidos_em_rastreamento WHERE transportadora = $1 AND numero_nfe = $2', ['DOMINALOG', nfeNormalizada])
                    .then(findResult => {
                        if (findResult.rowCount > 0) {
                            semAlteracao++;
                        } else {
                            naoEncontrados++;
                        }
                    });
            }
        });
        promises.push(promise);
    });

    await Promise.all(promises);
    return { atualizados, naoEncontrados, semAlteracao };
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
    const query = `SELECT DISTINCT CASE WHEN transportadora = 'I. AMORIN TRANSPORTES EIRELI' THEN 'I AMORIN TRANSPORTES EIRELLI' ELSE transportadora END as transportadora_unificada FROM pedidos_em_rastreamento WHERE transportadora IS NOT NULL AND transportadora <> '' ORDER BY transportadora_unificada ASC`;
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
    getDistinctPlataformas,
    atualizarPrevisaoComBoletimDominalog
};