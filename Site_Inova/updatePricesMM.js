const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const extractProductId = (url) => {
    const match = url.match(/-(\d+)\.html/);
    return match ? match[1] : null;
};

let isUpdateRunning = false;

/**
 * Função inteligente para atualizar os preços dos produtos,
 * priorizando os que falharam ou não são atualizados há mais de 2 horas.
 */
const updatePricesMM = async () => {

    if (isUpdateRunning) {
        console.log('[updatePrices] A atualização de preços já está em andamento. Pulando esta execução.');
        return;
    }
    isUpdateRunning = true;
    
    console.log('[updatePrices] Iniciando job de atualização de preços...');
    let client;
    try {
        client = await pool.connect();

        // 1. Lógica para buscar apenas os URLs que precisam de atenção
        const twoHoursAgo = new Date(new Date().getTime() - (2 * 60 * 60 * 1000));
        
        const urlsToUpdateResult = await client.query(
            `SELECT * FROM urls 
             WHERE status <> 'SUCCESS' OR last_update_at IS NULL OR last_update_at < $1 
             ORDER BY last_update_at ASC NULLS FIRST`,
            [twoHoursAgo]
        );
        const urls = urlsToUpdateResult.rows;

        if (urls.length === 0) {
            console.log('[updatePrices] Nenhum anúncio precisa de atualização no momento.');
            return;
        }

        console.log(`[updatePrices] ${urls.length} anúncio(s) selecionado(s) para atualização.`);

        // 2. Loop principal com pausa entre cada anúncio
        for (const url of urls) {
            try {
                const { data } = await axios.get(url.url);
                const $ = cheerio.load(data);
                const productId = extractProductId(url.url);

                let sellersInPage = [];
                let inovaMoveisFound = false;

                const priceUpdatePromises = $('.cav--c-gqwkJN').map(async (index, element) => {
                    const priceString = $(element).find('span:contains("R$")').first().text().trim();
                    const seller = $(element).find('.cav--c-gqwkJN a[href*="/lojista"]').first().text().trim();

                    if (priceString && seller) {
                        const price = parseFloat(priceString.replace('R$', '').replace('.', '').replace(',', '.'));
                        if (!isNaN(price)) {
                            sellersInPage.push(seller);
                            await client.query(
                                'INSERT INTO dados_produtos (product_id, price, seller, url_id) VALUES ($1, $2, $3, $4) ON CONFLICT (product_id, seller) DO UPDATE SET price = EXCLUDED.price',
                                [productId, price, seller, url.id]
                            );
                            if (seller.toLowerCase() === 'Moveis Magazine') {
                                inovaMoveisFound = true;
                            }
                        }
                    }
                }).get();

                await Promise.all(priceUpdatePromises);

                // Lógica de limpeza e atualização de status (como antes, mas agora dentro do try)
                const existingSellersResult = await client.query('SELECT seller FROM dados_produtos WHERE url_id = $1', [url.id]);
                const existingSellers = existingSellersResult.rows.map(row => row.seller);
                for (let existingSeller of existingSellers) {
                    if (!sellersInPage.includes(existingSeller)) {
                        await client.query('DELETE FROM dados_produtos WHERE url_id = $1 AND seller = $2', [url.id, existingSeller]);
                    }
                }

                if (!inovaMoveisFound) {
                    await client.query('UPDATE dados_produtos SET price = 0 WHERE url_id = $1 AND seller = $2', [url.id, 'Moveis Magazine']);
                }
                
                // 3. Se tudo deu certo para este URL, atualiza o status para SUCCESS
                await client.query("UPDATE urls SET status = 'SUCCESS', last_update_at = NOW() WHERE id = $1", [url.id]);
                console.log(`   -> SUCESSO: Anúncio ${url.id} (${url.description}) atualizado.`);

            } catch (urlError) {
                // Se deu erro PARA ESTE URL, atualiza o status para ERROR
                console.error(`   -> ERRO ao processar o anúncio ${url.id} (${url.url}): ${urlError.message}`);
                await client.query("UPDATE urls SET status = 'ERROR', last_update_at = NOW() WHERE id = $1", [url.id]);
            }

            // 4. Pausa entre cada anúncio para não ser bloqueado
            console.log('   ...Pausa de 5 segundos...');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Pausa de 5 segundos
        }

        console.log('[updatePrices] Job de atualização de preços finalizado.');

    } catch (err) {
        console.error('Erro fatal durante o processo de atualização de preços:', err);
    } finally {
        isUpdateRunning = false;
        if (client) client.release();
    }
};

module.exports = { updatePricesMM };