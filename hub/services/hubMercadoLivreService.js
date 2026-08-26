const axios = require('axios');
const { poolHub } = require('../config/database');
const AdmZip = require('adm-zip');
const { PDFDocument } = require('pdf-lib');
const hubTokenService = require('./hubTokenService');
// Constantes
const ML_API_URL = 'https://api.mercadolibre.com';

// Função auxiliar para delay (evitar rate limit)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class HubMercadoLivreService {

    /**
     * Resolve o status_envio considerando o histórico de substatus para pegar 'picked_up' 
     * mesmo quando o status principal do ML ficou travado em 'ready_to_ship'.
     */
    resolverStatusEnvio(envioData) {
        if (!envioData || !envioData.status) return null;
        let status = envioData.status;
        if (status === 'ready_to_ship' && envioData.substatus_history) {
            const hasPickedUp = envioData.substatus_history.some(h => h.substatus === 'picked_up');
            if (hasPickedUp) {
                status = 'picked_up';
            }
        }
        return status;
    }

    /**
     * Executa a 1ª ETAPA: Captura de Novos Pedidos

     * Percorre as contas ativas e busca pedidos recentes de forma paginada.
     */
    async capturarNovosPedidos() {
        console.log('[HUB ML] Iniciando captura de novos pedidos...');

        try {
            // 1. Pega todas as contas ativas no Hub
            const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = TRUE AND id NOT IN (6, 7)');
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

                let pedidosParaProcessar = [];
                for (const pedidoData of pedidos) {
                    const dataPedido = new Date(pedidoData.date_created);

                    if (dataPedido < dataLimite) {
                        console.log(`[HUB ML] Pedido ${pedidoData.id} é de ${dataPedido.toLocaleDateString()}. Limite de 5 meses atingido.`);
                        console.log('[HUB ML] Parando busca para esta conta.');
                        continuarBuscando = false; // Desliga o loop While
                        break; // Sai do loop For imediatamente
                    }
                    pedidosParaProcessar.push(pedidoData);
                }

                const chunkSize = 20;
                for (let i = 0; i < pedidosParaProcessar.length; i += chunkSize) {
                    const chunk = pedidosParaProcessar.slice(i, i + chunkSize);
                    await Promise.all(chunk.map(async (pedidoData) => {

                        // Verificação de existência para não duplicar (Idempotência)
                        const exists = await this.verificarSePedidoExiste(pedidoData.id);
                        if (exists) {
                            //console.log(`[HUB ML] Pedido ${pedidoData.id} já existe. Pulando...`);
                            return;
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
                            tipo_envio: null,
                            etiqueta_zpl: null,
                            itens_pedido: JSON.stringify(itensMapeados),
                            comprador_nickname: pedidoData.buyer?.nickname || null,
                            tem_dev: false,
                            tem_med: false,
                            status_dev: null,
                            status_med: null,
                            id_envio_dev: null,
                            status_envio_dev: null,
                            frete_envio: null,
                            nfe_numero: null,
                            chave_acesso: null,
                            pack_id: pedidoData.pack_id ? String(pedidoData.pack_id) : null
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

                                // ============ DEBUG TEMPORÁRIO - REMOVER DEPOIS ============
                                console.log(`[DEBUG ENVIO] Pedido ${pedidoData.id} | Shipment ${envioData?.id} | Status: ${envioData?.status}/${envioData?.substatus}`);
                                console.log(`[DEBUG ENVIO] === SEM x-format-new (formato antigo) ===`);
                                console.log(`[DEBUG ENVIO]   shipping_option.buffering: ${JSON.stringify(envioData?.shipping_option?.buffering)}`);
                                console.log(`[DEBUG ENVIO]   shipping_option.estimated_schedule_limit: ${JSON.stringify(envioData?.shipping_option?.estimated_schedule_limit)}`);
                                console.log(`[DEBUG ENVIO]   shipping_option.estimated_delivery_time?.date: ${envioData?.shipping_option?.estimated_delivery_time?.date}`);

                                // Segunda chamada COM header x-format-new para comparar
                                try {
                                    const envioNewFormat = await axios.get(`${ML_API_URL}/shipments/${envioData?.id}`, {
                                        headers: { 'Authorization': `Bearer ${accessToken}`, 'x-format-new': 'true' }
                                    });
                                    const envioNew = envioNewFormat.data;
                                    console.log(`[DEBUG ENVIO] === COM x-format-new (formato novo) ===`);
                                    console.log(`[DEBUG ENVIO]   lead_time existe? ${!!envioNew?.lead_time}`);
                                    console.log(`[DEBUG ENVIO]   lead_time.buffering: ${JSON.stringify(envioNew?.lead_time?.buffering)}`);
                                    console.log(`[DEBUG ENVIO]   lead_time.estimated_schedule_limit: ${JSON.stringify(envioNew?.lead_time?.estimated_schedule_limit)}`);
                                    console.log(`[DEBUG ENVIO]   lead_time.estimated_delivery_time?.date: ${envioNew?.lead_time?.estimated_delivery_time?.date}`);
                                    console.log(`[DEBUG ENVIO]   shipping_option ainda existe? ${!!envioNew?.shipping_option}`);
                                } catch (debugErr) {
                                    console.log(`[DEBUG ENVIO]   Erro ao buscar com x-format-new: ${debugErr.message}`);
                                }
                                console.log(`[DEBUG ENVIO] ---`);
                                // ============ FIM DEBUG TEMPORÁRIO ============

                                if (envioData) {
                                    novoPedido.id_envio_ml = envioData.id;
                                    novoPedido.status_envio = this.resolverStatusEnvio(envioData);
                                    novoPedido.tipo_envio = envioData.logistic_type || null;

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
                                    if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                        novoPedido.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
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

                        // --- CAPTURA ISOLADA DE NOTA FISCAL ---
                        const nfData = await this.buscarNotaFiscal(novoPedido.id_pedido_ml, conta.seller_id, accessToken);
                        if (nfData) {
                            novoPedido.nfe_numero = nfData.invoiceNumber;
                            novoPedido.chave_acesso = nfData.invoiceKey;
                            if (!novoPedido.tipo_envio && nfData.logisticType) {
                                novoPedido.tipo_envio = nfData.logisticType;
                            }
                        }

                        // Salvar no banco
                        await this.salvarPedidoNoBanco(novoPedido);
                    }));
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
                /* Removido o filtro estrito de IN para monitorar handling e shipped sem etiqueta */
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de ${pedidosParaChecar.length} pedidos mais antigos...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {

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
                        return;
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
                                        return; // Pula para o próximo pedido
                                    }
                                } catch (searchError) {
                                    console.error(`[HUB ML] Erro no fallback de busca do pedido ${pedido.id_pedido_ml}:`, searchError.message);
                                    return;
                                }
                            } else {
                                // Erros 500 ou instabilidades da API
                                console.error(`[HUB ML] Erro inesperado ao buscar pedido ${pedido.id_pedido_ml}:`, error.message);
                                return;
                            }
                        }

                        // Se por algum motivo bizarro chegou aqui sem dados, interrompe o fluxo deste pedido
                        if (!dadosAtualizados) return;

                        // Recriamos o objeto completo para garantir UPDATE total
                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl,
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            // Mantém os dados antigos por precaução até a nova verificação
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null)
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
                                    pedidoAtualizado.status_envio = this.resolverStatusEnvio(envioData);
                                    pedidoAtualizado.tipo_envio = envioData.logistic_type || null;

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
                                    if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                        pedidoAtualizado.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
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

                        // --- CAPTURA DE NOTA FISCAL NO MONITORAMENTO ---
                        // Se o pedido ainda não possui NF, tenta buscar novamente
                        if (!pedido.nfe_numero) {
                            const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                            if (nfData) {
                                pedidoAtualizado.nfe_numero = nfData.invoiceNumber;
                                pedidoAtualizado.chave_acesso = nfData.invoiceKey;
                                if (!pedidoAtualizado.tipo_envio && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                                console.log(`[HUB ML] NF capturada tardiamente para pedido ${pedidoAtualizado.id_pedido_ml}: NF ${nfData.invoiceNumber}`);
                            }
                        } else {
                            // Preserva os dados de NF existentes
                            pedidoAtualizado.nfe_numero = pedido.nfe_numero;
                            pedidoAtualizado.chave_acesso = pedido.chave_acesso;

                            if (!pedidoAtualizado.tipo_envio) {
                                const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                                if (nfData && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        }

                        // Salva TUDO (Atualiza datas, itens, etiquetas, status e DEVOLUÇÕES)
                        await this.salvarPedidoNoBanco(pedidoAtualizado);

                    } catch (err) {
                        console.error(`[HUB ML] Erro ao monitorar/atualizar pedido ${pedido.id_pedido_ml}:`, err.message);
                    }
                }));
            }
        } catch (error) {
            console.error('[HUB ML] Erro no monitoramento:', error);
        } finally {
            client.release();
        }
    }

    async monitorarPedidosDiferentes() {
        console.log('[HUB ML] Iniciando monitoramento (Pedidos Diferentes)...');
        const client = await poolHub.connect();

        try {
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.status_envio IS NULL AND p.status_pedido = 'paid'
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de ${pedidosParaChecar.length} pedidos diferentes...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {

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
                        return;
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
                                        return; // Pula para o próximo pedido
                                    }
                                } catch (searchError) {
                                    console.error(`[HUB ML] Erro no fallback de busca do pedido ${pedido.id_pedido_ml}:`, searchError.message);
                                    return;
                                }
                            } else {
                                // Erros 500 ou instabilidades da API
                                console.error(`[HUB ML] Erro inesperado ao buscar pedido ${pedido.id_pedido_ml}:`, error.message);
                                return;
                            }
                        }

                        // Se por algum motivo bizarro chegou aqui sem dados, interrompe o fluxo deste pedido
                        if (!dadosAtualizados) return;

                        // Recriamos o objeto completo para garantir UPDATE total
                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl,
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            // Mantém os dados antigos por precaução até a nova verificação
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null)
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
                                    pedidoAtualizado.status_envio = this.resolverStatusEnvio(envioData);
                                    pedidoAtualizado.tipo_envio = envioData.logistic_type || null;

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
                                    if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                        pedidoAtualizado.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
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

                        // --- CAPTURA DE NOTA FISCAL NO MONITORAMENTO ---
                        // Se o pedido ainda não possui NF, tenta buscar novamente
                        if (!pedido.nfe_numero) {
                            const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                            if (nfData) {
                                pedidoAtualizado.nfe_numero = nfData.invoiceNumber;
                                pedidoAtualizado.chave_acesso = nfData.invoiceKey;
                                if (!pedidoAtualizado.tipo_envio && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                                console.log(`[HUB ML] NF capturada tardiamente para pedido ${pedidoAtualizado.id_pedido_ml}: NF ${nfData.invoiceNumber}`);
                            }
                        } else {
                            // Preserva os dados de NF existentes
                            pedidoAtualizado.nfe_numero = pedido.nfe_numero;
                            pedidoAtualizado.chave_acesso = pedido.chave_acesso;

                            if (!pedidoAtualizado.tipo_envio) {
                                const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                                if (nfData && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        }

                        // Salva TUDO (Atualiza datas, itens, etiquetas, status e DEVOLUÇÕES)
                        await this.salvarPedidoNoBanco(pedidoAtualizado);

                    } catch (err) {
                        console.error(`[HUB ML] Erro ao monitorar/atualizar pedido ${pedido.id_pedido_ml}:`, err.message);
                    }
                }));
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

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {

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
                        return;
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
                                        return; // Pula para o próximo pedido
                                    }
                                } catch (searchError) {
                                    console.error(`[HUB ML] Erro no fallback de busca do pedido ${pedido.id_pedido_ml}:`, searchError.message);
                                    return;
                                }
                            } else {
                                // Erros 500 ou instabilidades da API
                                console.error(`[HUB ML] Erro inesperado ao buscar pedido ${pedido.id_pedido_ml}:`, error.message);
                                return;
                            }
                        }

                        // Se por algum motivo bizarro chegou aqui sem dados, interrompe o fluxo deste pedido
                        if (!dadosAtualizados) return;

                        // Recriamos o objeto completo para garantir UPDATE total
                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl,
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            // Mantém os dados antigos por precaução até a nova verificação
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null)
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
                                    pedidoAtualizado.status_envio = this.resolverStatusEnvio(envioData);
                                    pedidoAtualizado.tipo_envio = envioData.logistic_type || null;

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
                                    if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                        pedidoAtualizado.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
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
                }));
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
                WHERE p.date_created >= NOW() - INTERVAL '120 days'
                OR p.status_envio IS NULL OR p.status_pedido = 'paid'
                AND p.conta_id NOT IN (6, 7)
            `;
            const result = await client.query(query);
            const pedidosParaChecar = result.rows;

            console.log(`[HUB ML] Processando lote de devoluções com os ${pedidosParaChecar.length} pedidos mais antigos...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {
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
                        return;
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
                }));
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

    /**
     * Busca a Nota Fiscal de um pedido via API ML de invoices.
     * Retorna { invoiceNumber, invoiceKey } ou null se não encontrado.
     */
    async buscarNotaFiscal(idPedidoMl, sellerId, accessToken) {
        try {
            await delay(200);
            const url = `${ML_API_URL}/users/${sellerId}/invoices/orders/${idPedidoMl}`;
            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const data = response.data;
            if (data) {
                const invoiceNumber = data.invoice_number ? String(data.invoice_number) : null;
                const invoiceKey = data.attributes?.invoice_key || null;
                const logisticType = data.shipment?.logistic_type || null;

                if (invoiceNumber || invoiceKey || logisticType) {
                    return { invoiceNumber, invoiceKey, logisticType };
                }
            }
        } catch (err) {
            // 404 = pedido sem NF ainda (normal para pedidos recentes)
            // Outros erros são silenciados para não travar o fluxo
            if (err.response?.status !== 404) {
                console.warn(`[HUB ML] Erro ao buscar NF do pedido ${idPedidoMl}: ${err.message}`);
            }
        }
        return null;
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
            (conta_id, id_pedido_ml, date_created, status_pedido, data_limite_envio, id_envio_ml, status_envio, etiqueta_zpl, itens_pedido, comprador_nickname, data_envio_disponivel, data_envio_agendado, data_previsao_entrega, tem_dev, tem_med, status_dev, status_med, id_envio_dev, status_envio_dev, frete_envio, nfe_numero, chave_acesso, tipo_envio, pack_id, substatus_envio, manufacturing_ending_date, status_impressao, justificativa_erro)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
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
            nfe_numero = COALESCE(EXCLUDED.nfe_numero, pedidos_mercado_livre.nfe_numero),
            chave_acesso = COALESCE(EXCLUDED.chave_acesso, pedidos_mercado_livre.chave_acesso),
            tipo_envio = EXCLUDED.tipo_envio,
            pack_id = EXCLUDED.pack_id,
            substatus_envio = COALESCE(EXCLUDED.substatus_envio, pedidos_mercado_livre.substatus_envio),
            manufacturing_ending_date = COALESCE(EXCLUDED.manufacturing_ending_date, pedidos_mercado_livre.manufacturing_ending_date),
            status_impressao = COALESCE(EXCLUDED.status_impressao, pedidos_mercado_livre.status_impressao),
            justificativa_erro = COALESCE(EXCLUDED.justificativa_erro, pedidos_mercado_livre.justificativa_erro),
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
            pedido.frete_envio || null,
            pedido.nfe_numero || null,
            pedido.chave_acesso || null,
            pedido.tipo_envio || null,
            pedido.pack_id ? String(pedido.pack_id) : null,
            pedido.substatus_envio || null,
            pedido.manufacturing_ending_date || null,
            pedido.status_impressao || 'nao_impresso',
            pedido.justificativa_erro || null
        ];

        try {
            await poolHub.query(query, values);
        } catch (error) {
            console.error(`[HUB ML] Erro ao inserir pedido ${pedido.id_pedido_ml}:`, error.message);
        }
    }

    async monitorarPedidosInstantaneo(idsEnvio, idsPedido, clienteId) {
        console.log(`[HUB ML] Iniciando monitoramento instantâneo. Envios: ${idsEnvio.length}, Pedidos: ${idsPedido.length}...`);
        const client = await poolHub.connect();

        try {
            // 1. Buscar pedidos JÁ EXISTENTES no banco (tanto por id_pedido_ml quanto por id_envio_ml ou pack_id)
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE c.cliente_id = $1 AND (p.id_pedido_ml = ANY($2) OR p.id_envio_ml = ANY($3) OR p.pack_id = ANY($2))
            `;
            const result = await client.query(query, [clienteId, idsPedido, idsEnvio]);
            const pedidosEncontrados = result.rows;

            console.log(`[HUB ML] Encontrados ${pedidosEncontrados.length} pedidos já existentes no banco para monitoramento instantâneo.`);

            // Mapeia os IDs encontrados para identificar quais estão faltando
            const pedidosEncontradosIds = new Set();
            const enviosEncontradosIds = new Set();
            const packsEncontradosIds = new Set();
            pedidosEncontrados.forEach(p => {
                if (p.id_pedido_ml) pedidosEncontradosIds.add(String(p.id_pedido_ml));
                if (p.id_envio_ml) enviosEncontradosIds.add(String(p.id_envio_ml));
                if (p.pack_id) packsEncontradosIds.add(String(p.pack_id));
            });
            const idsPedidoFaltando = idsPedido.filter(id => !pedidosEncontradosIds.has(String(id)) && !packsEncontradosIds.has(String(id)));
            const idsEnvioFaltando = idsEnvio.filter(id => !enviosEncontradosIds.has(String(id)));

            // 2. Atualizar os pedidos que JÁ EXISTEM no banco (fluxo original)
            if (pedidosEncontrados.length > 0) {
                await Promise.all(pedidosEncontrados.map(async (pedido) => {
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
                        return;
                    }

                    try {
                        await delay(150);
                        let dadosAtualizados = null;

                        try {
                            const checkOrderUrl = `${ML_API_URL}/orders/${pedido.id_pedido_ml}`;
                            const orderRes = await axios.get(checkOrderUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            dadosAtualizados = orderRes.data;

                        } catch (error) {
                            if (error.response && (error.response.status === 404 || error.response.status === 403)) {
                                console.warn(`[HUB ML] Pedido ${pedido.id_pedido_ml} retornou ${error.response.status}. Iniciando fallback de busca...`);
                                try {
                                    const searchUrl = `${ML_API_URL}/orders/search?seller=${pedido.seller_id}&q=${pedido.id_pedido_ml}`;
                                    const searchRes = await axios.get(searchUrl, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });

                                    if (searchRes.data.results && searchRes.data.results.length > 0) {
                                        dadosAtualizados = searchRes.data.results[0];
                                    } else {
                                        return;
                                    }
                                } catch (searchError) {
                                    return;
                                }
                            } else {
                                return;
                            }
                        }

                        if (!dadosAtualizados) return;

                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl,
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null)
                        };

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

                        if (dadosAtualizados.shipping?.id) {
                            try {
                                const envioUrl = `${ML_API_URL}/shipments/${dadosAtualizados.shipping.id}`;
                                const envioRes = await axios.get(envioUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });
                                const envioData = envioRes.data;

                                if (envioData) {
                                    pedidoAtualizado.id_envio_ml = envioData.id;
                                    pedidoAtualizado.status_envio = this.resolverStatusEnvio(envioData);
                                    pedidoAtualizado.tipo_envio = envioData.logistic_type || null;

                                    try {
                                        const freteUrl = `${ML_API_URL}/shipments/${envioData.id}/costs`;
                                        const freteRes = await axios.get(freteUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` }
                                        });
                                        pedidoAtualizado.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                                    } catch (freteError) { }

                                    try {
                                        const limiteEnvioUrl = `${ML_API_URL}/shipments/${envioData.id}/sla`;
                                        const limiteEnvio = await axios.get(limiteEnvioUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` }
                                        });
                                        const limiteEnvioData = Array.isArray(limiteEnvio.data) ? limiteEnvio.data[0] : limiteEnvio.data;

                                        if (limiteEnvioData.expected_date) {
                                            pedidoAtualizado.data_limite_envio = limiteEnvioData.expected_date;
                                        }
                                    } catch (slaError) { }

                                    const shippingOption = envioData.shipping_option || {};
                                    const statusHistory = envioData.status_history || {};

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

                                    if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                        pedidoAtualizado.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
                                    }

                                    if (shippingOption.estimated_delivery_time?.date) {
                                        pedidoAtualizado.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                                    }

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
                                        } catch (errLabel) { }
                                    }
                                }
                            } catch (envioError) { }
                        }

                        if (!pedido.nfe_numero) {
                            const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                            if (nfData) {
                                pedidoAtualizado.nfe_numero = nfData.invoiceNumber;
                                pedidoAtualizado.chave_acesso = nfData.invoiceKey;
                                if (!pedidoAtualizado.tipo_envio && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        } else {
                            pedidoAtualizado.nfe_numero = pedido.nfe_numero;
                            pedidoAtualizado.chave_acesso = pedido.chave_acesso;

                            if (!pedidoAtualizado.tipo_envio) {
                                const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                                if (nfData && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        }

                        await this.salvarPedidoNoBanco(pedidoAtualizado);

                    } catch (err) {
                        console.error(`[HUB ML] Erro ao monitorar/atualizar pedido ${pedido.id_pedido_ml}:`, err.message);
                    }
                }));
            }

            // 3. Para IDs NÃO ENCONTRADOS no banco: buscar diretamente na API do ML e inserir
            if (idsEnvioFaltando.length > 0 || idsPedidoFaltando.length > 0) {
                console.log(`[HUB ML] ${idsEnvioFaltando.length} IDs Envio e ${idsPedidoFaltando.length} IDs Pedido não encontrados no banco. Buscando diretamente na API do ML...`);

                // Pega TODAS as contas do cliente (incluindo as inativas) para ter tokens disponíveis
                const contasResult = await client.query(
                    'SELECT * FROM hub_ml_contas WHERE cliente_id = $1',
                    [clienteId]
                );
                const contasDisponiveis = contasResult.rows;

                if (contasDisponiveis.length === 0) {
                    console.warn('[HUB ML] Nenhuma conta vinculada ao cliente. Não é possível buscar pedidos faltantes.');
                } else {
                    // Função auxiliar para inserir/atualizar um orderId
                    const processarOrderEncontrado = async (orderId, conta, accessToken, envioData = null) => {
                        try {
                            await delay(150);
                            const orderUrl = `${ML_API_URL}/orders/${orderId}`;
                            const orderRes = await axios.get(orderUrl, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            const dadosPedido = orderRes.data;

                            if (!dadosPedido) return;

                            // Verifica se o pedido pertence a este vendedor específico
                            if (dadosPedido.seller?.id && String(dadosPedido.seller.id) !== String(conta.seller_id)) {
                                return;
                            }

                            const pedidoNovo = {
                                conta_id: conta.id,
                                id_pedido_ml: dadosPedido.id,
                                date_created: dadosPedido.date_created,
                                status_pedido: dadosPedido.status,
                                data_limite_envio: null,
                                id_envio_ml: envioData ? envioData.id : (dadosPedido.shipping?.id || null),
                                status_envio: envioData ? this.resolverStatusEnvio(envioData) : null,
                                tipo_envio: envioData ? (envioData.logistic_type || null) : null,
                                etiqueta_zpl: null,
                                comprador_nickname: dadosPedido.buyer?.nickname || null,
                                frete_envio: null,
                                tem_dev: false,
                                tem_med: false,
                                status_dev: null,
                                status_med: null,
                                id_envio_dev: null,
                                status_envio_dev: null,
                                pack_id: dadosPedido.pack_id ? String(dadosPedido.pack_id) : (envioData?.pack_id ? String(envioData.pack_id) : null)
                            };

                            const itensMapeados = (dadosPedido.order_items || []).map(itemWrapper => {
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
                            pedidoNovo.itens_pedido = JSON.stringify(itensMapeados);

                            // Se não veio o envioData pré-preenchido, tenta buscar se tem ID de shipping
                            let envioRealData = envioData;
                            if (!envioRealData && pedidoNovo.id_envio_ml) {
                                try {
                                    const envioUrl = `${ML_API_URL}/shipments/${pedidoNovo.id_envio_ml}`;
                                    const envioRes = await axios.get(envioUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                                    envioRealData = envioRes.data;
                                    if (envioRealData) {
                                        pedidoNovo.status_envio = this.resolverStatusEnvio(envioRealData);
                                    }
                                } catch (e) { }
                            }

                            if (envioRealData) {
                                pedidoNovo.tipo_envio = envioRealData.logistic_type || null;
                                try {
                                    const freteUrl = `${ML_API_URL}/shipments/${envioRealData.id}/costs`;
                                    const freteRes = await axios.get(freteUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                                    pedidoNovo.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                                } catch (freteError) { }

                                try {
                                    const slaUrl = `${ML_API_URL}/shipments/${envioRealData.id}/sla`;
                                    const slaRes = await axios.get(slaUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                                    const slaData = Array.isArray(slaRes.data) ? slaRes.data[0] : slaRes.data;
                                    if (slaData?.expected_date) {
                                        pedidoNovo.data_limite_envio = slaData.expected_date;
                                    }
                                } catch (slaError) { }

                                const shippingOption = envioRealData.shipping_option || {};
                                const statusHistory = envioRealData.status_history || {};

                                if (shippingOption.buffering?.date) {
                                    const dataBuffering = new Date(shippingOption.buffering.date);
                                    const hoje = new Date();
                                    hoje.setHours(0, 0, 0, 0);
                                    dataBuffering.setHours(0, 0, 0, 0);
                                    pedidoNovo.data_envio_agendado = dataBuffering > hoje ? shippingOption.buffering.date : null;
                                }

                                if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                                    pedidoNovo.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
                                }

                                if (shippingOption.estimated_delivery_time?.date) {
                                    pedidoNovo.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                                }

                                if (envioRealData.logistic_type !== 'fulfillment' &&
                                    (envioRealData.status === 'ready_to_ship' || envioRealData.status === 'shipped')) {
                                    await delay(300);
                                    try {
                                        const zplUrl = `${ML_API_URL}/shipment_labels?shipment_ids=${envioRealData.id}&response_type=zpl2`;
                                        const zplResponse = await axios.get(zplUrl, {
                                            headers: { 'Authorization': `Bearer ${accessToken}` },
                                            responseType: 'arraybuffer'
                                        });
                                        let conteudoEtiqueta = zplResponse.data;
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
                                        pedidoNovo.etiqueta_zpl = conteudoEtiqueta;
                                    } catch (errLabel) { }
                                }
                            }

                            const nfData = await this.buscarNotaFiscal(dadosPedido.id, conta.seller_id, accessToken);
                            if (nfData) {
                                pedidoNovo.nfe_numero = nfData.invoiceNumber;
                                pedidoNovo.chave_acesso = nfData.invoiceKey;
                                if (!pedidoNovo.tipo_envio && nfData.logisticType) {
                                    pedidoNovo.tipo_envio = nfData.logisticType;
                                }
                            }

                            await this.salvarPedidoNoBanco(pedidoNovo);
                        } catch (orderErr) {
                            console.error(`[HUB ML] Erro ao buscar/inserir pedido ${orderId}:`, orderErr.message);
                        }
                    };

                    // Busca para IDs de Envio
                    await Promise.all(idsEnvioFaltando.map(async (idFaltante) => {
                        let encontrou = false;
                        for (const conta of contasDisponiveis) {
                            if (encontrou) break;
                            let accessToken;
                            try {
                                accessToken = await hubTokenService.getValidAccessToken(conta);
                            } catch (e) {
                                continue;
                            }

                            try {
                                await delay(100);
                                const envioUrl = `${ML_API_URL}/shipments/${idFaltante}`;
                                const envioRes = await axios.get(envioUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });
                                const envioData = envioRes.data;

                                if (!envioData || !envioData.order_id) continue;

                                const orderIds = [];
                                if (envioData.order_id) orderIds.push(envioData.order_id);

                                if (envioData.pack_id) {
                                    try {
                                        const packUrl = `${ML_API_URL}/packs/${envioData.pack_id}`;
                                        const packRes = await axios.get(packUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                                        if (packRes.data && packRes.data.orders) {
                                            for (const o of packRes.data.orders) {
                                                if (o.id && !orderIds.includes(o.id)) orderIds.push(o.id);
                                            }
                                        }
                                    } catch (packErr) { }
                                }

                                await Promise.all(orderIds.map(async (orderId) => {
                                    await processarOrderEncontrado(orderId, conta, accessToken, envioData);
                                }));
                                encontrou = true;
                            } catch (shipmentErr) {
                                if (shipmentErr.response && (shipmentErr.response.status === 404 || shipmentErr.response.status === 403)) {
                                    continue;
                                }
                            }
                        }
                        if (!encontrou) {
                            console.warn(`[HUB ML] Envio ${idFaltante} não encontrado em nenhuma conta.`);
                        }
                    }));

                    // Busca para IDs de Pedido (numero_loja) usando /orders/search ou /packs
                    await Promise.all(idsPedidoFaltando.map(async (idFaltante) => {
                        let encontrou = false;
                        for (const conta of contasDisponiveis) {
                            if (encontrou) break;
                            let accessToken;
                            try {
                                accessToken = await hubTokenService.getValidAccessToken(conta);
                            } catch (e) {
                                continue;
                            }

                            console.log(`ID FALTANTE: ${idFaltante}`)
                            // 1. Tentar buscar como pack_id
                            try {
                                await delay(100);
                                const packUrl = `${ML_API_URL}/packs/${idFaltante}`;
                                const packRes = await axios.get(packUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
                                if (packRes.data && packRes.data.orders) {
                                    let processouAlgum = false;
                                    await Promise.all(packRes.data.orders.map(async (o) => {
                                        if (o.id) {
                                            try {
                                                console.log(`Tentando buscar pedido ${o.id}`)
                                                await delay(100);
                                                const searchUrl = `${ML_API_URL}/orders/search?seller=${conta.seller_id}&q=${o.id}`;
                                                const searchRes = await axios.get(searchUrl, {
                                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                                });
                                                if (searchRes.data && searchRes.data.results && searchRes.data.results.length > 0) {
                                                    await processarOrderEncontrado(o.id, conta, accessToken, null);
                                                    processouAlgum = true;
                                                }
                                            } catch (oErr) {
                                                // Se der erro, apenas ignora
                                            }
                                        }
                                    }));
                                    if (processouAlgum) {
                                        encontrou = true;
                                        break;
                                    }
                                }
                            } catch (packErr) {
                                // Silencioso: se falhar, segue para a busca normal por order_id/search
                            }

                            try {
                                await delay(100);
                                const searchUrl = `${ML_API_URL}/orders/search?seller=${conta.seller_id}&q=${idFaltante}`;
                                const searchRes = await axios.get(searchUrl, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });

                                if (searchRes.data && searchRes.data.results && searchRes.data.results.length > 0) {
                                    await Promise.all(searchRes.data.results.map(async (orderData) => {
                                        await processarOrderEncontrado(orderData.id, conta, accessToken, null);
                                    }));
                                    encontrou = true;
                                }
                            } catch (searchErr) {
                                if (searchErr.response && (searchErr.response.status === 404 || searchErr.response.status === 403)) {
                                    continue;
                                }
                            }
                        }
                        if (!encontrou) {
                            console.warn(`[HUB ML] Pedido ou Pack ${idFaltante} não encontrado em nenhuma conta.`);
                        }
                    }));
                }
            }
        } catch (error) {
            console.error('[HUB ML] Erro no monitoramento instantâneo:', error);
        } finally {
            client.release();
        }
    }

    async processarWebhookStatus(topic, resource, user_id) {
        if (!topic || !resource || !user_id) return;

        // Processar apenas tópicos relacionados a pedidos ou envios
        if (topic !== 'orders_v2' && topic !== 'shipments') return;

        const client = await poolHub.connect();
        try {
            // Atraso de 1 segundo para garantir que o ML tenha tempo de persistir a mudança lá do lado deles
            await delay(1000);

            // 1. Descobrir a conta pelo seller_id
            const contaRes = await client.query('SELECT * FROM hub_ml_contas WHERE seller_id = $1', [String(user_id)]);
            if (contaRes.rowCount === 0) return; // Conta inativa ou não cadastrada
            const conta = contaRes.rows[0];

            // Pega o token válido para a conta
            const hubTokenService = require('./hubTokenService');
            let accessToken;
            try {
                accessToken = await hubTokenService.getValidAccessToken(conta);
            } catch (e) {
                console.error(`[HUB Webhook] Erro de token para user ${user_id}`);
                return;
            }

            let orderId = null;

            // 2. Extrair o orderId baseado no tópico
            if (topic === 'orders_v2') {
                orderId = resource.replace('/orders/', '').split('/')[0];
            } else if (topic === 'shipments') {
                const shipmentId = resource.replace('/shipments/', '').split('/')[0];
                const envioUrl = `${ML_API_URL}/shipments/${shipmentId}`;
                const envioRes = await axios.get(envioUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
                orderId = envioRes.data.order_id;
            }

            if (!orderId) return;

            // 3. Buscar no DB local para ver se o pedido existe e capturar seus status atuais
            const dbQuery = await client.query('SELECT id_pedido_ml, status_pedido, status_envio, tipo_envio FROM pedidos_mercado_livre WHERE id_pedido_ml = $1', [String(orderId)]);
            if (dbQuery.rowCount === 0) return; // Se não existe, a rotina normal do cron fará a inserção. Ignoramos aqui.
            const pedidoBanco = dbQuery.rows[0];

            // 4. Buscar os dados atualizados de order no ML
            const orderRes = await axios.get(`${ML_API_URL}/orders/${orderId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
            const dadosML = orderRes.data;

            const novoStatusPedido = dadosML.status;
            let novoStatusEnvio = null;
            let novoTipoEnvio = null;

            // Se o pedido tiver dados de envio, buscamos o status atualizado do envio
            if (dadosML.shipping && dadosML.shipping.id) {
                const shipRes = await axios.get(`${ML_API_URL}/shipments/${dadosML.shipping.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
                novoStatusEnvio = this.resolverStatusEnvio(shipRes.data);
                novoTipoEnvio = shipRes.data.logistic_type || null;
            }

            // 5. INTELIGÊNCIA: Só realiza o UPDATE no banco se houver uma real alteração nos campos alvo
            if (pedidoBanco.status_pedido !== novoStatusPedido || pedidoBanco.status_envio !== novoStatusEnvio || pedidoBanco.tipo_envio !== novoTipoEnvio) {
                console.log(`[HUB Webhook] Alteração real detectada no pedido ${orderId} | Status: ${pedidoBanco.status_pedido} -> ${novoStatusPedido} | Envio: ${pedidoBanco.status_envio} -> ${novoStatusEnvio}`);

                const updateQuery = `
                    UPDATE pedidos_mercado_livre
                    SET status_pedido = $1, status_envio = $2, tipo_envio = COALESCE($3, tipo_envio), pack_id = COALESCE($4, pack_id), last_update = NOW()
                    WHERE id_pedido_ml = $5
                `;
                await client.query(updateQuery, [
                    novoStatusPedido,
                    novoStatusEnvio,
                    novoTipoEnvio,
                    dadosML.pack_id ? String(dadosML.pack_id) : null,
                    String(orderId)
                ]);
            }

        } catch (error) {
            // Se for 404, o pedido ou envio foi expurgado/não existe, então ignoramos em silêncio.
            if (error.response && error.response.status === 404) {
                // Ignore
            } else {
                console.error(`[HUB Webhook] Erro ao processar webhook resource ${resource}:`, error.message);
            }
        } finally {
            client.release();
        }
    }

    // =========================================================================
    // NOVOS MÉTODOS SOB DEMANDA (ON-DEMAND VIA HTTP API) COM MULTI-TENANCY
    // =========================================================================

    /**
     * Resolve e valida as contas ML pertencentes ao cliente autenticado.
     * Suporta filtro opcional por conta_id ou seller_id.
     */
    async resolverContasCliente(clienteId, options = {}) {
        if (!clienteId) throw new Error('Cliente não identificado.');

        let query = 'SELECT * FROM hub_ml_contas WHERE cliente_id = $1 AND ativo = TRUE';
        const params = [clienteId];

        if (options.conta_id) {
            query += ' AND id = $2';
            params.push(Number(options.conta_id));
        } else if (options.seller_id) {
            query += ' AND seller_id = $2';
            params.push(String(options.seller_id));
        }

        const res = await poolHub.query(query, params);
        if (res.rows.length === 0) {
            if (options.conta_id || options.seller_id) {
                throw new Error('A conta especificada não foi encontrada, está inativa ou não pertence ao seu usuário.');
            }
            return [];
        }
        return res.rows;
    }

    /**
     * Helper modular que busca dados de envio, frete e SLA SEM chamar /shipment_labels.
     * Evita qualquer alteração indevida no status da etiqueta no Mercado Livre.
     */
    async extrairDadosEnvioSemEtiqueta(shipmentId, accessToken) {
        if (!shipmentId) return null;

        const resultado = {
            id_envio_ml: String(shipmentId),
            status_envio: null,
            substatus_envio: null,
            manufacturing_ending_date: null,
            tipo_envio: null,
            data_limite_envio: null,
            data_envio_agendado: null,
            data_envio_disponivel: null,
            data_previsao_entrega: null,
            frete_envio: null
        };

        try {
            await delay(100);
            const envioUrl = `${ML_API_URL}/shipments/${shipmentId}`;
            const envioRes = await axios.get(envioUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const envioData = envioRes.data;

            if (envioData) {
                resultado.status_envio = this.resolverStatusEnvio(envioData);
                resultado.substatus_envio = envioData.substatus || null;
                resultado.tipo_envio = envioData.logistic_type || null;

                // 1. Custos de Frete
                try {
                    const freteUrl = `${ML_API_URL}/shipments/${shipmentId}/costs`;
                    const freteRes = await axios.get(freteUrl, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    resultado.frete_envio = freteRes.data?.senders?.[0]?.cost || 0;
                } catch (e) {
                    // Silencioso se custos não estiverem disponíveis
                }

                // 2. SLA / Data Limite de Envio
                try {
                    const slaUrl = `${ML_API_URL}/shipments/${shipmentId}/sla`;
                    const slaRes = await axios.get(slaUrl, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    const slaData = Array.isArray(slaRes.data) ? slaRes.data[0] : slaRes.data;
                    if (slaData?.expected_date) {
                        resultado.data_limite_envio = slaData.expected_date;
                    }
                } catch (e) {
                    // Silencioso se SLA não estiver disponível
                }

                const shippingOption = envioData.shipping_option || {};
                const statusHistory = envioData.status_history || {};

                // 3. Data Envio Agendado (buffering futuro ou estimated_schedule_limit)
                if (shippingOption.buffering?.date) {
                    const dataBuffering = new Date(shippingOption.buffering.date);
                    const hoje = new Date();
                    hoje.setHours(0, 0, 0, 0);
                    dataBuffering.setHours(0, 0, 0, 0);
                    resultado.data_envio_agendado = dataBuffering > hoje ? shippingOption.buffering.date : null;
                } else if (shippingOption.estimated_schedule_limit?.date) {
                    const dataSched = new Date(shippingOption.estimated_schedule_limit.date);
                    const hoje = new Date();
                    hoje.setHours(0, 0, 0, 0);
                    dataSched.setHours(0, 0, 0, 0);
                    resultado.data_envio_agendado = dataSched > hoje ? shippingOption.estimated_schedule_limit.date : null;
                    resultado.manufacturing_ending_date = shippingOption.estimated_schedule_limit.date;
                }

                // 4. Data Envio Disponível
                if (statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship) {
                    resultado.data_envio_disponivel = statusHistory.date_handling || envioData.date_created || statusHistory.date_ready_to_ship;
                }

                // 5. Previsão de Entrega
                if (shippingOption.estimated_delivery_time?.date) {
                    resultado.data_previsao_entrega = shippingOption.estimated_delivery_time.date;
                }
            }
        } catch (err) {
            // Se o envio não existir ou retornar 404, prossegue sem dados logísticos
        }

        return resultado;
    }

    /**
     * 1. ROTINA ON-DEMAND: Captura de Novos Pedidos por Cliente
     * Busca pedidos recentes paginados no ML, enriquece dados cadastrais, fiscais e logísticos
     * SEM chamar a API de etiquetas do ML.
     */
    async capturarNovosPedidosCliente(clienteId, options = {}) {
        const inicio = Date.now();
        const contas = await this.resolverContasCliente(clienteId, options);

        if (contas.length === 0) {
            return {
                sucesso: true,
                mensagem: 'Nenhuma conta ativa encontrada para este cliente.',
                metricas: { total_processados: 0, novos_inseridos: 0, existentes_ignorados: 0, erros: 0, tempo_ms: 0 },
                contas: []
            };
        }

        const diasLimite = options.dias ? Math.min(parseInt(options.dias, 10), 150) : 30;
        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - diasLimite);

        const metricasGerais = {
            total_processados: 0,
            novos_inseridos: 0,
            existentes_ignorados: 0,
            erros: 0
        };
        const contasProcessadas = [];

        for (const conta of contas) {
            console.log(`[HUB ML On-Demand] Capturando novos pedidos da conta ${conta.nickname} (Seller: ${conta.seller_id})...`);
            let accessToken;
            try {
                accessToken = await hubTokenService.getValidAccessToken(conta);
            } catch (errToken) {
                console.error(`[HUB ML On-Demand] Token inválido para ${conta.nickname}:`, errToken.message);
                metricasGerais.erros++;
                contasProcessadas.push({ conta_id: conta.id, nickname: conta.nickname, status: 'erro_token', mensagem: errToken.message });
                continue;
            }

            let offset = 0;
            const limit = options.limit ? Math.min(parseInt(options.limit, 10), 50) : 50;
            let continuarBuscando = true;
            let totalContaNovos = 0;
            let totalContaAnalisados = 0;

            try {
                while (continuarBuscando) {
                    const searchUrl = `${ML_API_URL}/orders/search?seller=${conta.seller_id}&sort=date_desc&limit=${limit}&offset=${offset}`;
                    const response = await axios.get(searchUrl, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });

                    const pedidos = response.data.results || [];
                    if (pedidos.length === 0) {
                        continuarBuscando = false;
                        break;
                    }

                    const pedidosParaProcessar = [];
                    for (const p of pedidos) {
                        const dt = new Date(p.date_created);
                        if (dt < dataLimite) {
                            continuarBuscando = false;
                            break;
                        }
                        pedidosParaProcessar.push(p);
                    }

                    totalContaAnalisados += pedidosParaProcessar.length;
                    metricasGerais.total_processados += pedidosParaProcessar.length;

                    // Processamento em lotes concorrentes de 20 pedidos
                    const chunkSize = 20;
                    for (let i = 0; i < pedidosParaProcessar.length; i += chunkSize) {
                        const chunk = pedidosParaProcessar.slice(i, i + chunkSize);
                        await Promise.all(chunk.map(async (pedidoData) => {
                            try {
                                const exists = await this.verificarSePedidoExiste(pedidoData.id);

                                const itensMapeados = (pedidoData.order_items || []).map(itemWrapper => {
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

                                const novoPedido = {
                                    conta_id: conta.id,
                                    id_pedido_ml: pedidoData.id,
                                    date_created: pedidoData.date_created,
                                    status_pedido: pedidoData.status,
                                    data_limite_envio: pedidoData.shipping_option?.estimated_handling_limit?.date || null,
                                    id_envio_ml: pedidoData.shipping?.id ? String(pedidoData.shipping.id) : null,
                                    status_envio: null,
                                    tipo_envio: null,
                                    etiqueta_zpl: null, // NÃO BUSCA ETIQUETA AQUI
                                    itens_pedido: JSON.stringify(itensMapeados),
                                    comprador_nickname: pedidoData.buyer?.nickname || null,
                                    tem_dev: false,
                                    tem_med: false,
                                    status_dev: null,
                                    status_med: null,
                                    id_envio_dev: null,
                                    status_envio_dev: null,
                                    frete_envio: null,
                                    nfe_numero: null,
                                    chave_acesso: null,
                                    pack_id: pedidoData.pack_id ? String(pedidoData.pack_id) : null,
                                    substatus_envio: null,
                                    manufacturing_ending_date: pedidoData.manufacturing_ending_date || null
                                };

                                if (pedidoData.manufacturing_ending_date) {
                                    novoPedido.substatus_envio = 'manufacturing';
                                }

                                // Se tiver envio, busca dados adicionais (custo, sla, status) SEM gerar/baixar etiqueta
                                if (pedidoData.shipping?.id) {
                                    const dadosEnvio = await this.extrairDadosEnvioSemEtiqueta(pedidoData.shipping.id, accessToken);
                                    if (dadosEnvio) {
                                        novoPedido.status_envio = dadosEnvio.status_envio;
                                        novoPedido.substatus_envio = dadosEnvio.substatus_envio || novoPedido.substatus_envio;
                                        if (dadosEnvio.manufacturing_ending_date) novoPedido.manufacturing_ending_date = dadosEnvio.manufacturing_ending_date;
                                        novoPedido.tipo_envio = dadosEnvio.tipo_envio;
                                        novoPedido.frete_envio = dadosEnvio.frete_envio;
                                        if (dadosEnvio.data_limite_envio) novoPedido.data_limite_envio = dadosEnvio.data_limite_envio;
                                        novoPedido.data_envio_agendado = dadosEnvio.data_envio_agendado;
                                        novoPedido.data_envio_disponivel = dadosEnvio.data_envio_disponivel;
                                        novoPedido.data_previsao_entrega = dadosEnvio.data_previsao_entrega;
                                    }
                                }

                                // Claims e Reclamações
                                const detalhesReclamacao = await this.buscarDetalhesReclamacao(novoPedido.id_pedido_ml, accessToken);
                                Object.assign(novoPedido, detalhesReclamacao);

                                // Nota Fiscal
                                const nfData = await this.buscarNotaFiscal(novoPedido.id_pedido_ml, conta.seller_id, accessToken);
                                if (nfData) {
                                    novoPedido.nfe_numero = nfData.invoiceNumber;
                                    novoPedido.chave_acesso = nfData.invoiceKey;
                                    if (!novoPedido.tipo_envio && nfData.logisticType) {
                                        novoPedido.tipo_envio = nfData.logisticType;
                                    }
                                }

                                await this.salvarPedidoNoBanco(novoPedido);
                                if (exists) {
                                    metricasGerais.existentes_ignorados++;
                                } else {
                                    metricasGerais.novos_inseridos++;
                                    totalContaNovos++;
                                }
                            } catch (errPedido) {
                                console.error(`[HUB ML On-Demand] Erro ao processar pedido ${pedidoData.id}:`, errPedido.message);
                                metricasGerais.erros++;
                            }
                        }));
                    }

                    if (pedidos.length < limit) {
                        continuarBuscando = false;
                    } else {
                        offset += limit;
                    }

                    if (offset > 20000) {
                        continuarBuscando = false;
                    }
                    await delay(300);
                }

                contasProcessadas.push({
                    conta_id: conta.id,
                    nickname: conta.nickname,
                    status: 'sucesso',
                    pedidos_analisados: totalContaAnalisados,
                    novos_inseridos: totalContaNovos
                });

            } catch (errConta) {
                console.error(`[HUB ML On-Demand] Erro na busca de pedidos da conta ${conta.nickname}:`, errConta.message);
                metricasGerais.erros++;
                contasProcessadas.push({ conta_id: conta.id, nickname: conta.nickname, status: 'erro', mensagem: errConta.message });
            }
        }

        return {
            sucesso: true,
            rotina: 'captura_novos_pedidos',
            tempo_ms: Date.now() - inicio,
            metricas: metricasGerais,
            contas: contasProcessadas
        };
    }

    /**
     * 2. ROTINA ON-DEMAND: Monitoramento de Pedidos Diferentes por Cliente
     * Atualiza pedidos com status_envio IS NULL e status_pedido = 'paid' SEM chamar /shipment_labels.
     */
    async monitorarPedidosDiferentesCliente(clienteId, options = {}) {
        const inicio = Date.now();
        const contas = await this.resolverContasCliente(clienteId, options);
        if (contas.length === 0) {
            return { sucesso: true, mensagem: 'Nenhuma conta ativa encontrada.', metricas: { total_encontrados: 0, total_atualizados: 0, erros: 0, tempo_ms: 0 } };
        }

        const contaIds = contas.map(c => c.id);
        const client = await poolHub.connect();
        const metricas = { total_encontrados: 0, total_atualizados: 0, erros: 0 };

        try {
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.status_envio IS NULL AND p.status_pedido = 'paid'
                AND p.conta_id = ANY($1)
            `;
            const result = await client.query(query, [contaIds]);
            const pedidosParaChecar = result.rows;
            metricas.total_encontrados = pedidosParaChecar.length;

            console.log(`[HUB ML On-Demand] Monitorando ${pedidosParaChecar.length} pedidos diferentes do cliente ${clienteId}...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {
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
                        metricas.erros++;
                        return;
                    }

                    try {
                        await delay(100);
                        let dadosAtualizados = null;

                        try {
                            const orderRes = await axios.get(`${ML_API_URL}/orders/${pedido.id_pedido_ml}`, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            dadosAtualizados = orderRes.data;
                        } catch (errOrder) {
                            if (errOrder.response && (errOrder.response.status === 404 || errOrder.response.status === 403)) {
                                try {
                                    const searchRes = await axios.get(`${ML_API_URL}/orders/search?seller=${pedido.seller_id}&q=${pedido.id_pedido_ml}`, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    if (searchRes.data.results && searchRes.data.results.length > 0) {
                                        dadosAtualizados = searchRes.data.results[0];
                                    }
                                } catch (e) { }
                            }
                        }

                        if (!dadosAtualizados) return;

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

                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: dadosAtualizados.shipping?.id ? String(dadosAtualizados.shipping.id) : null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl, // PRESERVA ETIQUETA EXISTENTE SEM CHAMAR API DE LABELS
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null),
                            itens_pedido: JSON.stringify(itensMapeados),
                            nfe_numero: pedido.nfe_numero,
                            chave_acesso: pedido.chave_acesso,
                            substatus_envio: pedido.substatus_envio || (dadosAtualizados.manufacturing_ending_date ? 'manufacturing' : null),
                            manufacturing_ending_date: dadosAtualizados.manufacturing_ending_date || pedido.manufacturing_ending_date || null
                        };

                        if (dadosAtualizados.shipping?.id) {
                            const dadosEnvio = await this.extrairDadosEnvioSemEtiqueta(dadosAtualizados.shipping.id, accessToken);
                            if (dadosEnvio) {
                                pedidoAtualizado.status_envio = dadosEnvio.status_envio;
                                pedidoAtualizado.substatus_envio = dadosEnvio.substatus_envio || pedidoAtualizado.substatus_envio;
                                if (dadosEnvio.manufacturing_ending_date) pedidoAtualizado.manufacturing_ending_date = dadosEnvio.manufacturing_ending_date;
                                pedidoAtualizado.tipo_envio = dadosEnvio.tipo_envio;
                                pedidoAtualizado.frete_envio = dadosEnvio.frete_envio;
                                pedidoAtualizado.data_limite_envio = dadosEnvio.data_limite_envio;
                                pedidoAtualizado.data_envio_agendado = dadosEnvio.data_envio_agendado;
                                pedidoAtualizado.data_envio_disponivel = dadosEnvio.data_envio_disponivel;
                                pedidoAtualizado.data_previsao_entrega = dadosEnvio.data_previsao_entrega;
                            }
                        }

                        if (!pedidoAtualizado.nfe_numero) {
                            const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                            if (nfData) {
                                pedidoAtualizado.nfe_numero = nfData.invoiceNumber;
                                pedidoAtualizado.chave_acesso = nfData.invoiceKey;
                                if (!pedidoAtualizado.tipo_envio && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        }

                        await this.salvarPedidoNoBanco(pedidoAtualizado);
                        metricas.total_atualizados++;

                    } catch (err) {
                        console.error(`[HUB ML On-Demand] Erro ao monitorar pedido diferente ${pedido.id_pedido_ml}:`, err.message);
                        metricas.erros++;
                    }
                }));
            }
        } catch (error) {
            console.error('[HUB ML On-Demand] Erro no monitoramento de pedidos diferentes:', error);
            throw error;
        } finally {
            client.release();
        }

        return {
            sucesso: true,
            rotina: 'monitoramento_pedidos_diferentes',
            tempo_ms: Date.now() - inicio,
            metricas
        };
    }

    /**
     * 3. ROTINA ON-DEMAND: Monitoramento de Pedidos Existentes por Cliente
     * Atualiza dados de pedidos abertos (status, envio, frete, sla, nfe) SEM chamar /shipment_labels.
     */
    async monitorarPedidosExistentesCliente(clienteId, options = {}) {
        const inicio = Date.now();
        const contas = await this.resolverContasCliente(clienteId, options);
        if (contas.length === 0) {
            return { sucesso: true, mensagem: 'Nenhuma conta ativa encontrada.', metricas: { total_abertos_verificados: 0, total_atualizados: 0, erros: 0, tempo_ms: 0 } };
        }

        const contaIds = contas.map(c => c.id);
        const client = await poolHub.connect();
        const metricas = { total_abertos_verificados: 0, total_atualizados: 0, erros: 0 };
        const dias = options.dias ? parseInt(options.dias, 10) : 60;

        try {
            const query = `
                SELECT p.*, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.seller_id, c.nickname
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE p.status_pedido NOT IN ('cancelled')
                AND (p.status_envio IS NULL OR p.status_envio NOT IN ('cancelled', 'delivered'))
                AND (p.date_created >= NOW() - INTERVAL '${dias} days' OR p.status_envio IS NULL OR p.status_envio IN ('ready_to_ship', 'pending'))
                AND p.conta_id = ANY($1)
            `;
            const result = await client.query(query, [contaIds]);
            const pedidosParaChecar = result.rows;
            metricas.total_abertos_verificados = pedidosParaChecar.length;

            console.log(`[HUB ML On-Demand] Monitorando ${pedidosParaChecar.length} pedidos existentes/abertos do cliente ${clienteId}...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {
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
                        metricas.erros++;
                        return;
                    }

                    try {
                        await delay(100);
                        let dadosAtualizados = null;

                        try {
                            const orderRes = await axios.get(`${ML_API_URL}/orders/${pedido.id_pedido_ml}`, {
                                headers: { 'Authorization': `Bearer ${accessToken}` }
                            });
                            dadosAtualizados = orderRes.data;
                        } catch (errOrder) {
                            if (errOrder.response && (errOrder.response.status === 404 || errOrder.response.status === 403)) {
                                try {
                                    const searchRes = await axios.get(`${ML_API_URL}/orders/search?seller=${pedido.seller_id}&q=${pedido.id_pedido_ml}`, {
                                        headers: { 'Authorization': `Bearer ${accessToken}` }
                                    });
                                    if (searchRes.data.results && searchRes.data.results.length > 0) {
                                        dadosAtualizados = searchRes.data.results[0];
                                    }
                                } catch (e) { }
                            }
                        }

                        if (!dadosAtualizados) return;

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

                        const pedidoAtualizado = {
                            conta_id: pedido.conta_id_real,
                            id_pedido_ml: dadosAtualizados.id,
                            date_created: dadosAtualizados.date_created,
                            status_pedido: dadosAtualizados.status,
                            data_limite_envio: null,
                            id_envio_ml: dadosAtualizados.shipping?.id ? String(dadosAtualizados.shipping.id) : null,
                            status_envio: null,
                            tipo_envio: pedido.tipo_envio || null,
                            etiqueta_zpl: pedido.etiqueta_zpl, // PRESERVA ETIQUETA EXISTENTE SEM CHAMAR API DE LABELS
                            comprador_nickname: dadosAtualizados.buyer?.nickname || null,
                            frete_envio: null,
                            tem_dev: pedido.tem_dev || false,
                            tem_med: pedido.tem_med || false,
                            status_dev: pedido.status_dev || null,
                            status_med: pedido.status_med || null,
                            id_envio_dev: pedido.id_envio_dev || null,
                            status_envio_dev: pedido.status_envio_dev || null,
                            pack_id: dadosAtualizados.pack_id ? String(dadosAtualizados.pack_id) : (pedido.pack_id ? String(pedido.pack_id) : null),
                            itens_pedido: JSON.stringify(itensMapeados),
                            nfe_numero: pedido.nfe_numero,
                            chave_acesso: pedido.chave_acesso,
                            substatus_envio: pedido.substatus_envio || (dadosAtualizados.manufacturing_ending_date ? 'manufacturing' : null),
                            manufacturing_ending_date: dadosAtualizados.manufacturing_ending_date || pedido.manufacturing_ending_date || null
                        };

                        if (dadosAtualizados.shipping?.id) {
                            const dadosEnvio = await this.extrairDadosEnvioSemEtiqueta(dadosAtualizados.shipping.id, accessToken);
                            if (dadosEnvio) {
                                pedidoAtualizado.status_envio = dadosEnvio.status_envio;
                                pedidoAtualizado.substatus_envio = dadosEnvio.substatus_envio || pedidoAtualizado.substatus_envio;
                                if (dadosEnvio.manufacturing_ending_date) pedidoAtualizado.manufacturing_ending_date = dadosEnvio.manufacturing_ending_date;
                                pedidoAtualizado.tipo_envio = dadosEnvio.tipo_envio;
                                pedidoAtualizado.frete_envio = dadosEnvio.frete_envio;
                                pedidoAtualizado.data_limite_envio = dadosEnvio.data_limite_envio;
                                pedidoAtualizado.data_envio_agendado = dadosEnvio.data_envio_agendado;
                                pedidoAtualizado.data_envio_disponivel = dadosEnvio.data_envio_disponivel;
                                pedidoAtualizado.data_previsao_entrega = dadosEnvio.data_previsao_entrega;
                            }
                        }

                        if (!pedidoAtualizado.nfe_numero) {
                            const nfData = await this.buscarNotaFiscal(pedidoAtualizado.id_pedido_ml, pedido.seller_id, accessToken);
                            if (nfData) {
                                pedidoAtualizado.nfe_numero = nfData.invoiceNumber;
                                pedidoAtualizado.chave_acesso = nfData.invoiceKey;
                                if (!pedidoAtualizado.tipo_envio && nfData.logisticType) {
                                    pedidoAtualizado.tipo_envio = nfData.logisticType;
                                }
                            }
                        }

                        await this.salvarPedidoNoBanco(pedidoAtualizado);
                        metricas.total_atualizados++;

                    } catch (err) {
                        console.error(`[HUB ML On-Demand] Erro ao monitorar pedido existente ${pedido.id_pedido_ml}:`, err.message);
                        metricas.erros++;
                    }
                }));
            }
        } catch (error) {
            console.error('[HUB ML On-Demand] Erro no monitoramento de pedidos existentes:', error);
            throw error;
        } finally {
            client.release();
        }

        return {
            sucesso: true,
            rotina: 'monitoramento_pedidos_existentes',
            tempo_ms: Date.now() - inicio,
            metricas
        };
    }

    /**
     * 4. ROTINA ON-DEMAND: Monitoramento de Devoluções e Mediações por Cliente
     * Atualiza reclamações, mediações e devoluções ativas (claims/returns).
     */
    async monitorarDevolucoesCliente(clienteId, options = {}) {
        const inicio = Date.now();
        const contas = await this.resolverContasCliente(clienteId, options);
        if (contas.length === 0) {
            return { sucesso: true, mensagem: 'Nenhuma conta ativa encontrada.', metricas: { total_verificados: 0, devolucoes_ativas: 0, mediacoes_ativas: 0, erros: 0, tempo_ms: 0 } };
        }

        const contaIds = contas.map(c => c.id);
        const client = await poolHub.connect();
        const metricas = { total_verificados: 0, devolucoes_ativas: 0, mediacoes_ativas: 0, erros: 0 };
        const dias = options.dias ? parseInt(options.dias, 10) : 120;

        try {
            const query = `
                SELECT p.id_pedido_ml, p.conta_id, c.access_token, c.refresh_token, c.token_expiration, c.id as conta_id_real, c.nickname 
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE (p.date_created >= NOW() - INTERVAL '${dias} days' OR p.status_envio IS NULL OR p.status_pedido = 'paid')
                AND p.conta_id = ANY($1)
            `;
            const result = await client.query(query, [contaIds]);
            const pedidosParaChecar = result.rows;
            metricas.total_verificados = pedidosParaChecar.length;

            console.log(`[HUB ML On-Demand] Monitorando devoluções de ${pedidosParaChecar.length} pedidos do cliente ${clienteId}...`);

            const chunkSize = 20;
            for (let i = 0; i < pedidosParaChecar.length; i += chunkSize) {
                const chunk = pedidosParaChecar.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (pedido) => {
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
                        metricas.erros++;
                        return;
                    }

                    try {
                        const detalhesReclamacao = await this.buscarDetalhesReclamacao(pedido.id_pedido_ml, accessToken);

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

                        if (detalhesReclamacao.tem_dev) metricas.devolucoes_ativas++;
                        if (detalhesReclamacao.tem_med) metricas.mediacoes_ativas++;
                    } catch (err) {
                        console.error(`[HUB ML On-Demand] Erro ao buscar devolução do pedido ${pedido.id_pedido_ml}:`, err.message);
                        metricas.erros++;
                    }
                }));
            }
        } catch (error) {
            console.error('[HUB ML On-Demand] Erro no monitoramento de devoluções:', error);
            throw error;
        } finally {
            client.release();
        }

        return {
            sucesso: true,
            rotina: 'monitoramento_devolucoes_mediacoes',
            tempo_ms: Date.now() - inicio,
            metricas
        };
    }

    /**
     * 5. ENDPOINT DEDICADO DE ETIQUETAS: Obtenção e Download Real de Etiquetas Personalizadas
     * Executado ESTRITAMENTE quando o usuário seleciona os pedidos na listagem/controle e clica em Imprimir.
     * Suporta passagem de arrays de pedidos (id_pedido_ml), shipment_ids, packs, objetos ou strings separadas por vírgula.
     * Valida permissão do cliente, resolve envios no banco (ou na API do ML se pendente), chama /shipment_labels,
     * salva no banco e retorna as etiquetas individuais + ZPL consolidado para impressão térmica direta.
     */
    async obterEtiquetasEnvio(clienteId, options = {}) {
        const inicio = Date.now();
        const {
            pedidos = [],
            pedido_ids = [],
            shipment_ids = [],
            envios = [],
            ids_envio = [],
            pack_ids = [],
            packs = [],
            formato = 'zpl2',
            consolidar = true,
            salvar_banco = true
        } = options;

        // Normalização flexível de entradas (strings, arrays, objetos { id_pedido_ml, id_envio_ml })
        const extrairIds = (entrada) => {
            if (!entrada) return [];
            if (typeof entrada === 'string') {
                return entrada.split(',').map(s => s.trim()).filter(Boolean);
            }
            if (Array.isArray(entrada)) {
                return entrada.map(item => {
                    if (typeof item === 'object' && item !== null) {
                        return item.id_pedido_ml || item.id_pedido || item.id_envio_ml || item.id_envio || item.id || null;
                    }
                    return String(item).trim();
                }).filter(Boolean);
            }
            return [String(entrada).trim()].filter(Boolean);
        };

        const pedidosSolicitados = [
            ...extrairIds(pedidos),
            ...extrairIds(pedido_ids)
        ];
        const enviosSolicitados = [
            ...extrairIds(shipment_ids),
            ...extrairIds(envios),
            ...extrairIds(ids_envio)
        ];
        const packsSolicitados = [
            ...extrairIds(pack_ids),
            ...extrairIds(packs)
        ];

        // Se o usuário passou IDs genéricos no array pedidos que podem ser shipment ou pedido
        const todosIds = Array.from(new Set([...pedidosSolicitados, ...enviosSolicitados, ...packsSolicitados]));

        if (todosIds.length === 0) {
            throw new Error('Nenhum pedido ou envio foi selecionado. Envie a lista de "pedidos" ou "shipment_ids" desejada para impressão.');
        }

        console.log(`[HUB ML Etiquetas] Processando solicitação de etiquetas para ${todosIds.length} itens do cliente ${clienteId}...`);

        const client = await poolHub.connect();
        try {
            // 1. Busca os registros no banco para identificar quais contas ML pertencem aos pedidos selecionados
            const query = `
                SELECT p.id_pedido_ml, p.id_envio_ml, p.pack_id, p.conta_id, p.etiqueta_zpl, p.status_envio,
                       c.id as conta_id_real, c.seller_id, c.nickname, c.access_token, c.refresh_token, c.token_expiration
                FROM pedidos_mercado_livre p
                JOIN hub_ml_contas c ON p.conta_id = c.id
                WHERE c.cliente_id = $1 
                AND (p.id_pedido_ml = ANY($2) OR p.id_envio_ml = ANY($2) OR p.pack_id = ANY($2))
            `;
            const res = await client.query(query, [clienteId, todosIds]);
            let pedidosEncontrados = res.rows;

            // Se algum ID de pedido não foi encontrado no banco, tenta buscar nas contas do cliente para não deixar na mão
            const pedidosEncontradosSet = new Set(pedidosEncontrados.map(p => String(p.id_pedido_ml)));
            const enviosEncontradosSet = new Set(pedidosEncontrados.map(p => String(p.id_envio_ml)).filter(Boolean));
            const packsEncontradosSet = new Set(pedidosEncontrados.map(p => String(p.pack_id)).filter(Boolean));

            const faltantes = todosIds.filter(id =>
                !pedidosEncontradosSet.has(String(id)) &&
                !enviosEncontradosSet.has(String(id)) &&
                !packsEncontradosSet.has(String(id))
            );

            if (faltantes.length > 0) {
                console.log(`[HUB ML Etiquetas] ${faltantes.length} itens não localizados previamente no banco. Buscando contas para resolução...`);
                const contasCliente = await this.resolverContasCliente(clienteId);

                for (const faltante of faltantes) {
                    for (const conta of contasCliente) {
                        try {
                            const accessToken = await hubTokenService.getValidAccessToken(conta);
                            // Tenta como Pedido
                            try {
                                const orderRes = await axios.get(`${ML_API_URL}/orders/${faltante}`, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });
                                if (orderRes.data && orderRes.data.id) {
                                    const shippingId = orderRes.data.shipping?.id ? String(orderRes.data.shipping.id) : null;
                                    pedidosEncontrados.push({
                                        id_pedido_ml: orderRes.data.id,
                                        id_envio_ml: shippingId,
                                        pack_id: orderRes.data.pack_id ? String(orderRes.data.pack_id) : null,
                                        conta_id_real: conta.id,
                                        nickname: conta.nickname,
                                        seller_id: conta.seller_id,
                                        access_token: conta.access_token,
                                        refresh_token: conta.refresh_token,
                                        token_expiration: conta.token_expiration
                                    });
                                    break;
                                }
                            } catch (e) { }

                            // Tenta como Envio
                            try {
                                const shipRes = await axios.get(`${ML_API_URL}/shipments/${faltante}`, {
                                    headers: { 'Authorization': `Bearer ${accessToken}` }
                                });
                                if (shipRes.data && shipRes.data.id) {
                                    pedidosEncontrados.push({
                                        id_pedido_ml: shipRes.data.order_id ? String(shipRes.data.order_id) : null,
                                        id_envio_ml: String(shipRes.data.id),
                                        pack_id: shipRes.data.pack_id ? String(shipRes.data.pack_id) : null,
                                        conta_id_real: conta.id,
                                        nickname: conta.nickname,
                                        seller_id: conta.seller_id,
                                        access_token: conta.access_token,
                                        refresh_token: conta.refresh_token,
                                        token_expiration: conta.token_expiration
                                    });
                                    break;
                                }
                            } catch (e) { }
                        } catch (e) { }
                    }
                }
            }

            if (pedidosEncontrados.length === 0) {
                return {
                    sucesso: false,
                    mensagem: 'Nenhum dos pedidos selecionados pertence às contas integradas deste usuário ou possui envio elegível.',
                    total_solicitado: todosIds.length,
                    total_gerado: 0,
                    total_falhas: todosIds.length,
                    etiquetas: [],
                    zpl_consolidado: null
                };
            }

            // Agrupa os envios por conta (pois a API /shipment_labels do ML exige o Bearer token da respectiva conta)
            const gruposPorConta = new Map();
            pedidosEncontrados.forEach(p => {
                const idEnvio = p.id_envio_ml;
                if (!idEnvio) {
                    console.warn(`[HUB ML Etiquetas] Pedido ${p.id_pedido_ml} não possui id_envio_ml.`);
                    return;
                }

                if (!gruposPorConta.has(p.conta_id_real)) {
                    gruposPorConta.set(p.conta_id_real, {
                        conta: {
                            id: p.conta_id_real,
                            nickname: p.nickname,
                            refresh_token: p.refresh_token,
                            token_expiration: p.token_expiration,
                            access_token: p.access_token
                        },
                        envios: []
                    });
                }
                const grupo = gruposPorConta.get(p.conta_id_real);
                if (!grupo.envios.some(e => e.id_envio_ml === idEnvio)) {
                    grupo.envios.push(p);
                }
            });

            const resultadosEtiquetas = [];
            const zplAcumulado = [];
            const pdfBuffersAcumulados = [];

            // Processa cada conta
            for (const [contaId, grupo] of gruposPorConta.entries()) {
                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(grupo.conta);
                } catch (e) {
                    grupo.envios.forEach(e => {
                        resultadosEtiquetas.push({
                            id_pedido_ml: e.id_pedido_ml,
                            id_envio_ml: e.id_envio_ml,
                            pack_id: e.pack_id || null,
                            conta: grupo.conta.nickname,
                            sucesso: false,
                            erro: `Falha na autenticação da conta ${grupo.conta.nickname}: ${e.message}`
                        });
                    });
                    continue;
                }

                // Processa envios em lotes de até 50 (limite do Mercado Livre)
                const shipmentIds = grupo.envios.map(e => e.id_envio_ml);
                const chunkSize = 20;

                for (let i = 0; i < shipmentIds.length; i += chunkSize) {
                    const chunkShipmentIds = shipmentIds.slice(i, i + chunkSize);
                    try {
                        await delay(200);
                        const responseTypeParam = formato === 'pdf' ? 'pdf' : 'zpl2';
                        const zplUrl = `${ML_API_URL}/shipment_labels?shipment_ids=${chunkShipmentIds.join(',')}&response_type=${responseTypeParam}`;

                        const zplResponse = await axios.get(zplUrl, {
                            headers: { 'Authorization': `Bearer ${accessToken}` },
                            responseType: 'arraybuffer'
                        });

                        const buffer = zplResponse.data;
                        let conteudoExtraido = null;

                        // Tratamento do retorno ZIP (padrão quando múltiplos envios ZPL/PDF são solicitados)
                        if (buffer && buffer[0] === 0x50 && buffer[1] === 0x4B) {
                            const zip = new AdmZip(buffer);
                            const zipEntries = zip.getEntries();

                            if (formato === 'pdf') {
                                const pdfEntries = zipEntries.filter(entry => entry.entryName.toLowerCase().endsWith('.pdf'));
                                if (pdfEntries.length > 0) {
                                    for (const pEntry of pdfEntries) {
                                        const pBuf = pEntry.getData();
                                        pdfBuffersAcumulados.push(pBuf);
                                        conteudoExtraido = Buffer.from(pBuf).toString('base64');
                                    }
                                } else {
                                    pdfBuffersAcumulados.push(buffer);
                                    conteudoExtraido = Buffer.from(buffer).toString('base64');
                                }
                            } else {
                                const zplEntries = zipEntries.filter(entry => entry.entryName.toLowerCase().endsWith('.txt') || entry.entryName.toLowerCase().endsWith('.zpl'));
                                if (zplEntries.length > 0) {
                                    conteudoExtraido = zplEntries.map(entry => zip.readAsText(entry, 'utf8')).join('\n');
                                } else {
                                    conteudoExtraido = buffer.toString('utf8');
                                }
                            }
                        } else if (formato === 'pdf') {
                            pdfBuffersAcumulados.push(Buffer.from(buffer));
                            conteudoExtraido = Buffer.from(buffer).toString('base64');
                        } else {
                            conteudoExtraido = Buffer.from(buffer).toString('utf8');
                        }

                        // Persiste no banco e estrutura o retorno
                        for (const idEnvio of chunkShipmentIds) {
                            if (salvar_banco) {
                                try {
                                    let updateQuery = `UPDATE pedidos_mercado_livre SET status_impressao = 'sucesso', justificativa_erro = NULL, last_update = NOW()`;
                                    const updateParams = [idEnvio];
                                    if (conteudoExtraido && formato !== 'pdf') {
                                        updateQuery = `UPDATE pedidos_mercado_livre SET etiqueta_zpl = $2, status_impressao = 'sucesso', justificativa_erro = NULL, last_update = NOW()`;
                                        updateParams.push(conteudoExtraido.replace(/\u0000/g, ''));
                                    }
                                    updateQuery += ` WHERE id_envio_ml = $1`;
                                    await client.query(updateQuery, updateParams);
                                } catch (dbErr) {
                                    console.warn(`[HUB ML Etiquetas] Falha ao persistir etiqueta do envio ${idEnvio} no banco:`, dbErr.message);
                                }
                            }

                            const ped = grupo.envios.find(e => e.id_envio_ml === idEnvio);
                            resultadosEtiquetas.push({
                                id_pedido_ml: ped?.id_pedido_ml || null,
                                id_envio_ml: idEnvio,
                                pack_id: ped?.pack_id || null,
                                conta: grupo.conta.nickname,
                                formato: formato,
                                sucesso: true,
                                conteudo: conteudoExtraido
                            });

                            if (conteudoExtraido && formato !== 'pdf') {
                                zplAcumulado.push(conteudoExtraido);
                            }
                        }

                    } catch (errLabels) {
                        const msgErro = errLabels.response?.data?.message || errLabels.response?.data?.error || errLabels.message;
                        console.error(`[HUB ML Etiquetas] Erro ao obter etiquetas dos envios ${chunkShipmentIds.join(',')}:`, msgErro);

                        for (const idEnvio of chunkShipmentIds) {
                            if (salvar_banco) {
                                try {
                                    await client.query(
                                        `UPDATE pedidos_mercado_livre SET status_impressao = 'erro', justificativa_erro = $1, last_update = NOW() WHERE id_envio_ml = $2`,
                                        [msgErro, idEnvio]
                                    );
                                } catch (e) { }
                            }
                            const ped = grupo.envios.find(e => e.id_envio_ml === idEnvio);
                            resultadosEtiquetas.push({
                                id_pedido_ml: ped?.id_pedido_ml || null,
                                id_envio_ml: idEnvio,
                                pack_id: ped?.pack_id || null,
                                conta: grupo.conta.nickname,
                                sucesso: false,
                                erro: msgErro
                            });
                        }
                    }
                }
            }

            let pdfConsolidadoBase64 = null;
            if (consolidar && formato === 'pdf' && pdfBuffersAcumulados.length > 0) {
                try {
                    const mergedPdf = await PDFDocument.create();
                    const labelPagesToCopy = [];
                    const reportPagesToCopy = [];

                    for (const pdfBuf of pdfBuffersAcumulados) {
                        try {
                            const srcDoc = await PDFDocument.load(pdfBuf);
                            const totalPages = srcDoc.getPageCount();
                            for (let pIdx = 0; pIdx < totalPages; pIdx++) {
                                const page = srcDoc.getPage(pIdx);
                                const { width, height } = page.getSize();
                                const isReport = Math.min(width, height) > 450 || Math.max(width, height) > 650;
                                if (isReport) {
                                    reportPagesToCopy.push({ doc: srcDoc, index: pIdx });
                                } else {
                                    labelPagesToCopy.push({ doc: srcDoc, index: pIdx });
                                }
                            }
                        } catch (loadErr) {
                            console.warn('[HUB ML Etiquetas PDF] Erro ao carregar página de PDF:', loadErr.message);
                        }
                    }

                    // 1. Adiciona primeiro TODAS as páginas de etiqueta
                    for (const item of labelPagesToCopy) {
                        const [copiedPage] = await mergedPdf.copyPages(item.doc, [item.index]);
                        mergedPdf.addPage(copiedPage);
                    }

                    // 2. Adiciona depois TODAS as páginas de relatório (A4) ao final do documento
                    for (const item of reportPagesToCopy) {
                        const [copiedPage] = await mergedPdf.copyPages(item.doc, [item.index]);
                        mergedPdf.addPage(copiedPage);
                    }

                    const mergedBytes = await mergedPdf.save();
                    pdfConsolidadoBase64 = Buffer.from(mergedBytes).toString('base64');
                } catch (mergeErr) {
                    console.error('[HUB ML Etiquetas PDF] Erro ao consolidar PDFs:', mergeErr.message);
                }
            }

            const totalGerado = resultadosEtiquetas.filter(r => r.sucesso).length;
            const totalFalhas = resultadosEtiquetas.filter(r => !r.sucesso).length;

            return {
                sucesso: totalGerado > 0,
                formato,
                total_solicitado: todosIds.length,
                total_identificado: pedidosEncontrados.length,
                total_gerado: totalGerado,
                total_falhas: totalFalhas,
                tempo_ms: Date.now() - inicio,
                zpl_consolidado: consolidar && formato !== 'pdf' ? zplAcumulado.join('\n') : null,
                pdf_consolidado: pdfConsolidadoBase64,
                etiquetas: resultadosEtiquetas
            };

        } finally {
            client.release();
        }
    }
}

module.exports = new HubMercadoLivreService();