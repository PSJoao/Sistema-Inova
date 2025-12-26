// controllers/conferenciaController.js

const { Pool } = require('pg');
const axios = require('axios');
const { getValidBlingToken } = require('../services/blingTokenManager');

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
        title: 'Conferência de Expedição',
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
            return res.status(404).json({ message: 'Nota Fiscal não encontrada no sistema.' });
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
                s.gtin, s.gtin_embalagem, s.codigo_fabrica, s.escondido,
                p.nome as parent_name, p.sku as parent_sku
            FROM cached_structures s
            JOIN cached_products p ON s.parent_product_bling_id = p.bling_id
            WHERE s.parent_product_bling_id = ANY($1::bigint[])
        `;

        const structuresResult = await pool.query(structuresQuery, [productIds]);

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
            volumes: structuresResult.rows
        });

    } catch (error) {
        console.error('Erro ao buscar dados da NF-e:', error);
        res.status(500).json({ message: 'Erro interno ao buscar nota fiscal.' });
    }
};

// --- API: FINALIZAÇÃO (ATUALIZAÇÃO BLING E BANCO LOCAL) ---

exports.finalizeConferencia = async (req, res) => {
    const { nfeNumero, pedidoBlingId } = req.body;

    if (!nfeNumero || !pedidoBlingId) {
        return res.status(400).json({ message: 'Dados insuficientes para finalizar.' });
    }

    const client = await pool.connect();

    try {
        // [ALTERAÇÃO] Busca a conta (bling_account) da nota antes de prosseguir
        const accountResult = await client.query(
            'SELECT bling_account FROM cached_nfe WHERE nfe_numero = $1', 
            [nfeNumero]
        );
        
        // Se não achar a nota (improvável), usa 'lucas' como fallback seguro ou lança erro
        const accountName = accountResult.rows.length > 0 ? accountResult.rows[0].bling_account : 'lucas';

        await client.query('BEGIN');

        // 1. Atualiza Banco Local (Marca como conferida E salva a data)
        await client.query(
            'UPDATE cached_nfe SET conferencia_realizada = true, data_conferencia = CURRENT_TIMESTAMP WHERE nfe_numero = $1',
            [nfeNumero]
        );

        // 2. Atualiza Bling (Situação "Verificado")
        try {
            // [ALTERAÇÃO] Usa a conta recuperada do banco dinamicamente
            console.log(`[Conferência] Finalizando NF ${nfeNumero} na conta: ${accountName}`);
            
            const accessToken = await getValidBlingToken(accountName); 
            const url = `https://api.bling.com.br/Api/v3/pedidos/vendas/${pedidoBlingId}/situacoes/24`;
            
            await axios.patch(url, {}, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            console.log(`[Conferência] Pedido ${pedidoBlingId} (NF ${nfeNumero}) atualizado para 'Verificado' no Bling (${accountName}).`);

        } catch (blingError) {
            console.error('\n========================================');
            console.error(`[Conferência] ERRO DETALHADO AO ATUALIZAR BLING (NF ${nfeNumero})`);
            
            if (blingError.response) {
                // O servidor respondeu, mas com erro (4xx, 5xx)
                console.error('STATUS HTTP:', blingError.response.status);
                // O 'data' contém a mensagem real do Bling explicando o erro
                console.error('RESPOSTA DO BLING (MOTIVO):', JSON.stringify(blingError.response.data, null, 2));
            } else if (blingError.request) {
                // A requisição foi feita mas o Bling não respondeu
                console.error('ERRO DE REDE: Sem resposta do servidor do Bling.');
            } else {
                // Erro interno na montagem da requisição
                console.error('ERRO INTERNO:', blingError.message);
            }
            console.error('========================================\n');
        }

        await client.query('COMMIT');
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