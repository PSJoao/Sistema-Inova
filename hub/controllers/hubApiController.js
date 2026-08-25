const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { poolHub, poolProdutos } = require('../config/database');
const hubMercadoLivreService = require('../services/hubMercadoLivreService');
const hubProdutosService = require('../services/hubProdutosService');
const hubTokenService = require('../services/hubTokenService');

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await poolHub.query('SELECT * FROM hub_clientes WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(400).json({ error: 'Cliente não encontrado' });

        const cliente = result.rows[0];
        const validPass = await bcrypt.compare(password, cliente.senha_hash);

        if (!validPass) return res.status(400).json({ error: 'Senha incorreta' });

        // Gera token
        const token = jwt.sign(
            { id: cliente.id, email: cliente.email },
            JWT_SECRET,
            { expiresIn: '36500d' }
        );

        res.json({
            token,
            message: 'Guarde este token. Ele é sua chave de acesso à API.'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro interno no login' });
    }
};

exports.getPedidos = async (req, res) => {
    const clienteId = req.user.id;

    // Filtros e Paginação
    const { status, data_inicio, limit, offset } = req.query;

    // Definição de limites (Padrão 1000, como solicitado)
    const limiteReal = limit ? parseInt(limit) : 1000;
    const offsetReal = offset ? parseInt(offset) : 0;

    let query = `
        SELECT p.*, c.nickname as nome_loja
        FROM pedidos_mercado_livre p
        JOIN hub_ml_contas c ON p.conta_id = c.id
        WHERE c.cliente_id = $1
    `;
    const params = [clienteId];
    let paramCount = 1;

    if (status) {
        paramCount++;
        query += ` AND p.status_pedido = $${paramCount}`;
        params.push(status);
    }

    if (data_inicio) {
        paramCount++;
        query += ` AND p.date_created >= $${paramCount}`;
        params.push(data_inicio);
    }

    // Ordenação e Paginação
    query += ` ORDER BY p.date_created DESC LIMIT ${limiteReal} OFFSET ${offsetReal}`;

    try {
        const result = await poolHub.query(query, params);
        const rows = result.rows;

        // Se o cliente (Sistema Inova) pedir os dados crus (sem agrupar por envio)
        if (req.query.raw === 'true') {
            return res.json({
                total_retornado: rows.length,
                pagina_atual: { limit: limiteReal, offset: offsetReal },
                dados: rows
            });
        }

        // --- LÓGICA DE AGRUPAMENTO (Consolidação de Pacotes) ---
        // Aqui transformamos a lista crua de pedidos em uma lista inteligente de pacotes
        const pacotesMap = new Map();

        rows.forEach(p => {
            // A chave de agrupamento é o ID do envio. 
            // Se não tiver envio (ex: cancelado antes), usa o ID do pedido mesmo.
            const chave = p.id_envio_ml || `pedido_${p.id_pedido_ml}`;

            if (!pacotesMap.has(chave)) {
                // Se é a primeira vez que vemos esse envio, criamos a base do pacote
                pacotesMap.set(chave, {
                    id_envio_ml: p.id_envio_ml,
                    status_envio: p.status_envio,
                    data_criacao: p.date_created,
                    data_limite_envio: p.data_limite_envio,
                    data_envio_disponivel: p.data_envio_disponivel,
                    data_envio_agendado: p.data_envio_agendado,
                    data_previsao_entrega: p.data_previsao_entrega,
                    comprador_nickname: p.comprador_nickname,
                    etiqueta_zpl: p.etiqueta_zpl,
                    conta_id: p.conta_id,
                    nome_loja: p.nome_loja,
                    status_pedido_geral: p.status_pedido,
                    frete_envio: p.frete_envio,
                    tipo_envio: p.tipo_envio || null,
                    // --- NOVOS CAMPOS ---
                    tem_dev: p.tem_dev || false,
                    tem_med: p.tem_med || false,
                    status_dev: p.status_dev || null,
                    status_med: p.status_med || null,
                    id_envio_dev: p.id_envio_dev || null,
                    status_envio_dev: p.status_envio_dev || null,
                    nfe_numero: p.nfe_numero || null,
                    chave_acesso: p.chave_acesso || null,
                    pack_id: p.pack_id || null,
                    // --------------------
                    ids_pedidos_originais: [],
                    itens: []
                });
            }

            // Recupera o pacote que estamos montando
            const pacote = pacotesMap.get(chave);

            // Garante que a devolução/mediação não passe em branco em pacotes com múltiplos pedidos
            if (p.tem_dev) {
                pacote.tem_dev = true;
                pacote.status_dev = p.status_dev;
                pacote.id_envio_dev = p.id_envio_dev;
                pacote.status_envio_dev = p.status_envio_dev;
            }
            if (p.tem_med) {
                pacote.tem_med = true;
                pacote.status_med = p.status_med;
            }

            // 1. Adiciona o ID deste pedido à lista
            pacote.ids_pedidos_originais.push(p.id_pedido_ml);

            // 2. Processa e adiciona os itens
            let itens = p.itens_pedido;
            if (typeof itens === 'string') {
                try { itens = JSON.parse(itens); } catch (e) { itens = []; }
            }

            if (Array.isArray(itens)) {
                // Adiciona os itens deste pedido à lista geral do pacote
                pacote.itens = pacote.itens.concat(itens);
            }
        });

        // Transforma o Map em um Array limpo para retornar
        const listaConsolidada = Array.from(pacotesMap.values());

        res.json({
            total_retornado: listaConsolidada.length,
            pagina_atual: {
                limit: limiteReal,
                offset: offsetReal
            },
            dados: listaConsolidada
        });

    } catch (error) {
        console.error('Erro ao buscar lista de pedidos:', error);
        res.status(500).json({ error: 'Erro interno ao buscar pedidos.' });
    }
};

exports.getEnvioPorId = async (req, res) => {
    const clienteId = req.user.id;
    const paramId = req.params.id_envio; // Pode ser ID do Envio OU ID do Pedido

    try {
        // QUERY INTELIGENTE:
        // 1. A subquery (dentro dos parênteses) descobre qual é o ID DO ENVIO real ou pack_id,
        //    mesmo que você tenha passado o ID de um Pedido ou pack_id.
        // 2. A query principal puxa tudo que pertence a esse ID de Envio ou pack_id descoberto.
        const query = `
            SELECT p.*, c.nickname as nome_loja
            FROM pedidos_mercado_livre p
            JOIN hub_ml_contas c ON p.conta_id = c.id
            WHERE (
                (p.id_envio_ml IS NOT NULL AND p.id_envio_ml = (
                    SELECT id_envio_ml
                    FROM pedidos_mercado_livre p2
                    JOIN hub_ml_contas c2 ON p2.conta_id = c2.id
                    WHERE (p2.id_pedido_ml = $1 OR p2.id_envio_ml = $1 OR p2.pack_id = $1) 
                    AND c2.cliente_id = $2
                    LIMIT 1
                ))
                OR
                (p.pack_id IS NOT NULL AND p.pack_id = (
                    SELECT pack_id
                    FROM pedidos_mercado_livre p2
                    JOIN hub_ml_contas c2 ON p2.conta_id = c2.id
                    WHERE (p2.id_pedido_ml = $1 OR p2.id_envio_ml = $1 OR p2.pack_id = $1) 
                    AND c2.cliente_id = $2
                    LIMIT 1
                ))
            )
            AND c.cliente_id = $2
        `;

        const result = await poolHub.query(query, [paramId, clienteId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Envio não encontrado, não possui etiqueta gerada ou não pertence a sua conta.'
            });
        }

        const pedidos = result.rows;
        const base = pedidos[0];

        // --- LÓGICA DE AGRUPAMENTO (MERGE) ---
        // (Igual à anterior, mas vital para manter o formato de Pacote)
        let todosItens = [];
        let idsPedidos = [];

        pedidos.forEach(p => {
            idsPedidos.push(p.id_pedido_ml);

            // Captura devolução/mediação se algum dos pedidos agrupados tiver
            if (p.tem_dev) {
                base.tem_dev = true;
                base.status_dev = p.status_dev;
                base.id_envio_dev = p.id_envio_dev;
                base.status_envio_dev = p.status_envio_dev;
            }
            if (p.tem_med) {
                base.tem_med = true;
                base.status_med = p.status_med;
            }

            let itens = p.itens_pedido;
            if (typeof itens === 'string') {
                try { itens = JSON.parse(itens); } catch (e) { itens = []; }
            }
            if (Array.isArray(itens)) {
                todosItens = todosItens.concat(itens);
            }
        });

        const respostaConsolidada = {
            id_envio_ml: base.id_envio_ml,
            status_envio: base.status_envio,
            data_criacao: base.date_created,
            data_limite_envio: base.data_limite_envio,
            data_envio_disponivel: base.data_envio_disponivel,
            data_envio_agendado: base.data_envio_agendado,
            data_previsao_entrega: base.data_previsao_entrega,
            comprador_nickname: base.comprador_nickname,
            etiqueta_zpl: base.etiqueta_zpl,
            conta_id: base.conta_id,
            nome_loja: base.nome_loja,
            frete_envio: base.frete_envio,
            tipo_envio: base.tipo_envio || null,

            tem_dev: base.tem_dev || false,
            tem_med: base.tem_med || false,
            status_dev: base.status_dev || null,
            status_med: base.status_med || null,
            id_envio_dev: base.id_envio_dev || null,
            status_envio_dev: base.status_envio_dev || null,
            pack_id: base.pack_id || null,

            // Aqui mostramos todos os pedidos que foram achados através daquele ID
            ids_pedidos_originais: idsPedidos,
            itens: todosItens
        };

        res.json(respostaConsolidada);

    } catch (error) {
        console.error('Erro ao buscar envio inteligente:', error);
        res.status(500).json({ error: 'Erro interno ao buscar dados do envio.' });
    }
};

