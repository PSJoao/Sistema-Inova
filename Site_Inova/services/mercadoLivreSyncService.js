const { Pool } = require('pg');
const axios = require('axios');
const tokenManager = require('./meliTokenManager'); // Nosso gerenciador de token

// Configuração do banco de dados (assumindo que está no .env)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const API_DELAY_MS = 500; // Delay entre requisições (para evitar rate limit)
const MAX_RETRIES = 5;
const MELI_API_BASE_URL = 'https://api.mercadolibre.com';

// Flag para evitar corridas concorrentes
let isSyncRunning = false;

// --- Utilitários ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wrapper de API com retentativa.
 */
async function meliApiGet(resource, accessToken, retries = MAX_RETRIES) {
    const url = resource.startsWith('http') ? resource : `${MELI_API_BASE_URL}${resource}`;
    
    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        return response.data;
    
    } catch (error) {
        if (retries > 0) {
            const status = error.response?.status;
            console.warn(`[MELI Sync] Erro ao buscar ${url} (Status: ${status}). Tentando novamente em ${API_DELAY_MS}ms... (${retries} tentativas restantes)`);
            
            if (status === 429) {
                await delay(5000); // Espera mais longa para rate limit
                return meliApiGet(resource, accessToken, retries - 1);
            }
            if (status === 401 || status >= 500) {
                await delay(API_DELAY_MS);
                
                // Se for 401, força a busca por um novo token na próxima tentativa
                const { accessToken: newAccessToken } = await tokenManager.getValidAccessToken('DEFAULT_ACCOUNT');
                return meliApiGet(resource, newAccessToken, retries - 1);
            }
        }
        console.error(`[MELI Sync] Falha ao buscar ${url} após ${MAX_RETRIES} tentativas. Erro: ${error.message}`);
        throw error;
    }
}

// --- Lógica de Banco (NOVAS FUNÇÕES) ---

/**
 * Verifica se o pedido MELI já existe na nova tabela.
 */
async function checkOrderExists(meliOrderId) {
    const client = await pool.connect();
    try {
        const query = 'SELECT 1 FROM cached_pedido_ml WHERE id = $1';
        const res = await client.query(query, [meliOrderId]);
        return res.rowCount > 0;
    } finally {
        client.release();
    }
}

/**
 * Salva o pedido completo em uma transação de banco de dados,
 * distribuindo os dados entre as novas tabelas.
 */
async function saveOrderToCache(orderData, shippingData, billingData) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN'); // Inicia a transação

        // 1. Salva o Pedido Principal (Cabeçalho)
        await insertMainOrder(client, orderData, shippingData, billingData);

        // 2. Salva os Itens do Pedido
        await insertOrderItems(client, orderData.id, orderData.order_items);

        // 3. Salva os Pagamentos do Pedido
        await insertOrderPayments(client, orderData.id, orderData.payments);

        await client.query('COMMIT'); // Finaliza a transação
        console.log(`[MELI Sync] Pedido ${orderData.id} salvo com sucesso nas novas tabelas.`);

    } catch (error) {
        await client.query('ROLLBACK'); // Desfaz tudo em caso de erro
        console.error(`[MELI Sync] Erro ao salvar pedido ${orderData.id} (ROLLBACK):`, error.message);
    } finally {
        client.release();
    }
}

/**
 * Helper: Insere/Atualiza os dados na tabela principal 'cached_pedido_ml'
 */
