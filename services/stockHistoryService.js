// services/stockHistoryService.js
const { poolMonitora } = require('../config/db');

/**
 * Mapeamento de companyId (hash do Bling) para o nome da conta no sistema.
 * Esses hashes vêm do campo 'companyId' do payload de webhook do Bling API v3.
 */
const COMPANY_ID_MAP = {
    'c8358837e9a2cb9849d8a5faba9f4d60': 'lucas',
    '1b7a711bf3f3d4b2f1a24b1ce90d2c77': 'eliane'
};

/**
 * Resolve o companyId do Bling para o nome da conta no sistema ('lucas' ou 'eliane').
 * @param {string} companyId - Hash do companyId vindo do webhook do Bling.
 * @returns {string|null} Nome da conta ou null se desconhecido.
 */
function resolveAccountName(companyId) {
    if (!companyId) return null;
    const cleanId = String(companyId).trim().toLowerCase();
    return COMPANY_ID_MAP[cleanId] || null;
}

/**
 * Processa um evento de estoque recebido via webhook do Bling e insere na tabela stock_movement_history.
 * Garante idempotência através do event_id (UNIQUE constraint).
 * Para eventos 'stock.deleted', calcula automaticamente a quantidade e operação de estorno
 * comparando o saldo atual com o saldo imediatamente anterior.
 * 
 * @param {object} payload - Payload completo do webhook do Bling.
 */
async function processStockEvent(payload) {
    const { date, event, companyId, data } = payload;

    // Gera fallback de eventId se o Bling não enviou
    const eventId = payload.eventId || `evt_${companyId || 'anon'}_${data?.produto?.id || 'noprod'}_${Date.now()}`;
    const eventDate = date || new Date().toISOString();

    // Resolve o nome da conta a partir do companyId
    const accountName = resolveAccountName(companyId);
    if (!accountName) {
        console.warn(`[StockHistory] ATENÇÃO: companyId não mapeado: "${companyId}". Evento "${event}" não pôde ser atribuído a Lucas ou Eliane. Ignorado.`);
        return;
    }

    // Validação do produto no payload de estoque
    const productId = data?.produto?.id || data?.id;
    if (!productId) {
        console.warn(`[StockHistory] Payload de estoque sem ID de produto. Evento "${event}" (${eventId}) ignorado:`, data);
        return;
    }

    // Extração segura de depósito (objeto único 'deposito' ou array 'depositos')
    const depositoObj = data.deposito || (Array.isArray(data.depositos) && data.depositos.length > 0 ? data.depositos[0] : null);
    const depositId = depositoObj?.id || null;
    const saldoFisicoDeposito = depositoObj?.saldoFisico ?? null;
    const saldoVirtualDeposito = depositoObj?.saldoVirtual ?? null;

    let operation = data.operacao || (event.startsWith('virtual_stock') ? 'V' : null);
    let quantity = data.quantidade || 0;           // Quantidade movimentada
    const saldoFisicoTotal = data.saldoFisicoTotal ?? null;
    const saldoVirtualTotal = data.saldoVirtualTotal ?? null;

    // === TRATAMENTO INTELIGENTE DE CANCELAMENTOS / ESTORNOS (stock.deleted) ===
    // Quando um lançamento é excluído no Bling, ele envia event='stock.deleted' com quantidade=0,
    // mas envia o novo saldo_fisico_total. Calculamos a diferença em relação ao saldo anterior
    // para descobrir a quantidade exata estornada!
    if (event === 'stock.deleted' && quantity === 0 && saldoFisicoTotal !== null) {
        try {
            const prevResult = await poolMonitora.query(
                `SELECT saldo_fisico_total FROM stock_movement_history 
                 WHERE bling_product_id = $1 AND bling_account = $2 AND saldo_fisico_total IS NOT NULL
                 ORDER BY event_date DESC, id DESC LIMIT 1`,
                [productId, accountName]
            );

            if (prevResult.rows.length > 0) {
                const prevSaldo = parseFloat(prevResult.rows[0].saldo_fisico_total);
                const currSaldo = parseFloat(saldoFisicoTotal);
                const diff = currSaldo - prevSaldo;

                if (diff > 0) {
                    // O saldo SUBIU => A exclusão cancelou uma Saída ('S'), atuando como Entrada ('E') de estorno
                    operation = 'E';
                    quantity = Math.abs(diff);
                } else if (diff < 0) {
                    // O saldo CAIU => A exclusão cancelou uma Entrada ('E'), atuando como Saída ('S') de estorno
                    operation = 'S';
                    quantity = Math.abs(diff);
                }
            }
        } catch (errCalc) {
            console.warn(`[StockHistory] Aviso: Não foi possível calcular estorno automático para stock.deleted (${eventId}):`, errCalc.message);
        }
    }

    try {
        const query = `
            INSERT INTO stock_movement_history 
            (event_id, bling_product_id, bling_account, operation, quantity, 
             deposit_id, saldo_fisico_deposito, saldo_virtual_deposito,
             saldo_fisico_total, saldo_virtual_total, event_type, event_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (event_id) DO NOTHING
        `;

        const values = [
            eventId,                // $1
            productId,              // $2
            accountName,            // $3
            operation,              // $4
            quantity,               // $5
            depositId,              // $6
            saldoFisicoDeposito,    // $7
            saldoVirtualDeposito,   // $8
            saldoFisicoTotal,       // $9
            saldoVirtualTotal,      // $10
            event,                  // $11 (ex: 'stock.created', 'stock.deleted', 'virtual_stock.updated')
            eventDate               // $12
        ];

        const result = await poolMonitora.query(query, values);

        if (result.rowCount > 0) {
            const opLabel = operation === 'E' ? 'Entrada/Estorno' : operation === 'S' ? 'Saída' : operation === 'V' ? 'Estoque Virtual' : 'Atualização de Saldo';
            console.log(`[StockHistory] SUCESSO: Movimentação salva | Evento: ${event} | Produto: ${productId} | ${opLabel} (${quantity} un) | Conta: ${accountName}`);
        } else {
            console.log(`[StockHistory] Evento duplicado já processado anteriormente: ${eventId}`);
        }

    } catch (err) {
        console.error(`[StockHistory] ERRO ao inserir no banco (evento ${eventId}):`, err.message);
    }
}

