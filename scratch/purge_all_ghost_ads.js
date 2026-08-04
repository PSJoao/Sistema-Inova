require('dotenv').config();
const { Pool } = require('pg');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function purgeGhostAds() {
    console.log('=== Executing Direct Purge of Ghost Ads ===');
    try {
        await poolInova.query('ALTER TABLE anuncios_ml ADD COLUMN IF NOT EXISTS sub_status TEXT;');
        
        const idAnuncio = 'MLB6528041344';
        const res = await poolInova.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        console.log(`Successfully purged ${idAnuncio} from local database! Deleted rows:`, res.rowCount);

        const purgeSubStatus = await poolInova.query("DELETE FROM anuncios_ml WHERE sub_status ILIKE '%deleted%' OR (status = 'closed' AND sub_status ILIKE '%deleted%')");
        console.log(`Purged by sub_status:`, purgeSubStatus.rowCount);
    } catch (err) {
        console.error('Error during purge:', err.message);
    } finally {
        await poolInova.end();
        process.exit(0);
    }
}

purgeGhostAds();
