const { Pool } = require('pg');
const estoquePdfService = require('../services/estoquePdfService');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// =============================================
// === RENDERIZAÇÃO DE PÁGINAS ===
// =============================================

/**
 * Exibe a página de listagem de peças em estoque.
 */
exports.showListagemPage = async (req, res) => {
    try {
        const fabricasResult = await pool.query('SELECT id, nome FROM fabricas ORDER BY nome');
        
        // Busca o estado da página salvo para o usuário
        let userState = null;
        if (req.user && req.user.userId) {
            const stateResult = await pool.query(
                "SELECT state_data FROM user_page_states WHERE user_id = $1 AND page_route = 'estoque_lista_pecas'",
                [req.user.userId]
            );
            if (stateResult.rows.length > 0) {
                userState = stateResult.rows[0].state_data;
            }
        }

        res.render('estoque/lista-pecas', {
            layout: 'main',
            title: 'Estoque de Peças',
            fabricas: fabricasResult.rows,
            user: req.user,
            userState: userState ? JSON.stringify(userState) : null
        });
    } catch (error) {
        console.error('[Estoque] Erro ao carregar página de listagem:', error);
        req.flash('error', 'Erro ao carregar a listagem de peças.');
        res.redirect('/');
    }
};

exports.showNovaPecaForm = async (req, res) => {
    try {
        const { cloneId } = req.query;
        let peca = null;

        if (cloneId) {
            const result = await pool.query('SELECT * FROM estoque_pecas WHERE id = $1', [cloneId]);
            if (result.rows.length > 0) {
                peca = result.rows[0];
            }
        }

        res.render('estoque/nova-peca', {
            layout: 'main',
            title: peca ? 'Clonar Peça' : 'Cadastrar Nova Peça',
            peca,
            user: req.user
        });
    } catch (error) {
        console.error('[Estoque] Erro ao carregar formulário:', error);
        req.flash('error', 'Erro ao carregar o formulário.');
        res.redirect('/estoque');
    }
};

/**
 * Exibe o formulário de edição de uma peça existente.
 */
exports.showEditForm = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT ep.*, f.nome as fabrica_nome
            FROM estoque_pecas ep
            LEFT JOIN fabricas f ON ep.fabrica_id = f.id
            WHERE ep.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            req.flash('error', 'Peça não encontrada.');
            return res.redirect('/estoque');
        }

        res.render('estoque/editar-peca', {
            layout: 'main',
            title: 'Editar Peça',
            peca: result.rows[0],
            user: req.user
        });
    } catch (error) {
        console.error('[Estoque] Erro ao carregar formulário de edição:', error);
        req.flash('error', 'Erro ao carregar o formulário de edição.');
        res.redirect('/estoque');
    }
};

// =============================================
// === OPERAÇÕES CRUD ===
// =============================================

/**
 * Salva o estado da página para o usuário logado
 */
exports.savePageState = async (req, res) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ success: false, message: 'Não autorizado.' });
        }

        const { page_route, state_data } = req.body;
        if (!page_route || !state_data) {
            return res.status(400).json({ success: false, message: 'Dados inválidos.' });
        }

        await pool.query(`
            INSERT INTO user_page_states (user_id, page_route, state_data, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id, page_route) 
            DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = NOW()
        `, [req.user.userId, page_route, state_data]);

        res.json({ success: true });
    } catch (error) {
        console.error('[Estoque] Erro ao salvar estado da página:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao salvar estado.' });
    }
};

/**
 * Cria uma nova peça no estoque.
 */
