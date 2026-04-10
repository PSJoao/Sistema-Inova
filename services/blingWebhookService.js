// Em services/blingWebhookService.js
const { poolMonitora } = require('../config/db'); // Ajuste para sua conexão correta (pool ou poolMonitora)

const processWebhook = async (payload) => {
    // O payload vem com: { event: "nfe.created", data: { ... }, companyId: "..." }
    const { event, data, companyId } = payload;

    // Se não tiver dados ou ID, descarta
    if (!data || !data.id) {
        return;
    }

    const blingAccount = companyId; // Usamos o ID da empresa como identificador da conta

    try {
        // Separa o recurso da ação (ex: "nfe.created" -> resource="nfe", action="created")
        const [resource, action] = event.split('.');

        // FILTRO 1: Queremos APENAS Nota Fiscal (nfe)
        if (resource !== 'nfe' && resource !== 'notafiscal') {
            return; 
        }

        // FILTRO 2: Queremos APENAS Criação (created)
        // Ignoramos 'updated' ou 'deleted'
        if (action !== 'created') {
            return;
        }

        // FILTRO 3: Queremos APENAS Pendentes?
        // No Bling, Situação 1 geralmente é "Pendente". 
        // Se você quiser salvar TODAS as criadas independente da situação, remova o if abaixo.
        // O user pediu: "quero armazenar só as que estão pendentes"
        if (data.situacao !== 1) {
            console.log(`[Webhook NFe] Ignorando NFe ${data.id} pois situação não é pendente (${data.situacao})`);
            return;
        }

        console.log(`[Webhook NFe] Salvando NFe Pendente: ${data.numero} (ID: ${data.id})`);
        
        // Se passou por todos os filtros, salvamos na tabela auxiliar
        await insertNfePendente(data, blingAccount);

    } catch (err) {
        console.error(`[Webhook NFe] Erro ao processar evento ${event}:`, err.message);
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