async function insertMainOrder(client, order, shipping, billing) {
    const buyer = order.buyer || {};
    const ship = shipping || {};
    const addr = ship.receiver_address || {};
    const bill = billing?.billing_info || {};

    // Usamos ON CONFLICT para idempotência (caso o pedido já exista e precise ser atualizado)
    const query = `
        INSERT INTO cached_pedido_ml (
            id, seller_id, status, status_detail, date_created, date_closed, last_updated_api,
            currency_id, total_amount, paid_amount, shipping_cost, pack_id, tags,
            buyer_id, buyer_nickname, buyer_first_name, buyer_last_name, 
            buyer_doc_type, buyer_doc_number, buyer_phone,
            shipping_id, shipping_status, shipping_receiver_name, shipping_receiver_phone,
            shipping_street_name, shipping_street_number, shipping_comment,
            shipping_zip_code, shipping_city, shipping_state, shipping_neighborhood
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
        )
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            status_detail = EXCLUDED.status_detail,
            date_closed = EXCLUDED.date_closed,
            last_updated_api = EXCLUDED.last_updated_api,
            paid_amount = EXCLUDED.paid_amount,
            shipping_cost = EXCLUDED.shipping_cost,
            pack_id = EXCLUDED.pack_id,
            tags = EXCLUDED.tags,
            buyer_doc_type = EXCLUDED.buyer_doc_type,
            buyer_doc_number = EXCLUDED.buyer_doc_number,
            buyer_phone = EXCLUDED.buyer_phone,
            shipping_status = EXCLUDED.shipping_status,
            shipping_receiver_name = EXCLUDED.shipping_receiver_name,
            shipping_receiver_phone = EXCLUDED.shipping_receiver_phone,
            shipping_street_name = EXCLUDED.shipping_street_name,
            shipping_street_number = EXCLUDED.shipping_street_number,
            shipping_comment = EXCLUDED.shipping_comment,
            shipping_zip_code = EXCLUDED.shipping_zip_code,
            shipping_city = EXCLUDED.shipping_city,
            shipping_state = EXCLUDED.shipping_state,
            shipping_neighborhood = EXCLUDED.shipping_neighborhood,
            synced_at = CURRENT_TIMESTAMP;
    `;

    await client.query(query, [
        order.id, // $1
        order.seller.id, // $2
        order.status, // $3
        order.status_detail, // $4
        order.date_created, // $5
        order.date_closed, // $6
        order.last_updated, // $7
        order.currency_id, // $8
        order.total_amount, // $9
        order.paid_amount, // $10
        order.shipping_cost || ship.cost, // $11
        order.pack_id, // $12
        order.tags, // $13
        buyer.id, // $14
        buyer.nickname, // $15
        buyer.first_name, // $16
        buyer.last_name, // $17
        bill.doc_type, // $18
        bill.doc_number, // $19
        buyer.phone?.number, // $20
        ship.id, // $21
        ship.status, // $22
        addr.receiver_name, // $23
        addr.receiver_phone, // $24
        addr.street_name, // $25
        addr.street_number, // $26
        addr.comment, // $27
        addr.zip_code, // $28
        addr.city?.name, // $29
        addr.state?.name, // $30
        addr.neighborhood?.name // $31
    ]);
}

/**
 * Helper: Insere os itens do pedido na tabela 'cached_pedido_ml_itens'
 */
async function insertOrderItems(client, pedidoId, items) {
    if (!items || items.length === 0) return;

    for (const item of items) {
        const query = `
            INSERT INTO cached_pedido_ml_itens (
                pedido_id, item_id, variation_id, titulo, sku,
                quantidade, unit_price, full_unit_price, sale_fee, listing_type_id
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
            )
            ON CONFLICT (pedido_id, item_id, variation_id, sku) DO NOTHING;
        `;
        
        await client.query(query, [
            pedidoId, // $1
            item.item.id, // $2
            item.item.variation_id, // $3
            item.item.title, // $4
            item.seller_sku, // $5 (O SKU correto, não o do item.item)
            item.quantity, // $6
            item.unit_price, // $7
            item.full_unit_price, // $8
            item.sale_fee, // $9
            item.listing_type_id // $10
        ]);
    }
}

/**
 * Helper: Insere os pagamentos do pedido na tabela 'cached_pedido_ml_pagamentos'
 */
