const axios = require('axios');

async function testListingPrices() {
    try {
        // Test category MLB3530 (Cadeiras de Escritório or similar) or MLB1051 (Celulares)
        const categoryId = 'MLB3530';
        const price = 500;
        const listingTypeId = 'gold_special'; // Clássico
        const mode = 'me2';
        const logisticType = 'cross_docking';

        const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&logistic_type=${logisticType}&shipping_modes=${mode}&listing_type_id=${listingTypeId}`;
        console.log('Fetching:', url);
        
        const response = await axios.get(url);
        console.log('Is Array?', Array.isArray(response.data));
        console.log('Response data:', JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

testListingPrices();
