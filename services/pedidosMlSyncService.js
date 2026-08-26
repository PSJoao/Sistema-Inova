// services/pedidosMlSyncService.js
// Serviço de sincronização e ingestão de pedidos do Mercado Livre (Hub -> pedidos_ml no Inova)
const { Pool } = require('pg');
const axios = require('axios');

const poolMon = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const HUB_API_URL = process.env.HUB_API_URL || `http://localhost:${process.env.PORT || 3000}`;

function getHubAccounts() {
    const accounts = [];
    let i = 1;
    while (process.env[`HUB_CLIENTE_EMAIL_${i}`] && (process.env[`HUB_CLIENTE_SENHA_${i}`] || process.env[`HUB_CLIENTE_PASSWORD_${i}`])) {
        accounts.push({
            email: process.env[`HUB_CLIENTE_EMAIL_${i}`],
            pass: process.env[`HUB_CLIENTE_SENHA_${i}`] || process.env[`HUB_CLIENTE_PASSWORD_${i}`]
        });
        i++;
    }
    if (accounts.length === 0) {
        if (process.env.HUB_CLIENTE_EMAIL_1 && process.env.HUB_CLIENTE_SENHA_1) {
            accounts.push({ email: process.env.HUB_CLIENTE_EMAIL_1, pass: process.env.HUB_CLIENTE_SENHA_1 });
        }
        if (process.env.HUB_CLIENTE_EMAIL_2 && process.env.HUB_CLIENTE_SENHA_2) {
            accounts.push({ email: process.env.HUB_CLIENTE_EMAIL_2, pass: process.env.HUB_CLIENTE_SENHA_2 });
        }
    }
    return accounts;
}

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { poolHub } = require('../hub/config/database');

const HUB_ACCOUNTS = getHubAccounts();
const hubTokenCache = {};

async function getHubToken(account) {
    if (!account || !account.email || !account.pass) return null;
    const now = Date.now();
    const cached = hubTokenCache[account.email];
    if (cached && cached.token && cached.expiresAt > now + 300000) {
        return cached.token;
    }

    try {
        const response = await axios.post(`${HUB_API_URL}/hub/api/login`, {
            email: account.email,
            password: account.pass
        }, { timeout: 4000 });

        if (response.data && response.data.token) {
            hubTokenCache[account.email] = {
                token: response.data.token,
                expiresAt: now + (24 * 60 * 60 * 1000)
            };
            return response.data.token;
        }
    } catch (httpErr) {
        // Fallback direto via banco do Hub e JWT_SECRET se o servidor HTTP estiver offline ou em contexto de script/cron
        try {
            const result = await poolHub.query('SELECT * FROM hub_clientes WHERE email = $1', [account.email]);
            if (result.rows.length > 0) {
                const cliente = result.rows[0];
                const validPass = await bcrypt.compare(account.pass, cliente.senha_hash);
                if (validPass) {
                    const JWT_SECRET = process.env.HUB_JWT_SECRET || 'MDZo3SaYIS0A1vhLHyKszGAAkemOd6DN8SGmai0FxrJ';
                    const token = jwt.sign(
                        { id: cliente.id, email: cliente.email },
                        JWT_SECRET,
                        { expiresIn: '36500d' }
                    );
                    hubTokenCache[account.email] = {
                        token,
                        expiresAt: now + (24 * 60 * 60 * 1000)
                    };
                    return token;
                }
            }
        } catch (dbErr) {
            console.error(`[PedidosML Sync] Erro no fallback de login do Hub para ${account.email}:`, dbErr.message);
        }
    }
    return null;
}

/**
 * Calcula as situações de prazo e operacionais do pedido com base nos dados do ML/Hub
 */
