require('dotenv').config();
const { poolHub, poolProdutos } = require('../hub/config/database');
const { Pool } = require('pg');
const hubProdutosService = require('../hub/services/hubProdutosService');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function testSyncDeleted() {
    const idAnuncio = 'MLB6528041344';
    console.log(`=== Testing sync of deleted item ${idAnuncio} ===`);

    try {
        // 1. Purge
        await poolInova.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        await poolProdutos.query('DELETE FROM produtos_anuncios WHERE id_anuncio = $1', [idAnuncio]);
        console.log(`Purged ${idAnuncio} from DBs`);

        // 2. Fetch token for Inova Móveis
        const tokenRes = await poolHub.query("SELECT nickname, access_token, seller_id FROM hub_ml_contas WHERE nickname = 'Inova Móveis' LIMIT 1");
        const conta = tokenRes.rows[0];

        // 3. Process item
        const itemData = {
            id: idAnuncio,
            title: 'Test Deleted Item',
            status: 'closed',
            sub_status: ['deleted']
        };

        console.log(`Processing item with sub_status ['deleted']...`);
        const result = await hubProdutosService.processarItemCompleto(itemData, conta, conta.access_token);
        console.log('Result from processarItemCompleto:', result);

        // 4. Verify in DBs
        const inovaCheck = await poolInova.query('SELECT id_anuncio FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        const hubCheck = await poolProdutos.query('SELECT id_anuncio FROM produtos_anuncios WHERE id_anuncio = $1', [idAnuncio]);

        console.log('Exists in Inova DB?', inovaCheck.rows.length > 0);
        console.log('Exists in Hub DB?', hubCheck.rows.length > 0);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolInova.end();
        await poolProdutos.end();
        await poolHub.end();
        process.exit(0);
    }
}

testSyncDeleted();
