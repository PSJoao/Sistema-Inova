const axios = require('axios');
const { poolHub, poolProdutos } = require('../config/database');
const hubTokenService = require('./hubTokenService');

const ML_API_URL = 'https://api.mercadolibre.com';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class HubProdutosService {
    async sincronizarAnuncios() {
        console.log('[HUB PRODUTOS] Iniciando sincronização de anúncios...');
        try {
            // Busca contas ativas no banco principal do HUB
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE');
            
            for (const conta of contasResult.rows) {
                await this.processarContaProdutos(conta);
            }
        } catch (error) {
            console.error('[HUB PRODUTOS] Erro crítico na sincronização:', error);
        }
    }

    async processarContaProdutos(conta) {
        console.log(`[HUB PRODUTOS] Processando anúncios da conta: ${conta.nickname}`);
        
        let accessToken;
        try {
            accessToken = await hubTokenService.getValidAccessToken(conta);
        } catch (err) {
            console.error(`[HUB PRODUTOS] Falha de token para ${conta.nickname}. Pulando.`);
            return;
        }

        let scrollId = null;
        const limit = 50;
        let continuarBuscando = true;

        while (continuarBuscando) {
            try {
                // 1. Busca a lista de IDs usando o modo de varredura (Scan) puxando APENAS ativos
                let searchUrl = `${ML_API_URL}/users/${conta.seller_id}/items/search?search_type=scan&status=active&limit=${limit}`;

                if (scrollId) {
                    searchUrl += `&scroll_id=${scrollId}`;
                }

                const searchResponse = await axios.get(searchUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                scrollId = searchResponse.data.scroll_id;

                const idsAnuncios = searchResponse.data.results || [];
                
                if (idsAnuncios.length === 0) {
                    continuarBuscando = false;
                    break;
                }

                console.log(`Qtd. de anúncios encontrada: ${idsAnuncios.length}`);
                console.log(`Iniciando a busca aprofundada...`);

                let qtdAnuncios = 0;
                // 2. Itera sobre cada anúncio para pegar os detalhes
                for (const idAnuncio of idsAnuncios) {
                    await delay(300); // Evitar rate limit
                    
                    try {
                        const itemUrl = `${ML_API_URL}/items?ids=${idAnuncio}`;
                        const itemResponse = await axios.get(itemUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        
                        const itemData = itemResponse.data[0].body;

                        //console.log(JSON.stringify(itemData, null, 2));

                        // Extração de Atributos
                        let sku = null, peso = null, altura = null, largura = null, comprimento = null;
                        
                        if (itemData.attributes) {
                            for (const attr of itemData.attributes) {
                                if (attr.id === 'SELLER_SKU') sku = attr.value_name;
                                if (attr.id === 'SELLER_PACKAGE_WEIGHT') peso = attr.value_name;
                                if (attr.id === 'SELLER_PACKAGE_HEIGHT') altura = attr.value_name;
                                if (attr.id === 'SELLER_PACKAGE_WIDTH') largura = attr.value_name;
                                if (attr.id === 'SELLER_PACKAGE_LENGTH') comprimento = attr.value_name;
                            }
                        }

                        // Dados para buscar a tarifa e o frete
                        const price = itemData.price;
                        const categoryId = itemData.category_id;
                        const listingTypeId = itemData.listing_type_id;
                        const mode = itemData.shipping?.mode || 'me2';
                        const logisticType = itemData.shipping?.logistic_type || 'cross_docking';
                        
                        // Novos campos capturados para o frete
                        const condition = itemData.condition || 'new';
                        const freeShipping = itemData.shipping?.free_shipping || false;
                        const sellerId = itemData.seller_id;
                        const stateId = itemData.seller_address?.state?.id || '';
                        const cityId = itemData.seller_address?.city?.id || '';
                        const zipCode = itemData.seller_address?.zip_code || '';

                        // 3. Buscar Tarifa
                        let tarifa = 0;
                        let taxa_fixa = 0;
                        try {
                            const tarifaUrl = `${ML_API_URL}/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&logistic_type=${logisticType}&shipping_modes=${mode}&listing_type_id=${listingTypeId}`;
                            const tarifaResponse = await axios.get(tarifaUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            
                            tarifa = tarifaResponse.data.sale_fee_details?.percentage_fee || 0;
                            taxa_fixa = tarifaResponse.data.sale_fee_details?.fixed_fee || 0;
                        } catch (errTarifa) {
                            console.warn(`[HUB PRODUTOS] Não foi possível obter tarifa para ${idAnuncio}`);
                        }

                        // 4. Buscar Frete
                        let frete = 0;
                        // O frete só pode ser calculado se tivermos as dimensões
                        if (altura && largura && comprimento && peso) {
                            // Limpa os textos "cm" e "g" e pega só o número
                            const h = parseInt(altura) || 0;
                            const w = parseInt(largura) || 0;
                            const l = parseInt(comprimento) || 0;
                            const p = parseInt(peso) || 0;
                            const dimensionsStr = `${h}x${w}x${l},${p}`;

                            try {
                                const freteUrl = `${ML_API_URL}/users/${sellerId}/shipping_options/free?dimensions=${dimensionsStr}&item_price=${price}&listing_type_id=${listingTypeId}&mode=${mode}&condition=${condition}&logistic_type=${logisticType}&free_shipping=${freeShipping}&currency_id=BRL&state_id=${stateId}&city_id=${cityId}&zip_code=${zipCode}`;
                                
                                const freteResponse = await axios.get(freteUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });
                                
                                frete = freteResponse.data?.coverage?.all_country?.list_cost || 0;
                            } catch (errFrete) {
                                console.warn(`[HUB PRODUTOS] Não foi possível obter frete para ${idAnuncio}:`, errFrete.response?.data?.message || errFrete.message);
                            }
                        }

                        // 5. Buscar Publicidade (Product Ads)
                        let tem_publicidade = false;
                        let preco_publicidade = null;
                        let cliques_publicidade = null;

                        try {
                            const adsUrl = `${ML_API_URL}/advertising/MLB/product_ads/ads/${idAnuncio}`;
                            const adsResponse = await axios.get(adsUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            
                            // Se a requisição deu sucesso, ele faz parte de uma campanha
                            tem_publicidade = true;
                            preco_publicidade = adsResponse.data.metrics_summary?.cost || 0; // O valor investido na publicidade
                            cliques_publicidade = adsResponse.data.metrics_summary?.clicks || 0;

                        } catch (errAds) {
                            // Se retornar erro (geralmente 404 Not Found), significa que não tem publicidade.
                            // Deixamos o catch silencioso para manter false e null.
                        }

                        // 6. Buscar Custos do Produto baseado no SKU
                        let custo = 0;
                        let custo_real = 0;
                        let cleanSku = sku ? sku.trim() : null; // Apara os espaços em branco no JS

                        if (cleanSku) {
                            try {
                                // TRIM(sku) no SQL garante que os espaços no banco também sejam ignorados no match
                                const custoQuery = `SELECT preco_custo, preco_custo_real FROM produto_custos WHERE TRIM(sku) = $1 LIMIT 1`;
                                const custoResult = await poolProdutos.query(custoQuery, [cleanSku]);
                                
                                if (custoResult.rows.length > 0) {
                                    custo = custoResult.rows[0].preco_custo || 0;
                                    custo_real = custoResult.rows[0].preco_custo_real || 0;
                                }
                            } catch (errCusto) {
                                console.warn(`[HUB PRODUTOS] Erro ao buscar custo para o SKU ${cleanSku}:`, errCusto.message);
                            }
                        }

                        // 7. Cálculo da Margem de Lucro (%)
                        let margem = 0;
                        
                        // Garantindo que todos os valores sejam tratados como números para a matemática não falhar
                        const numPreco = Number(price) || 0;
                        const numTarifa = Number(tarifa) || 0;
                        const numTaxaFixa = Number(taxa_fixa) || 0;
                        const numFrete = Number(frete) || 0;
                        const numCusto = Number(custo) || 0;

                        if (numPreco > 0 && numCusto > 0.01) {
                            const valorTarifaEmReais = numPreco * (numTarifa / 100);
                            const despesasTotais = valorTarifaEmReais + numTaxaFixa + numFrete + numCusto;
                            const lucroLiquido = numPreco - despesasTotais;
                            
                            // Calcula a porcentagem e limita a 2 casas decimais
                            margem = Number(((lucroLiquido / numPreco) * 100).toFixed(2));
                        } else {
                            margem = 0;
                        }

                        // 8. Salvar no novo Banco de Dados (PRODUTOS_HUB)
                        await this.salvarProduto({
                            sku: cleanSku,
                            descricao: itemData.title,
                            id_anuncio: itemData.id,
                            status: itemData.status,
                            empresa: conta.nickname,
                            tipo: listingTypeId,
                            tarifa,
                            taxa_fixa,
                            preco: price,      
                            tipo_logistica: logisticType, 
                            tipo_envio: mode,
                            frete,
                            tem_publicidade,     
                            preco_publicidade,     
                            cliques_publicidade,
                            custo,           
                            custo_real,
                            margem,
                            peso,
                            altura,
                            largura,
                            profundidade: comprimento
                        });

                        qtdAnuncios++;

                    } catch (errItem) {
                        console.error(`[HUB PRODUTOS] Erro ao detalhar anúncio ${idAnuncio}:`, errItem.message);
                    }
                }

                console.log(`Fim da busca aprofundada! Anúncios inseridos com sucesso: ${qtdAnuncios}`);

                if (idsAnuncios.length < limit) {
                    continuarBuscando = false;
                }

            } catch (errSearch) {
                console.error(`[HUB PRODUTOS] Erro na paginação da conta ${conta.nickname}:`, errSearch.message);
                continuarBuscando = false;
            }
        }
    }

    async salvarProduto(dados) {
        const query = `
            INSERT INTO produtos_anuncios 
            (sku, descricao, id_anuncio, status, empresa, tipo, tarifa, taxa_fixa, preco, tipo_logistica, tipo_envio, frete, tem_publicidade, preco_publicidade, cliques_publicidade, custo, custo_real, margem, peso, altura, largura, profundidade)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
            ON CONFLICT (id_anuncio) DO UPDATE SET
            sku = EXCLUDED.sku,
            descricao = EXCLUDED.descricao,
            status = EXCLUDED.status,
            empresa = EXCLUDED.empresa,
            tipo = EXCLUDED.tipo,
            tarifa = EXCLUDED.tarifa,
            taxa_fixa = EXCLUDED.taxa_fixa,
            preco = EXCLUDED.preco,
            tipo_logistica = EXCLUDED.tipo_logistica,
            tipo_envio = EXCLUDED.tipo_envio,
            frete = EXCLUDED.frete,
            tem_publicidade = EXCLUDED.tem_publicidade,
            preco_publicidade = EXCLUDED.preco_publicidade,
            cliques_publicidade = EXCLUDED.cliques_publicidade,
            custo = EXCLUDED.custo,
            custo_real = EXCLUDED.custo_real,
            margem = EXCLUDED.margem,
            peso = EXCLUDED.peso,
            altura = EXCLUDED.altura,
            largura = EXCLUDED.largura,
            profundidade = EXCLUDED.profundidade,
            last_update = NOW()
        `;

        const values = [
            dados.sku, dados.descricao, dados.id_anuncio, dados.status, 
            dados.empresa, dados.tipo, dados.tarifa, dados.taxa_fixa, 
            dados.preco, dados.tipo_logistica, dados.tipo_envio, dados.frete,
            dados.tem_publicidade, dados.preco_publicidade, dados.cliques_publicidade,
            dados.custo, dados.custo_real, dados.margem,
            dados.peso, dados.altura, dados.largura, dados.profundidade
        ];

        try {
            await poolProdutos.query(query, values);
        } catch (error) {
            console.error(`[HUB PRODUTOS] Erro ao salvar produto ${dados.id_anuncio}:`, error.message);
        }
    }
}

module.exports = new HubProdutosService();