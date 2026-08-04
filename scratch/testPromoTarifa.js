require('dotenv').config({ path: 'c:/Sistemas/Sistema-Inova/.env' });
const axios = require('axios');
const { poolHub } = require('../hub/config/database');

async function testPromoTarifa() {
    try {
        const resConta = await poolHub.query('SELECT access_token FROM hub_ml_contas WHERE id = 7');
        const accessToken = resConta.rows[0].access_token;
        const idAnuncio = 'MLB4766094135';

        const itemRes = await axios.get(`https://api.mercadolibre.com/items/${idAnuncio}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const item = itemRes.data;

        // Buscar promoções
        const promoRes = await axios.get(`https://api.mercadolibre.com/seller-promotions/items/${idAnuncio}?app_version=v2`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        console.log('Item base price:', item.price, 'original_price:', item.original_price);
        console.log('Promos:', JSON.stringify(promoRes.data, null, 2));

        let precoCampanha = null;
        if (Array.isArray(promoRes.data)) {
            const ativas = promoRes.data.filter(p => p.status === 'started' || p.status === 'active');
            for (const p of ativas) {
                if (p.price && (precoCampanha === null || p.price < precoCampanha)) {
                    precoCampanha = p.price;
                }
            }
        }

        console.log('Preço Campanha Encontrado:', precoCampanha);

        const precoEfetivo = precoCampanha || (item.original_price ? item.price : item.price);
        console.log('Preço Efetivo para cálculo de tarifa:', precoEfetivo);

        const tarifaUrl = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${item.category_id}&price=${precoEfetivo}&logistic_type=${item.shipping?.logistic_type || 'cross_docking'}&shipping_modes=${item.shipping?.mode || 'me2'}&listing_type_id=${item.listing_type_id}`;
        const tarifaRes = await axios.get(tarifaUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

        console.log('Tarifa retornada para preço efetivo:', tarifaRes.data.sale_fee_details?.percentage_fee, '%');

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolHub.end();
        process.exit();
    }
}

testPromoTarifa();
