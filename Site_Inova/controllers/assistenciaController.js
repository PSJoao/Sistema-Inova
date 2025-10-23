const { Pool } = require('pg');
const xlsx = require('xlsx');
const path = require('path');

const createPdfService = require('../services/createPdfService');
const { generateAssistanceLabelPdf, generateStructureLabelsPdf } = require('../services/pdfService');
const { findAndCacheNfeByNumber } = require('../blingSyncService');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

function getNfNumberFromBarcode(barcode) {
    if (typeof barcode !== 'string') return null;
    const cleaned = barcode.replace(/\s+/g, '');
    if (cleaned.length === 44 && /^\d+$/.test(cleaned)) {
        return parseInt(cleaned.substring(25, 34), 10).toString();
    }
    return null;
}

// --- Funções de Gerenciamento de Solicitantes (API) ---
exports.getSolicitantes = async (req, res) => {
    try {
        const ocultarIds = [6769, 6522, 6770, 6771, 6772, 5465, 6849, 6774, 5465, 6775, 6776, 6532, 5484, 6460, 5489, 5798, 6466, 5589, 5498, 6676, 6474, 5514, 5634, 5448, 6486, 5566, 5568, 6392, 5727, 5446, 5737, 5955, 6403, 5586, 6395, 5752, 6417, 6381, 5904];

        const query = `
            SELECT id, nome 
            FROM solicitantes 
            WHERE id NOT IN (${ocultarIds.map((_, i) => `$${i + 1}`).join(', ')})
            ORDER BY nome
        `;

        const { rows } = await pool.query(query, ocultarIds);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar solicitantes:', error);
        res.status(500).json({ message: 'Erro ao buscar solicitantes.' });
    }
};

exports.getFabricas = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, nome FROM fabricas ORDER BY nome');
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar solicitantes:', error);
        res.status(500).json({ message: 'Erro ao buscar solicitantes.' });
    }
};

exports.addSolicitante = async (req, res) => {
    const { nome } = req.body;
    if (!nome || nome.trim() === '') {
        return res.status(400).json({ message: 'O nome do solicitante é obrigatório.' });
    }
    try {
        const { rows } = await pool.query(
            'INSERT INTO solicitantes (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id, nome',
            [nome.trim()]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Erro ao adicionar novo solicitante:', error);
        res.status(500).json({ message: 'Erro interno ao salvar o solicitante.' });
    }
};

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
        console.error('Erro ao adicionar nova fábrica:', error);
        res.status(500).json({ message: 'Erro interno ao salvar a fábrica.' });
    }
};


// --- Funções de Renderização de Páginas ---
exports.showListagemPage = async (req, res) => {
    try {
        const fabricasResult = await pool.query('SELECT DISTINCT fabrica FROM assistencias WHERE fabrica IS NOT NULL ORDER BY fabrica');
        res.render('assistencia/lista-assistencias', {
            layout: 'main',
            title: 'Gestão de Assistências',
            fabricas: fabricasResult.rows,
            user: req.user
        });
    } catch (error) {
        console.error('Erro ao carregar a página de assistências:', error);
        req.flash('error_msg', 'Erro ao carregar a página. Tente novamente mais tarde.');
        res.redirect('/');
    }
};

exports.showNovaAssistenciaForm = (req, res) => {
    res.render('assistencia/nova-assistencia', {
        layout: 'main',
        title: 'Nova Assistência',
        user: req.user
    });
};

exports.showDetalhesAssistencia = async (req, res) => {
    try {
        const { id } = req.params;
        // [CORREÇÃO] Alterado u.name para u.username
        const assistenciaQuery = `
            SELECT a.*, s.nome as solicitante_nome,
                   to_char(a.data_solicitacao, 'DD/MM/YYYY') as data_solicitacao_fmt,
                   to_char(a.data_resolucao, 'DD/MM/YYYY HH24:MI:SS') as data_resolucao_fmt
            FROM assistencias a
            LEFT JOIN solicitantes s ON a.solicitante_id = s.id
            WHERE a.id = $1;
        `;
        const assistenciaResult = await pool.query(assistenciaQuery, [id]);

        if (assistenciaResult.rows.length === 0) {
            req.flash('error_msg', 'Assistência não encontrada.');
            return res.redirect('/assistencias');
        }
        const assistencia = assistenciaResult.rows[0];

        const produtosResult = await pool.query(`
            SELECT ap.id, ap.nome_produto, ap.volume_numero, ap.volume_total, ap.status_volume,
                   (SELECT json_agg(json_build_object('nome_peca', apc.nome_peca)) 
                    FROM assistencia_pecas apc WHERE apc.produto_id = ap.id) as pecas
            FROM assistencia_produtos ap 
            WHERE ap.assistencia_id = $1 ORDER BY ap.id;
        `, [id]);
        assistencia.produtos = produtosResult.rows;

        console.log('Assistência carregada:', assistencia.produtos);

        res.render('assistencia/detalhe-assistencia', {
            layout: 'main',
            title: `Detalhes da Assistência #${assistencia.id}`,
            assistencia,
            user: req.user
        });
    } catch (error) {
        console.error('Erro ao buscar detalhes da assistência:', error);
        req.flash('error_msg', 'Erro ao carregar os detalhes da assistência.');
        res.redirect('/assistencias');
    }
};

exports.showResolucaoMassaPage = (req, res) => {
    res.render('assistencia/resolucao-massa', {
        layout: 'main',
        title: 'Resolução em Massa de Volumes',
        user: req.user
    });
};


