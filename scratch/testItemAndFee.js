require('dotenv').config({ path: 'c:/Sistemas/Sistema-Inova/.env' });
const axios = require('axios');
const { poolHub, poolProdutos } = require('../hub/config/database');

async function testItemAndFee() {
    try {
        const resConta = await poolHub.query('SELECT access_token FROM hub_ml_contas WHERE id = 7');
        const accessToken = resConta.rows[0].access_token;
        const idAnuncio = 'MLB4766094135';

        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${idAnuncio}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const item = itemRes.data;
        console.log('=== ITEM DO MERCADO LIVRE ===');
        console.log('id:', item.id);
        console.log('category_id:', item.category_id);
        console.log('price:', item.price);
        console.log('listing_type_id:', item.listing_type_id);

        // Check Hub DB
        const hubRes = await poolProdutos.query('SELECT tipo, tarifa, preco FROM produtos_anuncios WHERE id_anuncio = $1', [idAnuncio]);
        console.log('\n=== BANCO DO HUB (produtos_anuncios) ===');
        console.log(hubRes.rows[0]);

        // Check Inova DB
        const inovaRes = await poolHub.query('SELECT tipo_anuncio, tarifa, preco FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
        console.log('\n=== BANCO DO INOVA (anuncios_ml) ===');
        console.log(inovaRes.rows[0]);

        // Test listing_prices for gold_special vs gold_pro
        const urlGoldSpecial = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${item.category_id}&price=${item.price}&listing_type_id=gold_special`;
        const resGoldSpecial = await axios.get(urlGoldSpecial, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        console.log('\n=== TARIFA CLÁSSICO (gold_special) ===');
        console.log(resGoldSpecial.data.sale_fee_details);

        const urlGoldPro = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${item.category_id}&price=${item.price}&listing_type_id=gold_pro`;
        const resGoldPro = await axios.get(urlGoldPro, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        console.log('\n=== TARIFA PREMIUM (gold_pro) ===');
        console.log(resGoldPro.data.sale_fee_details);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolHub.end();
        await poolProdutos.end();
        process.exit();
    }
}

testItemAndFee();
