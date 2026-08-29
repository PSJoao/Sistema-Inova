const axios = require('axios');
const { poolHub, poolProdutos } = require('../config/database');
const hubTokenService = require('./hubTokenService');

const ML_API_URL = 'https://api.mercadolibre.com';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class HubProdutosService {
    constructor() {
        this._syncManualEmAndamento = false;
        this._isSincronizando = false;
    }

    /**
     * Retorna se alguma rotina de sincronização de anúncios/promoções está ativa.
     */
    isSincronizando() {
        return !!(this._isSincronizando || this._syncManualEmAndamento);
    }

    // =====================================================
    // PRAZO DE DISPONIBILIDADE (MANUFACTURING_TIME)
    // =====================================================

    /**
     * Resolve qual conta ML (e token) é dona de um determinado item.
     * Busca no banco de produtos pelo id_anuncio → empresa (nickname) → hub_ml_contas.
     * @param {string} itemId - ID do anúncio (ex: MLB1234567890)
     * @param {number} clienteId - ID do cliente autenticado
     * @returns {object|null} - Objeto da conta ML com token válido, ou null
     */
    async resolverContaPorItem(itemId, clienteId = null) {
        // 1. Busca no banco de produtos qual empresa é dona desse anúncio
        const prodResult = await poolProdutos.query(
            'SELECT empresa FROM produtos_anuncios WHERE id_anuncio = $1 LIMIT 1',
            [itemId]
        );

        if (prodResult.rows.length === 0) return null;

        const empresa = prodResult.rows[0].empresa;

        // 2. Busca a conta ML vinculada a esse nickname (filtrando por cliente_id se informado)
        let queryConta = 'SELECT * FROM hub_ml_contas WHERE LOWER(TRIM(nickname)) = LOWER(TRIM($1))';
        const params = [empresa];

        if (clienteId) {
            queryConta += ' AND cliente_id = $2';
            params.push(clienteId);
        }

        queryConta += ' LIMIT 1';

        const contaResult = await poolHub.query(queryConta, params);

        if (contaResult.rows.length === 0) return null;

        return contaResult.rows[0];
    }


    /**
     * Define o prazo de disponibilidade (MANUFACTURING_TIME) em um anúncio do ML.
     * @param {string} itemId - ID do anúncio (ex: MLB1234567890)
     * @param {number} dias - Quantidade de dias (1 a 45)
     * @param {string} accessToken - Token de acesso válido da conta ML
     * @returns {object} - Resposta da API do ML
     */
    async setPrazoDisponibilidade(itemId, dias, accessToken) {
        const response = await axios.put(
            `${ML_API_URL}/items/${itemId}`,
            {
                sale_terms: [
                    {
                        id: 'MANUFACTURING_TIME',
                        value_name: `${dias} dias`
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        try {
            await poolProdutos.query(
                'UPDATE produtos_anuncios SET prazo_disponibilidade = $1 WHERE id_anuncio = $2',
                [`${dias} dias`, itemId]
            );
        } catch (errDb) {
            console.warn(`[HUB PRODUTOS] Erro ao atualizar prazo em produtos_anuncios para ${itemId}:`, errDb.message);
        }

        return response.data;
    }

    /**
     * Remove o prazo de disponibilidade (MANUFACTURING_TIME) de um anúncio do ML.
     * @param {string} itemId - ID do anúncio (ex: MLB1234567890)
     * @param {string} accessToken - Token de acesso válido da conta ML
     * @returns {object} - Resposta da API do ML
     */
    async removerPrazoDisponibilidade(itemId, accessToken) {
        const response = await axios.put(
            `${ML_API_URL}/items/${itemId}`,
            {
                sale_terms: [
                    {
                        id: 'MANUFACTURING_TIME',
                        value_id: null,
                        value_name: null
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        try {
            await poolProdutos.query(
                'UPDATE produtos_anuncios SET prazo_disponibilidade = NULL WHERE id_anuncio = $1',
                [itemId]
            );
        } catch (errDb) {
            console.warn(`[HUB PRODUTOS] Erro ao limpar prazo em produtos_anuncios para ${itemId}:`, errDb.message);
        }

        return response.data;
    }


    // =====================================================
    // GESTÃO DE PROMOÇÕES (OPT-IN E OPT-OUT VIA ML API)
    // =====================================================

    /**
     * Adiciona um anúncio a uma promoção no Mercado Livre (Opt-In).
     * @param {string} itemId - ID do anúncio (MLB...)
     * @param {string} promoId - ID da promoção (ex: P-MLB123, C-MLB123)
     * @param {string} promoType - Tipo da promoção (DEAL, SELLER_CAMPAIGN, SMART, PRICE_DISCOUNT, etc.)
     * @param {number|null} dealPrice - Preço com desconto desejado
     * @param {object} options - Opções adicionais (ex: ref_id)
     * @param {number|null} clienteId - ID do cliente autenticado (opcional)
     * @returns {object} - Resultado com dados atualizados da promoção
     */
    async aderirPromocaoItem(itemId, promoId, promoType, dealPrice, options = {}, clienteId = null) {
        if (!itemId) throw new Error('ID do anúncio é obrigatório.');

        const cleanItemId = String(itemId).trim().toUpperCase();
        console.log(`[HUB PROMOÇÕES] Solicitando Opt-In para ${cleanItemId} na promoção ${promoId} (${promoType}) com preço ${dealPrice}...`);

        // 1. Resolve conta ML
        const conta = await this.resolverContaPorItem(cleanItemId, clienteId);
        if (!conta) {
            throw new Error(`Anúncio ${cleanItemId} não encontrado ou não pertence a nenhuma conta cadastrada.`);
        }

        // 2. Obtém token válido
        const accessToken = await hubTokenService.getValidAccessToken(conta);
        if (!accessToken) {
            throw new Error(`Não foi possível obter token de acesso para a conta ${conta.nickname}.`);
        }

        // 3. Monta payload de acordo com o tipo de promoção
        const payload = {};
        const cleanType = String(promoType || '').toUpperCase().trim();
        const offerId = (options && (options.offer_id || options.ref_id)) ? String(options.offer_id || options.ref_id).trim() : null;

        if (cleanType === 'SMART') {
            if (promoId) payload.promotion_id = promoId;
            payload.promotion_type = 'SMART';
            if (offerId) payload.offer_id = offerId;
            if (dealPrice != null && Number(dealPrice) > 0) {
                payload.deal_price = Number(dealPrice);
            }
        } else if (cleanType === 'PRICE_DISCOUNT') {
            payload.promotion_type = 'PRICE_DISCOUNT';
            if (dealPrice != null && Number(dealPrice) > 0) {
                payload.deal_price = Number(dealPrice);
            }
            if (offerId) payload.offer_id = offerId;
        } else {
            if (promoId) payload.promotion_id = promoId;
            if (promoType) payload.promotion_type = promoType;
            if (dealPrice != null && Number(dealPrice) > 0) {
                payload.deal_price = Number(dealPrice);
            }
            if (offerId) payload.offer_id = offerId;
        }

        // 4. Executa POST no Mercado Livre
        try {
            const url = `${ML_API_URL}/seller-promotions/items/${cleanItemId}?app_version=v2`;
            console.log(`[HUB PROMOÇÕES] Enviando POST ${url} com payload:`, payload);
            
            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`[HUB PROMOÇÕES] Resposta Meli Opt-In para ${cleanItemId}:`, response.status, response.data);
        } catch (apiErr) {
            const errData = apiErr.response?.data;
            const errMsg = errData?.message || errData?.error || apiErr.message;
            console.error(`[HUB PROMOÇÕES] Erro da API Meli no Opt-In de ${cleanItemId}:`, errMsg, errData);
            throw new Error(`Falha no Mercado Livre: ${errMsg}`);
        }


        // 5. Busca promoções atualizadas em tempo real
        const promoResult = await this.buscarPrecoCampanha(cleanItemId, accessToken);
        const promocoesList = promoResult?.promocoes || [];
        const precoPromocional = promoResult?.precoCampanha || null;
        const promocoesJsonStr = JSON.stringify(promocoesList);

        // 6. Atualiza banco do Hub
        try {
            await poolProdutos.query(`
                UPDATE produtos_anuncios
                SET promocoes_json = $1,
                    preco_promocional = $2,
                    last_update = NOW()
                WHERE id_anuncio = $3
            `, [promocoesJsonStr, precoPromocional, cleanItemId]);
        } catch (errDb) {
            console.warn(`[HUB PROMOÇÕES] Erro ao atualizar produtos_anuncios após opt-in:`, errDb.message);
        }

        return {
            success: true,
            item_id: cleanItemId,
            preco_promocional: precoPromocional,
            promocoes: promocoesList,
            promocoes_json: promocoesJsonStr,
            conta: conta.nickname
        };
    }

    /**
     * Remove um anúncio de uma promoção no Mercado Livre (Opt-Out).
     * @param {string} itemId - ID do anúncio (MLB...)
     * @param {string} promoId - ID da promoção (ex: P-MLB123, C-MLB123)
     * @param {string} promoType - Tipo da promoção (DEAL, SELLER_CAMPAIGN, SMART, PRICE_DISCOUNT, etc.)
     * @param {object} options - Opções adicionais (ex: offer_id, ref_id)
     * @param {number|null} clienteId - ID do cliente autenticado (opcional)
     * @returns {object} - Resultado com dados atualizados da promoção
     */
    async removerPromocaoItem(itemId, promoId, promoType, options = {}, clienteId = null) {
        if (!itemId) throw new Error('ID do anúncio é obrigatório.');

        // Suporta passagem de clienteId como 4º argumento se options for número
        if (typeof options === 'number') {
            clienteId = options;
            options = {};
        }

        const cleanItemId = String(itemId).trim().toUpperCase();
        console.log(`[HUB PROMOÇÕES] Solicitando Opt-Out para ${cleanItemId} da promoção ${promoId} (${promoType})...`);

        // 1. Resolve conta ML
        const conta = await this.resolverContaPorItem(cleanItemId, clienteId);
        if (!conta) {
            throw new Error(`Anúncio ${cleanItemId} não encontrado ou não pertence a nenhuma conta cadastrada.`);
        }

        // 2. Obtém token válido
        const accessToken = await hubTokenService.getValidAccessToken(conta);
        if (!accessToken) {
            throw new Error(`Não foi possível obter token de acesso para a conta ${conta.nickname}.`);
        }

        // 3. Resolve offer_id se necessário (ex: promoções SMART requerem offer_id)
        let offerId = (options && (options.offer_id || options.ref_id)) ? String(options.offer_id || options.ref_id).trim() : null;
        if (!offerId) {
            try {
                const prodRes = await poolProdutos.query('SELECT promocoes_json FROM produtos_anuncios WHERE id_anuncio = $1', [cleanItemId]);
                if (prodRes.rows.length > 0 && prodRes.rows[0].promocoes_json) {
                    const currentPromos = typeof prodRes.rows[0].promocoes_json === 'string' 
                        ? JSON.parse(prodRes.rows[0].promocoes_json) 
                        : prodRes.rows[0].promocoes_json;
                    const activeP = (currentPromos || []).find(p => (
                        (promoId && String(p.id) === String(promoId)) || 
                        (promoType && String(p.type).toUpperCase() === String(promoType).toUpperCase())
                    ) && (p.status === 'started' || p.status === 'active'));
                    if (activeP && activeP.ref_id) {
                        offerId = activeP.ref_id;
                    }
                }
            } catch (e) {
                console.warn(`[HUB PROMOÇÕES] Não foi possível obter offer_id prévio:`, e.message);
            }
        }

        // 4. Monta URL DELETE
        let deleteUrl = `${ML_API_URL}/seller-promotions/items/${cleanItemId}?app_version=v2`;
        if (promoId) deleteUrl += `&promotion_id=${encodeURIComponent(promoId)}`;
        if (promoType) deleteUrl += `&promotion_type=${encodeURIComponent(promoType)}`;
        if (offerId) deleteUrl += `&offer_id=${encodeURIComponent(offerId)}`;

        // 5. Executa DELETE no Mercado Livre
        try {
            console.log(`[HUB PROMOÇÕES] Enviando DELETE ${deleteUrl}`);
            const response = await axios.delete(deleteUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            console.log(`[HUB PROMOÇÕES] Resposta Meli Opt-Out para ${cleanItemId}:`, response.status, response.data);
        } catch (apiErr) {
            const errData = apiErr.response?.data;
            const errMsg = errData?.message || errData?.error || apiErr.message;
            console.error(`[HUB PROMOÇÕES] Erro da API Meli no Opt-Out de ${cleanItemId}:`, errMsg, errData);
            throw new Error(`Falha no Mercado Livre: ${errMsg}`);
        }


        // 5. Busca promoções atualizadas em tempo real
        const promoResult = await this.buscarPrecoCampanha(cleanItemId, accessToken);
        const promocoesList = promoResult?.promocoes || [];
        const precoPromocional = promoResult?.precoCampanha || null;
        const promocoesJsonStr = JSON.stringify(promocoesList);

        // 6. Atualiza banco do Hub
        try {
            await poolProdutos.query(`
                UPDATE produtos_anuncios
                SET promocoes_json = $1,
                    preco_promocional = $2,
                    last_update = NOW()
                WHERE id_anuncio = $3
            `, [promocoesJsonStr, precoPromocional, cleanItemId]);
        } catch (errDb) {
            console.warn(`[HUB PROMOÇÕES] Erro ao atualizar produtos_anuncios após opt-out:`, errDb.message);
        }

        return {
            success: true,
            item_id: cleanItemId,
            preco_promocional: precoPromocional,
            promocoes: promocoesList,
            promocoes_json: promocoesJsonStr,
            conta: conta.nickname
        };
    }

    // =====================================================
    // SINCRONIZAÇÃO DE ANÚNCIOS (existente)
    // =====================================================
    /**
     * Sincronização manual disparada via endpoint.
     * Recebe um array de seller_ids e sincroniza os anúncios dessas contas,
     * independente de estarem ativas ou não.
     * Possui trava para evitar execuções simultâneas.
     */
    async sincronizarAnunciosManuais(sellerIds) {
        if (this._syncManualEmAndamento || this._isSincronizando) {
            throw new Error('SYNC_EM_ANDAMENTO');
        }

        this._syncManualEmAndamento = true;
        this._isSincronizando = true;
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
            this._isSincronizando = false;
        }
    }

    async sincronizarAnunciosEspecificos(itemIds) {
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) return 0;
        console.log(`[HUB PRODUTOS] Iniciando sincronização em tempo real de ${itemIds.length} anúncio(s) específico(s)...`);

        const cleanIds = Array.from(new Set(itemIds.map(id => String(id).trim().toUpperCase()))).filter(id => id.startsWith('MLB') || id.length >= 8);
        if (cleanIds.length === 0) return 0;

        this._isSincronizando = true;
        try {
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE OR id IN (6, 7)');

            // Divide os IDs em blocos de até 20 para requisição em lote na API do Mercado Livre
            const chunkSize = 20;
            const chunks = [];
            for (let i = 0; i < cleanIds.length; i += chunkSize) {
                chunks.push(cleanIds.slice(i, i + chunkSize));
            }

            // Processa todas as contas e blocos simultaneamente em paralelo
            const contaPromises = contasResult.rows.map(async (conta) => {
                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(conta);
                } catch (err) {
                    return 0;
                }
                if (!accessToken) return 0;

                const chunkPromises = chunks.map(async (chunk) => {
                    try {
                        const idsBatch = chunk.join(',');
                        const itemsUrl = `${ML_API_URL}/items?ids=${idsBatch}`;
                        const itemsResponse = await axios.get(itemsUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            timeout: 15000
                        });

                        const itemsResults = itemsResponse.data || [];
                        const validItems = itemsResults.filter(res => res.code === 200 && res.body && String(res.body.seller_id) === String(conta.seller_id));

                        const itemResults = await Promise.all(validItems.map(async (res) => {
                            const success = await this.processarItemCompleto(res.body, conta, accessToken);
                            return success !== false ? 1 : 0;
                        }));

                        return itemResults.reduce((acc, curr) => acc + curr, 0);
                    } catch (errChunk) {
                        console.error(`[HUB PRODUTOS] Erro ao sincronizar itens específicos ${chunk.join(',')}:`, errChunk.message);
                        return 0;
                    }
                });

                const chunkResults = await Promise.all(chunkPromises);
                return chunkResults.reduce((acc, curr) => acc + curr, 0);
            });

            const allResults = await Promise.all(contaPromises);
            const totalProcessados = allResults.reduce((acc, curr) => acc + curr, 0);

            console.log(`[HUB PRODUTOS] Sincronização específica concluída: ${totalProcessados} item(ns) processado(s) em tempo real.`);
            return totalProcessados;
        } catch (error) {
            console.error('[HUB PRODUTOS] Erro ao sincronizar anúncios específicos:', error.message);
            return 0;
        } finally {
            this._isSincronizando = false;
        }
    }

    /**
     * Sincroniza APENAS os dados de promoções para os anúncios informados.
     * Muito mais rápido que sincronizarAnunciosEspecificos pois NÃO busca tarifa, frete, ads, etc.
     * Apenas chama a API de promoções e atualiza promocoes_json + preco_promocional.
     * @param {string[]} itemIds - Array de IDs de anúncios (ex: ['MLB1234567890', ...])
     * @param {function} [onProgress] - Callback opcional (processados, total) para progresso
     * @returns {object} - { totalProcessados, totalErros, totalAtualizado }
     */
    async sincronizarPromocoesAnuncios(itemIds, onProgress = null) {
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return { totalProcessados: 0, totalErros: 0, totalAtualizado: 0 };
        }
        
        const cleanIds = Array.from(new Set(
            itemIds.map(id => String(id).trim().toUpperCase())
        )).filter(id => id.startsWith('MLB') || id.length >= 8);
        
        if (cleanIds.length === 0) {
            return { totalProcessados: 0, totalErros: 0, totalAtualizado: 0 };
        }

        console.log(`[HUB PRODUTOS PROMOS] Iniciando sincronização dedicada de promoções para ${cleanIds.length} anúncio(s)...`);
        this._isSincronizando = true;

        try {
            // Busca todas as contas ML ativas
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE OR id IN (6, 7)');
            
            // Para cada anúncio, precisamos descobrir qual conta é dona dele
            // Busca os anúncios no banco para saber a empresa de cada um
            const anunciosInfo = await poolProdutos.query(
                'SELECT id_anuncio, empresa, preco FROM produtos_anuncios WHERE id_anuncio = ANY($1)',
                [cleanIds]
            );

            // Mapeia anúncios por empresa
            const anunciosByEmpresa = {};
            for (const row of anunciosInfo.rows) {
                const emp = (row.empresa || '').toLowerCase().trim();
                if (!anunciosByEmpresa[emp]) anunciosByEmpresa[emp] = [];
                anunciosByEmpresa[emp].push({ id_anuncio: row.id_anuncio, preco: row.preco });
            }

            // Mapeia contas por nickname (lowercase trim)
            const contaByNickname = {};
            for (const conta of contasResult.rows) {
                contaByNickname[(conta.nickname || '').toLowerCase().trim()] = conta;
            }

            let totalProcessados = 0;
            let totalErros = 0;
            let totalAtualizado = 0;

            // Processa por empresa/conta
            for (const [empKey, anuncios] of Object.entries(anunciosByEmpresa)) {
                const conta = contaByNickname[empKey];
                if (!conta) {
                    console.warn(`[HUB PRODUTOS PROMOS] Conta não encontrada para empresa "${empKey}". Pulando ${anuncios.length} anúncio(s).`);
                    totalErros += anuncios.length;
                    continue;
                }

                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(conta);
                } catch (err) {
                    console.error(`[HUB PRODUTOS PROMOS] Falha de token para ${conta.nickname}. Pulando.`);
                    totalErros += anuncios.length;
                    continue;
                }
                if (!accessToken) {
                    totalErros += anuncios.length;
                    continue;
                }

                // Processa anúncios em paralelo (lotes de 20 para não sobrecarregar a API)
                const batchSize = 20;
                for (let i = 0; i < anuncios.length; i += batchSize) {
                    const batch = anuncios.slice(i, i + batchSize);
                    
                    const results = await Promise.all(batch.map(async (anuncioInfo) => {
                        const { id_anuncio, preco } = anuncioInfo;
                        try {
                            // Busca APENAS promoções (chamada leve)
                            const promoResult = await this.buscarPrecoCampanha(id_anuncio, accessToken);
                            const promocoesList = promoResult?.promocoes || [];
                            const precoCampanha = promoResult?.precoCampanha || null;

                            const promocoesJsonStr = JSON.stringify(promocoesList);

                            // Determina o preco_promocional
                            let precoPromocional = precoCampanha || null;

                            // Atualiza no banco do Hub (produtos_anuncios) — apenas colunas de promoção
                            await poolProdutos.query(`
                                UPDATE produtos_anuncios
                                SET promocoes_json = $1,
                                    preco_promocional = $2,
                                    last_update = NOW()
                                WHERE id_anuncio = $3
                            `, [promocoesJsonStr, precoPromocional, id_anuncio]);

                            return { id_anuncio, promocoesJsonStr, precoPromocional, success: true };
                        } catch (err) {
                            console.error(`[HUB PRODUTOS PROMOS] Erro ao buscar promoções de ${id_anuncio}:`, err.message);
                            return { id_anuncio, success: false };
                        }
                    }));

                    for (const r of results) {
                        if (r.success) {
                            totalProcessados++;
                            totalAtualizado++;
                        } else {
                            totalErros++;
                        }
                    }

                    if (onProgress) {
                        try { onProgress(totalProcessados + totalErros, cleanIds.length); } catch (e) { /* ignore */ }
                    }

                    // Pequeno delay entre batches para não sobrecarregar
                    if (i + batchSize < anuncios.length) {
                        await delay(150);
                    }
                }
            }

            console.log(`[HUB PRODUTOS PROMOS] Sincronização de promoções concluída: ${totalProcessados} atualizado(s), ${totalErros} erro(s).`);
            return { totalProcessados, totalErros, totalAtualizado };
        } catch (error) {
            console.error('[HUB PRODUTOS PROMOS] Erro crítico na sincronização de promoções:', error.message);
            throw error;
        } finally {
            this._isSincronizando = false;
        }
    }

    async sincronizarAnuncios() {
        if (this._isSincronizando) {
            console.log('[HUB PRODUTOS] Sincronização de anúncios já em andamento. Pulando.');
            return;
        }

        this._isSincronizando = true;
        console.log('[HUB PRODUTOS] Iniciando sincronização de anúncios...');
        try {
            // Busca contas ativas no banco principal do HUB
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE OR id IN (6, 7)');

            for (const conta of contasResult.rows) {
                await this.processarContaProdutos(conta);
            }
        } catch (error) {
            console.error('[HUB PRODUTOS] Erro crítico na sincronização:', error);
        } finally {
            this._isSincronizando = false;
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
        const idsDoScan = []; // Acumula todos os IDs que vieram do scan da API

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

                // Acumula os IDs para verificação de órfãos depois
                idsDoScan.push(...idsAnuncios);

                console.log(`Qtd. de anúncios encontrada: ${idsAnuncios.length}`);
                console.log(`Iniciando a busca aprofundada...`);

                // 2. Divide os IDs em pedaços de no máximo 2 (para evitar erro 400)
                const chunkSize = 2;
                const idChunks = [];
                for (let i = 0; i < idsAnuncios.length; i += chunkSize) {
                    idChunks.push(idsAnuncios.slice(i, i + chunkSize));
                }

                // 3. Busca e processa os detalhes em lotes controlados com respiro para evitar 429 Too Many Requests
                const results = [];
                const batchOfChunksSize = 3; // 3 chunks de 2 = 6 itens simultâneos
                for (let i = 0; i < idChunks.length; i += batchOfChunksSize) {
                    const currentChunksBatch = idChunks.slice(i, i + batchOfChunksSize);
                    const batchResults = await Promise.all(currentChunksBatch.map(async (chunk) => {
                        try {
                            const idsBatch = chunk.join(',');
                            const itemsUrl = `${ML_API_URL}/items?ids=${idsBatch}`;
                            const itemsResponse = await axios.get(itemsUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` },
                                timeout: 15000
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

                    results.push(...batchResults);

                    if (i + batchOfChunksSize < idChunks.length) {
                        await delay(200); // 200ms de respiro entre lotes de 6 anúncios
                    }
                }

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

        // Após o scan completo, verifica anúncios órfãos (existem no banco mas não vieram no scan)
        await this.verificarAnunciosOrfaos(conta, idsDoScan, accessToken);
    }

    /**
     * Verifica anúncios que existem no banco para esta conta/empresa mas que NÃO vieram no scan da API.
     * Esses anúncios podem ter sido deletados, fechados ou removidos.
     * Para cada órfão, consulta a API individualmente e, se estiver deletado, remove do banco.
     */
    async verificarAnunciosOrfaos(conta, idsDoScan, accessToken) {
        try {
            // Busca todos os IDs de anúncios desta empresa que existem no banco
            const dbResult = await poolProdutos.query(
                'SELECT id_anuncio FROM produtos_anuncios WHERE empresa = $1',
                [conta.nickname]
            );

            const idsNoBanco = dbResult.rows.map(r => r.id_anuncio);
            const idsDoScanSet = new Set(idsDoScan);

            // Encontra os órfãos: existem no banco mas não vieram no scan
            const idsOrfaos = idsNoBanco.filter(id => !idsDoScanSet.has(id));

            if (idsOrfaos.length === 0) {
                console.log(`[HUB PRODUTOS] Nenhum anúncio órfão encontrado para ${conta.nickname}.`);
                return;
            }

            console.log(`[HUB PRODUTOS] Encontrados ${idsOrfaos.length} anúncio(s) órfão(s) para ${conta.nickname}. Verificando na API...`);

            let totalExcluidos = 0;

            // Verifica os órfãos em blocos de 20 (multiget)
            const chunkSize = 20;
            for (let i = 0; i < idsOrfaos.length; i += chunkSize) {
                const chunk = idsOrfaos.slice(i, i + chunkSize);

                try {
                    const idsBatch = chunk.join(',');
                    const itemsUrl = `${ML_API_URL}/items?ids=${idsBatch}`;
                    const itemsResponse = await axios.get(itemsUrl, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });

                    const itemsResults = itemsResponse.data || [];

                    for (const res of itemsResults) {
                        const itemId = res.body?.id || null;

                        if (res.code === 404) {
                            // Item completamente purgado da API — excluir do banco
                            console.log(`[HUB PRODUTOS] Anúncio ${itemId || 'desconhecido'} retornou 404 (purgado). Excluindo...`);
                            await this.excluirProduto(itemId || chunk[itemsResults.indexOf(res)]);
                            totalExcluidos++;
                        } else if (res.code === 200 && res.body) {
                            const itemData = res.body;

                            if (this.isItemDeleted(itemData)) {
                                console.log(`[HUB PRODUTOS] Anúncio ${itemData.id} está DELETADO (status: ${itemData.status}, sub_status: ${JSON.stringify(itemData.sub_status)}). Excluindo...`);
                                await this.excluirProduto(itemData.id);
                                totalExcluidos++;
                            } else if (itemData.status === 'closed') {
                                // Fechado mas não deletado — atualiza o status no banco para refletir
                                console.log(`[HUB PRODUTOS] Anúncio ${itemData.id} está fechado (closed) mas não deletado. Atualizando status no banco...`);
                                try {
                                    let subStatusClean = null;
                                    if (Array.isArray(itemData.sub_status) && itemData.sub_status.length > 0) {
                                        subStatusClean = itemData.sub_status.join(', ');
                                    }
                                    await poolProdutos.query(
                                        'UPDATE produtos_anuncios SET status = $1, sub_status = $2, last_update = NOW() WHERE id_anuncio = $3',
                                        [itemData.status, subStatusClean, itemData.id]
                                    );
                                } catch (errUpdate) {
                                    console.error(`[HUB PRODUTOS] Erro ao atualizar status do órfão ${itemData.id}:`, errUpdate.message);
                                }
                            }
                            // Se o status for 'active' ou 'paused', pode ser que o scan tenha falhado parcialmente.
                            // Nesse caso, não faz nada — o próximo scan pegará.
                        }
                    }
                } catch (errChunk) {
                    console.error(`[HUB PRODUTOS] Erro ao verificar órfãos ${chunk.join(',')}:`, errChunk.message);
                }

                // Pequeno delay para não sobrecarregar a API
                if (i + chunkSize < idsOrfaos.length) {
                    await delay(200);
                }
            }

            console.log(`[HUB PRODUTOS] Verificação de órfãos concluída para ${conta.nickname}. Excluídos: ${totalExcluidos}`);
        } catch (err) {
            console.error(`[HUB PRODUTOS] Erro ao verificar anúncios órfãos para ${conta.nickname}:`, err.message);
        }
    }

    isItemDeleted(itemData) {
        if (!itemData) return false;

        // Normaliza o sub_status para array
        let subStatusArray = [];
        if (Array.isArray(itemData.sub_status)) {
            subStatusArray = itemData.sub_status;
        } else if (typeof itemData.sub_status === 'string') {
            subStatusArray = [itemData.sub_status];
        }

        const hasDeletedSubStatus = subStatusArray.some(s => String(s).toLowerCase().includes('deleted'));
        const hasDeletedTag = Array.isArray(itemData.tags) && itemData.tags.includes('deleted');

        // Um anúncio é considerado deletado se:
        // 1. O sub_status contém 'deleted' (independente do status), OU
        // 2. O status é 'closed' E as tags contêm 'deleted'
        return hasDeletedSubStatus || (itemData.status === 'closed' && hasDeletedTag);
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

            // Novos campos: Estoque, Prazo de Disponibilidade e ID do Produto de Catálogo
            const estoque = itemData.available_quantity || 0;
            const catalogListing = itemData.catalog_listing || false;
            const catalogProductId = itemData.catalog_product_id || (Array.isArray(itemData.variations) ? itemData.variations.find(v => v.catalog_product_id)?.catalog_product_id : null) || null;

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
                catalog_product_id: catalogProductId,
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

    async buscarTarifa(categoryId, price, logisticType, mode, listingTypeId, accessToken, idAnuncio, maxRetries = 2) {
        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                const tarifaUrl = `${ML_API_URL}/sites/MLB/listing_prices?category_id=${categoryId}&price=${price}&logistic_type=${logisticType}&shipping_modes=${mode}&listing_type_id=${listingTypeId}`;
                const response = await axios.get(tarifaUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
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
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    await delay(1500 * tentativa);
                    continue;
                }
                console.warn(`[HUB PRODUTOS] Não foi possível obter tarifa para ${idAnuncio}`);
                return { tarifa: 0, taxa_fixa: 0 };
            }
        }
    }

    async buscarFrete(sellerId, price, listingTypeId, mode, condition, logisticType, freeShipping, stateId, cityId, zipCode, altura, largura, comprimento, peso, accessToken, idAnuncio, maxRetries = 2) {
        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                const h = parseInt(altura) || 0;
                const w = parseInt(largura) || 0;
                const l = parseInt(comprimento) || 0;
                const p = parseInt(peso) || 0;
                const dimensionsStr = `${h}x${w}x${l},${p}`;

                const freteUrl = `${ML_API_URL}/users/${sellerId}/shipping_options/free?dimensions=${dimensionsStr}&item_price=${price}&listing_type_id=${listingTypeId}&mode=${mode}&condition=${condition}&logistic_type=${logisticType}&free_shipping=${freeShipping}&currency_id=BRL&state_id=${stateId}&city_id=${cityId}&zip_code=${zipCode}`;

                const response = await axios.get(freteUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
                });
                return response.data?.coverage?.all_country?.list_cost || 0;
            } catch (err) {
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    await delay(1500 * tentativa);
                    continue;
                }
                console.warn(`[HUB PRODUTOS] Não foi possível obter frete para ${idAnuncio}:`, err.response?.data?.message || err.message);
                return 0;
            }
        }
    }

    async buscarAds(idAnuncio, accessToken, maxRetries = 2) {
        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                const adsUrl = `${ML_API_URL}/advertising/MLB/product_ads/ads/${idAnuncio}`;
                const response = await axios.get(adsUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
                });
                return {
                    tem_publicidade: true,
                    preco_publicidade: response.data.metrics_summary?.cost || 0,
                    cliques_publicidade: response.data.metrics_summary?.clicks || 0
                };
            } catch (err) {
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    await delay(1500 * tentativa);
                    continue;
                }
                return {
                    tem_publicidade: false,
                    preco_publicidade: null,
                    cliques_publicidade: null
                };
            }
        }
    }

    async buscarCatalogWinner(idAnuncio, accessToken, maxRetries = 2) {
        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                const url = `${ML_API_URL}/items/${idAnuncio}/price_to_win?siteId=MLB&version=v2`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
                });
                // O retorno contém status como 'winning', 'losing' ou 'tied'.
                if (response.data && (response.data.status === 'winning' || response.data.status === 'tied' || response.data.competitors_sharing_first_place > 0)) {
                    return true;
                }
                return false;
            } catch (err) {
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    await delay(1500 * tentativa);
                    continue;
                }
                console.warn(`[HUB PRODUTOS] Erro ao buscar price_to_win do anúncio ${idAnuncio}:`, err.response?.data?.message || err.message);
                return false;
            }
        }
    }

    async buscarPrecoCampanha(idAnuncio, accessToken, maxRetries = 2) {
        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                // 1. Descobrir as promoções do anúncio (com app_version=v2, mas sem o user_id)
                const urlPromos = `${ML_API_URL}/seller-promotions/items/${idAnuncio}?app_version=v2`;
                const resPromos = await axios.get(urlPromos, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
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
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    console.warn(`[HUB PRODUTOS] Rate limit (429) em buscarPrecoCampanha para ${idAnuncio}. Aguardando 1.5s antes da tentativa ${tentativa + 1}/${maxRetries}...`);
                    await delay(1500 * tentativa);
                    continue;
                }
                console.warn(`[HUB PRODUTOS] Erro ao buscar preço de campanha para o anúncio ${idAnuncio}:`, err.response?.data?.message || err.message);
                return { precoCampanha: null, promocoes: [] };
            }
        }
    }

    async buscarDataUltimaVenda(sellerId, idAnuncio, accessToken, maxRetries = 2) {
        if (!sellerId || !idAnuncio) return { dataUltimaVenda: null, diasSemVender: null };

        for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
            try {
                const url = `${ML_API_URL}/orders/search?seller=${sellerId}&q=${idAnuncio}&sort=date_desc&limit=1`;
                const response = await axios.get(url, {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    timeout: 10000
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
                const status = err.response?.status;
                if (status === 429 && tentativa < maxRetries) {
                    await delay(1500 * tentativa);
                    continue;
                }
                console.warn(`[HUB PRODUTOS] Não foi possível buscar data da última venda para o anúncio ${idAnuncio}:`, err.message);
                return { dataUltimaVenda: null, diasSemVender: null };
            }
        }
    }

    async salvarProduto(dados) {
        const query = `
            INSERT INTO produtos_anuncios 
            (sku, descricao, id_anuncio, status, sub_status, empresa, tipo, tarifa, taxa_fixa, preco, tipo_logistica, tipo_envio, frete, tem_publicidade, preco_publicidade, cliques_publicidade, custo, custo_real, margem, peso, altura, largura, profundidade, estoque, prazo_disponibilidade, catalog_listing, ganhando_catalogo, experiencia_compra, vendas_total, preco_promocional, permalink, thumbnail, promocoes_json, qualidade, data_ultima_venda, dias_sem_vender, catalog_product_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
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
            catalog_product_id = EXCLUDED.catalog_product_id,
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
            dados.permalink, dados.thumbnail, dados.promocoes_json, dados.qualidade, dados.data_ultima_venda, dados.dias_sem_vender,
            dados.catalog_product_id || null
        ];

        try {
            await poolProdutos.query(query, values);
        } catch (error) {
            console.error(`[HUB PRODUTOS] Erro ao salvar produto ${dados.id_anuncio}:`, error.message);
        }
    }
}

module.exports = new HubProdutosService();