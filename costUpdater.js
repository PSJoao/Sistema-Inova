const { Pool } = require('pg');

// Configuração do banco de dados
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// "Trava" de segurança para garantir que a atualização não rode duas vezes ao mesmo tempo
let isUpdateRunning = false;

/**
 * Atualiza a tabela 'urls' com os dados mais recentes da tabela 'cached_products',
 * unindo-as pelo SKU.
 */
async function updateUrlCostsAndData() {
    if (isUpdateRunning) {
        console.log('[CostUpdater] A atualização de custos e dados de URLs já está em andamento. Pulando esta execução.');
        return;
    }

    isUpdateRunning = true;
    console.log('[CostUpdater] Iniciando job de atualização da tabela de URLs...');

    const client = await pool.connect();
    try {
        const updateQuery = `
            WITH prioritized_products AS (
                SELECT 
                    sku,
                    nome,
                    preco_custo,
                    peso_bruto,
                    -- Classifica os produtos: 'lucas' tem prioridade 1, 'eliane' tem prioridade 2
                    ROW_NUMBER() OVER(PARTITION BY sku ORDER BY CASE WHEN bling_account = 'lucas' THEN 1 ELSE 2 END) as rn
                FROM 
                    cached_products
                WHERE 
                    sku IS NOT NULL
            )
            UPDATE urls u
            SET 
                description = pp.nome,
                custo = pp.preco_custo,
                peso = pp.peso_bruto
            FROM 
                prioritized_products pp
            WHERE 
                u.sku = pp.sku 
                AND pp.rn = 1 -- Usa apenas a linha com a maior prioridade para cada SKU
                AND (
                    -- Atualiza apenas se os dados forem diferentes ou nulos
                    u.description IS NULL OR 
                    u.custo IS NULL OR 
                    u.peso IS NULL OR 
                    u.description <> pp.nome OR 
                    u.custo <> pp.preco_custo OR 
                    u.peso <> pp.peso_bruto
                );
        `;

        const result = await client.query(updateQuery);
        
        console.log(`[CostUpdater] Atualização concluída. ${result.rowCount} anúncio(s) na tabela 'urls' foram atualizados.`);

    } catch (error) {
        console.error('[CostUpdater] Erro ao executar a atualização de custos e dados de URLs:', error);
    } finally {
        isUpdateRunning = false;
        if (client) client.release();
    }
}

module.exports = {
    updateUrlCostsAndData
};