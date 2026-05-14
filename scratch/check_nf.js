const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function checkNfe() {
    const client = await pool.connect();
    try {
        const nf = '386114';
        const res = await client.query("SELECT * FROM cached_nfe WHERE nfe_numero = $1", [nf]);
        console.log('Data in cached_nfe:', res.rows[0]);
    } finally {
        client.release();
        await pool.end();
    }
}

checkNfe();
