const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const { poolHub, poolProdutos } = require('../config/database');

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
                    // --- NOVOS CAMPOS ---
                    tem_dev: p.tem_dev || false,
                    tem_med: p.tem_med || false,
                    status_dev: p.status_dev || null,
                    status_med: p.status_med || null,
                    id_envio_dev: p.id_envio_dev || null,
                    status_envio_dev: p.status_envio_dev || null,
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
                try { itens = JSON.parse(itens); } catch(e) { itens = []; }
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
        // 1. A subquery (dentro dos parênteses) descobre qual é o ID DO ENVIO real,
        //    mesmo que você tenha passado o ID de um Pedido.
        // 2. A query principal puxa tudo que pertence a esse ID de Envio descoberto.
        const query = `
            SELECT p.*, c.nickname as nome_loja
            FROM pedidos_mercado_livre p
            JOIN hub_ml_contas c ON p.conta_id = c.id
            WHERE p.id_envio_ml = (
                SELECT id_envio_ml
                FROM pedidos_mercado_livre p2
                JOIN hub_ml_contas c2 ON p2.conta_id = c2.id
                WHERE (p2.id_pedido_ml = $1 OR p2.id_envio_ml = $1) 
                AND c2.cliente_id = $2
                LIMIT 1
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
                try { itens = JSON.parse(itens); } catch(e) { itens = []; }
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
            
            tem_dev: base.tem_dev || false,
            tem_med: base.tem_med || false,
            status_dev: base.status_dev || null,
            status_med: base.status_med || null,
            id_envio_dev: base.id_envio_dev || null,
            status_envio_dev: base.status_envio_dev || null,

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