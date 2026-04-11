const axios = require('axios');
const { poolHub } = require('../config/database');
const AdmZip = require('adm-zip');
const hubTokenService = require('./hubTokenService');
// Constantes
const ML_API_URL = 'https://api.mercadolibre.com';

// Função auxiliar para delay (evitar rate limit)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class HubMercadoLivreService {

    /**
     * Executa a 1ª ETAPA: Captura de Novos Pedidos
     * Percorre as contas ativas e busca pedidos recentes de forma paginada.
     */
    async capturarNovosPedidos() {
        console.log('[HUB ML] Iniciando captura de novos pedidos...');

        try {
            // 1. Pega todas as contas ativas no Hub
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE');
            const contas = contasResult.rows;

            for (const conta of contas) {
                await this.processarConta(conta);
            }
        } catch (error) {
            console.error('[HUB ML] Erro crítico na captura de novos pedidos:', error);
        }
    }

    async processarConta(conta) {
        console.log(`[HUB ML] Processando conta: ${conta.nickname} (Seller ID: ${conta.seller_id})`);

        let accessToken;

        try {
            // Pega o token válido (renova se precisar) usando o serviço
            accessToken = await hubTokenService.getValidAccessToken(conta);
        } catch (errToken) {
            console.error(`[HUB ML] Conta ${conta.nickname} pulada, pois o token não foi renovado.`);
            return;
        }

        const dataLimite = new Date();
        dataLimite.setMonth(dataLimite.getMonth() - 5);

        // Variáveis de Paginação
        let offset = 0;
        const limit = 50;
        let continuarBuscando = true;

        // Loop para pegar TODAS as páginas
        try {
            while (continuarBuscando) {
                console.log(`[HUB ML] Buscando página de pedidos... (Offset: ${offset})`);

                // Busca geral de pedidos do vendedor com paginação
                const searchUrl = `${ML_API_URL}/orders/search?seller=${conta.seller_id}&sort=date_desc&limit=${limit}&offset=${offset}`;

                const response = await axios.get(searchUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                const pedidos = response.data.results || [];

                await delay(500);

                //const urlAnuncio = `${ML_API_URL}/users/617566696/items/search`;
                //const urlAnuncio = `${ML_API_URL}/users/617566696/items/search?seller_sku=46641`;
                //const urlAnuncio = `${ML_API_URL}/items/MLB2166581283`;
                //const urlAnuncio = `${ML_API_URL}/sites/MLB/listing_prices?category_id=MLB236755&price=52.79&logistic_type=cross_docking&shipping_modes=me2&listing_type_id=gold_special`;

                /*const respAnuncio = await axios.get(urlAnuncio, { 
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                console.log("ANÚNCIOS!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

                console.log(JSON.stringify(respAnuncio.data, null, 2));*/


                // Se não vier nada, acabou a lista
                if (pedidos.length === 0) {
                    console.log('[HUB ML] Nenhum pedido retornado nesta página. Finalizando busca.');
                    continuarBuscando = false;
                    break;
                }

                for (const pedidoData of pedidos) {
                    const dataPedido = new Date(pedidoData.date_created);

                    if (dataPedido < dataLimite) {
                        console.log(`[HUB ML] Pedido ${pedidoData.id} é de ${dataPedido.toLocaleDateString()}. Limite de 5 meses atingido.`);
                        console.log('[HUB ML] Parando busca para esta conta.');
                        continuarBuscando = false; // Desliga o loop While
                        break; // Sai do loop For imediatamente
                    }

                    // Verificação de existência para não duplicar (Idempotência)
                    const exists = await this.verificarSePedidoExiste(pedidoData.id);
                    if (exists) {
                        //console.log(`[HUB ML] Pedido ${pedidoData.id} já existe. Pulando...`);
                        continue;
                    }

                    const itensMapeados = (pedidoData.order_items || []).map(itemWrapper => {
                        const item = itemWrapper.item;
                        return {
                            id_item: item.id,
                            sku: item.seller_sku || null, // O SKU que você quer
                            titulo: item.title,           // A descrição
                            quantidade: itemWrapper.quantity,
                            preco_unitario: itemWrapper.unit_price,
                            taxa_venda: itemWrapper.sale_fee
                        };
                    });

                    // Objeto base para salvar
                    const novoPedido = {
                        conta_id: conta.id,
                        id_pedido_ml: pedidoData.id,
                        date_created: pedidoData.date_created,
                        status_pedido: pedidoData.status,
                        data_limite_envio: null,
                        id_envio_ml: null,
                        status_envio: null,
                        etiqueta_zpl: null,
                        itens_pedido: JSON.stringify(itensMapeados),
                        comprador_nickname: pedidoData.buyer?.nickname || null,
                        tem_dev: false,
                        tem_med: false,
                        status_dev: null,
                        status_med: null,
                        id_envio_dev: null,
                        status_envio_dev: null,
                        frete_envio: null
                    };

                    // Captura a data limite de envio
                    if (pedidoData.shipping_option?.estimated_handling_limit?.date) {
                        novoPedido.data_limite_envio = pedidoData.shipping_option.estimated_handling_limit.date;
                    }

                    if (pedidoData.shipping?.id) {
                        try {
                            await delay(200);
                            const envioUrl = `${ML_API_URL}/shipments/${pedidoData.shipping.id}`;
                            const envioResponse = await axios.get(envioUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });

                            const envioData = envioResponse.data;

                            if (envioData) {
                                novoPedido.id_envio_ml = envioData.id;
                                novoPedido.status_envio = envioData.status;

                                // --- CAPTURA ISOLADA DE CUSTO (FRETE) ---
                                try {
                                    const freteUrl = `${ML_API_URL}/shipments/${envioData.id}/costs`;
                                    const freteRes = await axios.get(freteUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    novoPedido.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                                } catch (freteError) {
                                    // Silencioso: Se falhar, fica como null
                                }

                                // --- CAPTURA ISOLADA DE SLA ---
                                try {
                                    const limiteEnvioUrl = `${ML_API_URL}/shipments/${envioData.id}/sla`;
                                    const limiteEnvio = await axios.get(limiteEnvioUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    const limiteEnvioData = Array.isArray(limiteEnvio.data) ? limiteEnvio.data[0] : limiteEnvio.data;

                                    if (limiteEnvioData.expected_date) {
                                        novoPedido.data_limite_envio = limiteEnvioData.expected_date;
                                    }
                                } catch (slaError) {
                                    // Silencioso: Se falhar, usará a data do handling_limit ou null
                                }

                                const shippingOption = envioData.shipping_option || {};
                                const statusHistory = envioData.status_history || {};

                                // 1. Data de Envio Agendado
                                if (shippingOption.buffering?.date) {
                                    const dataBuffering = new Date(shippingOption.buffering.date);
                                    const hoje = new Date();
                                    hoje.setHours(0, 0, 0, 0);
                                    dataBuffering.setHours(0, 0, 0, 0);

                                    if (dataBuffering > hoje) {
                                        novoPedido.data_envio_agendado = shippingOption.buffering.date;
                                    } else {
                                        novoPedido.data_envio_agendado = null;
                                    }
                                }

                                // 2. Data de Envio Disponível
                                if (statusHistory.date_ready_to_ship) {
                                    novoPedido.data_envio_disponivel = statusHistory.date_ready_to_ship;
                                }

                                // 3. Data Previsão de Entrega
                                if (shippingOption.estimated_delivery_time?.date) {
                                    novoPedido.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                                }

                                // --- CAPTURA DA ETIQUETA (ZPL) ---
                                const deveBaixarEtiqueta = envioData.logistic_type !== 'fulfillment' && 
                                    (envioData.status === 'ready_to_ship' || envioData.status === 'shipped');

                                if (deveBaixarEtiqueta) {
                                    await delay(300);
                                    const zplUrl = `${ML_API_URL}/shipment_labels?shipment_ids=${novoPedido.id_envio_ml}&response_type=zpl2`;

                                    try {
                                        const zplResponse = await axios.get(zplUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` },
                                            responseType: 'arraybuffer'
                                        });

                                        let conteudoEtiqueta = zplResponse.data;

                                        if (conteudoEtiqueta && conteudoEtiqueta[0] === 0x50 && conteudoEtiqueta[1] === 0x4B) {
                                            try {
                                                const zip = new AdmZip(conteudoEtiqueta);
                                                const zipEntries = zip.getEntries();
                                                const textoEntry = zipEntries.find(entry =>
                                                    entry.entryName.toLowerCase().endsWith('.txt') ||
                                                    entry.entryName.toLowerCase().endsWith('.zpl')
                                                );

                                                if (textoEntry) {
                                                    conteudoEtiqueta = zip.readAsText(textoEntry, 'utf8');
                                                } else {
                                                    conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                                }
                                            } catch (zipErr) {
                                                console.error('[HUB ML] Erro ao descompactar ZIP:', zipErr.message);
                                                conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                            }
                                        } else {
                                            conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                        }

                                        novoPedido.etiqueta_zpl = conteudoEtiqueta;

                                    } catch (zplError) {
                                        console.warn(`[HUB ML] Falha ZPL pedido ${novoPedido.id_pedido_ml}: ${zplError.message}`);
                                    }
                                }
                            }
                        } catch (envioError) {
                            console.warn(`[HUB ML] Envio inacessível para o pedido ${novoPedido.id_pedido_ml}. Prosseguindo sem dados adicionais de logística.`);
                        }
                    }

                    // Busca devoluções e mediações para pedidos novos
                    const detalhesReclamacao = await this.buscarDetalhesReclamacao(novoPedido.id_pedido_ml, accessToken);
                    Object.assign(novoPedido, detalhesReclamacao); // Mescla os resultados no objeto

                    // Salvar no banco
                    await this.salvarPedidoNoBanco(novoPedido);
                }

                // Lógica de controle do loop
                if (pedidos.length < limit) {
                    continuarBuscando = false;
                } else {
                    offset += limit;
                }

                if (offset > 500) {
                    console.log('[HUB ML] Limite de segurança de paginação atingido (10k pedidos). Parando.');
                    continuarBuscando = false;
                }

                await delay(500);
            }

        } catch (error) {
            console.error(`[HUB ML] Erro ao processar conta ${conta.nickname}:`, error.message);
        }
    }

    /**
     * Executa a 2ª ETAPA: Monitoramento Inteligente
     * Recaptura TODOS os dados dos pedidos recentes para garantir integridade.
     */
    async monitorarPedidosExistentes() {
        console.log('[HUB ML] Iniciando monitoramento (Recaptura Completa)...');
        const client = await poolHub.connect();

        try {
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.status_pedido NOT IN ('cancelled')
                AND p.status_envio NOT IN ('cancelled', 'delivered')
                AND p.status_envio IN ('pending', 'ready_to_ship')
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de ${pedidosParaChecar.length} pedidos mais antigos...`);

            for (const pedido of pedidosParaChecar) {

                const contaMock = {
                    id: pedido.conta_id_real,
                    nickname: pedido.nickname,
                    refresh_token: pedido.refresh_token,
                    token_expiration: pedido.token_expiration,
                    access_token: pedido.access_token
                };

                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(contaMock);
                } catch (e) {
                    console.error(`[HUB ML] Erro de token ao monitorar pedido ${pedido.id_pedido_ml}. Pulando.`);
                    continue;
                }

                try {
                    await delay(150);
                    let dadosAtualizados = null;

                    try {
                        // TENTATIVA 1: Rota direta
                        const checkOrderUrl = `${ML_API_URL}/orders/${pedido.id_pedido_ml}`;
                        const orderRes = await axios.get(checkOrderUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        dadosAtualizados = orderRes.data;

                    } catch (error) {
                        // TENTATIVA 2: Fallback em caso de pedido "Fantasma" (404) ou vazamento de escopo (403)
                        if (error.response && (error.response.status === 404 || error.response.status === 403)) {
                            console.warn(`[HUB ML] Pedido ${pedido.id_pedido_ml} retornou ${error.response.status}. Iniciando fallback de busca...`);
                            
                            try {
                                const searchUrl = `${ML_API_URL}/orders/search?seller=${pedido.seller_id}&q=${pedido.id_pedido_ml}`;
                                const searchRes = await axios.get(searchUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });

                                if (searchRes.data.results && searchRes.data.results.length > 0) {
                                    dadosAtualizados = searchRes.data.results[0];
                                    console.log(`[HUB ML] Sucesso! Pedido ${pedido.id_pedido_ml} resgatado pelo fallback.`);
                                } else {
                                    console.error(`[HUB ML] Pedido ${pedido.id_pedido_ml} expurgado do ML. Pulando.`);
                                    continue; // Pula para o próximo pedido
                                }
                            } catch (searchError) {
                                console.error(`[HUB ML] Erro no fallback de busca do pedido ${pedido.id_pedido_ml}:`, searchError.message);
                                continue;
                            }
                        } else {
                            // Erros 500 ou instabilidades da API
                            console.error(`[HUB ML] Erro inesperado ao buscar pedido ${pedido.id_pedido_ml}:`, error.message);
                            continue;
                        }
                    }

                    // Se por algum motivo bizarro chegou aqui sem dados, interrompe o fluxo deste pedido
                    if (!dadosAtualizados) continue;

                    // Recriamos o objeto completo para garantir UPDATE total
                    const pedidoAtualizado = {
                        conta_id: pedido.conta_id_real,
                        id_pedido_ml: dadosAtualizados.id,
                        date_created: dadosAtualizados.date_created,
                        status_pedido: dadosAtualizados.status,
                        data_limite_envio: null,
                        id_envio_ml: null,
                        status_envio: null,
                        etiqueta_zpl: pedido.etiqueta_zpl,
                        comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                        frete_envio: null,
                        // Mantém os dados antigos por precaução até a nova verificação
                        tem_dev: pedido.tem_dev || false,
                        tem_med: pedido.tem_med || false,
                        status_dev: pedido.status_dev || null,
                        status_med: pedido.status_med || null,
                        id_envio_dev: pedido.id_envio_dev || null,
                        status_envio_dev: pedido.status_envio_dev || null
                    };

                    // Re-mapeamento de Itens (Caso tenha mudado algo)
                    const itensMapeados = (dadosAtualizados.order_items || []).map(itemWrapper => {
                        const item = itemWrapper.item;
                        return {
                            id_item: item.id,
                            sku: item.seller_sku || null,
                            titulo: item.title,
                            quantidade: itemWrapper.quantity,
                            preco_unitario: itemWrapper.unit_price,
                            taxa_venda: itemWrapper.sale_fee
                        };
                    });
                    pedidoAtualizado.itens_pedido = JSON.stringify(itensMapeados);

                    // Captura de Envio e Datas
                    if (dadosAtualizados.shipping?.id) {
                        try {
                            const envioUrl = `${ML_API_URL}/shipments/${dadosAtualizados.shipping.id}`;
                            const envioRes = await axios.get(envioUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            const envioData = envioRes.data;
                            
                            if (envioData) {
                                pedidoAtualizado.id_envio_ml = envioData.id;
                                pedidoAtualizado.status_envio = envioData.status;

                                try {
                                    const freteUrl = `${ML_API_URL}/shipments/${envioData.id}/costs`;
                                    const freteRes = await axios.get(freteUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    pedidoAtualizado.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                                } catch (freteError) {
                                    // Silencioso: Se falhar, fica como null
                                }

                                // Isola a busca de SLA, pois pode dar 404 independentemente
                                try {
                                    const limiteEnvioUrl = `${ML_API_URL}/shipments/${envioData.id}/sla`;
                                    const limiteEnvio = await axios.get(limiteEnvioUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    const limiteEnvioData = Array.isArray(limiteEnvio.data) ? limiteEnvio.data[0] : limiteEnvio.data;
                                    
                                    if (limiteEnvioData.expected_date) {
                                        pedidoAtualizado.data_limite_envio = limiteEnvioData.expected_date;
                                    }
                                } catch (slaError) {
                                    // Silencioso, apenas não preenche o SLA
                                }

                                const shippingOption = envioData.shipping_option || {};
                                const statusHistory = envioData.status_history || {};

                                // 1. Data de Envio Agendado
                                if (shippingOption.buffering?.date) {
                                    const dataBuffering = new Date(shippingOption.buffering.date);
                                    const hoje = new Date();
                                    hoje.setHours(0, 0, 0, 0);
                                    dataBuffering.setHours(0, 0, 0, 0);

                                    if (dataBuffering > hoje) {
                                        pedidoAtualizado.data_envio_agendado = shippingOption.buffering.date;
                                    } else {
                                        pedidoAtualizado.data_envio_agendado = null;
                                    }
                                }

                                // 2. Data de Envio Disponível (Quando ficou 'ready_to_ship')
                                if (statusHistory.date_ready_to_ship) {
                                    pedidoAtualizado.data_envio_disponivel = statusHistory.date_ready_to_ship;
                                }

                                // 4. Data Previsão de Entrega (Para o cliente final)
                                if (shippingOption.estimated_delivery_time?.date) {
                                    pedidoAtualizado.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                                }

                                // --- CAPTURA DE ETIQUETA NO MONITORAMENTO ---
                                // Tenta baixar se não tiver ou se o status mudou para pronto
                                const deveBaixarEtiqueta = !pedido.etiqueta_zpl &&
                                    envioData.logistic_type !== 'fulfillment' &&
                                    (envioData.status === 'ready_to_ship' || envioData.status === 'shipped');

                                if (deveBaixarEtiqueta) {
                                    await delay(300);
                                    try {
                                        const zplUrl = `${ML_API_URL}/shipment_labels?shipment_ids=${pedidoAtualizado.id_envio_ml}&response_type=zpl2`;
                                        const zplResponse = await axios.get(zplUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` },
                                            responseType: 'arraybuffer'
                                        });

                                        let conteudoEtiqueta = zplResponse.data;
                                        // Tratamento ZIP
                                        if (conteudoEtiqueta && conteudoEtiqueta[0] === 0x50 && conteudoEtiqueta[1] === 0x4B) {
                                            const zip = new AdmZip(conteudoEtiqueta);
                                            const zipEntries = zip.getEntries();
                                            const textoEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.txt') || entry.entryName.toLowerCase().endsWith('.zpl'));
                                            if (textoEntry) {
                                                conteudoEtiqueta = zip.readAsText(textoEntry, 'utf8');
                                            } else {
                                                conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                            }
                                        } else {
                                            conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                        }
                                        pedidoAtualizado.etiqueta_zpl = conteudoEtiqueta;
                                        console.log(`[HUB ML] Etiqueta capturada tardiamente para ${pedidoAtualizado.id_pedido_ml}`);
                                    } catch (errLabel) {
                                        // Silencioso se der erro, tenta na próxima
                                    }
                                }
                            }
                        } catch (envioError) {
                            console.warn(`[HUB ML] Envio inacessível para o pedido ${pedidoAtualizado.id_pedido_ml} (Provavelmente expurgado). Prosseguindo com dados básicos.`);
                        }
                    }

                    // --- CAPTURA DE DEVOLUÇÕES NO MONITORAMENTO ---
                    /*const detalhesReclamacaoMonitoramento = await this.buscarDetalhesReclamacao(pedidoAtualizado.id_pedido_ml, accessToken);
                    Object.assign(pedidoAtualizado, detalhesReclamacaoMonitoramento);*/

                    // Salva TUDO (Atualiza datas, itens, etiquetas, status e DEVOLUÇÕES)
                    await this.salvarPedidoNoBanco(pedidoAtualizado);

                } catch (err) {
                    console.error(`[HUB ML] Erro ao monitorar/atualizar pedido ${pedido.id_pedido_ml}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[HUB ML] Erro no monitoramento:', error);
        } finally {
            client.release();
        }
    }

    async monitorarPedidosExistentesTotal() {
        console.log('[HUB ML] Iniciando monitoramento TOTAL (Recaptura Completa)...');
        const client = await poolHub.connect();

        try {
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.status_pedido NOT IN ('cancelled')
                AND p.status_envio NOT IN ('cancelled', 'delivered')
                AND p.date_created >= NOW() - INTERVAL '30 days'
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de ${pedidosParaChecar.length} pedidos mais antigos...`);

            for (const pedido of pedidosParaChecar) {

                const contaMock = {
                    id: pedido.conta_id_real,
                    nickname: pedido.nickname,
                    refresh_token: pedido.refresh_token,
                    token_expiration: pedido.token_expiration,
                    access_token: pedido.access_token
                };

                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(contaMock);
                } catch (e) {
                    console.error(`[HUB ML] Erro de token ao monitorar pedido ${pedido.id_pedido_ml}. Pulando.`);
                    continue;
                }

                try {
                    await delay(150);
                    let dadosAtualizados = null;

                    try {
                        // TENTATIVA 1: Rota direta
                        const checkOrderUrl = `${ML_API_URL}/orders/${pedido.id_pedido_ml}`;
                        const orderRes = await axios.get(checkOrderUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        dadosAtualizados = orderRes.data;

                    } catch (error) {
                        // TENTATIVA 2: Fallback em caso de pedido "Fantasma" (404) ou vazamento de escopo (403)
                        if (error.response && (error.response.status === 404 || error.response.status === 403)) {
                            console.warn(`[HUB ML] Pedido ${pedido.id_pedido_ml} retornou ${error.response.status}. Iniciando fallback de busca...`);
                            
                            try {
                                const searchUrl = `${ML_API_URL}/orders/search?seller=${pedido.seller_id}&q=${pedido.id_pedido_ml}`;
                                const searchRes = await axios.get(searchUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });

                                if (searchRes.data.results && searchRes.data.results.length > 0) {
                                    dadosAtualizados = searchRes.data.results[0];
                                    console.log(`[HUB ML] Sucesso! Pedido ${pedido.id_pedido_ml} resgatado pelo fallback.`);
                                } else {
                                    console.error(`[HUB ML] Pedido ${pedido.id_pedido_ml} expurgado do ML. Pulando.`);
                                    continue; // Pula para o próximo pedido
                                }
                            } catch (searchError) {
                                console.error(`[HUB ML] Erro no fallback de busca do pedido ${pedido.id_pedido_ml}:`, searchError.message);
                                continue;
                            }
                        } else {
                            // Erros 500 ou instabilidades da API
                            console.error(`[HUB ML] Erro inesperado ao buscar pedido ${pedido.id_pedido_ml}:`, error.message);
                            continue;
                        }
                    }

                    // Se por algum motivo bizarro chegou aqui sem dados, interrompe o fluxo deste pedido
                    if (!dadosAtualizados) continue;

                    // Recriamos o objeto completo para garantir UPDATE total
                    const pedidoAtualizado = {
                        conta_id: pedido.conta_id_real,
                        id_pedido_ml: dadosAtualizados.id,
                        date_created: dadosAtualizados.date_created,
                        status_pedido: dadosAtualizados.status,
                        data_limite_envio: null,
                        id_envio_ml: null,
                        status_envio: null,
                        etiqueta_zpl: pedido.etiqueta_zpl,
                        comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                        frete_envio: null,
                        // Mantém os dados antigos por precaução até a nova verificação
                        tem_dev: pedido.tem_dev || false,
                        tem_med: pedido.tem_med || false,
                        status_dev: pedido.status_dev || null,
                        status_med: pedido.status_med || null,
                        id_envio_dev: pedido.id_envio_dev || null,
                        status_envio_dev: pedido.status_envio_dev || null
                    };

                    // Re-mapeamento de Itens (Caso tenha mudado algo)
                    const itensMapeados = (dadosAtualizados.order_items || []).map(itemWrapper => {
                        const item = itemWrapper.item;
                        return {
                            id_item: item.id,
                            sku: item.seller_sku || null,
                            titulo: item.title,
                            quantidade: itemWrapper.quantity,
                            preco_unitario: itemWrapper.unit_price,
                            taxa_venda: itemWrapper.sale_fee
                        };
                    });
                    pedidoAtualizado.itens_pedido = JSON.stringify(itensMapeados);

                    // Captura de Envio e Datas (Lógica Replicada da Captura)
                    if (dadosAtualizados.shipping?.id) {
                        try {
                            const envioUrl = `${ML_API_URL}/shipments/${dadosAtualizados.shipping.id}`;
                            const envioRes = await axios.get(envioUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            const envioData = envioRes.data;

                            if (envioData) {
                                pedidoAtualizado.id_envio_ml = envioData.id;
                                pedidoAtualizado.status_envio = envioData.status;

                                try {
                                    const freteUrl = `${ML_API_URL}/shipments/${envioData.id}/costs`;
                                    const freteRes = await axios.get(freteUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    pedidoAtualizado.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                                } catch (freteError) {
                                    // Silencioso: Se falhar, fica como null
                                }

                                // Isola a busca de SLA, pois pode dar 404 independentemente
                                try {
                                    const limiteEnvioUrl = `${ML_API_URL}/shipments/${envioData.id}/sla`;
                                    const limiteEnvio = await axios.get(limiteEnvioUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    const limiteEnvioData = Array.isArray(limiteEnvio.data) ? limiteEnvio.data[0] : limiteEnvio.data;
                                    
                                    if (limiteEnvioData.expected_date) {
                                        pedidoAtualizado.data_limite_envio = limiteEnvioData.expected_date;
                                    }
                                } catch (slaError) {
                                    // Silencioso, apenas não preenche o SLA
                                }

                                const shippingOption = envioData.shipping_option || {};
                                const statusHistory = envioData.status_history || {};

                                // 1. Data de Envio Agendado
                                if (shippingOption.buffering?.date) {
                                    const dataBuffering = new Date(shippingOption.buffering.date);
                                    const hoje = new Date();
                                    hoje.setHours(0, 0, 0, 0);
                                    dataBuffering.setHours(0, 0, 0, 0);

                                    if (dataBuffering > hoje) {
                                        pedidoAtualizado.data_envio_agendado = shippingOption.buffering.date;
                                    } else {
                                        pedidoAtualizado.data_envio_agendado = null;
                                    }
                                }

                                // 2. Data de Envio Disponível (Quando ficou 'ready_to_ship')
                                if (statusHistory.date_ready_to_ship) {
                                    pedidoAtualizado.data_envio_disponivel = statusHistory.date_ready_to_ship;
                                }

                                // 4. Data Previsão de Entrega (Para o cliente final)
                                if (shippingOption.estimated_delivery_time?.date) {
                                    pedidoAtualizado.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                                }

                                // --- CAPTURA DE ETIQUETA NO MONITORAMENTO ---
                                // Tenta baixar se não tiver ou se o status mudou para pronto
                                const deveBaixarEtiqueta = !pedido.etiqueta_zpl &&
                                    envioData.logistic_type !== 'fulfillment' &&
                                    (envioData.status === 'ready_to_ship' || envioData.status === 'shipped');

                                if (deveBaixarEtiqueta) {
                                    await delay(300);
                                    try {
                                        const zplUrl = `${ML_API_URL}/shipment_labels?shipment_ids=${pedidoAtualizado.id_envio_ml}&response_type=zpl2`;
                                        const zplResponse = await axios.get(zplUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` },
                                            responseType: 'arraybuffer'
                                        });

                                        let conteudoEtiqueta = zplResponse.data;
                                        // Tratamento ZIP
                                        if (conteudoEtiqueta && conteudoEtiqueta[0] === 0x50 && conteudoEtiqueta[1] === 0x4B) {
                                            const zip = new AdmZip(conteudoEtiqueta);
                                            const zipEntries = zip.getEntries();
                                            const textoEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.txt') || entry.entryName.toLowerCase().endsWith('.zpl'));
                                            if (textoEntry) {
                                                conteudoEtiqueta = zip.readAsText(textoEntry, 'utf8');
                                            } else {
                                                conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                            }
                                        } else {
                                            conteudoEtiqueta = conteudoEtiqueta.toString('utf8');
                                        }
                                        pedidoAtualizado.etiqueta_zpl = conteudoEtiqueta;
                                        console.log(`[HUB ML] Etiqueta capturada tardiamente para ${pedidoAtualizado.id_pedido_ml}`);
                                    } catch (errLabel) {
                                        // Silencioso se der erro, tenta na próxima
                                    }
                                }
                            }
                        } catch (envioError) {
                            console.warn(`[HUB ML] Envio inacessível para o pedido ${pedidoAtualizado.id_pedido_ml} (Provavelmente expurgado). Prosseguindo com dados básicos.`);
                        }
                    }

                    // --- CAPTURA DE DEVOLUÇÕES NO MONITORAMENTO ---
                    /*const detalhesReclamacaoMonitoramento = await this.buscarDetalhesReclamacao(pedidoAtualizado.id_pedido_ml, accessToken);
                    Object.assign(pedidoAtualizado, detalhesReclamacaoMonitoramento);*/

                    // Salva TUDO (Atualiza datas, itens, etiquetas, status e DEVOLUÇÕES)
                    await this.salvarPedidoNoBanco(pedidoAtualizado);

                } catch (err) {
                    console.error(`[HUB ML] Erro ao monitorar/atualizar pedido ${pedido.id_pedido_ml}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[HUB ML] Erro no monitoramento:', error);
        } finally {
            client.release();
        }
    }

    /**
     * Executa a 3ª ETAPA: Monitoramento Exclusivo de Devoluções e Mediações
     * Busca pedidos até 90 dias atrás (incluindo entregues) para checar claims.
     */
    async monitorarDevolucoes() {
        console.log('[HUB ML] Iniciando monitoramento exclusivo de devoluções e mediações...');
        const client = await poolHub.connect();

        try {
            const query = `
                SELECT p.id_pedido_ml, p.conta_id, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.nickname 
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.date_created >= NOW() - INTERVAL '30 days'
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de devoluções com os ${pedidosParaChecar.length} pedidos mais antigos...`);

            for (const pedido of pedidosParaChecar) {
                const contaMock = {
                    id: pedido.conta_id_real,
                    nickname: pedido.nickname,
                    refresh_token: pedido.refresh_token,
                    token_expiration: pedido.token_expiration,
                    access_token: pedido.access_token
                };

                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(contaMock);
                } catch (e) {
                    console.error(`[HUB ML] Erro de token ao checar devoluções do pedido ${pedido.id_pedido_ml}. Pulando.`);
                    continue;
                }

                try {
                    const detalhesReclamacao = await this.buscarDetalhesReclamacao(pedido.id_pedido_ml, accessToken);

                    // Atualizamos o registro para sincronizar os dados da reclamação e colocar o last_update para o fim do rodízio
                    const updateQuery = `
                        UPDATE pedidos_mercado_livre SET 
                            tem_dev = $1, tem_med = $2, status_dev = $3, status_med = $4, 
                            id_envio_dev = $5, status_envio_dev = $6, last_update = NOW()
                        WHERE id_pedido_ml = $7
                    `;
                    await client.query(updateQuery, [
                        detalhesReclamacao.tem_dev, detalhesReclamacao.tem_med,
                        detalhesReclamacao.status_dev, detalhesReclamacao.status_med,
                        detalhesReclamacao.id_envio_dev, detalhesReclamacao.status_envio_dev,
                        String(pedido.id_pedido_ml)
                    ]);

                    if (detalhesReclamacao.tem_dev || detalhesReclamacao.tem_med) {
                        console.log(`[HUB ML] Devolução/Mediação detectada e atualizada para o pedido ${pedido.id_pedido_ml}`);
                    }
                } catch (err) {
                    console.error(`[HUB ML] Erro ao buscar devolução para o pedido ${pedido.id_pedido_ml}:`, err.message);
                }
            }
        } catch (error) {
            console.error('[HUB ML] Erro no monitoramento de devoluções:', error);
        } finally {
            client.release();
            this.monitorarPedidosExistentesTotal();
        }
    }

    // --- Métodos Auxiliares de Banco ---

    async buscarDetalhesReclamacao(idPedidoMl, accessToken) {
        let detalhes = {
            tem_dev: false, tem_med: false,
            status_dev: null, status_med: null,
            id_envio_dev: null, status_envio_dev: null
        };

        try {
            await delay(150); // Evitar rate limit
            const searchUrl = `${ML_API_URL}/post-purchase/v1/claims/search?resource=order&resource_id=${idPedidoMl}`;
            const response = await axios.get(searchUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const claims = response.data.data || [];

            if (claims.length > 0) {
                // Pegamos a primeira reclamação (a mais ativa/recente)
                const claim = claims[0];

                // Verifica Mediação
                if (claim.type === 'mediations') {
                    detalhes.tem_med = true;
                    detalhes.status_med = claim.status;
                }

                // Verifica Devolução: tenta buscar sempre os dados logísticos do frete reverso
                try {
                    await delay(150);
                    const returnUrl = `${ML_API_URL}/post-purchase/v2/claims/${claim.id}/returns`;
                    const returnRes = await axios.get(returnUrl, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });

                    const logistica = returnRes.data;

                    // Se a chamada retornou dados com sucesso, ENTÃO existe uma devolução
                    if (logistica) {
                        detalhes.tem_dev = true;
                        detalhes.status_dev = claim.status; // O status da devolução é o status geral do claim

                        // Navega no array shipments para pegar a etiqueta e status de envio reverso
                        if (logistica.shipments && logistica.shipments.length > 0) {
                            const shipmentReverso = logistica.shipments[0];
                            detalhes.id_envio_dev = shipmentReverso.shipment_id ? String(shipmentReverso.shipment_id) : null;
                            detalhes.status_envio_dev = shipmentReverso.status || null;
                        }
                    }
                } catch (errReturn) {
                    // Silencioso: Se der erro (ex: 404), significa que não tem devolução atrelada a esse claim,
                    // ou ela é apenas uma reclamação simples.
                }
            }
        } catch (error) {
            console.warn(`[HUB ML] Erro ao buscar reclamações do pedido ${idPedidoMl}:`, error.message);
        }

        return detalhes;
    }

    async verificarSePedidoExiste(idPedidoMl) {
        const res = await poolHub.query('SELECT 1 FROM pedidos_mercado_livre WHERE id_pedido_ml = $1', [String(idPedidoMl)]);
        return res.rowCount > 0;
    }

    async salvarPedidoNoBanco(pedido) {
        const etiquetaLimpa = pedido.etiqueta_zpl
            ? pedido.etiqueta_zpl.replace(/\u0000/g, '')
            : null;

        const query = `
            INSERT INTO pedidos_mercado_livre 
            (conta_id, id_pedido_ml, date_created, status_pedido, data_limite_envio, id_envio_ml, status_envio, etiqueta_zpl, itens_pedido, comprador_nickname, data_envio_disponivel, data_envio_agendado, data_previsao_entrega, tem_dev, tem_med, status_dev, status_med, id_envio_dev, status_envio_dev, frete_envio)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            ON CONFLICT (id_pedido_ml) DO UPDATE SET
            status_pedido = EXCLUDED.status_pedido,
            status_envio = EXCLUDED.status_envio,
            data_limite_envio = EXCLUDED.data_limite_envio,
            data_envio_disponivel = EXCLUDED.data_envio_disponivel,
            data_envio_agendado = EXCLUDED.data_envio_agendado,
            data_previsao_entrega = EXCLUDED.data_previsao_entrega,
            etiqueta_zpl = EXCLUDED.etiqueta_zpl,
            itens_pedido = EXCLUDED.itens_pedido,
            comprador_nickname = EXCLUDED.comprador_nickname,
            tem_dev = EXCLUDED.tem_dev,
            tem_med = EXCLUDED.tem_med,
            status_dev = EXCLUDED.status_dev,
            status_med = EXCLUDED.status_med,
            id_envio_dev = EXCLUDED.id_envio_dev,
            status_envio_dev = EXCLUDED.status_envio_dev,
            frete_envio = EXCLUDED.frete_envio,
            last_update = NOW()
        `;

        const values = [
            pedido.conta_id,
            String(pedido.id_pedido_ml),
            pedido.date_created,
            pedido.status_pedido,
            pedido.data_limite_envio,
            pedido.id_envio_ml ? String(pedido.id_envio_ml) : null,
            pedido.status_envio,
            etiquetaLimpa,
            pedido.itens_pedido,
            pedido.comprador_nickname,
            pedido.data_envio_disponivel,
            pedido.data_envio_agendado,
            pedido.data_previsao_entrega,
            pedido.tem_dev || false,
            pedido.tem_med || false,
            pedido.status_dev || null,
            pedido.status_med || null,
            pedido.id_envio_dev || null,
            pedido.status_envio_dev || null,
            pedido.frete_envio || null
        ];

        try {
            await poolHub.query(query, values);
        } catch (error) {
            console.error(`[HUB ML] Erro ao inserir pedido ${pedido.id_pedido_ml}:`, error.message);
        }
    }
}

module.exports = new HubMercadoLivreService();