exports.sincronizarProdutos = async (req, res) => {
    try {
        // Dispara o processo em background
        hubProdutosService.sincronizarAnuncios();
        res.json({ message: 'Sincronização de produtos iniciada em background.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao iniciar sincronização.' });
    }
};

exports.getProdutos = async (req, res) => {
    const clienteId = req.user.id;

    // Filtros e Paginação
    const { status, limit, offset, tipo } = req.query;

    const limiteReal = limit ? parseInt(limit) : 1000;
    const offsetReal = offset ? parseInt(offset) : 0;

    try {
        // 1. Descobrir as contas (empresas) que pertencem a este cliente no banco principal
        const contasResult = await poolHub.query('SELECT nickname FROM hub_ml_contas WHERE cliente_id = $1', [clienteId]);
        const empresas = contasResult.rows.map(row => row.nickname);

        // Se o cliente não tem nenhuma conta integrada, retorna vazio
        if (empresas.length === 0) {
            return res.json({
                total_retornado: 0,
                pagina_atual: { limit: limiteReal, offset: offsetReal },
                dados: []
            });
        }

        // 2. Consultar os produtos no banco secundário filtrando pelas empresas permitidas
        let query = `SELECT * FROM produtos_anuncios WHERE empresa = ANY($1)`;
        const params = [empresas];
        let paramCount = 1;

        if (status) {
            paramCount++;
            query += ` AND status = $${paramCount}`;
            params.push(status);
        }

        if (tipo) {
            paramCount++;
            query += ` AND tipo = $${paramCount}`;
            params.push(tipo);
        }

        // Ordenação e Paginação
        query += ` ORDER BY last_update DESC LIMIT ${limiteReal} OFFSET ${offsetReal}`;

        const result = await poolProdutos.query(query, params);

        res.json({
            total_retornado: result.rows.length,
            pagina_atual: {
                limit: limiteReal,
                offset: offsetReal
            },
            dados: result.rows
        });

    } catch (error) {
        console.error('Erro ao buscar lista de produtos:', error);
        res.status(500).json({ error: 'Erro interno ao buscar produtos.' });
    }
};

