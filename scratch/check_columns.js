require('dotenv').config();
const { Pool } = require('pg');

const poolProdutos = new Pool({
    user: process.env.DB_PROD_USER || process.env.DB_USER,
    host: process.env.DB_PROD_HOST || process.env.DB_HOST,
    database: process.env.DB_PROD_DATABASE || process.env.DB_NAME,
    password: process.env.DB_PROD_PASSWORD || process.env.DB_PASSWORD,
    port: process.env.DB_PROD_PORT || process.env.DB_PORT,
});

async function inspectColumns() {
    try {
        const res = await poolProdutos.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'produtos_anuncios'
            ORDER BY ordinal_position;
        `);
        console.log('Columns in produtos_anuncios:', res.rows.map(r => r.column_name));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolProdutos.end();
        process.exit(0);
    }
}

inspectColumns();