/**
 * Consulta o histórico de movimentações de estoque com filtros.
 */
async function getStockHistory(filters = {}) {
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    if (filters.blingProductId) {
        conditions.push(`smh.bling_product_id = $${paramIndex++}`);
        values.push(filters.blingProductId);
    }

    if (filters.sku) {
        conditions.push(`cp.sku ILIKE $${paramIndex++}`);
        values.push(`%${filters.sku}%`);
    }

    if (filters.account) {
        conditions.push(`smh.bling_account = $${paramIndex++}`);
        values.push(filters.account);
    }

    if (filters.operation) {
        conditions.push(`smh.operation = $${paramIndex++}`);
        values.push(filters.operation);
    }

    if (filters.startDate) {
        conditions.push(`smh.event_date >= $${paramIndex++}`);
        values.push(filters.startDate);
    }

    if (filters.endDate) {
        conditions.push(`smh.event_date <= $${paramIndex++}`);
        values.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const query = `
        SELECT 
            smh.id,
            smh.event_id,
            smh.bling_product_id,
            smh.bling_account,
            smh.operation,
            smh.quantity,
            smh.deposit_id,
            smh.saldo_fisico_deposito,
            smh.saldo_virtual_deposito,
            smh.saldo_fisico_total,
            smh.saldo_virtual_total,
            smh.event_type,
            smh.event_date,
            smh.received_at,
            cp.sku AS product_sku,
            cp.nome AS product_name
        FROM stock_movement_history smh
        LEFT JOIN cached_products cp 
            ON smh.bling_product_id = cp.bling_id 
            AND smh.bling_account = cp.bling_account
        ${whereClause}
        ORDER BY smh.event_date DESC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    values.push(limit, offset);

    const countQuery = `
        SELECT COUNT(*) as total
        FROM stock_movement_history smh
        LEFT JOIN cached_products cp 
            ON smh.bling_product_id = cp.bling_id 
            AND smh.bling_account = cp.bling_account
        ${whereClause}
    `;
    const countValues = values.slice(0, values.length - 2);

    const [dataResult, countResult] = await Promise.all([
        poolMonitora.query(query, values),
        poolMonitora.query(countQuery, countValues)
    ]);

    return {
        rows: dataResult.rows,
        total: parseInt(countResult.rows[0].total, 10)
    };
}

/**
 * Obtém um resumo de entradas e saídas por produto em um período (ex: 3, 7, 15, 30 dias).
 * Calcula automaticamente as Vendas Líquidas (Saídas 'S' menos Entradas/Estornos 'E').
 */
async function getStockSummary(filters = {}) {
    const conditions = [];
    const values = [];
    let paramIndex = 1;

    conditions.push(`smh.operation IS NOT NULL`);

    if (filters.account) {
        conditions.push(`smh.bling_account = $${paramIndex++}`);
        values.push(filters.account);
    }

    if (filters.startDate) {
        conditions.push(`smh.event_date >= $${paramIndex++}`);
        values.push(filters.startDate);
    }

    if (filters.endDate) {
        conditions.push(`smh.event_date <= $${paramIndex++}`);
        values.push(filters.endDate);
    }

    if (filters.days) {
        conditions.push(`smh.event_date >= NOW() - INTERVAL '${parseInt(filters.days, 10)} days'`);
    }

    if (filters.blingProductId) {
        conditions.push(`smh.bling_product_id = $${paramIndex++}`);
        values.push(filters.blingProductId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
        SELECT 
            smh.bling_product_id,
            smh.bling_account,
            cp.sku AS product_sku,
            cp.nome AS product_name,
            SUM(CASE WHEN smh.operation = 'S' THEN smh.quantity ELSE 0 END) AS total_saidas,
            SUM(CASE WHEN smh.operation = 'E' THEN smh.quantity ELSE 0 END) AS total_entradas_ou_estornos,
            SUM(CASE WHEN smh.operation = 'S' THEN smh.quantity ELSE 0 END) - 
            SUM(CASE WHEN smh.operation = 'E' AND smh.event_type = 'stock.deleted' THEN smh.quantity ELSE 0 END) AS vendas_liquidas,
            COUNT(CASE WHEN smh.operation = 'S' THEN 1 END) AS qtd_movimentacoes_saida,
            MIN(smh.event_date) AS primeira_movimentacao,
            MAX(smh.event_date) AS ultima_movimentacao
        FROM stock_movement_history smh
        LEFT JOIN cached_products cp 
            ON smh.bling_product_id = cp.bling_id 
            AND smh.bling_account = cp.bling_account
        ${whereClause}
        GROUP BY smh.bling_product_id, smh.bling_account, cp.sku, cp.nome
        ORDER BY vendas_liquidas DESC
    `;

    const result = await poolMonitora.query(query, values);
    return result.rows;
}

module.exports = {
    resolveAccountName,
    processStockEvent,
    getStockHistory,
    getStockSummary
};