exports.getProdutoPorId = async (req, res) => {
    const clienteId = req.user.id;
    const identificador = req.params.identificador; // Pode ser ID do Anúncio ou SKU

    try {
        // 1. Descobrir as empresas do cliente para validação de segurança
        const contasResult = await poolHub.query('SELECT nickname FROM hub_ml_contas WHERE cliente_id = $1', [clienteId]);
        const empresas = contasResult.rows.map(row => row.nickname);

        if (empresas.length === 0) {
            return res.status(403).json({ error: 'Nenhuma conta vinculada a este cliente.' });
        }

        // 2. Busca específica usando id_anuncio OU sku
        const query = `
            SELECT * FROM produtos_anuncios 
            WHERE (id_anuncio = $2 OR sku = $2) 
            AND empresa = ANY($1)
            LIMIT 1
        `;

        const result = await poolProdutos.query(query, [empresas, identificador]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Produto não encontrado ou não pertence a sua conta.'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Erro ao buscar produto específico:', error);
        res.status(500).json({ error: 'Erro interno ao buscar dados do produto.' });
    }
};

exports.monitoramentoInstantaneo = async (req, res) => {
    const clienteId = req.user.id;
    const { ids, pedidos } = req.query;

    if (!ids && !pedidos) {
        return res.status(400).json({ error: 'Parâmetros ids ou pedidos são obrigatórios' });
    }

    const idsArray = ids ? ids.split(',').map(id => id.trim()).filter(id => id) : [];
    const pedidosArray = pedidos ? pedidos.split(',').map(id => id.trim()).filter(id => id) : [];

    if (idsArray.length === 0 && pedidosArray.length === 0) {
        return res.status(400).json({ error: 'Envie pelo menos um ID válido.' });
    }

    try {
        // 1. Executar a rotina de monitoramento instantâneo
        await hubMercadoLivreService.monitorarPedidosInstantaneo(idsArray, pedidosArray, clienteId);

        // 2. Buscar os pedidos atualizados no banco e consolidá-los (mesma lógica de getPedidos)
        const query = `
            SELECT p.*, c.nickname as nome_loja
            FROM pedidos_mercado_livre p
            JOIN hub_ml_contas c ON p.conta_id = c.id
            WHERE c.cliente_id = $1 AND (p.id_pedido_ml = ANY($2) OR p.id_envio_ml = ANY($3) OR p.pack_id = ANY($2))
        `;
        const result = await poolHub.query(query, [clienteId, pedidosArray, idsArray]);
        const rows = result.rows;

        const pacotesMap = new Map();

        rows.forEach(p => {
            const chave = p.id_envio_ml || `pedido_${p.id_pedido_ml}`;

            if (!pacotesMap.has(chave)) {
                pacotesMap.set(chave, {
                    id_pedido_ml: p.id_pedido_ml,
                    id_envio_ml: p.id_envio_ml,
                    status_envio: p.status_envio,
                    data_criacao: p.date_created,
                    data_limite_envio: p.data_limite_envio,
                    data_envio_disponivel: p.data_envio_disponivel,
                    data_envio_agendado: p.data_envio_agendado,
                    data_previsao_entrega: p.data_previsao_entrega,
                    comprador_nickname: p.comprador_nickname,
                    etiqueta_zpl: p.etiqueta_zpl,
                    conta_id: p.conta_id,
                    nome_loja: p.nome_loja,
                    status_pedido_geral: p.status_pedido,
                    frete_envio: p.frete_envio,
                    tipo_envio: p.tipo_envio || null,
                    tem_dev: p.tem_dev || false,
                    tem_med: p.tem_med || false,
                    status_dev: p.status_dev || null,
                    status_med: p.status_med || null,
                    id_envio_dev: p.id_envio_dev || null,
                    status_envio_dev: p.status_envio_dev || null,
                    nfe_numero: p.nfe_numero || null,
                    chave_acesso: p.chave_acesso || null,
                    pack_id: p.pack_id || null,
                    ids_pedidos_originais: [],
                    itens: []
                });
            }

            const pacote = pacotesMap.get(chave);

            if (p.tem_dev) {
                pacote.tem_dev = true;
                pacote.status_dev = p.status_dev;
                pacote.id_envio_dev = p.id_envio_dev;
                pacote.status_envio_dev = p.status_envio_dev;
            }
            if (p.tem_med) {
                pacote.tem_med = true;
                pacote.status_med = p.status_med;
            }

            pacote.ids_pedidos_originais.push(p.id_pedido_ml);

            let itens = p.itens_pedido;
            if (typeof itens === 'string') {
                try { itens = JSON.parse(itens); } catch (e) { itens = []; }
            }

            if (Array.isArray(itens)) {
                pacote.itens = pacote.itens.concat(itens);
            }
        });

        const listaConsolidada = Array.from(pacotesMap.values());

        res.json({
            total_retornado: listaConsolidada.length,
            dados: listaConsolidada
        });

    } catch (error) {
        console.error('Erro no monitoramento instantâneo:', error);
        res.status(500).json({ error: 'Erro interno ao realizar monitoramento instantâneo.' });
    }
};

