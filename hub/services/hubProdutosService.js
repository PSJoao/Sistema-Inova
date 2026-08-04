const axios = require('axios');
const { poolHub, poolProdutos } = require('../config/database');
const hubTokenService = require('./hubTokenService');

const ML_API_URL = 'https://api.mercadolibre.com';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class HubProdutosService {
    constructor() {
        this._syncManualEmAndamento = false;
    }

    /**
     * Sincronização manual disparada via endpoint.
     * Recebe um array de seller_ids e sincroniza os anúncios dessas contas,
     * independente de estarem ativas ou não.
     * Possui trava para evitar execuções simultâneas.
     */
    async sincronizarAnunciosManuais(sellerIds) {
        if (this._syncManualEmAndamento) {
            throw new Error('SYNC_EM_ANDAMENTO');
        }

        this._syncManualEmAndamento = true;
        console.log(`[HUB PRODUTOS] Sincronização manual iniciada para sellers: ${sellerIds.join(', ')}`);

        try {
            // Busca as contas pelos seller_ids (sem filtro de ativo)
            const placeholders = sellerIds.map((_, i) => `$${i + 1}`).join(', ');
            const contasResult = await poolHub.query(
                `SELECT * FROM hub_ml_contas WHERE seller_id IN (${placeholders})`,
                sellerIds
            );

            if (contasResult.rows.length === 0) {
                console.warn('[HUB PRODUTOS] Nenhuma conta encontrada para os seller_ids informados.');
                return { processadas: 0, nao_encontradas: sellerIds };
            }

            // Identifica quais sellers foram encontrados e quais não
            const sellersEncontrados = contasResult.rows.map(c => String(c.seller_id));
            const sellersNaoEncontrados = sellerIds.filter(id => !sellersEncontrados.includes(String(id)));

            // Processa cada conta encontrada
            for (const conta of contasResult.rows) {
                await this.processarContaProdutos(conta);
            }

            console.log(`[HUB PRODUTOS] Sincronização manual finalizada. Contas processadas: ${contasResult.rows.length}`);

            return {
                processadas: contasResult.rows.length,
                sellers_processados: sellersEncontrados,
                sellers_nao_encontrados: sellersNaoEncontrados
            };
        } catch (error) {
            console.error('[HUB PRODUTOS] Erro na sincronização manual:', error);
            throw error;
        } finally {
            this._syncManualEmAndamento = false;
        }
    }

    async sincronizarAnunciosEspecificos(itemIds) {
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) return 0;
        console.log(`[HUB PRODUTOS] Iniciando sincronização em tempo real de ${itemIds.length} anúncio(s) específico(s)...`);

        const cleanIds = Array.from(new Set(itemIds.map(id => String(id).trim().toUpperCase()))).filter(id => id.startsWith('MLB') || id.length >= 8);
        if (cleanIds.length === 0) return 0;

        try {
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE AND id NOT IN (7, 6)');
            let totalProcessados = 0;

            for (const conta of contasResult.rows) {
                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(conta);
                } catch (err) {
                    continue;
                }

                const chunkSize = 20;
                for (let i = 0; i < cleanIds.length; i += chunkSize) {
                    const chunk = cleanIds.slice(i, i + chunkSize);
                    try {
                        const idsBatch = chunk.join(',');
                        const itemsUrl = `${ML_API_URL}/items?ids=${idsBatch}`;
                        const itemsResponse = await axios.get(itemsUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });

                        const itemsResults = itemsResponse.data || [];
                        for (const res of itemsResults) {
                            if (res.code === 200 && res.body) {
                                const itemData = res.body;
                                if (String(itemData.seller_id) === String(conta.seller_id)) {
                                    const success = await this.processarItemCompleto(itemData, conta, accessToken);
                                    if (success !== false) totalProcessados++;
                                }
                            }
                        }
                    } catch (errChunk) {
                        console.error(`[HUB PRODUTOS] Erro ao sincronizar itens específicos ${chunk.join(',')}:`, errChunk.message);
                    }
                }
            }

            console.log(`[HUB PRODUTOS] Sincronização específica concluída: ${totalProcessados} item(ns) processado(s) em tempo real.`);
            return totalProcessados;
        } catch (error) {
            console.error('[HUB PRODUTOS] Erro ao sincronizar anúncios específicos:', error.message);
            return 0;
        }
    }

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

    isItemDeleted(itemData) {
        if (!itemData) return false;

        let subStatusArray = [];
        if (Array.isArray(itemData.sub_status)) {
            subStatusArray = itemData.sub_status;
        } else if (typeof itemData.sub_status === 'string') {
            subStatusArray = [itemData.sub_status];
        }

        const hasDeletedSubStatus = subStatusArray.some(s => String(s).toLowerCase().includes('deleted'));
        const hasDeletedTag = Array.isArray(itemData.tags) && itemData.tags.includes('deleted');

        return hasDeletedSubStatus || (itemData.status === 'closed' && (hasDeletedSubStatus || hasDeletedTag));
    }

    async excluirProduto(idAnuncio) {
        if (!idAnuncio) return;
        try {
            await poolProdutos.query('DELETE FROM produtos_anuncios WHERE id_anuncio = $1', [idAnuncio]);
            console.log(`[HUB PRODUTOS] Anúncio ${idAnuncio} excluído com sucesso da tabela produtos_anuncios.`);
        } catch (err) {
            console.error(`[HUB PRODUTOS] Erro ao excluir ${idAnuncio} da tabela produtos_anuncios:`, err.message);
        }

        try {
            const { Pool } = require('pg');
            const poolInova = new Pool({
                user: process.env.DB_MON_USER,
                host: process.env.DB_MON_HOST,
                database: process.env.DB_MON_DATABASE,
                password: process.env.DB_MON_PASSWORD,
                port: process.env.DB_MON_PORT,
            });
            await poolInova.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1', [idAnuncio]);
            await poolInova.end();
            console.log(`[HUB PRODUTOS] Anúncio ${idAnuncio} excluído com sucesso da tabela anuncios_ml.`);
        } catch (err) {
            console.error(`[HUB PRODUTOS] Erro ao excluir ${idAnuncio} da tabela anuncios_ml:`, err.message);
        }
    }

    async processarItemCompleto(itemData, conta, accessToken) {
        const idAnuncio = itemData.id;
        try {
            // Verifica se o anúncio foi excluído no Mercado Livre
            if (this.isItemDeleted(itemData)) {
                console.log(`[HUB PRODUTOS] Anúncio ${idAnuncio} foi EXCLUÍDO no Mercado Livre (status: ${itemData.status}, sub_status: ${JSON.stringify(itemData.sub_status)}). Deletando dos bancos de dados...`);
                await this.excluirProduto(idAnuncio);
                return false;
            }
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

            // Novos campos: Estoque e Prazo de Disponibilidade
            const estoque = itemData.available_quantity || 0;
            const catalogListing = itemData.catalog_listing || false;

            // Prazo de disponibilidade: fica em sale_terms com id "MANUFACTURING_TIME"
            let prazoDisponibilidade = null;
            if (itemData.sale_terms && Array.isArray(itemData.sale_terms)) {
                const mfgTerm = itemData.sale_terms.find(t => t.id === 'MANUFACTURING_TIME');
                if (mfgTerm) {
                    prazoDisponibilidade = mfgTerm.value_struct?.number || mfgTerm.value_name || null;
                }
            }

            const experienciaCompra = itemData.health ? Number((itemData.health * 100).toFixed(2)) : 0;
            const vendasTotal = itemData.sold_quantity || 0;

            // Se original_price existir, o price atual é promocional. Senão, price é o original.
            let precoOriginal = itemData.original_price ? itemData.original_price : itemData.price;
            let precoPromocional = itemData.original_price ? itemData.price : null;

            // Prepara a promise para verificar o vencedor do catálogo, se for de catálogo
            let winnerPromise = Promise.resolve(false);
            if (catalogListing) {
                winnerPromise = this.buscarCatalogWinner(idAnuncio, accessToken);
            }

            let lastSalePromise = Promise.resolve({ dataUltimaVenda: null, diasSemVender: null });
            if (vendasTotal > 0 && sellerId) {
                lastSalePromise = this.buscarDataUltimaVenda(sellerId, idAnuncio, accessToken);
            }

            // 1. Busca Ads, Catalog Winner, Preço de Campanha e Última Venda concorrentemente
            const [adsResult, ganhandoCatalogo, promoResult, lastSaleResult] = await Promise.all([
                this.buscarAds(idAnuncio, accessToken),
                winnerPromise,
                this.buscarPrecoCampanha(idAnuncio, accessToken),
                lastSalePromise
            ]);

            const { tem_publicidade, preco_publicidade, cliques_publicidade } = adsResult;
            const precoCampanha = promoResult ? promoResult.precoCampanha : null;
            const promocoesList = promoResult && promoResult.promocoes ? promoResult.promocoes : [];
            const { dataUltimaVenda, diasSemVender } = lastSaleResult;

            const qualidade = itemData.health != null ? Number((itemData.health * 100).toFixed(2)) : null;

            // Se o anúncio possuir um preço de campanha ativo, ele sobrepõe a lógica de promoção simples
            if (precoCampanha) {
                precoPromocional = precoCampanha;
                // Se a API não tinha enviado original_price (pois a campanha roda por fora), o preço base é o price atual.
                if (!itemData.original_price) {
                    precoOriginal = itemData.price;
                }
            }

            // Preço Efetivo que o cliente realmente paga no momento (Promocional se ativo, ou Base se sem promoção)
            const precoEfetivo = precoPromocional ? precoPromocional : precoOriginal;

            // 2. Busca a Tarifa e o Frete calculando com base no PREÇO EFETIVO real
            const tarifaResult = await this.buscarTarifa(categoryId, precoEfetivo, logisticType, mode, listingTypeId, accessToken, idAnuncio);
            const { tarifa, taxa_fixa } = tarifaResult;

            // Buscar Frete baseado no Preço Efetivo
            let frete = 0;
            if (altura && largura && comprimento && peso) {
                frete = await this.buscarFrete(sellerId, precoEfetivo, listingTypeId, mode, condition, logisticType, freeShipping, stateId, cityId, zipCode, altura, largura, comprimento, peso, accessToken, idAnuncio);
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
            const numPreco = Number(precoEfetivo) || Number(price) || 0;
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

            const permalink = itemData.permalink || '';
            const thumbnail = itemData.thumbnail || (itemData.pictures && itemData.pictures[0] ? (itemData.pictures[0].secure_url || itemData.pictures[0].url) : '');

            let subStatusClean = null;
            if (Array.isArray(itemData.sub_status) && itemData.sub_status.length > 0) {
                subStatusClean = itemData.sub_status.join(', ');
            } else if (typeof itemData.sub_status === 'string' && itemData.sub_status.trim() !== '') {
                try {
                    const parsed = JSON.parse(itemData.sub_status);
                    subStatusClean = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
                } catch (e) {
                    subStatusClean = itemData.sub_status.replace(/[\[\]"']/g, '').trim();
                }
            }

            // Salvar no Banco de Dados
            await this.salvarProduto({
                sku: cleanSku,
                descricao: itemData.title,
                id_anuncio: itemData.id,
                status: itemData.status,
                sub_status: subStatusClean,
                empresa: conta.nickname,
                tipo: listingTypeId,
                tarifa,
                taxa_fixa,
                preco: precoOriginal, // Altera para salvar sempre o preço base aqui
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
                profundidade: comprimento,
                estoque,
                prazo_disponibilidade: prazoDisponibilidade,
                catalog_listing: catalogListing,
                ganhando_catalogo: ganhandoCatalogo,
                experiencia_compra: experienciaCompra,
                vendas_total: vendasTotal,
                preco_promocional: precoPromocional,
                permalink,
                thumbnail,
                promocoes_json: JSON.stringify(promocoesList),
                qualidade,
                data_ultima_venda: dataUltimaVenda,
                dias_sem_vender: diasSemVender
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

            let dataObj = response.data;
            if (Array.isArray(dataObj)) {
                dataObj = dataObj.find(item => item.listing_type_id === listingTypeId) || dataObj[0] || {};
            }

            return {
                tarifa: dataObj.sale_fee_details?.percentage_fee || 0,
                taxa_fixa: dataObj.sale_fee_details?.fixed_fee || 0
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

    async buscarCatalogWinner(idAnuncio, accessToken) {
        try {
            const url = `${ML_API_URL}/items/${idAnuncio}/price_to_win?siteId=MLB&version=v2`;
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            // O retorno contém status como 'winning', 'losing' ou 'tied'.
            if (response.data && (response.data.status === 'winning' || response.data.status === 'tied' || response.data.competitors_sharing_first_place > 0)) {
                return true;
            }
            return false;
        } catch (err) {
            console.warn(`[HUB PRODUTOS] Erro ao buscar price_to_win do anúncio ${idAnuncio}:`, err.response?.data?.message || err.message);
            return false;
        }
    }

    async buscarPrecoCampanha(idAnuncio, accessToken) {
        try {
            // 1. Descobrir as promoções do anúncio (com app_version=v2, mas sem o user_id)
            const urlPromos = `${ML_API_URL}/seller-promotions/items/${idAnuncio}?app_version=v2`;
            const resPromos = await axios.get(urlPromos, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!resPromos.data || !Array.isArray(resPromos.data) || resPromos.data.length === 0) {
                return { precoCampanha: null, promocoes: [] };
            }

            const allPromos = resPromos.data;

            // 2. Filtrar apenas as promoções ativas/iniciadas
            const promosAtivas = allPromos.filter(p => p.status === 'started' || p.status === 'active');
            
            let menorPreco = null;
            for (const promo of promosAtivas) {
                if (promo.price && (menorPreco === null || promo.price < menorPreco)) {
                    menorPreco = promo.price;
                }
            }

            return { precoCampanha: menorPreco, promocoes: allPromos };

        } catch (err) {
            console.warn(`[HUB PRODUTOS] Erro ao buscar preço de campanha para o anúncio ${idAnuncio}:`, err.response?.data?.message || err.message);
            return { precoCampanha: null, promocoes: [] };
        }
    }

    async buscarDataUltimaVenda(sellerId, idAnuncio, accessToken) {
        if (!sellerId || !idAnuncio) return { dataUltimaVenda: null, diasSemVender: null };

        try {
            const url = `${ML_API_URL}/orders/search?seller=${sellerId}&q=${idAnuncio}&sort=date_desc&limit=1`;
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const results = response.data?.results || [];
            if (results.length > 0 && results[0].date_created) {
                const dateStr = results[0].date_created;
                const lastSaleDate = new Date(dateStr);
                const now = new Date();
                const diffMs = now.getTime() - lastSaleDate.getTime();
                const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

                return {
                    dataUltimaVenda: dateStr,
                    diasSemVender: diffDays
                };
            }
            return { dataUltimaVenda: null, diasSemVender: null };
        } catch (err) {
            console.warn(`[HUB PRODUTOS] Não foi possível buscar data da última venda para o anúncio ${idAnuncio}:`, err.message);
            return { dataUltimaVenda: null, diasSemVender: null };
        }
    }

    async salvarProduto(dados) {
        try {
            await poolProdutos.query('ALTER TABLE produtos_anuncios ADD COLUMN IF NOT EXISTS qualidade NUMERIC(5,2);');
            await poolProdutos.query('ALTER TABLE produtos_anuncios ADD COLUMN IF NOT EXISTS data_ultima_venda TIMESTAMP WITH TIME ZONE;');
            await poolProdutos.query('ALTER TABLE produtos_anuncios ADD COLUMN IF NOT EXISTS dias_sem_vender INTEGER;');
            await poolProdutos.query('ALTER TABLE produtos_anuncios ADD COLUMN IF NOT EXISTS sub_status TEXT;');
        } catch (e) {}

        const query = `
            INSERT INTO produtos_anuncios 
            (sku, descricao, id_anuncio, status, sub_status, empresa, tipo, tarifa, taxa_fixa, preco, tipo_logistica, tipo_envio, frete, tem_publicidade, preco_publicidade, cliques_publicidade, custo, custo_real, margem, peso, altura, largura, profundidade, estoque, prazo_disponibilidade, catalog_listing, ganhando_catalogo, experiencia_compra, vendas_total, preco_promocional, permalink, thumbnail, promocoes_json, qualidade, data_ultima_venda, dias_sem_vender)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
            ON CONFLICT (id_anuncio) DO UPDATE SET
            sku = EXCLUDED.sku,
            descricao = EXCLUDED.descricao,
            status = EXCLUDED.status,
            sub_status = EXCLUDED.sub_status,
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
            estoque = EXCLUDED.estoque,
            prazo_disponibilidade = EXCLUDED.prazo_disponibilidade,
            catalog_listing = EXCLUDED.catalog_listing,
            ganhando_catalogo = EXCLUDED.ganhando_catalogo,
            experiencia_compra = EXCLUDED.experiencia_compra,
            vendas_total = EXCLUDED.vendas_total,
            preco_promocional = EXCLUDED.preco_promocional,
            permalink = EXCLUDED.permalink,
            thumbnail = EXCLUDED.thumbnail,
            promocoes_json = EXCLUDED.promocoes_json,
            qualidade = EXCLUDED.qualidade,
            data_ultima_venda = EXCLUDED.data_ultima_venda,
            dias_sem_vender = EXCLUDED.dias_sem_vender,
            last_update = NOW()
        `;

        const values = [
            dados.sku, dados.descricao, dados.id_anuncio, dados.status, dados.sub_status,
            dados.empresa, dados.tipo, dados.tarifa, dados.taxa_fixa,
            dados.preco, dados.tipo_logistica, dados.tipo_envio, dados.frete,
            dados.tem_publicidade, dados.preco_publicidade, dados.cliques_publicidade,
            dados.custo, dados.custo_real, dados.margem, dados.peso,
            dados.altura, dados.largura, dados.profundidade, dados.estoque, dados.prazo_disponibilidade,
            dados.catalog_listing, dados.ganhando_catalogo, dados.experiencia_compra, dados.vendas_total, dados.preco_promocional,
            dados.permalink, dados.thumbnail, dados.promocoes_json, dados.qualidade, dados.data_ultima_venda, dados.dias_sem_vender
        ];

        try {
            await poolProdutos.query(query, values);
        } catch (error) {
            console.error(`[HUB PRODUTOS] Erro ao salvar produto ${dados.id_anuncio}:`, error.message);
        }
    }
}

module.exports = new HubProdutosService();