require('dotenv').config();
const { poolHub, poolProdutos } = require('../hub/config/database');
const { Pool } = require('pg');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function inspectDeletedItem() {
    const idAnuncio = 'MLB6528041344';
    console.log(`=== Inspecting ${idAnuncio} ===`);

    try {
        const inovaRes = await poolInova.query('SELECT id_anuncio, sku, status, last_updated_at FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        console.log('Inova anuncios_ml:', inovaRes.rows);

        const hubRes = await poolProdutos.query('SELECT id_anuncio, sku, status FROM produtos_anuncios WHERE id_anuncio = $1', [idAnuncio]);
        console.log('Hub produtos_anuncios:', hubRes.rows);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolInova.end();
        await poolProdutos.end();
        await poolHub.end();
        process.exit(0);
    }
}

inspectDeletedItem();
