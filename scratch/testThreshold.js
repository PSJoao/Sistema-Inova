require('dotenv').config({ path: 'c:/Sistemas/Sistema-Inova/.env' });
const axios = require('axios');
const { poolHub } = require('../hub/config/database');

async function testExactThreshold() {
    try {
        const resConta = await poolHub.query('SELECT access_token FROM hub_ml_contas WHERE id = 7');
        const accessToken = resConta.rows[0].access_token;
        const categoryId = 'MLB186273';

        const prices = [600, 649, 650, 680, 698.99, 699, 699.99, 700, 701];

        console.log('=== TESTANDO PONTO EXATO DA MUDANÇA DE TARIFA ===\n');

        for (const p of prices) {
            const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${p}&logistic_type=cross_docking&shipping_modes=me2&listing_type_id=gold_pro`;
            const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            console.log(`Preço R$ ${p} -> Tarifa Premium: ${res.data.sale_fee_details?.percentage_fee}%`);
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolHub.end();
        process.exit();
    }
}

testExactThreshold();
