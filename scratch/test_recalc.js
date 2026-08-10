require('dotenv').config();
const { Pool } = require('pg');
const { calcularMargemLucro } = require('../controllers/anunciosController'); // wait, let's see if exports contains calcularMargemLucro or we test directly

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function testRecalc() {
    const res = await poolInova.query('SELECT * FROM anuncios_ml WHERE id_anuncio = $1', ['MLB6857431490']);
    const row = res.rows[0];
    
    // Let's check what price_promocional and margin look like
    let promos = [];
    if (row.promocoes_json) {
        promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
    }
    const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
    activePromos.sort((a, b) => Number(a.price) - Number(b.price));

    console.log('Active promos sorted by lowest price:', activePromos);
    console.log('Lowest active promo:', activePromos[0]);

    await poolInova.end();
}

testRecalc();
