require('dotenv').config();
const { Pool } = require('pg');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function inspectAd() {
    const idAnuncio = 'MLB6857431490';
    console.log(`=== Inspecting ${idAnuncio} ===`);

    try {
        const res = await poolInova.query('SELECT * FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        if (res.rows.length === 0) {
            console.log('Anúncio não encontrado por id_anuncio exato, buscando com ILIKE...');
            const resLike = await poolInova.query('SELECT * FROM anuncios_ml WHERE id_anuncio ILIKE $1', [`%${idAnuncio.replace(/\D/g, '')}%`]);
            console.log('Resultados ILIKE:', resLike.rows);
        } else {
            console.log('Dados em anuncios_ml:');
            console.dir(res.rows[0], { depth: null });
            
            const sku = res.rows[0].sku;
            if (sku) {
                console.log(`\n=== Buscando SKU "${sku}" em produto_custos_impostos ===`);
                const resCusto = await poolInova.query('SELECT * FROM produto_custos_impostos WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))', [sku]);
                console.log('Dados em produto_custos_impostos:', resCusto.rows);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolInova.end();
        process.exit(0);
    }
}

inspectAd();