exports.sincronizarProdutosManuais = async (req, res) => {
    const { seller_ids } = req.body;

    // Validação: seller_ids deve ser um array com pelo menos 1 elemento
    if (!seller_ids || !Array.isArray(seller_ids) || seller_ids.length === 0) {
        return res.status(400).json({
            error: 'O campo "seller_ids" é obrigatório e deve ser um array com pelo menos um seller_id.',
            exemplo: { seller_ids: ["123456789", "987654321"] }
        });
    }

    // Verifica a trava ANTES de disparar o background
    if (hubProdutosService._syncManualEmAndamento) {
        return res.status(409).json({
            error: 'Já existe uma sincronização manual em andamento. Aguarde a conclusão antes de iniciar outra.'
        });
    }

    // Converte todos para string para consistência
    const sellerIdsLimpos = seller_ids.map(id => String(id).trim()).filter(id => id);

    // Dispara a sincronização em background (não bloqueia a resposta)
    hubProdutosService.sincronizarAnunciosManuais(sellerIdsLimpos)
        .then(resultado => {
            console.log('[HUB PRODUTOS] Resultado da sincronização manual:', resultado);
        })
        .catch(err => {
            console.error('[HUB PRODUTOS] Erro na sincronização manual em background:', err.message);
        });

    res.status(202).json({
        message: 'Sincronização manual iniciada em background.',
        seller_ids: sellerIdsLimpos,
        aviso: 'O processo está rodando em segundo plano. Novas chamadas serão bloqueadas até a conclusão.'
    });
};