exports.createPeca = async (req, res) => {
    const {
        sku, numero_peca, fabrica_id, produto_pai_sku, produto_pai_nome,
        nome_peca, observacao, cor, altura, largura, profundidade,
        quantidade, coluna_localizacao, linha_localizacao
    } = req.body;

    // Validação server-side dos campos obrigatórios
    const errors = [];
    if (!sku || sku.trim() === '') errors.push('SKU é obrigatório.');
    if (!fabrica_id) errors.push('Fábrica é obrigatória.');
    if (!produto_pai_sku && !produto_pai_nome) errors.push('Produto Pai é obrigatório.');
    if (!nome_peca || nome_peca.trim() === '') errors.push('Nome da Peça é obrigatório.');
    if (!altura || parseFloat(altura) <= 0) errors.push('Altura deve ser um valor positivo.');
    if (!largura || parseFloat(largura) <= 0) errors.push('Largura deve ser um valor positivo.');
    if (!profundidade || parseFloat(profundidade) <= 0) errors.push('Profundidade deve ser um valor positivo.');
    if (quantidade === undefined || quantidade === null || quantidade === '' || parseInt(quantidade) < 0) errors.push('Quantidade deve ser um número inteiro não negativo.');

    if (errors.length > 0) {
        return res.status(400).json({ success: false, message: errors.join(' ') });
    }

    try {
        // Verificar unicidade do SKU
        const skuCheck = await pool.query('SELECT id FROM estoque_pecas WHERE UPPER(sku) = UPPER($1)', [sku.trim()]);
        if (skuCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Este SKU já está cadastrado no estoque.' });
        }

        // Inserir a peça
        const insertResult = await pool.query(`
            INSERT INTO estoque_pecas (
                sku, numero_peca, fabrica_id, produto_pai_sku, produto_pai_nome,
                nome_peca, observacao, cor, altura, largura, profundidade,
                quantidade, coluna_localizacao, linha_localizacao
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id
        `, [
            sku.trim(),
            numero_peca ? numero_peca.trim() : null,
            fabrica_id,
            produto_pai_sku || null,
            produto_pai_nome || null,
            nome_peca.trim(),
            observacao || null,
            cor || null,
            parseFloat(altura),
            parseFloat(largura),
            parseFloat(profundidade),
            parseInt(quantidade),
            coluna_localizacao || null,
            linha_localizacao || null
        ]);

        res.status(201).json({
            success: true,
            message: 'Peça cadastrada com sucesso!',
            id: insertResult.rows[0].id
        });
    } catch (error) {
        console.error('[Estoque] Erro ao cadastrar peça:', error);
        if (error.code === '23505') { // unique_violation
            return res.status(409).json({ success: false, message: 'Este SKU já está cadastrado no estoque.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno ao cadastrar a peça.' });
    }
};

/**
 * Atualiza uma peça existente no estoque.
 */
exports.updatePeca = async (req, res) => {
    const { id } = req.params;
    const {
        sku, numero_peca, fabrica_id, produto_pai_sku, produto_pai_nome,
        nome_peca, observacao, cor, altura, largura, profundidade,
        quantidade, coluna_localizacao, linha_localizacao
    } = req.body;

    // Validação server-side
    const errors = [];
    if (!sku || sku.trim() === '') errors.push('SKU é obrigatório.');
    if (!fabrica_id) errors.push('Fábrica é obrigatória.');
    if (!produto_pai_sku && !produto_pai_nome) errors.push('Produto Pai é obrigatório.');
    if (!nome_peca || nome_peca.trim() === '') errors.push('Nome da Peça é obrigatório.');
    if (!altura || parseFloat(altura) <= 0) errors.push('Altura deve ser um valor positivo.');
    if (!largura || parseFloat(largura) <= 0) errors.push('Largura deve ser um valor positivo.');
    if (!profundidade || parseFloat(profundidade) <= 0) errors.push('Profundidade deve ser um valor positivo.');
    if (quantidade === undefined || quantidade === null || quantidade === '' || parseInt(quantidade) < 0) errors.push('Quantidade deve ser um número inteiro não negativo.');

    if (errors.length > 0) {
        return res.status(400).json({ success: false, message: errors.join(' ') });
    }

    try {
        // Verificar unicidade do SKU (excluindo o registro atual)
        const skuCheck = await pool.query('SELECT id FROM estoque_pecas WHERE UPPER(sku) = UPPER($1) AND id != $2', [sku.trim(), id]);
        if (skuCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Este SKU já está cadastrado para outra peça.' });
        }

        await pool.query(`
            UPDATE estoque_pecas SET
                sku = $1, numero_peca = $2, fabrica_id = $3, produto_pai_sku = $4,
                produto_pai_nome = $5, nome_peca = $6, observacao = $7, cor = $8,
                altura = $9, largura = $10, profundidade = $11,
                quantidade = $12, coluna_localizacao = $13, linha_localizacao = $14,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
        `, [
            sku.trim(),
            numero_peca ? numero_peca.trim() : null,
            fabrica_id,
            produto_pai_sku || null,
            produto_pai_nome || null,
            nome_peca.trim(),
            observacao || null,
            cor || null,
            parseFloat(altura),
            parseFloat(largura),
            parseFloat(profundidade),
            parseInt(quantidade),
            coluna_localizacao || null,
            linha_localizacao || null,
            id
        ]);

        res.json({ success: true, message: 'Peça atualizada com sucesso!' });
    } catch (error) {
        console.error('[Estoque] Erro ao atualizar peça:', error);
        if (error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Este SKU já está cadastrado para outra peça.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno ao atualizar a peça.' });
    }
};

/**
 * Exclui uma peça do estoque.
 */
exports.deletePeca = async (req, res) => {
    const { id } = req.params;
    try {
        // Primeiro exclui movimentações vinculadas (se houver)
        await pool.query('DELETE FROM estoque_movimentacoes WHERE peca_id = $1', [id]);
        // Depois exclui a peça
        const result = await pool.query('DELETE FROM estoque_pecas WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Peça não encontrada.' });
        }

        res.json({ success: true, message: 'Peça excluída com sucesso!' });
    } catch (error) {
        console.error('[Estoque] Erro ao excluir peça:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao excluir a peça.' });
    }
};

