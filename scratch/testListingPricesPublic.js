const axios = require('axios');

async function testListingPrices() {
    try {
        const categoryId = 'MLB186273';
        const price = 1099.9;

        console.log('Testing gold_special (Clássico)...');
        const urlSpecial = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&listing_type_id=gold_special`;
        const resSpecial = await axios.get(urlSpecial);
        console.log('gold_special response:');
        console.log(JSON.stringify(resSpecial.data, null, 2));

        console.log('\nTesting gold_pro (Premium)...');
        const urlPro = `https://api.mercadolibre.com/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&listing_type_id=gold_pro`;
        const resPro = await axios.get(urlPro);
        console.log('gold_pro response:');
        console.log(JSON.stringify(resPro.data, null, 2));

    } catch (err) {
        console.error('Error:', err.response?.data || err.message);
    }
}

testListingPrices();