// =====================================================
// PRAZO DE DISPONIBILIDADE (MANUFACTURING_TIME)
// =====================================================

/**
 * PUT /api/anuncios/prazo-disponibilidade
 * Define o prazo de disponibilidade (MANUFACTURING_TIME) em um ou mais anúncios.
 * 
 * Body esperado:
 * {
 *   "itens": ["MLB1234567890", "MLB0987654321"],
 *   "dias": 5
 * }
 */
exports.setPrazoDisponibilidade = async (req, res) => {
    const clienteId = req.user.id;
    const { itens, dias } = req.body;

    // Validação de entrada
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({
            error: 'O campo "itens" é obrigatório e deve ser um array com pelo menos um ID de anúncio.',
            exemplo: { itens: ["MLB1234567890"], dias: 5 }
        });
    }

    if (!dias || isNaN(dias) || dias < 1 || dias > 45) {
        return res.status(400).json({
            error: 'O campo "dias" é obrigatório e deve ser um número entre 1 e 45.',
            exemplo: { itens: ["MLB1234567890"], dias: 5 }
        });
    }

    const itensLimpos = itens.map(id => String(id).trim().toUpperCase()).filter(id => id);

    try {
        const resultados = [];

        for (const itemId of itensLimpos) {
            try {
                // 1. Descobre qual conta ML é dona deste anúncio
                const conta = await hubProdutosService.resolverContaPorItem(itemId, clienteId);

                if (!conta) {
                    resultados.push({
                        item_id: itemId,
                        sucesso: false,
                        erro: 'Anúncio não encontrado ou não pertence a nenhuma conta vinculada a este cliente.'
                    });
                    continue;
                }

                // 2. Pega o token válido (renova se necessário)
                const accessToken = await hubTokenService.getValidAccessToken(conta);

                // 3. Chama a API do ML para definir o prazo
                await hubProdutosService.setPrazoDisponibilidade(itemId, dias, accessToken);

                resultados.push({
                    item_id: itemId,
                    sucesso: true,
                    dias_aplicados: dias,
                    conta: conta.nickname
                });

            } catch (errItem) {
                resultados.push({
                    item_id: itemId,
                    sucesso: false,
                    erro: errItem.response?.data?.message || errItem.response?.data?.error || errItem.message
                });
            }
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const falhas = resultados.filter(r => !r.sucesso).length;

        res.json({
            resumo: {
                total: itensLimpos.length,
                sucessos,
                falhas
            },
            resultados
        });

    } catch (error) {
        console.error('Erro ao definir prazo de disponibilidade:', error);
        res.status(500).json({ error: 'Erro interno ao definir prazo de disponibilidade.' });
    }
};

