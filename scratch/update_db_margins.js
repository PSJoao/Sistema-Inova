require('dotenv').config();
const { Pool } = require('pg');
const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const { calcularMargemLucro } = require('../controllers/anunciosController'); // wait, let's check if recalcularMargensDB is exported or we can run the query

async function updateDBMargins() {
    console.log('Atualizando margens no banco anuncios_ml...');
    const res = await poolInova.query(`
        SELECT id_anuncio, preco, preco_promocional, tarifa, imposto, custo_produto, frete, promocoes_json
        FROM anuncios_ml
        WHERE custo_produto IS NOT NULL AND custo_produto > 0
    `);

    let count = 0;
    for (const row of res.rows) {
        let promos = [];
        if (row.promocoes_json) {
            try {
                promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
            } catch (e) { promos = []; }
        }
        promos = Array.isArray(promos) ? promos : [];

        const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
        activePromos.sort((a, b) => Number(a.price) - Number(b.price));

        const lowestActivePromo = activePromos[0] || null;

        // Pass lowestActivePromo to calcularMargemLucro logic
        const custo = Number(row.custo_produto) || 0;
        const precoOriginal = Number(row.preco) || 0;
        let venda = 0;
        let meliPct = 0;

        if (lowestActivePromo) {
            venda = Number(lowestActivePromo.price);
            meliPct = lowestActivePromo.meli_percentage != null ? Number(lowestActivePromo.meli_percentage) : 0;
        } else if (row.preco_promocional != null && Number(row.preco_promocional) > 0) {
            venda = Number(row.preco_promocional);
        } else {
            venda = precoOriginal;
        }

        if (venda > 0) {
            const impostoPct = Number(row.imposto) || 0;
            const tarifaBasePct = Number(row.tarifa) || 0;
            const freteVal = Number(row.frete) || 0;

            const reembolsoVal = Number(((meliPct / 100.0) * precoOriginal).toFixed(2));
            const comissaoReais = venda * (tarifaBasePct / 100.0);
            const comissaoEfetiva = comissaoReais - reembolsoVal;
            const impostoReais = venda * (impostoPct / 100.0);

            const despesas = custo + freteVal + comissaoEfetiva + impostoReais;
            const lucro = venda - despesas;
            const margem = (lucro / venda) * 100.0;

            await poolInova.query('UPDATE anuncios_ml SET margem_lucro = $1 WHERE id_anuncio = $2', [margem, row.id_anuncio]);
            count++;
        }
    }
    console.log(`Concluído! ${count} anúncios atualizados.`);
    await poolInova.end();
}

updateDBMargins();
