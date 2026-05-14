// controllers/conferenciaController.js

const { Pool } = require('pg');
const axios = require('axios');
const { getValidBlingToken } = require('../services/blingTokenManager');
const etiquetasService = require('../services/etiquetasService');

// Conexão com o banco (usando as variáveis de ambiente do banco de monitoramento/inova)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// --- RENDERIZAÇÃO DE PÁGINAS ---

exports.renderBipagemPage = (req, res) => {
    res.render('conferencia/bipagem', {
        title: 'Conferência de Pedidos',
        user: req.session.username
    });
};

exports.renderGerenciamentoPage = (req, res) => {
    res.render('conferencia/gerenciamento-codigos', {
        title: 'Gerenciamento de Estruturas Sem EAN'
    });
};

// --- API: MULTITAREFA & ESTADO (PERSISTÊNCIA) ---

exports.getState = async (req, res) => {
    try {
        const userId = req.session.userId || 0;

        const result = await pool.query(
            'SELECT state_json FROM conferencia_expedicao_state WHERE user_id = $1',
            [userId]
        );

        if (result.rows.length > 0) {
            return res.json(result.rows[0].state_json);
        } else {
            return res.json(null);
        }
    } catch (error) {
        console.error('Erro ao buscar estado da conferência:', error);
        res.status(500).json({ message: 'Erro ao recuperar sessão anterior.' });
    }
};

exports.saveState = async (req, res) => {
    try {
        const userId = req.session.userId || 0;
        const stateData = req.body;

        const query = `
            INSERT INTO conferencia_expedicao_state (user_id, state_json, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) 
            DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = CURRENT_TIMESTAMP
        `;

        await pool.query(query, [userId, JSON.stringify(stateData)]);
        res.json({ success: true });

    } catch (error) {
        console.error('Erro ao salvar estado da conferência:', error);
        res.status(500).json({ message: 'Erro ao salvar progresso.' });
    }
};

// --- API: BUSCA DE DADOS DA NOTA (LOGICA PRINCIPAL) ---