/**
 * DELETE /api/anuncios/prazo-disponibilidade
 * Remove o prazo de disponibilidade (MANUFACTURING_TIME) de um ou mais anúncios.
 * 
 * Body esperado:
 * {
 *   "itens": ["MLB1234567890", "MLB0987654321"]
 * }
 */
exports.removerPrazoDisponibilidade = async (req, res) => {
    const clienteId = req.user.id;
    const { itens } = req.body;

    // Validação de entrada
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({
            error: 'O campo "itens" é obrigatório e deve ser um array com pelo menos um ID de anúncio.',
            exemplo: { itens: ["MLB1234567890"] }
        });
    }

    const itensLimpos = itens.map(id => String(id).trim().toUpperCase()).filter(id => id);

    try {
        const resultados = [];

        for (const itemId of itensLimpos) {
            try {
                // 1. Descobre qual conta ML é dona deste anúncio
                const conta = await hubProdutosService.resolverContaPorItem(itemId, clienteId);

                if (!conta) {
                    resultados.push({
                        item_id: itemId,
                        sucesso: false,
                        erro: 'Anúncio não encontrado ou não pertence a nenhuma conta vinculada a este cliente.'
                    });
                    continue;
                }

                // 2. Pega o token válido (renova se necessário)
                const accessToken = await hubTokenService.getValidAccessToken(conta);

                // 3. Chama a API do ML para remover o prazo
                await hubProdutosService.removerPrazoDisponibilidade(itemId, accessToken);

                resultados.push({
                    item_id: itemId,
                    sucesso: true,
                    prazo_removido: true,
                    conta: conta.nickname
                });

            } catch (errItem) {
                resultados.push({
                    item_id: itemId,
                    sucesso: false,
                    erro: errItem.response?.data?.message || errItem.response?.data?.error || errItem.message
                });
            }
        }

        const sucessos = resultados.filter(r => r.sucesso).length;
        const falhas = resultados.filter(r => !r.sucesso).length;

        res.json({
            resumo: {
                total: itensLimpos.length,
                sucessos,
                falhas
            },
            resultados
        });

    } catch (error) {
        console.error('Erro ao remover prazo de disponibilidade:', error);
        res.status(500).json({ error: 'Erro interno ao remover prazo de disponibilidade.' });
    }
};

// =====================================================
// GESTÃO DE PROMOÇÕES (OPT-IN E OPT-OUT VIA API)
// =====================================================

/**
 * POST /api/promocoes/opt-in
 * Adiciona um anúncio a uma promoção no Mercado Livre.
 * 
 * Body esperado:
 * {
 *   "item_id": "MLB1234567890",
 *   "promotion_id": "P-MLB123",
 *   "promotion_type": "DEAL",
 *   "deal_price": 749.00,
 *   "options": { "ref_id": "..." }
 * }
 */
exports.aderirPromocao = async (req, res) => {
    const clienteId = req.user?.id || null;
    const { item_id, promotion_id, promotion_type, deal_price, options } = req.body;

    if (!item_id) {
        return res.status(400).json({ error: 'O campo "item_id" é obrigatório.' });
    }

    try {
        const resultado = await hubProdutosService.aderirPromocaoItem(
            item_id,
            promotion_id,
            promotion_type,
            deal_price,
            options || {},
            clienteId
        );

        res.status(200).json({
            success: true,
            message: `Anúncio ${item_id} adicionado à promoção com sucesso!`,
            ...resultado
        });
    } catch (error) {
        console.error(`[HUB API] Erro no opt-in de promoção para ${item_id}:`, error.message);
        res.status(400).json({
            success: false,
            error: error.message || 'Erro ao participar da promoção no Mercado Livre.'
        });
    }
};

/**
 * POST /api/promocoes/opt-out
 * Remove um anúncio de uma promoção no Mercado Livre.
 * 
 * Body esperado:
 * {
 *   "item_id": "MLB1234567890",
 *   "promotion_id": "P-MLB123",
 *   "promotion_type": "DEAL"
 * }
 */
