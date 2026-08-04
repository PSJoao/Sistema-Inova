require('dotenv').config();
const { poolProdutos, poolHub } = require('../hub/config/database');
const { Pool } = require('pg');

const poolInova = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function cleanSubStatus() {
    console.log('=== Cleaning Sub Status Brackets in DBs ===');
    try {
        const resHub = await poolProdutos.query(`
            UPDATE produtos_anuncios 
            SET sub_status = REPLACE(REPLACE(REPLACE(sub_status, '["', ''), '"]', ''), '"', '')
            WHERE sub_status LIKE '[%' OR sub_status LIKE '%"%';
        `);
        console.log('Cleaned in Hub (produtos_anuncios):', resHub.rowCount);

        const resInova = await poolInova.query(`
            UPDATE anuncios_ml 
            SET sub_status = REPLACE(REPLACE(REPLACE(sub_status, '["', ''), '"]', ''), '"', '')
            WHERE sub_status LIKE '[%' OR sub_status LIKE '%"%';
        `);
        console.log('Cleaned in Inova (anuncios_ml):', resInova.rowCount);
    } catch (err) {
        console.error('Error during cleanup:', err.message);
    } finally {
        await poolInova.end();
        await poolProdutos.end();
        await poolHub.end();
        process.exit(0);
    }
}

cleanSubStatus();
