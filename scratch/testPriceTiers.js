require('dotenv').config({ path: 'c:/Sistemas/Sistema-Inova/.env' });
const axios = require('axios');
const { poolHub } = require('../hub/config/database');

async function testPriceTiers() {
    try {
        const resConta = await poolHub.query('SELECT access_token FROM hub_ml_contas WHERE id = 7');
        const accessToken = resConta.rows[0].access_token;
        const categoryId = 'MLB186273';

        const pricesToTest = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];

        console.log('=== TESTANDO TARIFAS POR FAIXA DE PREÇO (gold_pro - Premium) ===\n');

        for (const p of pricesToTest) {
            const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${p}&logistic_type=cross_docking&shipping_modes=me2&listing_type_id=gold_pro`;
            const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            console.log(`Preço R$ ${p} -> Tarifa: ${res.data.sale_fee_details?.percentage_fee}% (Valor R$ ${res.data.sale_fee_details?.gross_amount})`);
        }

        console.log('\n=== TESTANDO TARIFAS POR FAIXA DE PREÇO (gold_special - Clássico) ===\n');

        for (const p of pricesToTest) {
            const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${p}&logistic_type=cross_docking&shipping_modes=me2&listing_type_id=gold_special`;
            const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
            console.log(`Preço R$ ${p} -> Tarifa: ${res.data.sale_fee_details?.percentage_fee}% (Valor R$ ${res.data.sale_fee_details?.gross_amount})`);
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolHub.end();
        process.exit();
    }
}

testPriceTiers();