exports.removerPromocao = async (req, res) => {
    const clienteId = req.user?.id || null;
    const body = req.body || {};
    const query = req.query || {};
    const item_id = body.item_id || query.item_id;
    const promotion_id = body.promotion_id || query.promotion_id;
    const promotion_type = body.promotion_type || query.promotion_type;
    const options = body.options || query.options || {
        offer_id: body.offer_id || query.offer_id,
        ref_id: body.ref_id || query.ref_id
    };

    if (!item_id) {
        return res.status(400).json({ error: 'O campo "item_id" é obrigatório.' });
    }

    try {
        const resultado = await hubProdutosService.removerPromocaoItem(
            item_id,
            promotion_id,
            promotion_type,
            options,
            clienteId
        );


        res.status(200).json({
            success: true,
            message: `Anúncio ${item_id} removido da promoção com sucesso!`,
            ...resultado
        });
    } catch (error) {
        console.error(`[HUB API] Erro no opt-out de promoção para ${item_id}:`, error.message);
        res.status(400).json({
            success: false,
            error: error.message || 'Erro ao sair da promoção no Mercado Livre.'
        });
    }
};

// =========================================================================
// ROTINAS ON-DEMAND DE SINCRONIZAÇÃO DE PEDIDOS (DISPARADAS POR GATILHO/HTTP)
// =========================================================================

/**
 * POST /api/pedidos/sincronizar/novos
 * Dispara sob demanda a captura paginada de novos pedidos recentes.
 * NÃO chama /shipment_labels para não marcar etiquetas como impressas prematuramente.
 */
exports.sincronizarNovosPedidos = async (req, res) => {
    const clienteId = req.user.id;
    const { conta_id, seller_id, dias, limit } = req.body || {};

    try {
        const resultado = await hubMercadoLivreService.capturarNovosPedidosCliente(clienteId, {
            conta_id,
            seller_id,
            dias,
            limit
        });

        res.status(200).json(resultado);
    } catch (error) {
        console.error('[HUB API] Erro na captura de novos pedidos sob demanda:', error.message);
        res.status(error.message.includes('não encontrada') ? 403 : 500).json({
            sucesso: false,
            error: error.message || 'Erro interno ao sincronizar novos pedidos.'
        });
    }
};

/**
 * POST /api/pedidos/sincronizar/diferentes
 * Dispara sob demanda o monitoramento de pedidos pagos sem envio/status no banco.
 * NÃO chama /shipment_labels.
 */
exports.sincronizarPedidosDiferentes = async (req, res) => {
    const clienteId = req.user.id;
    const { conta_id, seller_id } = req.body || {};

    try {
        const resultado = await hubMercadoLivreService.monitorarPedidosDiferentesCliente(clienteId, {
            conta_id,
            seller_id
        });

        res.status(200).json(resultado);
    } catch (error) {
        console.error('[HUB API] Erro no monitoramento de pedidos diferentes sob demanda:', error.message);
        res.status(error.message.includes('não encontrada') ? 403 : 500).json({
            sucesso: false,
            error: error.message || 'Erro interno ao monitorar pedidos diferentes.'
        });
    }
};

/**
 * POST /api/pedidos/sincronizar/existentes
 * Dispara sob demanda a atualização completa de pedidos abertos/ativos.
 * NÃO chama /shipment_labels.
 */
exports.sincronizarPedidosExistentes = async (req, res) => {
    const clienteId = req.user.id;
    const { conta_id, seller_id, dias } = req.body || {};

    try {
        const resultado = await hubMercadoLivreService.monitorarPedidosExistentesCliente(clienteId, {
            conta_id,
            seller_id,
            dias
        });

        res.status(200).json(resultado);
    } catch (error) {
        console.error('[HUB API] Erro no monitoramento de pedidos existentes sob demanda:', error.message);
        res.status(error.message.includes('não encontrada') ? 403 : 500).json({
            sucesso: false,
            error: error.message || 'Erro interno ao monitorar pedidos existentes.'
        });
    }
};

/**
 * POST /api/pedidos/sincronizar/devolucoes
 * Dispara sob demanda o monitoramento de devoluções, mediações e logística reversa.
 */
