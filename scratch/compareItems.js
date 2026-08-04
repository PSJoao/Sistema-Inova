require('dotenv').config({ path: 'c:/Sistemas/Sistema-Inova/.env' });
const axios = require('axios');
const { poolHub } = require('../hub/config/database');

async function compareItems() {
    try {
        const resConta = await poolHub.query('SELECT access_token FROM hub_ml_contas WHERE id = 7');
        const accessToken = resConta.rows[0].access_token;

        const id1 = 'MLB4766094135';
        const id2 = 'MLB4922995789';

        console.log(`=== BUSCANDO DETALHES DE ${id1} E ${id2} ===\n`);

        const [res1, res2] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${id1}`, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
            axios.get(`https://api.mercadolibre.com/items/${id2}`, { headers: { 'Authorization': `Bearer ${accessToken}` } })
        ]);

        const item1 = res1.data;
        const item2 = res2.data;

        console.log(`--- CÔMODA 1: ${id1} ---`);
        console.log('Title:', item1.title);
        console.log('Category:', item1.category_id);
        console.log('Domain ID:', item1.domain_id);
        console.log('Listing Type ID:', item1.listing_type_id);
        console.log('Price:', item1.price);
        console.log('Original Price:', item1.original_price);
        console.log('Catalog Listing:', item1.catalog_listing);
        console.log('Shipping Mode:', item1.shipping?.mode, 'Logistic:', item1.shipping?.logistic_type);
        console.log('Tags:', item1.tags);

        console.log(`\n--- CÔMODA 2: ${id2} ---`);
        console.log('Title:', item2.title);
        console.log('Category:', item2.category_id);
        console.log('Domain ID:', item2.domain_id);
        console.log('Listing Type ID:', item2.listing_type_id);
        console.log('Price:', item2.price);
        console.log('Original Price:', item2.original_price);
        console.log('Catalog Listing:', item2.catalog_listing);
        console.log('Shipping Mode:', item2.shipping?.mode, 'Logistic:', item2.shipping?.logistic_type);
        console.log('Tags:', item2.tags);

        // Testar a API /sites/MLB/listing_prices para ambos
        console.log(`\n=== TESTANDO LISTING_PRICES ===`);

        const urlTarifa1 = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${item1.category_id}&price=${item1.price}&logistic_type=${item1.shipping?.logistic_type || 'cross_docking'}&shipping_modes=${item1.shipping?.mode || 'me2'}&listing_type_id=${item1.listing_type_id}`;
        const resTarifa1 = await axios.get(urlTarifa1, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        console.log(`\nTarifa API para Cômoda 1 (${id1}):`);
        console.log(JSON.stringify(resTarifa1.data, null, 2));

        const urlTarifa2 = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${item2.category_id}&price=${item2.price}&logistic_type=${item2.shipping?.logistic_type || 'cross_docking'}&shipping_modes=${item2.shipping?.mode || 'me2'}&listing_type_id=${item2.listing_type_id}`;
        const resTarifa2 = await axios.get(urlTarifa2, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        console.log(`\nTarifa API para Cômoda 2 (${id2}):`);
        console.log(JSON.stringify(resTarifa2.data, null, 2));

        // Categorias
        const [cat1, cat2] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/categories/${item1.category_id}`),
            axios.get(`https://api.mercadolibre.com/categories/${item2.category_id}`)
        ]);

        console.log(`\nCategoria Cômoda 1 (${item1.category_id}):`, cat1.data.name, 'Path:', cat1.data.path_from_root?.map(p => p.name).join(' > '));
        console.log(`Categoria Cômoda 2 (${item2.category_id}):`, cat2.data.name, 'Path:', cat2.data.path_from_root?.map(p => p.name).join(' > '));

    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    } finally {
        await poolHub.end();
        process.exit();
    }
}

compareItems();
