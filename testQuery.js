require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function run() {
  const client = await pool.connect();
  try {
    console.time("PreQueryTime");
    const searchValue = 'e';
    let extraSkusClause = '';
    const queryParams = [];
    let paramIndex = 1;
            
    const prodRes = await client.query(`
        SELECT sku 
        FROM cached_products 
        WHERE tipo_ml ILIKE $1 OR (tipo_ml || '-' || sku) ILIKE $1
        LIMIT 50
    `, [`%${searchValue}%`]);

    if (prodRes.rows.length > 0) {
        const skuMatches = [];
        for (const r of prodRes.rows) {
            skuMatches.push(`m.skus::text ILIKE $${paramIndex}`);
            queryParams.push(`%${r.sku}%`);
            paramIndex++;
        }
        extraSkusClause = ` OR ${skuMatches.join(' OR ')}`;
    }

    const whereClause = `(
        m.nfe_numero ILIKE $${paramIndex} OR 
        COALESCE(m.pack_id, m.numero_loja) ILIKE $${paramIndex} OR
        m.skus::text ILIKE $${paramIndex}
        ${extraSkusClause}
    )`;
    queryParams.push(`%${searchValue}%`);
    paramIndex++;
    console.timeEnd("PreQueryTime");

    console.time("MainQueryTime");
    const res2 = await client.query(`
      SELECT m.id FROM cached_etiquetas_ml m
      WHERE ${whereClause}
    `, queryParams);
    console.timeEnd("MainQueryTime");
    
    console.log("Found:", res2.rows.length);

  } catch (err) {
    console.error("Query Error:", err);
  } finally {
    client.release();
    pool.end();
  }
}
run();