// --- API e Ações ---
exports.getAssistenciasAPI = async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '20', 10);
        const offset = (page - 1) * limit;
        const { dataInicio, dataFim, situacao, fabrica, busca, aba = 'aba1', volumeStatus, solicitanteId } = req.query;

        const ABA_MAP = {
            'aba1': ['PEÇA PARA CLIENTE'],
            'aba2': ['PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE'],
            'aba3': ['PEÇA PARA CLIENTE LOJA FISICA', 'PEÇA PARA MOSTRUÁRIO LOJA']
        };

        let queryParams = [];
        let whereClauses = [];

        const addParam = (value) => `$${queryParams.push(value)}`;

        if (ABA_MAP[aba]) {
            whereClauses.push(`a.descricao = ANY(${addParam(ABA_MAP[aba])})`);
        }
        if (dataInicio && dataFim) {
            whereClauses.push(`a.data_solicitacao BETWEEN ${addParam(dataInicio)} AND ${addParam(dataFim + 'T23:59:59')}`);
        }
        if (fabrica) {
            whereClauses.push(`a.fabrica = ${addParam(fabrica)}`);
        }
        if (solicitanteId) {
            whereClauses.push(`a.solicitante_id = ${addParam(solicitanteId)}`);
        }
        if (aba === 'aba2' && volumeStatus && volumeStatus !== 'Todos') {
            whereClauses.push(`EXISTS (SELECT 1 FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id AND ap.volume_qualidade = ${addParam(volumeStatus)})`);
        }
        if (busca) {
            const buscaLike = `%${busca}%`;
            const nfExtraida = getNfNumberFromBarcode(busca);
            let buscaConditions = [];
            const buscaIndex = addParam(buscaLike);
            
            buscaConditions.push(`a.nf_origem ILIKE ${buscaIndex}`, `a.nome_pedido ILIKE ${buscaIndex}`, `s.nome ILIKE ${buscaIndex}`, `a.fabrica ILIKE ${buscaIndex}`, `a.observacoes ILIKE ${buscaIndex}`, `a.documento_cliente ILIKE ${buscaIndex}`, `EXISTS (SELECT 1 FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id AND ap.nome_produto ILIKE ${buscaIndex})`);

            if (nfExtraida) {
                buscaConditions.push(`a.nf_origem = ${addParam(nfExtraida)}`);
            }
            whereClauses.push(`(${buscaConditions.join(' OR ')})`);
        }
        
        // [CORREÇÃO] A chamada para addParam foi movida para dentro das condições corretas
        if (situacao && situacao !== 'Todos') {
            if (aba === 'aba2') {
                if (situacao === 'Múltiplo') {
                    whereClauses.push(`(SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1`);
                } else {
                    const situacaoIndex = addParam(situacao);
                    whereClauses.push(`(SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) <= 1 AND a.situacao = ${situacaoIndex}`);
                }
            } else {
                const situacaoIndex = addParam(situacao);
                whereClauses.push(`a.situacao = ${situacaoIndex}`);
            }
        }
        
        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const mainQuery = `
            SELECT 
                a.id,
                CASE 
                    WHEN a.descricao = ANY(${addParam(ABA_MAP[aba])}) AND (SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1 THEN 'Múltiplo'
                    ELSE a.situacao
                END as situacao,
                a.nf_origem, a.nome_pedido, s.nome as solicitante, a.fabrica, 
                to_char(a.data_acao, 'DD/MM/YYYY HH24:MI:SS') as data_acao_fmt, 
                a.data_solicitacao, a.marcar_como_alerta, a.observacoes, 
                a.coluna_estoque AS coluna, a.linha_estoque AS linha,
                (SELECT ap.nome_produto FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id ORDER BY ap.id LIMIT 1) as primeiro_produto
            FROM assistencias a
            LEFT JOIN solicitantes s ON a.solicitante_id = s.id
            ${whereCondition}
        `;

        const countQuery = `SELECT COUNT(*) as total FROM (${mainQuery}) as count_subquery`;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total, 10);

        const dataQuery = `
            ${mainQuery}
            ORDER BY marcar_como_alerta DESC, data_solicitacao DESC, id DESC
            LIMIT ${addParam(limit)} OFFSET ${addParam(offset)};
        `;
        const dataResult = await pool.query(dataQuery, queryParams);
        
        res.json({
            assistencias: dataResult.rows,
            total: total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Erro na API de busca de assistências:', error);
        res.status(500).json({ message: 'Erro ao buscar dados das assistências.' });
    }
};

exports.findAssistenciaByChaveAPI = async (req, res) => {
    const { chave } = req.params;

    if (!chave || chave.length !== 44 || !/^\d+$/.test(chave)) {
        return res.status(400).json({ message: 'Chave de acesso inválida.' });
    }

    try {
        const nfeResult = await pool.query(
            'SELECT nfe_numero FROM cached_nfe WHERE chave_acesso = $1',
            [chave]
        );

        if (nfeResult.rows.length === 0) {
            return res.status(404).json({ message: 'Nenhuma NF encontrada para esta chave de acesso.' });
        }

        const nfeNumero = nfeResult.rows[0].nfe_numero;

        // A query agora também seleciona o ID da assistência PAI para cada produto
        const assistenciaQuery = `
            SELECT a.id, a.nf_origem, a.nome_pedido,
                   COALESCE(
                       (SELECT json_agg(
                            json_build_object(
                                'id', ap.id, 
                                'nome_produto', ap.nome_produto,
                                'status_volume', ap.status_volume,
                                'assistencia_id', a.id -- ADICIONADO: ID da assistência pai do volume
                            )
                        )
                        FROM assistencia_produtos ap 
                        WHERE ap.assistencia_id = a.id),
                        '[]'::json
                   ) as produtos
            FROM assistencias a
            WHERE a.nf_origem = $1 
              AND a.descricao IN ('PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE')
              AND a.situacao != 'Resolvida'
        `;
        const assistenciaResult = await pool.query(assistenciaQuery, [nfeNumero]);

        if (assistenciaResult.rows.length === 0) {
            return res.status(404).json({ message: `Nenhuma assistência de Reposição/Estoque pendente encontrada para a NF ${nfeNumero}.` });
        }
        
        // --- LÓGICA DE CONSOLIDAÇÃO ---
        // Pega a primeira assistência como base para os dados gerais (NF, pedido, etc.)
        const assistenciaBase = assistenciaResult.rows[0];

        // Usa flatMap para criar uma lista única com todos os produtos de todas as assistências encontradas
        const todosOsProdutos = assistenciaResult.rows.flatMap(a => a.produtos);

        // Se após a consolidação não houver produtos, retorna um erro.
        if (todosOsProdutos.length === 0) {
            return res.status(404).json({ message: `A assistência da NF ${nfeNumero} não possui volumes (produtos) cadastrados.` });
        }
        
        // Substitui a lista de produtos da assistência base pela lista consolidada
        assistenciaBase.produtos = todosOsProdutos;
        
        // Retorna o objeto único e consolidado
        res.json(assistenciaBase);

    } catch (error) {
        console.error('Erro na API ao buscar assistência por chave:', error);
        res.status(500).json({ message: 'Erro interno ao processar a solicitação.' });
    }
};

exports.getProductStructuresAPI = async (req, res) => {
    const { sku } = req.params;
    try {
        // Primeiro, encontramos o ID do produto pai usando o SKU
        const productResult = await pool.query(
            'SELECT bling_id FROM cached_products WHERE sku = $1',
            [sku]
        );

        if (productResult.rows.length === 0) {
            return res.status(404).json({ message: 'Produto com este SKU não encontrado.' });
        }
        const parentProductId = productResult.rows[0].bling_id;

        // Agora, buscamos todas as estruturas associadas a esse ID de produto
        const structuresResult = await pool.query(
            `SELECT structure_name, component_sku 
             FROM cached_structures 
             WHERE parent_product_bling_id = $1
             ORDER BY structure_name`,
            [parentProductId]
        );

        if (structuresResult.rows.length === 0) {
            return res.status(404).json({ message: 'Nenhuma estrutura encontrada para este produto.' });
        }

        res.json(structuresResult.rows);

    } catch (error) {
        console.error(`Erro ao buscar estruturas para o SKU ${sku}:`, error);
        res.status(500).json({ message: 'Erro interno ao buscar estruturas do produto.' });
    }
};