function calcularSituacoes(pedido) {
    const statusPedido = String(pedido.status_pedido || '').toLowerCase().trim();
    const statusEnvio = String(pedido.status_envio || '').toLowerCase().trim();
    const substatusEnvio = String(pedido.substatus_envio || '').toLowerCase().trim();
    const nfeTrim = String(pedido.nfe_numero || '').trim();
    const temNfe = Boolean(nfeTrim !== '' && nfeTrim !== '0' && nfeTrim !== 'null' && nfeTrim !== 'undefined');
    const temEtiqueta = Boolean(pedido.etiqueta_zpl && String(pedido.etiqueta_zpl).trim() !== '');
    const temMed = Boolean(pedido.tem_med);
    const temDev = Boolean(pedido.tem_dev);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const dataLimite = pedido.data_limite_envio ? new Date(pedido.data_limite_envio) : null;
    const dataAgendada = pedido.data_envio_agendado ? new Date(pedido.data_envio_agendado) : null;
    const dataManuf = pedido.manufacturing_ending_date ? new Date(pedido.manufacturing_ending_date) : null;

    // Detecta se o pedido está aguardando disponibilidade de estoque / fabricação
    const isAguardandoEstoque = Boolean(
        substatusEnvio === 'manufacturing' ||
        (dataManuf && dataManuf > now) ||
        (statusEnvio === 'pending' && (dataAgendada || dataManuf))
    );

    // 1. Situação do Prazo de Envio / Coleta
    let situacaoPrazo = 'para_hoje';
    if (statusPedido === 'cancelled') {
        situacaoPrazo = 'cancelado';
    } else if (statusEnvio === 'delivered') {
        situacaoPrazo = 'entregue';
    } else if (statusEnvio === 'shipped' || statusEnvio === 'picked_up') {
        situacaoPrazo = 'despachado';
    } else if (isAguardandoEstoque) {
        situacaoPrazo = 'futuro_agendado';
    } else if (dataLimite) {
        if (dataLimite < now && dataLimite < todayStart) {
            situacaoPrazo = 'atrasado';
        } else if (dataLimite <= todayEnd) {
            situacaoPrazo = 'para_hoje';
        } else {
            situacaoPrazo = 'futuro_agendado';
        }
    } else if (dataAgendada && dataAgendada > todayEnd) {
        situacaoPrazo = 'futuro_agendado';
    }

    // 2. Situação Operacional
    let situacaoOperacional = 'nf_a_gerenciar';
    if (temMed) {
        situacaoOperacional = 'reclamacao';
    } else if (temDev) {
        situacaoOperacional = 'devolucao';
    } else if (statusPedido === 'cancelled') {
        situacaoOperacional = 'cancelado';
    } else if (statusEnvio === 'delivered') {
        situacaoOperacional = 'entregue';
    } else if (statusEnvio === 'shipped' || statusEnvio === 'picked_up') {
        situacaoOperacional = 'a_caminho';
    } else if (isAguardandoEstoque && !temEtiqueta) {
        situacaoOperacional = 'aguardando_disponibilidade';
    } else if (statusEnvio === 'ready_to_ship') {
        if (!temNfe) {
            situacaoOperacional = 'nf_a_gerenciar';
        } else if (!temEtiqueta) {
            situacaoOperacional = 'com_nota_sem_etiqueta';
        } else {
            situacaoOperacional = 'etiquetas_para_imprimir';
        }
    } else {
        if (!temNfe) {
            situacaoOperacional = 'nf_a_gerenciar';
        } else if (!temEtiqueta) {
            situacaoOperacional = 'com_nota_sem_etiqueta';
        } else {
            situacaoOperacional = 'pronto_para_envio';
        }
    }

    let etiquetaStatus = 'sem_etiqueta';
    if (temEtiqueta) {
        etiquetaStatus = 'pronta_para_imprimir';
    } else if (temNfe) {
        etiquetaStatus = 'com_nota_sem_etiqueta';
    }

    return {
        temNfe,
        temEtiqueta,
        situacaoPrazo,
        situacaoOperacional,
        etiquetaStatus
    };
}

/**
 * Sincroniza pedidos do Hub para o banco local do Sistema Inova via API
 * @param {object} options - { diasAtras: 30, limit: 5000, pedidoId: null }
 */
