// Em services/blingWebhookService.js
const { poolMonitora } = require('../config/db');
const { processStockEvent, resolveAccountName } = require('./stockHistoryService');

const processWebhook = async (payload) => {
    // Payload padronizado do Bling v3:
    // { eventId: "uuid", date: "ISO8601", version: "v1", event: "resource.action", companyId: "hash", data: { ... } }
    const { event, data, companyId } = payload;

    if (!event) {
        console.warn('[Webhook] Recebido payload sem o campo "event":', payload);
        return;
    }

    if (!data) {
        console.warn(`[Webhook] Recebido evento "${event}" sem o campo "data".`);
        return;
    }

    try {
        // Separa o recurso da ação (ex: "stock.created" -> resource="stock", action="created")
        const [resource, action] = event.split('.');

        // === HANDLER: Estoque (stock e virtual_stock) ===
        if (resource === 'stock' || resource === 'virtual_stock') {
            await processStockEvent(payload);
            return;
        }

        // === HANDLER: Nota Fiscal (nfe / notafiscal) ===
        if (resource === 'nfe' || resource === 'notafiscal') {
            if (!data.id) return;

            const blingAccount = resolveAccountName(companyId) || companyId;

            if (action !== 'created') {
                return;
            }

            if (data.situacao !== 1) {
                console.log(`[Webhook NFe] Ignorando NFe ${data.id} pois situação não é pendente (${data.situacao})`);
                return;
            }

            console.log(`[Webhook NFe] Salvando NFe Pendente: ${data.numero} (ID: ${data.id})`);
            await insertNfePendente(data, blingAccount);
            return;
        }

        console.log(`[Webhook] Recurso "${resource}" (evento "${event}") não possui handler específico. Ignorado.`);

    } catch (err) {
        console.error(`[Webhook] Erro ao processar evento "${event}":`, err.message);
    }
};

async function insertNfePendente(nfeData, blingAccount) {
    const query = `
        INSERT INTO cached_nfe_pendentes
        (bling_id, bling_account, nfe_numero, situacao, data_emissao, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (bling_id) DO UPDATE SET
            nfe_numero = EXCLUDED.nfe_numero,
            situacao = EXCLUDED.situacao,
            data_emissao = EXCLUDED.data_emissao,
            created_at = NOW()
    `;

    const values = [
        nfeData.id,            // bling_id
        blingAccount,          // bling_account
        nfeData.numero,        // nfe_numero
        nfeData.situacao,      // situacao
        nfeData.dataEmissao    // data_emissao
    ];

    await poolMonitora.query(query, values);
}

module.exports = {
    processWebhook
};