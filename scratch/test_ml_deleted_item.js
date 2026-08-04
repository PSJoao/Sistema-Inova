require('dotenv').config();
const { poolHub } = require('../hub/config/database');
const axios = require('axios');

async function testMlApiItem() {
    const idAnuncio = 'MLB6528041344';
    try {
        // Obter contas do Hub
        const res = await poolHub.query('SELECT nickname, access_token, refresh_token FROM hub_ml_contas');
        console.log('Contas encontradas:', res.rows.map(r => r.nickname));

        for (const account of res.rows) {
            console.log(`\nTestando para a conta: ${account.nickname}`);
            try {
                const response = await axios.get(`https://api.mercadolibre.com/items/${idAnuncio}`, {
                    headers: { 'Authorization': `Bearer ${account.access_token}` }
                });

                const item = response.data;
                console.log(`\n=== ITEM ML API RESULT (${account.nickname}) ===`);
                console.log(`ID: ${item.id}`);
                console.log(`Title: ${item.title}`);
                console.log(`Status: ${item.status}`);
                console.log(`Sub Status:`, item.sub_status);
                console.log(`Tags:`, item.tags);
                console.log(`Stop Time:`, item.stop_time);
                break;
            } catch (errAcc) {
                console.log(`Erro na conta ${account.nickname}:`, errAcc.response ? errAcc.response.data : errAcc.message);
            }
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await poolHub.end();
        process.exit(0);
    }
}

testMlApiItem();
