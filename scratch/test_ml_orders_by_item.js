require('dotenv').config();
const { poolHub, poolProdutos } = require('../hub/config/database');
const axios = require('axios');

async function testOrdersByItem() {
    console.log('=== Testing ML Orders Search by Item ===');
    try {
        const tokenRes = await poolHub.query("SELECT nickname, access_token, seller_id FROM hub_ml_contas WHERE nickname = 'Inova Móveis' LIMIT 1");
        const conta = tokenRes.rows[0];
        console.log(`Account: ${conta.nickname}, Seller ID: ${conta.seller_id}`);

        // Get recent order to inspect fields
        const recentOrdersUrl = `https://api.mercadolibre.com/orders/search?seller=${conta.seller_id}&sort=date_desc&limit=5`;
        const res = await axios.get(recentOrdersUrl, {
            headers: { 'Authorization': `Bearer ${conta.access_token}` }
        });

        console.log('Recent orders count:', res.data.results?.length);
        if (res.data.results && res.data.results.length > 0) {
            const sampleOrder = res.data.results[0];
            const sampleItem = sampleOrder.order_items[0]?.item;
            console.log('Sample Order ID:', sampleOrder.id);
            console.log('Sample Order Date:', sampleOrder.date_created);
            console.log('Sample Order Item ID:', sampleItem?.id, sampleItem?.title);

            if (sampleItem?.id) {
                console.log(`\nTesting search for item ${sampleItem.id}...`);
                const itemOrderUrl = `https://api.mercadolibre.com/orders/search?seller=${conta.seller_id}&q=${sampleItem.id}&sort=date_desc&limit=1`;
                const itemRes = await axios.get(itemOrderUrl, {
                    headers: { 'Authorization': `Bearer ${conta.access_token}` }
                });
                console.log('Results with q=', sampleItem.id, ':', itemRes.data.results?.length);
            }
        }
    } catch (err) {
        if (err.response) {
            console.error('ML API Error:', err.response.status, err.response.data);
        } else {
            console.error('Error:', err.message);
        }
    } finally {
        await poolHub.end();
        await poolProdutos.end();
        process.exit(0);
    }
}

testOrdersByItem();