exports.searchNfeByChave = async (req, res) => {
    const { chave } = req.params;

    try {
        // 1. Busca a Nota Fiscal
        // [ALTERAÇÃO] Adicionado 'bling_account' no SELECT para saber de quem é a nota
        let nfeQuery = `
            SELECT 
                bling_id, nfe_numero, chave_acesso, product_ids_list, 
                conferencia_realizada, etiqueta_nome, etiqueta_uf, bling_account
            FROM cached_nfe 
            WHERE chave_acesso = $1 OR nfe_numero = $1
        `;

        const nfeResult = await pool.query(nfeQuery, [chave]);

        if (nfeResult.rows.length === 0) {
            // FALLBACK INTELIGENTE: Tentar procurar na cached_etiquetas_ml
            const fallbackQuery = `
                SELECT 
                    id, nfe_numero, pack_id, chave_acesso, skus, passou_conferencia_bipagem
                FROM cached_etiquetas_ml
                WHERE chave_acesso = $1 OR nfe_numero = $1
            `;
            const fallbackResult = await pool.query(fallbackQuery, [chave]);

            if (fallbackResult.rows.length === 0) {
                return res.status(404).json({ message: 'Nota Fiscal não encontrada no sistema (Nem no Bling, nem Hub).' });
            }

            const fallbackNfe = fallbackResult.rows[0];

            if (fallbackNfe.passou_conferencia_bipagem) {
                return res.status(400).json({
                    message: `A Nota Fiscal ${fallbackNfe.nfe_numero} já foi conferida anteriormente!`,
                    code: 'ALREADY_CHECKED',
                    nfeNumero: fallbackNfe.nfe_numero
                });
            }

            let skus = [];
            if (fallbackNfe.skus) {
                try {
                    const parsed = JSON.parse(fallbackNfe.skus);
                    if (Array.isArray(parsed)) {
                        skus = parsed.map(s => s.original || s.display || s);
                    } else if (typeof parsed === 'string') {
                        skus = [parsed];
                    }
                } catch (e) {
                    skus = fallbackNfe.skus.split(',').map(s => s.trim());
                }
            }

            // Pega structures pelo SKU do pai (cached_products) ou do componente (cached_structures)
            const structuresQueryFallback = `
                SELECT 
                    s.id, s.parent_product_bling_id, s.component_sku, s.structure_name,
                    s.gtin, s.gtin_embalagem, s.codigo_fabrica, s.escondido, s.quantidade,
                    p.nome as parent_name, p.sku as parent_sku
                FROM cached_products p
                LEFT JOIN cached_structures s ON s.parent_product_bling_id = p.bling_id
                WHERE p.sku = ANY($1::text[])
            `;

            const structuresResultFallback = await pool.query(structuresQueryFallback, [skus]);

            // Expande os volumes de acordo com a quantidade
            let expandedVolumesFallback = [];
            for (let row of structuresResultFallback.rows) {
                const qtd = parseInt(row.quantidade) || 1;
                for (let i = 0; i < qtd; i++) {
                    // Copia o objeto, adicionando um suffix ao id para evitar duplicação real se necessário no frontend
                    expandedVolumesFallback.push({ ...row, id: row.id ? `${row.id}_${i}` : null });
                }
            }

            return res.json({
                nfe: {
                    numero: fallbackNfe.nfe_numero || '-',
                    chave: fallbackNfe.chave_acesso || '-',
                    cliente: 'Cliente do Hub',
                    uf: '-',
                    pedidoBlingId: fallbackNfe.pack_id || '-',
                    conta: 'hub'
                },
                volumes: expandedVolumesFallback
            });
        }

        const nfe = nfeResult.rows[0];

        // 2. Verifica se já foi conferida
        if (nfe.conferencia_realizada) {
            return res.status(400).json({
                message: `A Nota Fiscal ${nfe.nfe_numero} já foi conferida anteriormente!`,
                code: 'ALREADY_CHECKED',
                nfeNumero: nfe.nfe_numero
            });
        }

        // 3. Busca o Pedido vinculado
        const pedidoResult = await pool.query(
            'SELECT bling_id FROM cached_pedido_venda WHERE notafiscal_id = $1',
            [nfe.bling_id]
        );
        const pedidoBlingId = pedidoResult.rows.length > 0 ? pedidoResult.rows[0].bling_id : null;

        // 4. Identifica os Produtos Pais
        if (!nfe.product_ids_list) {
            return res.status(400).json({ message: 'Nota Fiscal sem produtos vinculados.' });
        }

        const productIds = nfe.product_ids_list.split(';').map(id => id.trim()).filter(id => id);

        // 5. Busca as Estruturas (Volumes)
        const structuresQuery = `
            SELECT 
                s.id, s.parent_product_bling_id, s.component_sku, s.structure_name,
                s.gtin, s.gtin_embalagem, s.codigo_fabrica, s.escondido, s.quantidade,
                p.nome as parent_name, p.sku as parent_sku
            FROM cached_structures s
            JOIN cached_products p ON s.parent_product_bling_id = p.bling_id
            WHERE s.parent_product_bling_id = ANY($1::bigint[])
        `;

        const structuresResult = await pool.query(structuresQuery, [productIds]);

        // Expande os volumes de acordo com a quantidade
        let expandedVolumes = [];
        for (let row of structuresResult.rows) {
            const qtd = parseInt(row.quantidade) || 1;
            for (let i = 0; i < qtd; i++) {
                expandedVolumes.push({ ...row, id: row.id ? `${row.id}_${i}` : null });
            }
        }

        // Retorna o objeto completo
        res.json({
            nfe: {
                numero: nfe.nfe_numero,
                chave: nfe.chave_acesso,
                cliente: nfe.etiqueta_nome,
                uf: nfe.etiqueta_uf,
                pedidoBlingId: pedidoBlingId,
                conta: nfe.bling_account // Envia a conta para o frontend (opcional, mas bom para debug)
            },
            volumes: expandedVolumes
        });

    } catch (error) {
        console.error('Erro ao buscar dados da NF-e:', error);
        res.status(500).json({ message: 'Erro interno ao buscar nota fiscal.' });
    }
};

// --- API: FINALIZAÇÃO (ATUALIZAÇÃO BLING E BANCO LOCAL) ---