exports.bulkResolveVolumesAPI = async (req, res) => {
    const { volumeIds } = req.body; // Espera um array de IDs de assistencia_produtos

    if (!volumeIds || !Array.isArray(volumeIds) || volumeIds.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum ID de volume fornecido.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateQuery = `
            UPDATE assistencia_produtos
            SET status_volume = 'Resolvida'
            WHERE id = ANY($1::int[]) AND status_volume != 'Resolvida'
        `;
        const result = await client.query(updateQuery, [volumeIds]);

        await client.query('COMMIT');

        res.json({ 
            success: true, 
            message: `${result.rowCount} volume(s) marcado(s) como 'Resolvido(s)'.`
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro ao resolver volumes em massa:", error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao tentar atualizar os volumes.' });
    } finally {
        client.release();
    }
};

exports.createAssistencia = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const {
            descricao, solicitante_id, fabrica_id, data_solicitacao, nf_origem, nome_pedido, documento_cliente,
            numero_pedido_venda, coluna_estoque, linha_estoque, observacoes, marcar_como_alerta,
            produtos, cor, para_vistoriar
        } = req.body;

        const solicitanteResult = await client.query('SELECT nome FROM solicitantes WHERE id = $1', [solicitante_id]);
        if (solicitanteResult.rows.length === 0) throw new Error('Solicitante selecionado é inválido.');
        const solicitanteNome = solicitanteResult.rows[0].nome;

        const fabricaResult = await client.query('SELECT nome FROM fabricas WHERE id = $1', [fabrica_id]);
        if (fabricaResult.rows.length === 0) throw new Error('Fábrica selecionada é inválida.');
        const fabricaNome = fabricaResult.rows[0].nome;
        
        const situacaoInicial = para_vistoriar ? 'Para Vistoriar' : 'Pendente';

        const assistenciaQuery = `
            INSERT INTO assistencias (
                descricao, solicitante_id, solicitante, data_solicitacao, nf_origem, nome_pedido, documento_cliente,
                numero_pedido_venda, coluna_estoque, linha_estoque, observacoes, marcar_como_alerta,
                fabrica, cor, situacao, fabrica_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id;
        `;
        const assistenciaResult = await client.query(assistenciaQuery, [
            descricao, solicitante_id, solicitanteNome, data_solicitacao, nf_origem, nome_pedido, documento_cliente,
            numero_pedido_venda, coluna_estoque, linha_estoque, observacoes, !!marcar_como_alerta,
            fabricaNome, cor, situacaoInicial, fabrica_id
        ]);
        const novaAssistenciaId = assistenciaResult.rows[0].id;

        if (produtos && Array.isArray(produtos)) {
            for (const produto of produtos) {
                if (produto.nome && produto.nome.trim() !== '') {
                    // [CORREÇÃO] Adicionando 'volume_qualidade' ao INSERT
                    const produtoResult = await client.query(
                        `INSERT INTO assistencia_produtos 
                         (assistencia_id, nome_produto, status_volume, sku, volume_qualidade) 
                         VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
                        [novaAssistenciaId, produto.nome, produto.status_volume || 'Pendente', produto.sku || null, produto.volume_qualidade || null]
                    );
                    const novoProdutoId = produtoResult.rows[0].id;

                    if (produto.pecas && Array.isArray(produto.pecas)) {
                        for (const pecaNome of produto.pecas) {
                            if (pecaNome && pecaNome.trim() !== '') {
                                await client.query('INSERT INTO assistencia_pecas (produto_id, nome_peca) VALUES ($1, $2);', [novoProdutoId, pecaNome]);
                            }
                        }
                    }
                }
            }
        }
        
        await client.query('COMMIT');
        
        res.status(201).json({
            success: true,
            message: 'Assistência cadastrada com sucesso!',
            newAssistenciaId: novaAssistenciaId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao cadastrar assistência:', error);
        res.status(500).json({ success: false, message: 'Não foi possível cadastrar a assistência. Verifique os dados e tente novamente.' });
    } finally {
        client.release();
    }
};

exports.bulkUpdateStatusAPI = async (req, res) => {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !status) {
        return res.status(400).json({ success: false, message: 'Dados inválidos fornecidos.' });
    }

    try {
        let query;
        let queryParams = [status, ids];
        
        if (status === 'Resolvida') {
            query = `UPDATE assistencias SET situacao = $1, data_resolucao = CURRENT_TIMESTAMP WHERE id = ANY($2::int[])`;
        } else {
            // Caso queira usar para outros status no futuro
            query = `UPDATE assistencias SET situacao = $1 WHERE id = ANY($2::int[])`;
        }

        const result = await pool.query(query, queryParams);
        res.json({ success: true, message: `${result.rowCount} assistência(s) atualizada(s) com sucesso.` });
    } catch (error) {
        console.error("Erro ao atualizar status em massa:", error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao tentar atualizar as assistências.' });
    }
};

exports.resolveAssistencia = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `UPDATE assistencias SET situacao = 'Resolvida', data_resolucao = CURRENT_TIMESTAMP WHERE id = $1 AND situacao <> 'Resolvida'`,
            [id]
        );
        if (result.rowCount > 0) {
            req.flash('success_msg', `Assistência #${id} marcada como resolvida.`);
        } else {
            req.flash('error_msg', 'A assistência já estava resolvida ou não foi encontrada.');
        }
        // Redireciona para a página anterior, que será a de detalhes.
        res.redirect('back');
    } catch (error) {
        console.error(`Erro ao resolver assistência ${id}:`, error);
        req.flash('error_msg', 'Ocorreu um erro ao tentar resolver a assistência.');
        res.redirect('/assistencias');
    }
};

exports.findNfOrigemAPI = async (req, res) => {
    const { numero } = req.params;
    try {
        const nfeResult = await pool.query('SELECT * FROM cached_nfe WHERE nfe_numero = $1 LIMIT 1', [numero]);
        if (nfeResult.rows.length === 0) {
            return res.status(404).json({ message: 'Nota Fiscal não encontrada.' });
        }
        const nfe = nfeResult.rows[0];
        
        const pedidoResult = await pool.query('SELECT * FROM cached_pedido_venda WHERE notafiscal_id = $1 LIMIT 1', [nfe.bling_id]);
        const pedido = pedidoResult.rows.length > 0 ? pedidoResult.rows[0] : {};

        const productIds = nfe.product_ids_list ? nfe.product_ids_list.split(';').map(id => parseInt(id.trim())).filter(Number.isFinite) : [];
        let produtosFormatados = [];

        if (productIds.length > 0) {
            // [CORREÇÃO] A query agora renomeia 'nome' para 'nome_produto' para consistência
            const productsResult = await pool.query(
                'SELECT nome as nome_produto, volumes, sku FROM cached_products WHERE bling_id = ANY($1::bigint[])',
                [productIds]
            );
            produtosFormatados = productsResult.rows.map(p => ({
                nome_produto: p.nome_produto,
                sku: p.sku || '',
                volumes: p.volumes || 1,
                pecas: []
            }));
        }

        res.json({
            nome_pedido: pedido.contato_nome || '',
            documento_cliente: pedido.contato_documento || '',
            numero_pedido_venda: pedido.numero || '',
            produtos: produtosFormatados
        });
    } catch (error) {
        console.error(`Erro na API ao buscar NF ${numero}:`, error);
        res.status(500).json({ message: 'Erro interno ao buscar dados da NF.' });
    }
};

exports.showEditForm = async (req, res) => {
    try {
        const { id } = req.params;
        const assistenciaResult = await pool.query('SELECT * FROM assistencias WHERE id = $1', [id]);

        if (assistenciaResult.rows.length === 0) {
            req.flash('error_msg', 'Assistência não encontrada.');
            return res.redirect('/assistencias');
        }
        const assistencia = assistenciaResult.rows[0];

        if (assistencia.situacao === 'Resolvida') {
            req.flash('error_msg', 'Não é possível editar uma assistência que já foi resolvida.');
            return res.redirect(`/assistencias/${id}`);
        }

        const produtosResult = await pool.query(`
            SELECT 
                ap.id, 
                ap.nome_produto, 
                ap.volume_numero, 
                ap.volume_total, 
                ap.status_volume,
                ap.volume_qualidade, -- Adicionado aqui
                (SELECT json_agg(json_build_object('nome_peca', apc.nome_peca)) 
                 FROM assistencia_pecas apc WHERE apc.produto_id = ap.id) as pecas
            FROM assistencia_produtos ap 
            WHERE ap.assistencia_id = $1 ORDER BY ap.id;
        `, [id]);
        
        assistencia.produtos = produtosResult.rows;

        res.render('assistencia/editar-assistencia', {
            layout: 'main',
            title: `Editando Assistência #${assistencia.id}`,
            assistencia,
            user: req.user
        });
    } catch (error) {
        console.error('Erro ao carregar formulário de edição:', error);
        req.flash('error_msg', 'Erro ao carregar o formulário de edição.');
        res.redirect('/assistencias');
    }
};

// SUBSTITUA A FUNÇÃO 'updateAssistencia' EXISTENTE POR ESTE BLOCO COMPLETO
exports.updateAssistencia = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const {
            descricao, solicitante_id, data_solicitacao, nf_origem, nome_pedido, documento_cliente,
            numero_pedido_venda, coluna_estoque, linha_estoque, observacoes, marcar_como_alerta,
            produtos, fabrica_id, cor
        } = req.body;

        const situacaoAtualResult = await client.query('SELECT situacao FROM assistencias WHERE id = $1', [id]);
        let novaSituacao = situacaoAtualResult.rows[0].situacao;
        if (novaSituacao === 'Para Vistoriar') {
            novaSituacao = 'Pendente';
        }
        const solicitanteResult = await client.query('SELECT nome FROM solicitantes WHERE id = $1', [solicitante_id]);
        if (solicitanteResult.rows.length === 0) throw new Error('Solicitante selecionado é inválido.');
        const solicitanteNome = solicitanteResult.rows[0].nome;
        const fabricaResult = await client.query('SELECT nome FROM fabricas WHERE id = $1', [fabrica_id]);
        if (fabricaResult.rows.length === 0) throw new Error('Fábrica selecionada é inválida.');
        const fabricaNome = fabricaResult.rows[0].nome;

        await client.query(`
            UPDATE assistencias SET 
                descricao = $1, solicitante_id = $2, solicitante = $3, data_solicitacao = $4, nf_origem = $5, nome_pedido = $6, 
                documento_cliente = $7, numero_pedido_venda = $8, coluna_estoque = $9, linha_estoque = $10, 
                observacoes = $11, marcar_como_alerta = $12, fabrica = $13, cor = $14, situacao = $15, fabrica_id = $17
            WHERE id = $16 AND situacao != 'Resolvida';
        `, [
            descricao, solicitante_id, solicitanteNome, data_solicitacao, nf_origem, nome_pedido, documento_cliente,
            numero_pedido_venda, coluna_estoque, linha_estoque, observacoes, !!marcar_como_alerta,
            fabricaNome, cor, novaSituacao, id, fabrica_id
        ]);

        await client.query('DELETE FROM assistencia_produtos WHERE assistencia_id = $1', [id]);

        if (produtos && Array.isArray(produtos)) {
            for (const produto of produtos) {
                console.log(produto.volume_qualidade);
                if (produto.nome && produto.nome.trim() !== '') {
                    const produtoResult = await client.query(
                        `INSERT INTO assistencia_produtos 
                         (assistencia_id, nome_produto, status_volume, sku, volume_qualidade) 
                         VALUES ($1, $2, $3, $4, $5) RETURNING id;`,
                        [id, produto.nome, produto.status_volume || 'Pendente', produto.sku || null, produto.volume_qualidade || null]
                    );
                    const novoProdutoId = produtoResult.rows[0].id;
                    if (produto.pecas && Array.isArray(produto.pecas)) {
                        for (const pecaNome of produto.pecas) {
                            if (pecaNome && pecaNome.trim() !== '') {
                                await client.query('INSERT INTO assistencia_pecas (produto_id, nome_peca) VALUES ($1, $2);', [novoProdutoId, pecaNome]);
                            }
                        }
                    }
                }
            }
        }

        await client.query('COMMIT');
        req.flash('success_msg', 'Assistência atualizada com sucesso!');
        res.redirect(`/assistencias/${id}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Erro ao atualizar assistência ${id}:`, error);
        req.flash('error_msg', 'Não foi possível atualizar a assistência. Tente novamente.');
        res.redirect(`/assistencias/editar/${id}`);
    } finally {
        client.release();
    }
};

exports.generatePdf = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Query para buscar todos os dados necessários para o PDF
        const assistenciaQuery = `
            SELECT a.*, s.nome as solicitante_nome,
                   to_char(a.data_solicitacao, 'DD/MM/YYYY') as data_solicitacao_fmt
            FROM assistencias a
            LEFT JOIN solicitantes s ON a.solicitante_id = s.id
            WHERE a.id = $1;
        `;
        const assistenciaResult = await pool.query(assistenciaQuery, [id]);

        if (assistenciaResult.rows.length === 0) {
            req.flash('error_msg', 'Assistência não encontrada para gerar PDF.');
            return res.redirect('/assistencias');
        }
        const assistenciaData = assistenciaResult.rows[0];

        const produtosResult = await pool.query(`
            SELECT ap.id, ap.nome_produto,
                   (SELECT json_agg(json_build_object('nome_peca', apc.nome_peca)) 
                    FROM assistencia_pecas apc WHERE apc.produto_id = ap.id) as pecas
            FROM assistencia_produtos ap 
            WHERE ap.assistencia_id = $1 ORDER BY ap.id;
        `, [id]);
        assistenciaData.produtos = produtosResult.rows;

        // Configura os headers da resposta para PDF
        const filename = `Assistencia_${id}_${assistenciaData.nome_pedido.replace(/\s/g, '_')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Chama o serviço para gerar o PDF e o envia na resposta
        createPdfService.generateAssistancePDF(assistenciaData, res);

    } catch (error) {
        console.error('Erro ao gerar PDF da assistência:', error);
        req.flash('error_msg', 'Não foi possível gerar o PDF. Tente novamente.');
        res.redirect('/assistencias');
    }
};

function standardizeName(str) {
    if (!str || typeof str !== 'string') return str;
    return str
        .trim() // Remove espaços no início e no fim
        .toLowerCase() // Converte tudo para minúsculo primeiro
        .replace(/\s+/g, ' ') // Substitui múltiplos espaços por um só
        .split(' ') // Divide em palavras
        .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitaliza a primeira letra de cada palavra
        .join(' '); // Junta as palavras de volta
}

// --- [NOVA FUNÇÃO AUXILIAR] ---
// Converte datas do Excel de forma segura, tratando erros comuns
function parseDate(dateInput) {
    // Se a biblioteca já retornou um objeto Date válido, use-o
    if (dateInput instanceof Date && !isNaN(dateInput)) {
        return dateInput;
    }

    if (typeof dateInput === 'string') {
        // Se a célula contém '#######', retorna a data atual como fallback
        if (dateInput.includes('#')) {
            return new Date();
        }
        // Tenta converter a string para data. O construtor do JS é bem flexível.
        let date = new Date(dateInput);
        if (!isNaN(date)) {
            // Corrige o problema do ano com 2 dígitos (ex: 25 -> 2025)
            if (date.getFullYear() >= 0 && date.getFullYear() < 100) {
                date.setFullYear(date.getFullYear() + 2000);
            }
            return date;
        }
    }

    // Se tudo falhar (formato desconhecido, etc.), retorna a data atual como fallback
    return new Date();
}

exports.importFromExcel = async (req, res) => {
    const filePath = path.join(__dirname, 'assistencias_antigas.xlsx');
    let successfullyImported = 0;
    let failedImports = 0;
    const errors = [];

    try {
        const workbook = xlsx.readFile(filePath, { cellDates: true });

        // --- Processa a Aba "1" ---
        const sheet1 = workbook.Sheets['1'];
        const data1 = xlsx.utils.sheet_to_json(sheet1, { header: 1, raw: false });

        for (let i = 1; i < data1.length; i++) {
            const row = data1[i];
            if (!row || !row[1]) continue;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                const observacoes = row[0] || '';
                const solicitanteNome = standardizeName(row[1]); // PADRONIZADO
                const numero_pedido_venda = row[2] || null;
                const nome_pedido = row[3] || 'N/A';
                const coluna_estoque = row[4] || null;
                const linha_estoque = row[5] || null;
                const documento_cliente = row[6] || null;
                const nf_origem = row[7] || null;
                const descricaoRaw = row[9] ? String(row[9]).toUpperCase() : '';
                const data_solicitacao = parseDate(row[12]); // PADRONIZADO
                const produtoNome = standardizeName(row[13] || 'Produto não especificado'); // PADRONIZADO
                const fabrica = standardizeName(row[14] || 'N/A'); // PADRONIZADO
                const cor = standardizeName(row[15] || null); // PADRONIZADO

                const pecas = [];
                for (let p = 16; p <= 23; p++) {
                    if (row[p]) pecas.push(standardizeName(String(row[p]))); // PADRONIZADO
                }

                let descricaoFinal = 'PEÇA PARA CLIENTE';
                if (descricaoRaw.includes('MOSTRUARIO') || descricaoRaw.includes('MOSTRUÁRIO')) {
                    descricaoFinal = 'PEÇA PARA MOSTRUÁRIO LOJA';
                } else if (descricaoRaw.includes('LOJA')) {
                    descricaoFinal = 'PEÇA PARA CLIENTE LOJA FISICA';
                } else if (descricaoRaw.includes('CLIENTE')) {
                    descricaoFinal = 'PEÇA PARA CLIENTE';
                } else if (descricaoRaw.includes('ESTOQUE')) {
                    descricaoFinal = 'PEÇA PARA ESTOQUE';
                } else if (descricaoRaw.includes('VOLUME')) {
                    descricaoFinal = 'PEÇA PARA REPOR VOLUME';
                }

                const solicitanteRes = await client.query(
                    'INSERT INTO solicitantes (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id',
                    [solicitanteNome]
                );

                const fabricaRes = await client.query(
                    'INSERT INTO fabricas (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id',
                    [fabrica]
                );

                const fabrica_id = fabricaRes.rows[0].id;
                const solicitante_id = solicitanteRes.rows[0].id;

                const assistenciaQuery = `
                    INSERT INTO assistencias (observacoes, solicitante, solicitante_id, nome_pedido, coluna_estoque, linha_estoque, documento_cliente, numero_pedido_venda, nf_origem, descricao, data_solicitacao, fabrica, cor, fabrica_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`;
                const assistenciaRes = await client.query(assistenciaQuery, [
                    observacoes, solicitanteNome, solicitante_id, nome_pedido, coluna_estoque, linha_estoque, documento_cliente, numero_pedido_venda, nf_origem, descricaoFinal, data_solicitacao, fabrica, cor, fabrica_id
                ]);
                const assistenciaId = assistenciaRes.rows[0].id;

                const produtoRes = await client.query('INSERT INTO assistencia_produtos (assistencia_id, nome_produto) VALUES ($1, $2) RETURNING id', [assistenciaId, produtoNome]);
                const produtoId = produtoRes.rows[0].id;

                if (pecas.length > 0) {
                    for (const peca of pecas) {
                        await client.query('INSERT INTO assistencia_pecas (produto_id, nome_peca) VALUES ($1, $2)', [produtoId, peca]);
                    }
                }

                await client.query('COMMIT');
                successfullyImported++;
            } catch (err) {
                await client.query('ROLLBACK');
                failedImports++;
                errors.push(`Aba 1, Linha ${i + 1}: ${err.message}`);
            } finally {
                client.release();
            }
        }

        // --- Processa a Aba "2" ---
        /*const sheet2 = workbook.Sheets['2'];
        const data2 = xlsx.utils.sheet_to_json(sheet2, { header: 1, raw: false });

        for (let i = 1; i < data2.length; i++) {
            const row = data2[i];
            if (!row || !row[1]) continue;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                const observacoes = row[0] || '';
                const solicitanteNome = standardizeName(row[1]); // PADRONIZADO
                const nome_pedido = row[3] || 'N/A';
                const coluna_estoque = row[4] || null;
                const linha_estoque = row[5] || null;
                const documento_cliente = row[6] || null;
                const nf_origem = row[7] || null;
                const descricaoRaw = row[9] ? String(row[9]).toUpperCase() : 'PEÇA PARA REPOR VOLUME';
                const data_solicitacao = parseDate(row[12]); // PADRONIZADO
                const produtoNome = standardizeName(row[13] || 'Produto não especificado'); // PADRONIZADO
                const fabrica = standardizeName(row[14] || 'N/A'); // PADRONIZADO
                const cor = standardizeName(row[15] || null); // PADRONIZADO
                
                const pecas = [];
                for (let p = 16; p <= 23; p++) {
                    if (row[p]) pecas.push(standardizeName(String(row[p]))); // PADRONIZADO
                }

                const descricaoFinal = descricaoRaw.includes('ESTOQUE') ? 'PEÇA PARA ESTOQUE' : 'PEÇA PARA REPOR VOLUME';

                const solicitanteRes = await client.query(
                    'INSERT INTO solicitantes (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id',
                    [solicitanteNome]
                );

                const fabricaRes = await client.query(
                    'INSERT INTO fabricas (nome) VALUES ($1) ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id',
                    [fabrica]
                );

                const fabrica_id = fabricaRes.rows[0].id;
                
                const solicitante_id = solicitanteRes.rows[0].id;

                const assistenciaQuery = `
                    INSERT INTO assistencias (observacoes, solicitante, solicitante_id, nome_pedido, coluna_estoque, linha_estoque, documento_cliente, nf_origem, descricao, data_solicitacao, fabrica, cor, fabrica_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`;
                const assistenciaRes = await client.query(assistenciaQuery, [
                    observacoes, solicitanteNome, solicitante_id, nome_pedido, coluna_estoque, linha_estoque, documento_cliente, nf_origem, descricaoFinal, data_solicitacao, fabrica, cor, fabrica_id
                ]);
                const assistenciaId = assistenciaRes.rows[0].id;

                const produtoRes = await client.query('INSERT INTO assistencia_produtos (assistencia_id, nome_produto) VALUES ($1, $2) RETURNING id', [assistenciaId, produtoNome]);
                const produtoId = produtoRes.rows[0].id;

                if (pecas.length > 0) {
                    for (const peca of pecas) {
                        await client.query('INSERT INTO assistencia_pecas (produto_id, nome_peca) VALUES ($1, $2)', [produtoId, peca]);
                    }
                }

                await client.query('COMMIT');
                successfullyImported++;
            } catch (err) {
                await client.query('ROLLBACK');
                failedImports++;
                errors.push(`Aba 2, Linha ${i + 1}: ${err.message}`);
            } finally {
                client.release();
            }
        }*/

        let report = `Importação concluída!<br><br>Sucesso: ${successfullyImported}<br>Falhas: ${failedImports}`;
        if (errors.length > 0) {
            report += '<br><br><strong>Detalhes dos erros:</strong><br>' + errors.join('<br>');
        }
        res.send(report);

    } catch (error) {
        console.error("Erro ao ler o arquivo Excel:", error);
        res.status(500).send("Erro ao ler o arquivo Excel. Verifique se o arquivo 'assistencias_antigas.xlsx' existe na pasta 'controllers'.");
    }
};

exports.generateAssistenciaLabel = async (req, res) => {
    try {
        // A rota agora envia o ID da assistência e o ID do produto/volume específico
        const { id, produto_id } = req.params;

        // 1. Busca os dados gerais da assistência (NF, nome, cor, localização)
        const assistenciaResult = await pool.query(
            'SELECT nf_origem, nome_pedido, cor, coluna_estoque, linha_estoque FROM assistencias WHERE id = $1',
            [id]
        );

        if (assistenciaResult.rows.length === 0) {
            req.flash('error_msg', 'Assistência não encontrada.');
            return res.redirect('/assistencias');
        }
        const assistencia = assistenciaResult.rows[0];
        const nfOrigem = assistencia.nf_origem;

        /*if (!nfOrigem || nfOrigem.trim() === '') {
            req.flash('error_msg', 'Esta assistência não possui uma NF de Origem para gerar etiqueta.');
            return res.redirect(`/assistencias/${id}`);
        }*/

        // 2. Busca os detalhes do volume específico e suas peças associadas
        const produtoResult = await pool.query(
            `SELECT ap.nome_produto, ap.volume_numero, ap.volume_total,
                    (SELECT json_agg(apc.nome_peca) FROM assistencia_pecas apc WHERE apc.produto_id = ap.id) as pecas
             FROM assistencia_produtos ap WHERE ap.id = $1 AND ap.assistencia_id = $2`,
            [produto_id, id]
        );

        if (produtoResult.rows.length === 0) {
            req.flash('error_msg', 'Volume do produto não encontrado nesta assistência.');
            return res.redirect(`/assistencias/${id}`);
        }
        const produto = produtoResult.rows[0];

        // 3. Busca a chave de acesso da NF no cache para o código de barras
        const barCodeResult = await pool.query('SELECT chave_acesso FROM cached_nfe WHERE nfe_numero = $1 LIMIT 1', [nfOrigem]);
        // Se não encontrar, usa a própria NF como fallback para o código de barras
        const chaveAcesso = barCodeResult.rows.length > 0 ? barCodeResult.rows[0].chave_acesso : nfOrigem;

        // 4. Monta o objeto com todos os dados para o PDF
        const pdfData = {
            chave_acesso: chaveAcesso,
            nfe_numero: nfOrigem,
            nome_pedido: assistencia.nome_pedido || `Pedido_${id}`,
            nome_produtos: produto.nome_produto || '',
            // Informação do volume para exibir (ex: "1/3")
            volume_info: `${produto.volume_numero || 1}/${produto.volume_total || 1}`,
            cor: assistencia.cor,
            // Lista de peças do volume específico
            pecas: produto.pecas || [],
            // Concatena coluna e linha para a localização
            localizacao: `${assistencia.coluna_estoque || ''} ${assistencia.linha_estoque || ''}`.trim()
        };

        // 5. Gera o PDF com os dados consolidados
        const pdfBuffer = await generateAssistanceLabelPdf(pdfData);

        // 6. Envia o PDF para o usuário
        const fileName = `Etiqueta_Assistencia_${id}_Vol_${produto.volume_numero}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Erro ao gerar etiqueta da assistência:', error);
        req.flash('error_msg', 'Ocorreu um erro ao gerar a etiqueta.');
        res.redirect('back');
    }
};

exports.generateStructureLabels = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Achar a NF de origem da assistência
        const assistenciaResult = await pool.query('SELECT nf_origem FROM assistencias WHERE id = $1', [id]);
        if (assistenciaResult.rows.length === 0 || !assistenciaResult.rows[0].nf_origem) {
            return res.status(404).send('Assistência ou NF de origem não encontrada.');
        }
        const nfOrigem = assistenciaResult.rows[0].nf_origem;

        // 2. Achar os IDs dos produtos na NF em cache
        const nfeResult = await pool.query('SELECT product_ids_list FROM cached_nfe WHERE nfe_numero = $1', [nfOrigem]);
        if (nfeResult.rows.length === 0 || !nfeResult.rows[0].product_ids_list) {
            return res.status(404).send('Produtos para esta NF não encontrados no cache. Não é possível gerar etiquetas de estrutura.');
        }
        const productIds = nfeResult.rows[0].product_ids_list.split(';').map(pid => parseInt(pid.trim())).filter(Number.isFinite);

        if (productIds.length === 0) {
            return res.status(404).send('Nenhum ID de produto válido encontrado para esta NF.');
        }

        // 3. Buscar todas as estruturas para esses produtos
        const structuresResult = await pool.query(
            `SELECT structure_name, component_sku, component_location FROM cached_structures 
             WHERE parent_product_bling_id = ANY($1::bigint[])
             ORDER BY structure_name`,
            [productIds]
        );

        if (structuresResult.rows.length === 0) {
            return res.status(404).send('Nenhuma estrutura encontrada para os produtos desta assistência.');
        }
        
        // 4. Gerar o PDF com os dados das estruturas
        const pdfBuffer = await generateStructureLabelsPdf(structuresResult.rows);

        const fileName = `Etiquetas_Estrutura_Assistencia_${id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Erro ao gerar etiquetas de estrutura:', error);
        res.status(500).send('Ocorreu um erro interno ao gerar as etiquetas de estrutura.');
    }
};

exports.updateSingleStatusAPI = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Pendente', 'Pronta para Embalar', 'Descarte', 'Resolvida', 'Para Vistoriar'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status fornecido é inválido.' });
    }

    try {
        const query = `
            UPDATE assistencias 
            SET situacao = $1,
                data_resolucao = CASE WHEN $2 = 'Resolvida' THEN CURRENT_TIMESTAMP ELSE data_resolucao END,
                data_acao = CURRENT_TIMESTAMP
            WHERE id = $3
        `;

        const result = await pool.query(query, [status, status, id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Assistência não encontrada.' });
        }

        res.json({ success: true, message: 'Status atualizado com sucesso.' });

    } catch (error) {
        console.error(`Erro ao atualizar status da assistência ${id}:`, error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao tentar atualizar o status.' });
    }
};

exports.updateVolumeStatusAPI = async (req, res) => {
    const { produto_id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pendente', 'Pronta para Embalar', 'Descarte', 'Resolvida', 'Para Vistoriar', 'Volume Bom', 'Volume Ruim'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Status fornecido é inválido.' });
    }

    try {
        const query = `
            UPDATE assistencia_produtos 
            SET status_volume = $1
            WHERE id = $2
        `;
        const result = await pool.query(query, [status, produto_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Volume (produto) não encontrado.' });
        }

        res.json({ success: true, message: 'Status do volume atualizado com sucesso.' });

    } catch (error) {
        console.error(`Erro ao atualizar status do volume ${produto_id}:`, error);
        res.status(500).json({ success: false, message: 'Erro no servidor ao tentar atualizar o status do volume.' });
    }
};

exports.getSkuDetailsAPI = async (req, res) => {
    const { sku } = req.params;
    try {
        // CORREÇÃO: A query agora também seleciona o SKU para garantir que ele seja retornado
        const { rows } = await pool.query(
            'SELECT nome, volumes, sku FROM cached_products WHERE sku = $1 LIMIT 1',
            [sku]
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ message: 'SKU não encontrado.' });
        }
    } catch (error) {
        console.error('Erro ao buscar SKU:', error);
        res.status(500).json({ message: 'Erro ao buscar SKU.' });
    }
};

exports.findNfInBlingAPI = async (req, res) => {
    const { numero } = req.params;

    // 1. Validação básica
    if (!numero || !/^\d+$/.test(numero)) {
        return res.status(400).json({ message: 'Número da NF inválido. Deve conter apenas dígitos.' });
    }

    // --- INÍCIO DA CORREÇÃO COM REGRA DE NEGÓCIO ---
    let targetAccount;

    // 2. Aplica a regra para determinar a conta correta
    if (numero.length === 6 && numero.startsWith('0')) {
        targetAccount = 'eliane';
    } else {
        // Assume 'lucas' para 6 dígitos que não começam com 0
        // ou qualquer outro formato de número.
        targetAccount = 'lucas';
    }
    
    console.log(`[findNfInBlingAPI] NF ${numero} mapeada para a conta: ${targetAccount}`);
    // --- FIM DA CORREÇÃO ---

    try {
        // 3. Chama a função da fila AGORA COM OS DOIS ARGUMENTOS CORRETOS
        await findAndCacheNfeByNumber(numero, targetAccount);

        // 4. O resto da função continua como antes, lendo do cache
        console.log(`[findNfInBlingAPI] NF ${numero} encontrada e cacheada. Buscando dados do cache local...`);
        const cachedResult = await pool.query(
            'SELECT * FROM cached_nfe WHERE nfe_numero = $1',
            [numero]
        );

        if (cachedResult.rows.length > 0) {
            const nfData = cachedResult.rows[0];

            // Busca os produtos da NF usando a conta correta que foi cacheada
            const productsResult = await pool.query(
                `SELECT cp.sku, cp.nome as nome_produto, nqp.quantidade 
                 FROM nfe_quantidade_produto nqp 
                 JOIN cached_products cp ON nqp.produto_codigo = cp.sku 
                 WHERE nqp.nfe_numero = $1 AND cp.bling_account = $2`,
                [numero, nfData.bling_account] // nfData.bling_account agora será 'lucas' ou 'eliane'
            );
            
            nfData.produtos = productsResult.rows;
            res.json(nfData);
        } else {
            // Se o findAndCacheNfeByNumber não lançou um erro, mas não salvou no cache
            // (o que é improvável, mas é uma segurança), informamos que não foi achada.
            res.status(404).json({ message: `Nota Fiscal ${numero} não foi encontrada no Bling (${targetAccount}) após a busca.` });
        }
    } catch (error) {
        // Pega erros vindos do findAndCacheNfeByNumber (ex: API do Bling falhou, ou a NF realmente não existe)
        console.error(`[findNfInBlingAPI] Erro ao buscar/cachear NF ${numero} da conta ${targetAccount}:`, error.message);
        // Retorna o erro vindo do Bling (ex: "NF 123456 não encontrada")
        res.status(404).json({ message: error.message });
    }
};

// [NOVA FUNÇÃO]
exports.exportAssistenciasExcel = async (req, res) => {
    try {
        // 1. Pega e constrói os mesmos filtros da getAssistenciasAPI
        const { dataInicio, dataFim, situacao, fabrica, busca, aba = 'aba1', volumeStatus, solicitanteId } = req.query;
        const ABA_MAP = {
            'aba1': ['PEÇA PARA CLIENTE'],
            'aba2': ['PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE'],
            'aba3': ['PEÇA PARA CLIENTE LOJA FISICA', 'PEÇA PARA MOSTRUÁRIO LOJA']
        };
        let queryParams = [];
        let whereClauses = [];
        const addParam = (value) => `$${queryParams.push(value)}`;

        if (ABA_MAP[aba]) whereClauses.push(`a.descricao = ANY(${addParam(ABA_MAP[aba])})`);
        if (dataInicio && dataFim) whereClauses.push(`a.data_solicitacao BETWEEN ${addParam(dataInicio)} AND ${addParam(dataFim + 'T23:59:59')}`);
        if (fabrica) whereClauses.push(`a.fabrica = ${addParam(fabrica)}`);
        if (solicitanteId) whereClauses.push(`a.solicitante_id = ${addParam(solicitanteId)}`);
        if (aba === 'aba2' && volumeStatus && volumeStatus !== 'Todos') whereClauses.push(`EXISTS (SELECT 1 FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id AND ap.volume_qualidade = ${addParam(volumeStatus)})`);
        if (busca) {
            const buscaLike = `%${busca}%`;
            const buscaIndex = addParam(buscaLike);
            whereClauses.push(`(a.nf_origem ILIKE ${buscaIndex} OR a.nome_pedido ILIKE ${buscaIndex} OR s.nome ILIKE ${buscaIndex} OR EXISTS (SELECT 1 FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id AND ap.nome_produto ILIKE ${buscaIndex}))`);
        }
        if (situacao && situacao !== 'Todos') {
            const situacaoIndex = addParam(situacao);
            if (aba === 'aba2') {
                if (situacao === 'Múltiplo') {
                    whereClauses.push(`(SELECT COUNT(DISTINCT ap.status_volume) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1`);
                } else {
                    whereClauses.push(`(( (SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) <= 1 AND a.situacao = ${situacaoIndex}) OR EXISTS (SELECT 1 FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id AND ap.status_volume = ${situacaoIndex}))`);
                }
            } else {
                whereClauses.push(`a.situacao = ${situacaoIndex}`);
            }
        }
        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 2. Query principal SEM PAGINAÇÃO e que busca TODOS os produtos
        const mainQuery = `
            SELECT 
                a.id,
                CASE 
                    WHEN a.descricao = ANY(${addParam(ABA_MAP['aba2'])}) AND (SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1 THEN
                        CASE WHEN (SELECT COUNT(DISTINCT ap.status_volume) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1 THEN 'Múltiplo' ELSE (SELECT MIN(ap.status_volume) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) END
                    ELSE a.situacao
                END as situacao,
                to_char(a.data_solicitacao, 'DD/MM/YYYY') as data_solicitacao,
                a.nf_origem, a.nome_pedido, s.nome as solicitante, a.fabrica, a.coluna_estoque as coluna, a.linha_estoque as linha,
                (SELECT STRING_AGG(
                    'Produto: ' || ap.nome_produto || 
                    ' | Status: ' || ap.status_volume || 
                    CASE WHEN ap.volume_qualidade IS NOT NULL THEN ' | Qualidade: ' || ap.volume_qualidade ELSE '' END, 
                    '; '
                ) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) as produtos,
                a.observacoes
            FROM assistencias a
            LEFT JOIN solicitantes s ON a.solicitante_id = s.id
            ${whereCondition}
            ORDER BY a.data_solicitacao DESC, a.id DESC
        `;

        const { rows } = await pool.query(mainQuery, queryParams);

        // 3. Formatação dos dados para o Excel
        const dataForExcel = rows.map(a => ({
            'ID': a.id,
            'Situação': a.situacao,
            'Data Solic.': a.data_solicitacao,
            'NF Origem': a.nf_origem,
            'Coluna': a.coluna,
            'Linha': a.linha,
            'Cliente/Pedido': a.nome_pedido,
            'Solicitante': a.solicitante,
            'Fábrica': a.fabrica,
            'Produtos': a.produtos,
            'Observações': a.observacoes
        }));

        // 4. Criação do arquivo Excel em memória
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(dataForExcel);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Assistências');

        // Ajusta a largura das colunas
        worksheet['!cols'] = [
            { wch: 5 },  // ID
            { wch: 15 }, // Situação
            { wch: 12 }, // Data Solic.
            { wch: 12 }, // NF Origem
            { wch: 8 },  // Coluna
            { wch: 8 },  // Linha
            { wch: 40 }, // Cliente/Pedido
            { wch: 25 }, // Solicitante
            { wch: 25 }, // Fábrica
            { wch: 80 }, // Produtos
            { wch: 50 }  // Observações
        ];

        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        // 5. Envio do arquivo para o navegador
        res.setHeader('Content-Disposition', 'attachment; filename="Relatorio_Assistencias.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Erro ao exportar assistências para Excel:', error);
        res.status(500).send('Erro ao gerar o relatório.');
    }
};