exports.sincronizarDevolucoes = async (req, res) => {
    const clienteId = req.user.id;
    const { conta_id, seller_id, dias } = req.body || {};

    try {
        const resultado = await hubMercadoLivreService.monitorarDevolucoesCliente(clienteId, {
            conta_id,
            seller_id,
            dias
        });

        res.status(200).json(resultado);
    } catch (error) {
        console.error('[HUB API] Erro no monitoramento de devoluções sob demanda:', error.message);
        res.status(error.message.includes('não encontrada') ? 403 : 500).json({
            sucesso: false,
            error: error.message || 'Erro interno ao monitorar devoluções.'
        });
    }
};

// =========================================================================
// ENDPOINT ISOLADO E DEDICADO PARA GESTÃO/DOWNLOAD REAL DE ETIQUETAS
// =========================================================================

/**
 * POST /api/pedidos/etiquetas/obter
 * Busca e baixa etiquetas de envio no ML APENAS no momento da impressão real para os pedidos selecionados pelo usuário.
 * 
 * Body esperado:
 * {
 *   "pedidos": ["2000001234567", "2000009876543"], // lista de IDs de pedidos selecionados no controle
 *   "formato": "zpl2", // "zpl2" (padrão para térmicas) ou "pdf"
 *   "consolidar": true // retorna zpl_consolidado com todos os ZPLs concatenados para envio direto à impressora
 * }
 */
exports.obterEtiquetasEnvio = async (req, res) => {
    const clienteId = req.user.id;
    const body = req.body || {};
    const query = req.query || {};

    const pedidos = body.pedidos || body.pedido_ids || body.ids || query.pedidos || query.pedido_ids;
    const shipment_ids = body.shipment_ids || body.envios || body.ids_envio || query.shipment_ids || query.envios;
    const pack_ids = body.pack_ids || body.packs || query.pack_ids;
    const formato = body.formato || query.formato || 'zpl2';
    const consolidar = body.consolidar !== undefined ? body.consolidar : (query.consolidar !== undefined ? query.consolidar === 'true' : true);
    const salvar_banco = body.salvar_banco !== undefined ? body.salvar_banco : (query.salvar_banco !== undefined ? query.salvar_banco !== 'false' : true);

    try {
        const resultado = await hubMercadoLivreService.obterEtiquetasEnvio(clienteId, {
            pedidos,
            pedido_ids: body.pedido_ids,
            shipment_ids,
            pack_ids,
            formato,
            consolidar,
            salvar_banco
        });

        // Se o cliente pediu resposta em texto cru (ex: raw=true e formato=zpl2 com zpl_consolidado)
        if ((req.query.raw === 'true' || req.body.raw === true) && resultado.zpl_consolidado) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.send(resultado.zpl_consolidado);
        }

        res.status(resultado.sucesso ? 200 : 404).json(resultado);
    } catch (error) {
        console.error('[HUB API] Erro ao obter etiquetas de envio:', error.message);
        res.status(400).json({
            sucesso: false,
            error: error.message || 'Erro ao processar etiquetas de envio.'
        });
    }
};

/**
 * GET /api/pedidos/etiquetas/:id_envio
 * Rota conveniente para baixar/visualizar etiqueta de envio individual.
 */
exports.baixarEtiquetaPorEnvio = async (req, res) => {
    const clienteId = req.user.id;
    const { id_envio } = req.params;
    const formato = req.query.formato || 'zpl2';

    try {
        const resultado = await hubMercadoLivreService.obterEtiquetasEnvio(clienteId, {
            shipment_ids: [id_envio],
            formato
        });

        if (!resultado.sucesso || resultado.etiquetas.length === 0 || !resultado.etiquetas[0].sucesso) {
            return res.status(404).json({
                sucesso: false,
                error: resultado.etiquetas?.[0]?.erro || 'Etiqueta não encontrada ou não gerada para este envio.'
            });
        }

        const etiqueta = resultado.etiquetas[0];

        // Se o cliente pediu ZPL puro via header ou query
        if (req.query.raw === 'true') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.send(etiqueta.conteudo);
        }

        res.status(200).json({
            sucesso: true,
            ...etiqueta
        });
    } catch (error) {
        console.error(`[HUB API] Erro ao buscar etiqueta do envio ${id_envio}:`, error.message);
        res.status(500).json({
            sucesso: false,
            error: error.message || 'Erro interno ao obter etiqueta.'
        });
    }
};

