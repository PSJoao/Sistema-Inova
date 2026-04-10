const { Pool } = require('pg');
const axios = require('axios');
const tokenManager = require('./meliTokenManager');

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
 * Wrapper de API com retentativa, inspirado no seu do Bling.
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
            
            // Erro de Rate Limit
            if (status === 429) {
                await delay(5000); // Espera mais longa para rate limit
                return meliApiGet(resource, accessToken, retries - 1);
            }
            // Outros erros de servidor ou 401 (token pode ter expirado entre a checagem e o uso)
            if (status === 401 || status >= 500) {
                await delay(API_DELAY_MS);
                
                // Se for 401, força a busca por um novo token na próxima tentativa
                // (O tokenManager já faz isso, mas garantimos)
                const { accessToken: newAccessToken } = await tokenManager.getValidAccessToken('DEFAULT_ACCOUNT');
                return meliApiGet(resource, newAccessToken, retries - 1);
            }
        }
        // Se esgotar as tentativas
        console.error(`[MELI Sync] Falha ao buscar ${url} após ${MAX_RETRIES} tentativas. Erro: ${error.message}`);
        throw error;
    }
}

// --- Lógica de Banco ---

/**
 * Verifica se o pedido MELI já existe no nosso cache.
 * Usamos 'bling_id' para o ID do MELI e 'bling_account' para a origem.
 */
async function checkOrderExists(meliOrderId) {
    const client = await pool.connect();
    try {
        const query = `
            SELECT 1 FROM cached_pedido_venda 
            WHERE bling_id = $1 AND bling_account = 'MELI_DIRECT'
        `;
        const res = await client.query(query, [meliOrderId]);
        return res.rowCount > 0;
    } finally {
        client.release();
    }
}

/**
 * Mapeia o objeto de pedido do MELI para a sua tabela 'cached_pedido_venda'.
 * * ATENÇÃO: Sua tabela 'cached_pedido_venda' foi feita para o Bling.
 * Estamos adaptando os campos do MELI para ela, conforme sua solicitação.
 * Muitos campos ficarão nulos (NULL).
 */
function mapMeliToDb(order) {
    const buyer = order.buyer || {};
    const shipping = order.shipping || {};
    const payments = (order.payments && order.payments.length > 0) ? order.payments[0] : {};
    const items = order.order_items || [];

    // Calcula taxas e custos
    const totalFee = items.reduce((acc, item) => acc + (parseFloat(item.sale_fee) || 0), 0);
    const shippingCost = parseFloat(shipping.cost) || 0;
    
    // MELI não informa o CNPJ do intermediador no pedido, 
    // mas sabemos que é o MELI. Use o CNPJ principal se precisar.
    const MELI_CNPJ = '03.361.252/0001-34'; 

    const data = {
        // Assumindo que 'bling_id' será usado para o 'meli_order_id'
        bling_id: order.id, 
        // Identificador para sabermos que veio direto do MELI
        bling_account: 'MELI_DIRECT', 
        numero: null, // MELI não tem "número" interno, só o ID
        numero_loja: order.id.toString(), // ID do Pedido MELI
        data_pedido: new Date(order.date_created),
        data_saida: shipping.date_first_printed ? new Date(shipping.date_first_printed) : null,
        total_produtos: parseFloat(order.total_amount) - shippingCost,
        total_pedido: parseFloat(order.total_amount),
        contato_id: buyer.id,
        contato_nome: `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim(),
        contato_tipo_pessoa: buyer.billing_info?.doc_type === 'CNPJ' ? 'J' : 'F',
        contato_documento: buyer.billing_info?.doc_number || null,
        situacao_id: null, // Você teria que mapear os status do MELI (ex: 'paid') para seus IDs internos
        situacao_valor: null, // Ver situacao_id
        loja_id: null, // Não aplicável?
        desconto_valor: 0, // MELI aplica descontos de outra forma
        notafiscal_id: null, // Será preenchido por outro processo
        parcela_data_vencimento: payments.date_created ? new Date(payments.date_created) : null, // Simplificação
        parcela_valor: payments.transaction_amount || 0,
        nfe_parent_numero: null,
        transporte_frete: shippingCost,
        intermediador_cnpj: MELI_CNPJ,
        taxa_comissao: totalFee,
        custo_frete: shippingCost, // Pode ser redundante
        valor_base: (parseFloat(order.total_amount) - totalFee - shippingCost),
    };

    return data;
}

/**
 * Salva o pedido mapeado no banco de dados.
 */
async function saveOrderToCache(orderData) {
    const client = await pool.connect();
    
    // Mapeia o objeto para os campos da tabela
    const data = mapMeliToDb(orderData);

    const query = `
        INSERT INTO cached_pedido_venda (
            id, bling_id, bling_account, numero, numero_loja, data_pedido, data_saida,
            total_produtos, total_pedido, contato_id, contato_nome, contato_tipo_pessoa,
            contato_documento, situacao_id, situacao_valor, loja_id, desconto_valor,
            notafiscal_id, parcela_data_vencimento, parcela_valor, nfe_parent_numero,
            transporte_frete, intermediador_cnpj, taxa_comissao, custo_frete, valor_base
            -- created_at e updated_at têm DEFAULT
        )
        VALUES (
            -- 'id' é NOT NULL, mas não tem DEFAULT na sua definição. 
            -- Se for SERIAL, remova-o daqui. Se não for, você precisa de uma sequence.
            -- Vou assumir que você tem uma sequence ou trigger. Se não, adicione: nextval('cached_pedido_venda_id_seq'::regclass) como primeiro valor
            DEFAULT, 
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        );
    `;
    
    try {
        await client.query(query, [
            data.bling_id, data.bling_account, data.numero, data.numero_loja, data.data_pedido, data.data_saida,
            data.total_produtos, data.total_pedido, data.contato_id, data.contato_nome, data.contato_tipo_pessoa,
            data.contato_documento, data.situacao_id, data.situacao_valor, data.loja_id, data.desconto_valor,
            data.notafiscal_id, data.parcela_data_vencimento, data.parcela_valor, data.nfe_parent_numero,
            data.transporte_frete, data.intermediador_cnpj, data.taxa_comissao, data.custo_frete, data.valor_base
        ]);
        console.log(`[MELI Sync] Pedido ${data.bling_id} salvo no cache com sucesso.`);
    } catch (error) {
        console.error(`[MELI Sync] Erro ao salvar pedido ${data.bling_id} no banco:`, error.message);
    } finally {
        client.release();
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

                // 2. Busca o pedido completo (o search não traz tudo)
                console.log(`[MELI Sync] Buscando detalhes do pedido ${meliOrderId}...`);
                const orderDetails = await meliApiGet(`/orders/${meliOrderId}`, accessToken);

                if (orderDetails) {
                    // 3. Salva no banco
                    await saveOrderToCache(orderDetails);
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