async function sincronizarPedidos(options = {}) {
    const { diasAtras = 60, limit = 10000, pedidoId = null } = options;
    console.log(`[PedidosML Sync] Iniciando sincronização (diasAtras: ${diasAtras}, pedidoId: ${pedidoId || 'TODOS'})...`);

    if (HUB_ACCOUNTS.length === 0) {
        console.warn('[PedidosML Sync] Nenhuma conta do Hub configurada. Abortando.');
        return { success: false, total_processados: 0 };
    }

    const clientMon = await poolMon.connect();
    try {
        let totalProcessados = 0;
        await clientMon.query('BEGIN');

        const hubMercadoLivreService = require('../hub/services/hubMercadoLivreService');

        for (const account of HUB_ACCOUNTS) {
            try {
                const token = await getHubToken(account);
                if (!token) continue;

                let clienteId = null;
                try {
                    const decoded = jwt.decode(token);
                    clienteId = decoded?.id;
                } catch (e) {}

                if (!clienteId) {
                    const clRes = await poolHub.query('SELECT id FROM hub_clientes WHERE email = $1', [account.email]);
                    clienteId = clRes.rows[0]?.id;
                }

                // 1. Dispara todas as rotinas de sincronização sob demanda no Hub/ML
                try {
                    console.log(`[PedidosML Sync] Disparando rotinas sob demanda no Hub para ${account.email}...`);
                    await Promise.allSettled([
                        axios.post(`${HUB_API_URL}/hub/api/pedidos/sincronizar/novos`, {
                            dias: diasAtras || 60
                        }, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            timeout: 90000
                        }),
                        axios.post(`${HUB_API_URL}/hub/api/pedidos/sincronizar/diferentes`, {}, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            timeout: 90000
                        }),
                        axios.post(`${HUB_API_URL}/hub/api/pedidos/sincronizar/existentes`, {
                            dias: diasAtras || 60
                        }, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            timeout: 90000
                        }),
                        axios.post(`${HUB_API_URL}/hub/api/pedidos/sincronizar/devolucoes`, {
                            dias: diasAtras || 60
                        }, {
                            headers: { 'Authorization': `Bearer ${token}` },
                            timeout: 90000
                        })
                    ]);
                } catch (syncErr) {
                    console.warn(`[PedidosML Sync] Aviso HTTP ao disparar rotinas no Hub para ${account.email}, acionando serviço interno:`, syncErr.message);
                    if (clienteId) {
                        try {
                            await hubMercadoLivreService.capturarNovosPedidosCliente(clienteId, { dias: diasAtras || 60 });
                            await hubMercadoLivreService.monitorarPedidosDiferentesCliente(clienteId);
                            await hubMercadoLivreService.monitorarPedidosExistentesCliente(clienteId, { dias: diasAtras || 60 });
                            await hubMercadoLivreService.monitorarDevolucoesCliente(clienteId, { dias: diasAtras || 60 });
                        } catch (intErr) {
                            console.error('[PedidosML Sync] Erro na execução interna do serviço Hub:', intErr.message);
                        }
                    }
                }

                let offset = 0;
                const reqLimit = limit < 1000 ? limit : 1000;
                let continuar = true;

                while (continuar) {
                    let pacotes = [];
                    const dInicio = diasAtras > 0 ? new Date(Date.now() - diasAtras * 86400000).toISOString() : null;

                    try {
                        const params = { limit: reqLimit, offset, raw: 'true', incluir_abertos: 'true' };
                        if (dInicio) params.data_inicio = dInicio;

                        const response = await axios.get(`${HUB_API_URL}/hub/api/pedidos`, {
                            params,
                            headers: { 'Authorization': `Bearer ${token}` },
                            timeout: 60000
                        });
                        pacotes = response.data.dados || [];
                    } catch (httpGetErr) {
                        // Fallback direto via banco de dados do Hub
                        if (clienteId) {
                            let q = `
                                SELECT p.*, c.nickname as nome_loja
                                FROM pedidos_mercado_livre p
                                JOIN hub_ml_contas c ON p.conta_id = c.id
                                WHERE c.cliente_id = $1
                            `;
                            const qParams = [clienteId];
                            if (dInicio) {
                                q += ` AND (
                                    p.date_created >= $2 
                                    OR p.status_envio IS NULL 
                                    OR p.status_envio IN ('ready_to_ship', 'pending', 'handling') 
                                    OR (p.status_pedido = 'paid' AND (p.status_envio IS NULL OR p.status_envio NOT IN ('delivered', 'cancelled')))
                                    OR p.tem_dev = TRUE 
                                    OR p.tem_med = TRUE
                                )`;
                                qParams.push(dInicio);
                            }
                            q += ` ORDER BY p.date_created DESC LIMIT ${reqLimit} OFFSET ${offset}`;
                            const resDb = await poolHub.query(q, qParams);
                            pacotes = resDb.rows || [];
                        }
                    }
                    if (pacotes.length === 0) {
                        continuar = false;
                        break;
                    }

                    for (const p of pacotes) {
                        if (pedidoId && String(p.id_pedido_ml) !== String(pedidoId)) continue;
                        
                        let itens = p.itens_pedido;
                        if (typeof itens === 'string') {
                            try { itens = JSON.parse(itens); } catch (e) { itens = []; }
                        }
                        if (!Array.isArray(itens)) itens = [];

                        let valorTotal = 0;
                        let qtdTotal = 0;
                        const skusList = [];

                        itens.forEach(it => {
                            const q = Number(it.quantidade) || 1;
                            const pr = Number(it.preco_unitario) || 0;
                            valorTotal += (q * pr);
                            qtdTotal += q;
                            if (it.sku) skusList.push(`${it.sku} (x${q})`);
                        });

                        const skuPrincipal = itens.length > 0 ? (itens[0].sku || itens[0].id_item || 'N/A') : 'N/A';
                        const skusResumo = skusList.join(', ');
                        const freteNum = Number(p.frete_envio) || 0;

                        const {
                            temNfe,
                            temEtiqueta,
                            situacaoPrazo,
                            situacaoOperacional,
                            etiquetaStatus
                        } = calcularSituacoes(p);

                        const queryUpsert = `
                            INSERT INTO pedidos_ml (
                                id_pedido_ml, pack_id, id_envio_ml, conta_id, empresa,
                                date_created, data_pedido, status_pedido, status_envio, tipo_envio,
                                data_limite_envio, data_envio_disponivel, data_envio_agendado, data_previsao_entrega,
                                comprador_nickname, comprador_nome, comprador_documento,
                                valor_total, frete_envio, nfe_numero, chave_acesso,
                                tem_nfe, tem_etiqueta, etiqueta_zpl, etiqueta_status,
                                itens_json, sku_principal, skus_resumo, quantidade_total_itens,
                                tem_dev, status_dev, id_envio_dev, status_envio_dev,
                                tem_med, status_med, situacao_prazo, situacao_operacional,
                                substatus_envio, manufacturing_ending_date,
                                status_impressao, justificativa_erro,
                                last_synced_at, updated_at
                            ) VALUES (
                                $1, $2, $3, $4, $5,
                                $6, $7, $8, $9, $10,
                                $11, $12, $13, $14,
                                $15, $16, $17,
                                $18, $19, $20, $21,
                                $22, $23, $24, $25,
                                $26, $27, $28, $29,
                                $30, $31, $32, $33,
                                $34, $35, $36, $37,
                                $38, $39,
                                $40, $41,
                                NOW(), NOW()
                            )
                            ON CONFLICT (id_pedido_ml) DO UPDATE SET
                                pack_id = EXCLUDED.pack_id,
                                id_envio_ml = EXCLUDED.id_envio_ml,
                                conta_id = EXCLUDED.conta_id,
                                empresa = EXCLUDED.empresa,
                                date_created = EXCLUDED.date_created,
                                data_pedido = EXCLUDED.data_pedido,
                                status_pedido = EXCLUDED.status_pedido,
                                status_envio = EXCLUDED.status_envio,
                                tipo_envio = EXCLUDED.tipo_envio,
                                data_limite_envio = EXCLUDED.data_limite_envio,
                                data_envio_disponivel = EXCLUDED.data_envio_disponivel,
                                data_envio_agendado = EXCLUDED.data_envio_agendado,
                                data_previsao_entrega = EXCLUDED.data_previsao_entrega,
                                comprador_nickname = EXCLUDED.comprador_nickname,
                                valor_total = EXCLUDED.valor_total,
                                frete_envio = EXCLUDED.frete_envio,
                                nfe_numero = COALESCE(EXCLUDED.nfe_numero, pedidos_ml.nfe_numero),
                                chave_acesso = COALESCE(EXCLUDED.chave_acesso, pedidos_ml.chave_acesso),
                                tem_nfe = EXCLUDED.tem_nfe,
                                tem_etiqueta = EXCLUDED.tem_etiqueta,
                                etiqueta_zpl = COALESCE(EXCLUDED.etiqueta_zpl, pedidos_ml.etiqueta_zpl),
                                etiqueta_status = EXCLUDED.etiqueta_status,
                                itens_json = EXCLUDED.itens_json,
                                sku_principal = EXCLUDED.sku_principal,
                                skus_resumo = EXCLUDED.skus_resumo,
                                quantidade_total_itens = EXCLUDED.quantidade_total_itens,
                                tem_dev = EXCLUDED.tem_dev,
                                status_dev = EXCLUDED.status_dev,
                                id_envio_dev = EXCLUDED.id_envio_dev,
                                status_envio_dev = EXCLUDED.status_envio_dev,
                                tem_med = EXCLUDED.tem_med,
                                status_med = EXCLUDED.status_med,
                                situacao_prazo = EXCLUDED.situacao_prazo,
                                situacao_operacional = EXCLUDED.situacao_operacional,
                                substatus_envio = COALESCE(EXCLUDED.substatus_envio, pedidos_ml.substatus_envio),
                                manufacturing_ending_date = COALESCE(EXCLUDED.manufacturing_ending_date, pedidos_ml.manufacturing_ending_date),
                                status_impressao = COALESCE(EXCLUDED.status_impressao, pedidos_ml.status_impressao, 'nao_impresso'),
                                justificativa_erro = COALESCE(EXCLUDED.justificativa_erro, pedidos_ml.justificativa_erro),
                                last_synced_at = NOW(),
                                updated_at = NOW();
                        `;

                        const values = [
                            String(p.id_pedido_ml),
                            p.pack_id ? String(p.pack_id) : null,
                            p.id_envio_ml ? String(p.id_envio_ml) : null,
                            p.conta_id ? Number(p.conta_id) : null,
                            p.nome_loja || (p.conta_id === 1 ? 'Lucas' : (p.conta_id === 2 ? 'Eliane' : 'Loja ML')),
                            p.date_created,
                            p.date_created,
                            p.status_pedido,
                            p.status_envio,
                            p.tipo_envio,
                            p.data_limite_envio,
                            p.data_envio_disponivel,
                            p.data_envio_agendado,
                            p.data_previsao_entrega,
                            p.comprador_nickname,
                            p.comprador_nickname,
                            null,
                            valorTotal,
                            freteNum,
                            p.nfe_numero || null,
                            p.chave_acesso || null,
                            temNfe,
                            temEtiqueta,
                            p.etiqueta_zpl ? p.etiqueta_zpl.replace(/\u0000/g, '') : null,
                            etiquetaStatus,
                            JSON.stringify(itens),
                            skuPrincipal,
                            skusResumo,
                            qtdTotal,
                            Boolean(p.tem_dev),
                            p.status_dev || null,
                            p.id_envio_dev ? String(p.id_envio_dev) : null,
                            p.status_envio_dev || null,
                            Boolean(p.tem_med),
                            p.status_med || null,
                            situacaoPrazo,
                            situacaoOperacional,
                            p.substatus_envio || null,
                            p.manufacturing_ending_date || null,
                            p.status_impressao || null,
                            p.justificativa_erro || null
                        ];

                        await clientMon.query(queryUpsert, values);
                        totalProcessados++;
                    }

                    offset += reqLimit;
                    if (pacotes.length < reqLimit || (limit && totalProcessados >= limit)) {
                        continuar = false;
                    }
                }
            } catch (err) {
                console.error(`[PedidosML Sync] Erro na conta ${account.email}:`, err.message);
            }
        }

        await clientMon.query('COMMIT');
        console.log(`[PedidosML Sync] Sincronização concluída com sucesso! Total: ${totalProcessados} pedidos.`);

        return {
            success: true,
            total_processados: totalProcessados
        };

    } catch (error) {
        await clientMon.query('ROLLBACK');
        console.error('[PedidosML Sync] Erro na sincronização:', error);
        throw error;
    } finally {
        clientMon.release();
    }
}

