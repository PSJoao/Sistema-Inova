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
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE AND id NOT IN (7, 6)');

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
                let searchUrl = `${ML_API_URL}/users/${conta.seller_id}/items/search?search_type=scan&limit=${limit}`;

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

                // 2. Divide os IDs em pedaços de no máximo 2 (para evitar erro 400)
                const chunkSize = 2;
                const idChunks = [];
                for (let i = 0; i < idsAnuncios.length; i += chunkSize) {
                    idChunks.push(idsAnuncios.slice(i, i + chunkSize));
                }

                // 3. Busca e processa os detalhes de todos os blocos concorrentemente
                const results = await Promise.all(idChunks.map(async (chunk) => {
                    try {
                        const idsBatch = chunk.join(',');
                        const itemsUrl = `${ML_API_URL}/items?ids=${idsBatch}`;
                        const itemsResponse = await axios.get(itemsUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });

                        const itemsResults = itemsResponse.data || [];

                        // Processa cada item do bloco
                        return await Promise.all(itemsResults.map(async (res) => {
                            if (res.code !== 200) {
                                console.error(`[HUB PRODUTOS] Erro ao detalhar anúncio:`, res.body);
                                return false;
                            }
                            const itemData = res.body;
                            return await this.processarItemCompleto(itemData, conta, accessToken);
                        }));
                    } catch (errChunk) {
                        console.error(`[HUB PRODUTOS] Erro ao buscar bloco ${chunk.join(',')}:`, errChunk.message);
                        return [];
                    }
                }));

                const qtdAnuncios = results.flat().filter(r => r === true).length;

                console.log(`Fim da busca aprofundada! Anúncios inseridos com sucesso nesta leva: ${qtdAnuncios}`);

                if (idsAnuncios.length < limit) {
                    continuarBuscando = false;
                }

            } catch (errSearch) {
                console.error(`[HUB PRODUTOS] Erro na paginação da conta ${conta.nickname}:`, errSearch.message);
                continuarBuscando = false;
            }
        }
    }

    async processarItemCompleto(itemData, conta, accessToken) {
        const idAnuncio = itemData.id;
        try {
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

            // Promise.all para buscas paralelas dentro do item (Tarifa, Ads)
            // O Frete depende de condições, mas podemos tentar paralelizar o que for possível
            const [tarifaResult, adsResult] = await Promise.all([
                this.buscarTarifa(categoryId, price, logisticType, mode, listingTypeId, accessToken, idAnuncio),
                this.buscarAds(idAnuncio, accessToken)
            ]);

            const { tarifa, taxa_fixa } = tarifaResult;
            const { tem_publicidade, preco_publicidade, cliques_publicidade } = adsResult;

            // Buscar Frete (separado pois tem lógica condicional)
            let frete = 0;
            if (altura && largura && comprimento && peso) {
                frete = await this.buscarFrete(sellerId, price, listingTypeId, mode, condition, logisticType, freeShipping, stateId, cityId, zipCode, altura, largura, comprimento, peso, accessToken, idAnuncio);
            }

            // Buscar Custos do Produto baseado no SKU
            let custo = 0;
            let custo_real = 0;
            let cleanSku = sku ? sku.trim() : null;

            if (cleanSku) {
                try {
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

            // Cálculo da Margem de Lucro (%)
            let margem = 0;
            const numPreco = Number(price) || 0;
            const numTarifa = Number(tarifa) || 0;
            const numTaxaFixa = Number(taxa_fixa) || 0;
            const numFrete = Number(frete) || 0;
            const numCusto = Number(custo) || 0;

            if (numPreco > 0 && numCusto > 0.01) {
                const valorTarifaEmReais = numPreco * (numTarifa / 100);
                const despesasTotais = valorTarifaEmReais + numTaxaFixa + numFrete + numCusto;
                const lucroLiquido = numPreco - despesasTotais;
                margem = Number(((lucroLiquido / numPreco) * 100).toFixed(2));
            }

            // Salvar no Banco de Dados
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

            return true;
        } catch (err) {
            console.error(`[HUB PRODUTOS] Erro ao processar item ${idAnuncio}:`, err.message);
            return false;
        }
    }

    async buscarTarifa(categoryId, price, logisticType, mode, listingTypeId, accessToken, idAnuncio) {
        try {
            const tarifaUrl = `${ML_API_URL}/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&logistic_type=${logisticType}&shipping_modes=${mode}&listing_type_id=${listingTypeId}`;
            const response = await axios.get(tarifaUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            return {
                tarifa: response.data.sale_fee_details?.percentage_fee || 0,
                taxa_fixa: response.data.sale_fee_details?.fixed_fee || 0
            };
        } catch (err) {
            console.warn(`[HUB PRODUTOS] Não foi possível obter tarifa para ${idAnuncio}`);
            return { tarifa: 0, taxa_fixa: 0 };
        }
    }

    async buscarFrete(sellerId, price, listingTypeId, mode, condition, logisticType, freeShipping, stateId, cityId, zipCode, altura, largura, comprimento, peso, accessToken, idAnuncio) {
        try {
            const h = parseInt(altura) || 0;
            const w = parseInt(largura) || 0;
            const l = parseInt(comprimento) || 0;
            const p = parseInt(peso) || 0;
            const dimensionsStr = `${h}x${w}x${l},${p}`;

            const freteUrl = `${ML_API_URL}/users/${sellerId}/shipping_options/free?dimensions=${dimensionsStr}&item_price=${price}&listing_type_id=${listingTypeId}&mode=${mode}&condition=${condition}&logistic_type=${logisticType}&free_shipping=${freeShipping}&currency_id=BRL&state_id=${stateId}&city_id=${cityId}&zip_code=${zipCode}`;

            const response = await axios.get(freteUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            return response.data?.coverage?.all_country?.list_cost || 0;
        } catch (err) {
            console.warn(`[HUB PRODUTOS] Não foi possível obter frete para ${idAnuncio}:`, err.response?.data?.message || err.message);
            return 0;
        }
    }

    async buscarAds(idAnuncio, accessToken) {
        try {
            const adsUrl = `${ML_API_URL}/advertising/MLB/product_ads/ads/${idAnuncio}`;
            const response = await axios.get(adsUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            return {
                tem_publicidade: true,
                preco_publicidade: response.data.metrics_summary?.cost || 0,
                cliques_publicidade: response.data.metrics_summary?.clicks || 0
            };
        } catch (err) {
            return {
                tem_publicidade: false,
                preco_publicidade: null,
                cliques_publicidade: null
            };
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