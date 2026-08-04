require('dotenv').config();
const { poolHub, poolProdutos } = require('../hub/config/database');
const { Pool } = require('pg');
const axios = require('axios');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function purgeDeletedAds() {
    console.log('=== Purging Deleted Ads ===');

    try {
        // 1. Delete MLB6528041344 directly
        const targetId = 'MLB6528041344';
        const resInova = await poolInova.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1 RETURNING id_anuncio', [targetId]);
        console.log(`Deleted ${targetId} from Inova (anuncios_ml):`, resInova.rowCount);

        const resHub = await poolProdutos.query('DELETE FROM produtos_anuncios WHERE id_anuncio = $1 RETURNING id_anuncio', [targetId]);
        console.log(`Deleted ${targetId} from Hub (produtos_anuncios):`, resHub.rowCount);

        // 2. Fetch all closed items from anuncios_ml to check if any other item is deleted on ML
        const closedRes = await poolInova.query("SELECT id_anuncio FROM anuncios_ml WHERE status = 'closed'");
        console.log(`Found ${closedRes.rows.length} closed items in Inova DB. Checking ML status...`);

        const tokenRes = await poolHub.query("SELECT access_token FROM hub_ml_contas WHERE nickname = 'Inova Móveis' LIMIT 1");
        if (tokenRes.rows.length > 0) {
            const token = tokenRes.rows[0].access_token;
            for (const row of closedRes.rows) {
                try {
                    const mlRes = await axios.get(`https://api.mercadolibre.com/items/${row.id_anuncio}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const item = mlRes.data;
                    const subStatus = Array.isArray(item.sub_status) ? item.sub_status : [];
                    if (subStatus.includes('deleted')) {
                        console.log(`Found deleted ad: ${row.id_anuncio} (sub_status: ${JSON.stringify(subStatus)}). Purging...`);
                        await poolInova.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1', [row.id_anuncio]);
                        await poolProdutos.query('DELETE FROM produtos_anuncios WHERE id_anuncio = $1', [row.id_anuncio]);
                    }
                } catch (e) {
                    console.warn(`Error checking ${row.id_anuncio}:`, e.message);
                }
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolInova.end();
        await poolProdutos.end();
        await poolHub.end();
        process.exit(0);
    }
}

purgeDeletedAds();