exports.finalizeConferencia = async (req, res) => {
    const { nfeNumero, pedidoBlingId, carregadores } = req.body;

    if (!nfeNumero || !pedidoBlingId) {
        return res.status(400).json({ message: 'Dados insuficientes para finalizar.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Atualiza Banco Local (Marca como conferida E salva a data)
        await client.query(
            'UPDATE cached_nfe SET conferencia_realizada = true, data_conferencia = CURRENT_TIMESTAMP WHERE nfe_numero = $1',
            [nfeNumero]
        );

        // 2. Integração com Expedição e Tabela de Gestão de Conferência
        // Seta passou_conferencia_bipagem = true para a nota ir pra gestão
        // e status = checado para seguir o fluxo de expedição
        await client.query(`
            UPDATE cached_etiquetas_ml 
            SET status = 'checado',
                passou_conferencia_bipagem = true,
                bling_sync_status = 'pending'
            WHERE nfe_numero = $1 AND status != 'expedido'
        `, [nfeNumero]);

        // 3. Grava no Relatório Histórico
        const username = req.session.username || 'Sistema';
        await client.query(`
            INSERT INTO conferencia_relatorio (nfe_numero, usuario)
            VALUES ($1, $2)
        `, [nfeNumero, username]);

        await client.query('COMMIT');

        // 4. Registra Produtividade (fora da transaction da conferência para garantir modularidade)
        if (carregadores && carregadores.length > 0) {
            try {
                await etiquetasService.registrarProdutividadeConferencia(nfeNumero, carregadores);
                console.log(`[Conferência] Produtividade registrada para NF ${nfeNumero} com carregadores: ${carregadores.join(', ')}`);
            } catch (prodErr) {
                console.error(`[Conferência] Erro não fatal ao registrar produtividade da NF ${nfeNumero}:`, prodErr);
                // Não retorna erro pois a conferência em si foi salva com sucesso.
            }
        }

        res.json({ success: true, message: 'Conferência finalizada com sucesso.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao finalizar conferência:', error);

        res.status(500).json({ message: 'Erro ao finalizar conferência.' });
    } finally {
        client.release();
    }
};


// --- API: GERENCIAMENTO DE PRODUTOS SEM EAN ---

exports.getProdutosSemEanApi = async (req, res) => {
    try {
        const { draw, start, length, search, filterOption } = req.query;

        const limit = parseInt(length) || 10;
        const offset = parseInt(start) || 0;
        const searchValue = search && search.value ? `%${search.value}%` : null;

        // [NOVO] Passo de Sincronização (Auto-Fix):
        // Antes de buscar, propagamos o GTIN/GTIN_EMBALAGEM de estruturas que têm para as que não têm (mesmo SKU e Nome).
        // Isso resolve o problema das "clones" incompletas.
        const syncGtinQuery = `
            UPDATE cached_structures t1
            SET gtin = t2.gtin
            FROM cached_structures t2
            WHERE t1.component_sku = t2.component_sku 
              AND t1.structure_name = t2.structure_name
              AND (t1.gtin IS NULL OR t1.gtin = '')
              AND (t2.gtin IS NOT NULL AND t2.gtin <> '')
        `;

        const syncGtinEmbQuery = `
            UPDATE cached_structures t1
            SET gtin_embalagem = t2.gtin_embalagem
            FROM cached_structures t2
            WHERE t1.component_sku = t2.component_sku 
              AND t1.structure_name = t2.structure_name
              AND (t1.gtin_embalagem IS NULL OR t1.gtin_embalagem = '')
              AND (t2.gtin_embalagem IS NOT NULL AND t2.gtin_embalagem <> '')
        `;

        // Executamos as correções em paralelo
        await Promise.all([
            pool.query(syncGtinQuery),
            pool.query(syncGtinEmbQuery)
        ]);

        // [ALTERAÇÃO] Filtro Base Reforçado:
        // 1. Ignora SKU nulo/vazio.
        // 2. AGORA TAMBÉM ignora quem já possui GTIN ou GTIN Embalagem (pois não precisam de conferência).
        let whereClause = `
            WHERE s.component_sku IS NOT NULL 
              AND s.component_sku <> ''
              AND (s.gtin IS NULL OR s.gtin = '')
              AND (s.gtin_embalagem IS NULL OR s.gtin_embalagem = '')
        `;

        const queryParams = [];

        // Filtro de "Escondidos"
        if (filterOption === 'escondidos') {
            whereClause += ` AND s.escondido = true`;
        } else if (filterOption === 'nao_escondidos') {
            whereClause += ` AND (s.escondido = false OR s.escondido IS NULL)`;
        }

        // Filtro de Pesquisa
        if (searchValue) {
            queryParams.push(searchValue);
            whereClause += ` AND (
                s.structure_name ILIKE $${queryParams.length} OR 
                s.component_sku ILIKE $${queryParams.length} OR
                s.codigo_fabrica ILIKE $${queryParams.length}
            )`;
        }

        // [MANTIDO] Uso de DISTINCT ON para agrupar repetidos visualmente
        const dataQuery = `
            SELECT DISTINCT ON (s.component_sku, s.structure_name)
                s.id, s.component_sku, s.structure_name, 
                s.gtin, s.gtin_embalagem, s.codigo_fabrica, s.escondido
            FROM cached_structures s
            ${whereClause}
            ORDER BY s.component_sku ASC, s.structure_name ASC
            LIMIT ${limit} OFFSET ${offset}
        `;

        // [MANTIDO] Contagem correta dos grupos
        const countQuery = `
            SELECT COUNT(*) FROM (
                SELECT DISTINCT component_sku, structure_name 
                FROM cached_structures s 
                ${whereClause}
            ) as grouped_count
        `;

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, queryParams),
            pool.query(countQuery, queryParams)
        ]);

        res.json({
            draw: parseInt(draw),
            recordsTotal: parseInt(countResult.rows[0].count),
            recordsFiltered: parseInt(countResult.rows[0].count),
            data: dataResult.rows
        });

    } catch (error) {
        console.error('Erro na API de Produtos Sem EAN:', error);
        res.status(500).json({ error: 'Erro ao carregar dados.' });
    }
};