// =============================================
// === APIs ===
// =============================================

/**
 * API: Retorna listagem paginada de peças com filtros e ordenação dinâmica.
 */
exports.getPecasAPI = async (req, res) => {
    try {
        const { busca, busca2, situacao, fabrica_id, page = 1, limit = 50, orderBy = 'created_at', orderDir = 'DESC' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        const conditions = [];

        // Validação preventiva do limite para evitar abuso
        const pageLimit = Math.max(20, Math.min(200, parseInt(limit) || 50));

        if (busca && busca.trim() !== '') {
            params.push(`%${busca.trim()}%`);
            const idx = params.length;
            conditions.push(`(
                ep.sku ILIKE $${idx} OR
                ep.numero_peca ILIKE $${idx} OR
                ep.nome_peca ILIKE $${idx} OR
                ep.produto_pai_nome ILIKE $${idx} OR
                ep.produto_pai_sku ILIKE $${idx} OR
                ep.cor ILIKE $${idx} OR
                ep.observacao ILIKE $${idx} OR
                f.nome ILIKE $${idx}
            )`);
        }

        if (busca2 && busca2.trim() !== '') {
            params.push(`%${busca2.trim()}%`);
            const idx = params.length;
            conditions.push(`(
                ep.sku ILIKE $${idx} OR
                ep.numero_peca ILIKE $${idx} OR
                ep.nome_peca ILIKE $${idx} OR
                ep.produto_pai_nome ILIKE $${idx} OR
                ep.produto_pai_sku ILIKE $${idx} OR
                ep.cor ILIKE $${idx} OR
                ep.observacao ILIKE $${idx} OR
                f.nome ILIKE $${idx}
            )`);
        }

        if (situacao && situacao !== '') {
            if (situacao === 'vermelho') {
                conditions.push(`ep.quantidade = 0`);
            } else if (situacao === 'amarelo') {
                conditions.push(`ep.quantidade > 0 AND ep.quantidade <= 5`);
            } else if (situacao === 'verde') {
                conditions.push(`ep.quantidade > 5`);
            }
        }

        if (fabrica_id && fabrica_id !== '') {
            params.push(fabrica_id);
            conditions.push(`ep.fabrica_id = $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Whitelist para colunas de ordenação
        const sortableColumns = {
            'sku': 'ep.sku',
            'numero_peca': 'ep.numero_peca',
            'nome_peca': 'ep.nome_peca',
            'fabrica_nome': 'f.nome',
            'produto_pai_sku': 'ep.produto_pai_sku',
            'quantidade': 'ep.quantidade',
            'localizacao': 'ep.coluna_localizacao, ep.linha_localizacao',
            'created_at': 'ep.created_at'
        };

        const sortColumn = sortableColumns[orderBy] || 'ep.created_at';
        const sortDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Contagem total
        const countResult = await pool.query(`
            SELECT COUNT(*) as total
            FROM estoque_pecas ep
            LEFT JOIN fabricas f ON ep.fabrica_id = f.id
            ${whereClause}
        `, params);

        // Busca paginada
        const dataParams = [...params, pageLimit, offset];
        const dataResult = await pool.query(`
            SELECT ep.*, f.nome as fabrica_nome
            FROM estoque_pecas ep
            LEFT JOIN fabricas f ON ep.fabrica_id = f.id
            ${whereClause}
            ORDER BY ${sortColumn} ${sortDir}
            LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
        `, dataParams);

        res.json({
            data: dataResult.rows,
            total: parseInt(countResult.rows[0].total),
            page: parseInt(page),
            limit: pageLimit,
            totalPages: Math.ceil(parseInt(countResult.rows[0].total) / pageLimit)
        });
    } catch (error) {
        console.error('[Estoque] Erro ao buscar peças:', error);
        res.status(500).json({ message: 'Erro ao buscar peças do estoque.' });
    }
};

/**
 * API: Busca preditiva assíncrona em cached_products para Produto Pai.
 * Prioriza a conta 'lucas', fallback para 'eliane'.
 */
exports.searchProdutoPaiAPI = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }

        const searchTerm = `%${q.trim()}%`;

        // Busca com prioridade: lucas primeiro, depois eliane
        // Usa DISTINCT ON para evitar duplicatas de SKU, priorizando 'lucas'
        const result = await pool.query(`
            SELECT DISTINCT ON (UPPER(sku)) sku, nome
            FROM cached_products
            WHERE (sku ILIKE $1 OR nome ILIKE $1)
            ORDER BY UPPER(sku), (bling_account = 'lucas') DESC
            LIMIT 15
        `, [searchTerm]);

        res.json(result.rows);
    } catch (error) {
        console.error('[Estoque] Erro na busca de produto pai:', error);
        res.status(500).json({ message: 'Erro na busca de produtos.' });
    }
};

/**
 * API: Autocompletar nomes de peças baseado nas peças já existentes.
 */
exports.searchNomePecaAPI = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }

        const result = await pool.query(
            'SELECT DISTINCT nome_peca FROM estoque_pecas WHERE nome_peca ILIKE $1 ORDER BY nome_peca LIMIT 10',
            [`%${q.trim()}%`]
        );

        res.json(result.rows.map(r => r.nome_peca));
    } catch (error) {
        console.error('[Estoque] Erro na busca de nomes de peças:', error);
        res.status(500).json({ message: 'Erro na busca de nomes.' });
    }
};

/**
 * API: Retorna fábricas (reutiliza a tabela do módulo de Assistência).
 */
exports.getFabricas = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, nome FROM fabricas ORDER BY nome');
        res.json(rows);
    } catch (error) {
        console.error('[Estoque] Erro ao buscar fábricas:', error);
        res.status(500).json({ message: 'Erro ao buscar fábricas.' });
    }
};

/**
 * API: Inserção rápida de nova fábrica.
 */
exports.addFabrica = async (req, res) => {
    const { nome } = req.body;
    if (!nome || nome.trim() === '') {
        return res.status(400).json({ message: 'O nome da fábrica é obrigatório.' });
    }
    try {
        const { rows } = await pool.query(
            'INSERT INTO fabricas (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id, nome',
            [nome.trim()]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('[Estoque] Erro ao adicionar fábrica:', error);
        res.status(500).json({ message: 'Erro interno ao salvar a fábrica.' });
    }
};

/**
 * API: Verifica unicidade de SKU.
 */
exports.verificarSkuAPI = async (req, res) => {
    try {
        const { sku } = req.params;
        const excludeId = req.query.excludeId || null;

        let query = 'SELECT id FROM estoque_pecas WHERE UPPER(sku) = UPPER($1)';
        const params = [sku];

        if (excludeId) {
            query += ' AND id != $2';
            params.push(excludeId);
        }

        const result = await pool.query(query, params);
        res.json({ exists: result.rows.length > 0 });
    } catch (error) {
        console.error('[Estoque] Erro ao verificar SKU:', error);
        res.status(500).json({ message: 'Erro ao verificar SKU.' });
    }
};

exports.verificarNumeroPecaAPI = async (req, res) => {
    res.json({ exists: false });
};

/**
 * Exibe a página de bipagem de peças para movimentação rápida.
 */
exports.showBipagemPage = async (req, res) => {
    try {
        res.render('estoque/bipagem', {
            layout: 'main',
            title: 'Bipagem de Peças',
            user: req.user
        });
    } catch (error) {
        console.error('[Estoque] Erro ao carregar página de bipagem:', error);
        req.flash('error', 'Erro ao carregar a página de bipagem.');
        res.redirect('/estoque');
    }
};

/**
 * API: Executa a movimentação da bipagem (entrada ou saída).
 */
exports.biparPecaAPI = async (req, res) => {
    const { codigo, tipo } = req.body;

    if (!codigo || codigo.trim() === '') {
        return res.status(400).json({ success: false, message: 'O código de bipagem é obrigatório.' });
    }

    if (!tipo || !['entrada', 'saida'].includes(tipo)) {
        return res.status(400).json({ success: false, message: 'Tipo de movimentação inválido (deve ser entrada ou saida).' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Busca a peça pelo SKU ou Número da Peça
        const findQuery = `
            SELECT ep.*, f.nome as fabrica_nome 
            FROM estoque_pecas ep 
            LEFT JOIN fabricas f ON ep.fabrica_id = f.id 
            WHERE UPPER(ep.sku) = UPPER($1) OR UPPER(ep.numero_peca) = UPPER($1)
        `;
        const findResult = await client.query(findQuery, [codigo.trim()]);

        if (findResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Peça não localizada no estoque.' });
        }

        const peca = findResult.rows[0];
        let novaQuantidade = peca.quantidade;

        if (tipo === 'entrada') {
            novaQuantidade = peca.quantidade + 1;
        } else if (tipo === 'saida') {
            if (peca.quantidade <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    message: `Saldo insuficiente para a peça ${peca.sku} (${peca.nome_peca}).`,
                    peca: peca 
                });
            }
            novaQuantidade = peca.quantidade - 1;
        }

        // Atualiza a quantidade
        await client.query(
            'UPDATE estoque_pecas SET quantidade = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [novaQuantidade, peca.id]
        );

        // Insere a movimentação no histórico
        await client.query(
            'INSERT INTO estoque_movimentacoes (peca_id, tipo, quantidade, observacao) VALUES ($1, $2, $3, $4)',
            [peca.id, tipo, 1, 'Movimentado via bipagem']
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Sucesso: ${tipo === 'entrada' ? 'Entrada' : 'Saída'} realizada!`,
            peca: {
                ...peca,
                quantidade: novaQuantidade
            }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Estoque API Bipar] Erro ao movimentar peça:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao realizar a bipagem.' });
    } finally {
        client.release();
    }
};

/**
 * API: Gera etiquetas em PDF para uma peça de estoque específica.
 */
exports.gerarEtiquetasPdf = async (req, res) => {
    try {
        const { id } = req.params;
        const quantidade = parseInt(req.query.quantidade) || 1;

        if (isNaN(quantidade) || quantidade <= 0) {
            req.flash('error', 'A quantidade de etiquetas deve ser maior que 0.');
            return res.redirect('/estoque');
        }

        // Busca os dados completos da peça e da fábrica correspondente
        const result = await pool.query(`
            SELECT ep.*, f.nome as fabrica_nome
            FROM estoque_pecas ep
            LEFT JOIN fabricas f ON ep.fabrica_id = f.id
            WHERE ep.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            req.flash('error', 'Peça não localizada no estoque.');
            return res.redirect('/estoque');
        }

        const peca = result.rows[0];
        
        // Gera o PDF usando o serviço
        const pdfBuffer = await estoquePdfService.gerarPdfEtiquetasPeca(peca, quantidade);

        // Define os cabeçalhos de resposta para PDF Inline
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Etiquetas_${peca.sku}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('[Estoque PDF] Erro ao gerar etiquetas:', error);
        req.flash('error', 'Erro interno ao gerar o PDF das etiquetas.');
        res.redirect('/estoque');
    }
};