async function insertOrderPayments(client, pedidoId, payments) {
    if (!payments || payments.length === 0) return;

    for (const p of payments) {
        const query = `
            INSERT INTO cached_pedido_ml_pagamentos (
                id, pedido_id, status, payment_method_id, payment_type,
                transaction_amount, total_paid_amount, shipping_cost,
                installments, marketplace_fee, date_approved, date_created
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            )
            ON CONFLICT (id) DO NOTHING;
        `;
        
        await client.query(query, [
            p.id, // $1
            pedidoId, // $2
            p.status, // $3
            p.payment_method_id, // $4
            p.payment_type, // $5
            p.transaction_amount, // $6
            p.total_paid_amount, // $7
            p.shipping_cost, // $8
            p.installments, // $9
            p.marketplace_fee, // $10
            p.date_approved, // $11
            p.date_created // $12
        ]);
    }
}


// --- Função Principal de Sincronização ---

async function runSync() {
    if (isSyncRunning) {
        console.log('[MELI Sync] Sincronização já em andamento. Pulando esta execução.');
        return;
    }
    
    console.log('[MELI Sync] Iniciando sincronização de pedidos...');
    isSyncRunning = true;

    try {
        const { accessToken, sellerId } = await tokenManager.getValidAccessToken('DEFAULT_ACCOUNT');
        
        let offset = 0;
        const limit = 50; // Limite padrão da API do MELI
        let total = 0;

        do {
            console.log(`[MELI Sync] Buscando pedidos (Offset: ${offset})...`);
            // Busca pedidos com 'sort=date_desc' para pegar os mais novos primeiro
            const resource = `/orders/search?seller=${sellerId}&sort=date_desc&limit=${limit}&offset=${offset}`;
            
            const response = await meliApiGet(resource, accessToken);
            
            if (!response || !response.results) {
                console.error('[MELI Sync] Resposta inválida da API de search. Abortando.');
                break;
            }
            
            total = response.paging.total;
            const orders = response.results;

            for (const orderSummary of orders) {
                const meliOrderId = orderSummary.id;

                // 1. REQUISITO: VERIFICA IDEMPOTÊNCIA (Se já existe)
                const exists = await checkOrderExists(meliOrderId);
                if (exists) {
                    console.log(`[MELI Sync] Pedido ${meliOrderId} já existe. Parando busca de novos.`);
                    // Como estamos ordenando por data (mais novo primeiro), 
                    // se encontramos um que já existe, podemos parar a sincronização.
                    offset = total; // Força a saída do loop 'do...while'
                    break;
                }

                // 2. Busca os 3 RECURSOS: Pedido, Envio e Dados Fiscais
                console.log(`[MELI Sync] Buscando detalhes do pedido ${meliOrderId}...`);
                
                try {
                    const orderDetails = await meliApiGet(`/orders/${meliOrderId}`, accessToken);
                    
                    // Pega o ID do Envio
                    const shippingId = orderDetails.shipping?.id;
                    let shippingDetails = null;
                    if (shippingId) {
                        shippingDetails = await meliApiGet(`/shipments/${shippingId}`, accessToken);
                    }

                    // Pega os Dados Fiscais
                    const billingInfo = await meliApiGet(`/orders/${meliOrderId}/billing_info`, accessToken);

                    if (orderDetails) {
                        // 3. Salva no banco (agora passando todos os dados)
                        await saveOrderToCache(orderDetails, shippingDetails, billingInfo);
                    }

                } catch (e) {
                     console.error(`[MELI Sync] Erro ao processar pedido ${meliOrderId}: `, e.message);
                     // Continua para o próximo pedido
                }

                // 4. REQUISITO: DELAY (Rate Limit)
                await delay(API_DELAY_MS);
            }

            // Atualiza o offset para a próxima página
            offset += limit;

        } while (offset < total);

        console.log('[MELI Sync] Sincronização concluída.');

    } catch (error) {
        console.error('[MELI Sync] Erro crítico durante a sincronização:', error.message);
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Inicia o loop de sincronização.
 */
function startOrderSync(intervalMs = 300000) { // Ex: 300.000ms = 5 minutos
    console.log(`[MELI Sync] Serviço de sincronização de pedidos iniciado. (Intervalo: ${intervalMs}ms)`);
    // Roda imediatamente na primeira vez
    runSync(); 
    // E então agenda o intervalo
    setInterval(runSync, intervalMs);
}

module.exports = {
    startOrderSync,
    runSync // Para execuções manuais, se necessário
};