exports.updateStructureInfo = async (req, res) => {
    const { id, gtin, codigo_fabrica, escondido } = req.body;

    if (!id) {
        return res.status(400).json({ message: 'ID da estrutura necessário.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // [ALTERAÇÃO 1] Primeiro descobrimos o SKU e Nome do item que foi editado
        const findQuery = 'SELECT component_sku, structure_name FROM cached_structures WHERE id = $1';
        const findResult = await client.query(findQuery, [id]);

        if (findResult.rows.length === 0) {
            throw new Error('Estrutura não encontrada.');
        }

        const { component_sku, structure_name } = findResult.rows[0];

        // [ALTERAÇÃO 2] Agora atualizamos TODOS os registros que tenham esse mesmo SKU e Nome
        // Isso garante que se houver 50 linhas iguais, todas recebem o código novo
        const updateQuery = `
            UPDATE cached_structures
            SET 
                gtin = $1,
                codigo_fabrica = $2,
                escondido = $3
            WHERE component_sku = $4 AND structure_name = $5
        `;

        await client.query(updateQuery, [gtin, codigo_fabrica, !!escondido, component_sku, structure_name]);

        await client.query('COMMIT');
        res.json({ success: true, message: 'Grupo de estruturas atualizado com sucesso.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Erro ao atualizar estrutura ${id}:`, error);
        res.status(500).json({ message: 'Erro ao atualizar dados.' });
    } finally {
        client.release();
    }
};

// --- API: CONTROLE DE PALETES ---

exports.getPaletes = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nome, count, created_at FROM conferencia_paletes ORDER BY id ASC'
        );
        const paleteAtualRes = await pool.query(
            "SELECT value FROM conferencia_config WHERE key = 'palete_atual_id'"
        );
        const paleteAtualId = paleteAtualRes.rows.length > 0 ? parseInt(paleteAtualRes.rows[0].value) : 1;

        res.json({
            success: true,
            paletes: result.rows,
            paleteAtualId
        });
    } catch (error) {
        console.error('Erro ao buscar paletes:', error);
        res.status(500).json({ success: false, message: 'Erro ao buscar paletes.' });
    }
};

exports.savePalete = async (req, res) => {
    try {
        const { id, nome, count } = req.body;
        const query = `
            INSERT INTO conferencia_paletes (id, nome, count)
            VALUES ($1, $2, $3)
            ON CONFLICT (id)
            DO UPDATE SET nome = EXCLUDED.nome, count = EXCLUDED.count, updated_at = CURRENT_TIMESTAMP
        `;
        await pool.query(query, [id, nome, count]);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao salvar palete:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar palete.' });
    }
};

exports.setPaleteAtual = async (req, res) => {
    try {
        const { paleteAtualId } = req.body;
        const query = `
            INSERT INTO conferencia_config (key, value)
            VALUES ('palete_atual_id', $1)
            ON CONFLICT (key)
            DO UPDATE SET value = EXCLUDED.value
        `;
        await pool.query(query, [String(paleteAtualId)]);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao definir palete atual:', error);
        res.status(500).json({ success: false, message: 'Erro ao definir palete atual.' });
    }
};

exports.resetPaletes = async (req, res) => {
    try {
        await pool.query('DELETE FROM conferencia_paletes');
        await pool.query(`
            INSERT INTO conferencia_paletes (id, nome, count) VALUES (1, 'Palete 1', 0)
        `);
        await pool.query(`
            INSERT INTO conferencia_config (key, value) VALUES ('palete_atual_id', '1')
            ON CONFLICT (key) DO UPDATE SET value = '1'
        `);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao resetar paletes:', error);
        res.status(500).json({ success: false, message: 'Erro ao resetar paletes.' });
    }
};