/**
 * Recalcula situações de prazo em tempo real para pedidos abertos
 */
async function recalcularSituacoesAbertos() {
    try {
        const query = `
            SELECT id, id_pedido_ml, status_pedido, status_envio, data_limite_envio, data_envio_agendado,
                   nfe_numero, etiqueta_zpl, tem_med, tem_dev
            FROM pedidos_ml
            WHERE status_pedido != 'cancelled' AND status_envio NOT IN ('delivered', 'cancelled')
        `;
        const res = await poolMon.query(query);
        for (const p of res.rows) {
            const { situacaoPrazo, situacaoOperacional, etiquetaStatus } = calcularSituacoes(p);
            await poolMon.query(`
                UPDATE pedidos_ml 
                SET situacao_prazo = $1, situacao_operacional = $2, etiqueta_status = $3, updated_at = NOW()
                WHERE id = $4
            `, [situacaoPrazo, situacaoOperacional, etiquetaStatus, p.id]);
        }
        console.log(`[PedidosML Sync] Situações recalculadas para ${res.rows.length} pedidos abertos.`);
    } catch (e) {
        console.error('[PedidosML Sync] Erro ao recalcular situações:', e);
    }
}

module.exports = {
    sincronizarPedidos,
    recalcularSituacoesAbertos,
    calcularSituacoes,
    getHubToken,
    getHubAccounts,
    HUB_ACCOUNTS,
    HUB_API_URL
};
