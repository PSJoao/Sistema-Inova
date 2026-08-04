// controllers/anunciosController.js
const { Pool } = require('pg');
const axios = require('axios');
const xlsx = require('xlsx');
const { syncEstoquePlataforma } = require('../blingSyncService');

// Pool do banco local (inovamonitoramento) - mesmo do produtosController
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Configuração do Hub
const HUB_API_URL = process.env.HUB_API_URL || 'http://localhost:3000';
const SELLER_IDS = ['188924862', '133882293'];

/// Cache de tokens do Hub por e-mail
let hubTokensCache = {};

/**
 * Obtém um token válido do Hub para um e-mail/senha específicos, fazendo login se necessário.
 */
async function getHubToken(email, password) {
    if (!email || !password) return null;
    const now = Date.now();
    if (hubTokensCache[email] && now < hubTokensCache[email].expiresAt) {
        return hubTokensCache[email].token;
    }

    try {
        const response = await axios.post(`${HUB_API_URL}/hub/api/login`, {
            email,
            password
        });

        const token = response.data.token;
        hubTokensCache[email] = {
            token,
            expiresAt: now + (24 * 60 * 60 * 1000) // 24h
        };

        return token;
    } catch (error) {
        console.error(`[Anúncios] Erro ao autenticar no Hub (${email}):`, error.message);
        return null;
    }
}

// =============================================
// === RENDERIZAÇÃO DE VIEW ===
// =============================================

/**
 * Renderiza a página de listagem de anúncios.
 */
exports.renderAnunciosPage = (req, res) => {
    try {
        res.render('produtos/lista-anuncios', {
            title: 'Gerenciar Anúncios',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de anúncios:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de gerenciamento de anúncios.');
        res.redirect('/');
    }
};

// =============================================
// === API DE LISTAGEM ===
// =============================================

/**
 * API que busca os dados para a tabela dinâmica de anúncios, com filtros e paginação.
 * Faz JOIN com cached_products para trazer o estoque_plataforma.
 */
exports.getAnunciosApi = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            search = '',
            status = '',
            catalog = '',
            orderBy = 'last_updated_at',
            orderDir = 'DESC'
        } = req.query;

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        if (status) {
            whereClauses.push(`a.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        if (catalog === 'com') {
            whereClauses.push(`a.catalog_listing = TRUE`);
        } else if (catalog === 'sem') {
            whereClauses.push(`a.catalog_listing = FALSE`);
        }

        if (req.query.tipo) {
            whereClauses.push(`a.tipo_anuncio = $${paramIndex}`);
            queryParams.push(req.query.tipo);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validação da ordenação para evitar SQL Injection
        const colunasPermitidas = ['id_anuncio', 'sku', 'descricao', 'status', 'estoque_ml', 'prazo_disponibilidade', 'estoque_plataforma', 'frete', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'preco_promocional', 'tipo_anuncio', 'ganhando_catalogo', 'tarifa', 'margem_lucro'];
        const safeOrderBy = colunasPermitidas.includes(orderBy) ? orderBy : 'last_updated_at';
        const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Mapeia a coluna de ordenação correta dependendo do join
        let sqlOrderBy = `a.${safeOrderBy}`;
        if (safeOrderBy === 'estoque_plataforma') {
            sqlOrderBy = 'cp.estoque_plataforma';
        } else if (safeOrderBy === 'prazo_disponibilidade') {
            // Garante ordenação numérica removendo letras e convertendo para inteiro
            sqlOrderBy = `NULLIF(regexp_replace(a.prazo_disponibilidade, '\\D', '', 'g'), '')::integer`;
        }

        const fetchAll = req.query.all === 'true' || req.query.fetchAll === 'true';

        let dataResult;
        if (fetchAll) {
            const mainQuery = `
                SELECT 
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.estoque_ml,
                    a.prazo_disponibilidade,
                    a.catalog_listing,
                    a.frete,
                    a.tipo_anuncio,
                    a.ganhando_catalogo,
                    a.experiencia_compra,
                    a.vendas_total,
                    a.preco,
                    a.preco_promocional,
                    a.tarifa,
                    a.permalink,
                    a.thumbnail,
                    a.custo_produto,
                    a.imposto,
                    a.margem_lucro,
                    a.last_updated_at,
                    cp.estoque_plataforma
                FROM anuncios_ml a
                LEFT JOIN (
                    SELECT DISTINCT ON (sku) sku, estoque_plataforma
                    FROM cached_products
                    WHERE sku IS NOT NULL AND sku != ''
                    ORDER BY sku, 
                        CASE 
                            WHEN bling_account = 'lucas' THEN 1 
                            WHEN bling_account = 'eliane' THEN 2 
                            ELSE 3 
                        END,
                        last_updated_at DESC
                ) cp ON cp.sku = a.sku
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
            `;
            dataResult = await pool.query(mainQuery, queryParams);
        } else {
            const mainQuery = `
                SELECT 
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.estoque_ml,
                    a.prazo_disponibilidade,
                    a.catalog_listing,
                    a.frete,
                    a.tipo_anuncio,
                    a.ganhando_catalogo,
                    a.experiencia_compra,
                    a.vendas_total,
                    a.preco,
                    a.preco_promocional,
                    a.tarifa,
                    a.permalink,
                    a.thumbnail,
                    a.custo_produto,
                    a.imposto,
                    a.margem_lucro,
                    a.last_updated_at,
                    cp.estoque_plataforma
                FROM anuncios_ml a
                LEFT JOIN (
                    SELECT DISTINCT ON (sku) sku, estoque_plataforma
                    FROM cached_products
                    WHERE sku IS NOT NULL AND sku != ''
                    ORDER BY sku, 
                        CASE 
                            WHEN bling_account = 'lucas' THEN 1 
                            WHEN bling_account = 'eliane' THEN 2 
                            ELSE 3 
                        END,
                        last_updated_at DESC
                ) cp ON cp.sku = a.sku
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            dataResult = await pool.query(mainQuery, [...queryParams, limit, offset]);
        }

        // 2. Busca contagem total para paginação
        const countQuery = `SELECT COUNT(*) FROM anuncios_ml a ${whereCondition};`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        res.status(200).json({
            data: dataResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems }
        });

    } catch (error) {
        console.error("[API Anúncios] Erro ao buscar dados:", error);
        res.status(500).json({ message: "Erro ao buscar dados dos anúncios." });
    }
};

// =============================================
// === SINCRONIZAÇÃO COM HUB ===
// =============================================

function isItemDeleted(itemData) {
    if (!itemData) return false;

    let subStatusArray = [];
    if (Array.isArray(itemData.sub_status)) {
        subStatusArray = itemData.sub_status;
    } else if (typeof itemData.sub_status === 'string') {
        try {
            const parsed = JSON.parse(itemData.sub_status);
            subStatusArray = Array.isArray(parsed) ? parsed : [itemData.sub_status];
        } catch (e) {
            subStatusArray = [itemData.sub_status];
        }
    }

    const hasDeletedSubStatus = subStatusArray.some(s => String(s).toLowerCase().includes('deleted'));
    const hasDeletedTag = Array.isArray(itemData.tags) && itemData.tags.includes('deleted');

    return hasDeletedSubStatus || (itemData.status === 'closed' && (hasDeletedSubStatus || hasDeletedTag));
}

function matchesSyncFilters(anuncio, options) {
    if (!options) return true;
    const { search, status, catalog, tipo, item_ids } = options;

    if (Array.isArray(item_ids) && item_ids.length > 0) {
        if (!item_ids.includes(anuncio.id_anuncio)) {
            return false;
        }
    }

    if (search && String(search).trim() !== '') {
        const term = String(search).trim().toLowerCase();
        const sku = String(anuncio.sku || '').toLowerCase();
        const desc = String(anuncio.descricao || '').toLowerCase();
        const idAnuncio = String(anuncio.id_anuncio || '').toLowerCase();
        if (!sku.includes(term) && !desc.includes(term) && !idAnuncio.includes(term)) {
            return false;
        }
    }

    if (status && String(status).trim() !== '') {
        const statusClean = String(status).trim().toLowerCase();
        const itemStatus = String(anuncio.status || '').trim().toLowerCase();

        let statusExpected = statusClean;
        if (statusClean === 'ativo') statusExpected = 'active';
        if (statusClean === 'pausado') statusExpected = 'paused';
        if (statusClean === 'fechado') statusExpected = 'closed';
        if (statusClean === 'em análise' || statusClean === 'em analise') statusExpected = 'under_review';
        if (statusClean === 'inativo') statusExpected = 'inactive';

        if (itemStatus !== statusExpected && itemStatus !== statusClean) {
            return false;
        }
    }

    if (catalog && String(catalog).trim() !== '') {
        const isCatalog = Boolean(anuncio.catalog_listing && anuncio.catalog_listing !== 'false' && anuncio.catalog_listing !== '0');
        if (catalog === 'com' && !isCatalog) return false;
        if (catalog === 'sem' && isCatalog) return false;
    }

    if (tipo && String(tipo).trim() !== '') {
        const tipoClean = String(tipo).trim().toLowerCase();
        const rawTipo = String(anuncio.tipo || anuncio.tipo_anuncio || '').toLowerCase();
        const tipoAnuncio = rawTipo === 'gold_special' ? 'clássico' :
                            rawTipo === 'gold_pro' ? 'premium' :
                            rawTipo;

        if (tipoAnuncio !== tipoClean && rawTipo !== tipoClean) return false;
    }

    return true;
}

/**
 * Função interna que faz o processo completo de sincronização
 */
async function sincronizarAnunciosInterno(forcarSyncHub = false, options = {}) {
    console.log(`[Anúncios] Iniciando sincronização interna (forçar sync Hub: ${forcarSyncHub}, filtros: ${JSON.stringify(options)})...`);

    // Carrega credenciais do .env
    const accounts = [
        { email: process.env.HUB_CLIENTE_EMAIL_1, password: process.env.HUB_CLIENTE_SENHA_1 },
        { email: process.env.HUB_CLIENTE_EMAIL_2, password: process.env.HUB_CLIENTE_SENHA_2 }
    ].filter(acc => acc.email && acc.password);

    if (accounts.length === 0) {
        throw new Error('Nenhuma credencial de conta do Hub configurada no .env');
    }

    // 1. Condicionalmente dispara a sincronização no Hub/ML
    if (forcarSyncHub) {
        const hubProdutosService = require('../hub/services/hubProdutosService');

        let specificIds = [];
        if (Array.isArray(options.item_ids) && options.item_ids.length > 0) {
            specificIds = options.item_ids;
        } else if (options.search && (String(options.search).toUpperCase().startsWith('MLB') || String(options.search).trim().length >= 8)) {
            specificIds = [options.search.trim()];
        }

        if (specificIds.length > 0) {
            console.log(`[Anúncios] Sincronizando ${specificIds.length} item(ns) específico(s) diretamente da API do Mercado Livre...`);
            await hubProdutosService.sincronizarAnunciosEspecificos(specificIds);
        } else {
            let seedToken = null;
            for (const acc of accounts) {
                seedToken = await getHubToken(acc.email, acc.password);
                if (seedToken) break;
            }

            if (!seedToken) {
                throw new Error('Não foi possível obter um token de acesso para disparar a sincronização no Hub');
            }

            console.log('[Anúncios] Disparando sincronização manual no Hub...');
            try {
                await axios.post(
                    `${HUB_API_URL}/hub/api/produtos/sync-manual`,
                    { seller_ids: SELLER_IDS },
                    { headers: { Authorization: `Bearer ${seedToken}` } }
                );
            } catch (syncErr) {
                if (syncErr.response?.status === 409) {
                    console.log('[Anúncios] Sincronização manual já em andamento no Hub.');
                } else {
                    console.error('[Anúncios] Erro ao disparar sincronização no Hub:', syncErr.message);
                }
            }

            // 2. Aguarda o processamento do Hub
            console.log('[Anúncios] Aguardando processamento do Hub (3s)...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    // 3. Busca todos os anúncios do Hub para CADA conta cadastrada e consolida
    let allAnuncios = [];

    for (const acc of accounts) {
        console.log(`[Anúncios] Buscando anúncios do Hub para a conta: ${acc.email}`);
        const token = await getHubToken(acc.email, acc.password);
        if (!token) {
            console.warn(`[Anúncios] Pulando busca para a conta ${acc.email} devido a falha no token.`);
            continue;
        }

        let currentOffset = 0;
        const fetchLimit = 1000;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await axios.get(`${HUB_API_URL}/hub/api/produtos`, {
                    params: { limit: fetchLimit, offset: currentOffset },
                    headers: { Authorization: `Bearer ${token}` }
                });

                const dados = response.data.dados || [];
                allAnuncios = allAnuncios.concat(dados);

                if (dados.length < fetchLimit) {
                    hasMore = false;
                } else {
                    currentOffset += fetchLimit;
                }
            } catch (fetchErr) {
                console.error(`[Anúncios] Erro ao buscar anúncios para ${acc.email} no offset ${currentOffset}:`, fetchErr.message);
                hasMore = false;
            }
        }
    }

    console.log(`[Anúncios] Total consolidado do Hub: ${allAnuncios.length} anúncios.`);

    const hasFilters = Boolean(options && (
        (options.search && String(options.search).trim() !== '') ||
        (options.status && String(options.status).trim() !== '') ||
        (options.catalog && String(options.catalog).trim() !== '') ||
        (options.tipo && String(options.tipo).trim() !== '')
    ));

    const anunciosToSync = hasFilters
        ? allAnuncios.filter(a => matchesSyncFilters(a, options))
        : allAnuncios;

    console.log(`[Anúncios] Total a processar no Inova: ${anunciosToSync.length} (Filtros ativos: ${hasFilters}).`);

    if (anunciosToSync.length === 0) {
        return {
            message: 'Nenhum anúncio correspondente aos filtros foi encontrado para sincronizar.',
            total: 0,
            novos: 0,
            atualizados: 0
        };
    }

    // 4. Insere/Atualiza na tabela local anuncios_ml
    const client = await pool.connect();
    let insertedCount = 0;
    let updatedCount = 0;

    try {
        await client.query('BEGIN');

        for (const anuncio of anunciosToSync) {
            if (isItemDeleted(anuncio)) {
                console.log(`[Anúncios] Removendo anúncio excluído ${anuncio.id_anuncio} do Inova...`);
                await client.query('DELETE FROM anuncios_ml WHERE id_anuncio = $1', [anuncio.id_anuncio]);
                continue;
            }

            const tipoAnuncio = anuncio.tipo === 'gold_special' ? 'Clássico' :
                anuncio.tipo === 'gold_pro' ? 'Premium' :
                    anuncio.tipo;

            let promocoesJsonVal = null;
            if (anuncio.promocoes_json) {
                promocoesJsonVal = typeof anuncio.promocoes_json === 'string' ? anuncio.promocoes_json : JSON.stringify(anuncio.promocoes_json);
            }

            let subStatusVal = null;
            if (Array.isArray(anuncio.sub_status) && anuncio.sub_status.length > 0) {
                subStatusVal = anuncio.sub_status.join(', ');
            } else if (typeof anuncio.sub_status === 'string' && anuncio.sub_status.trim() !== '') {
                try {
                    const parsed = JSON.parse(anuncio.sub_status);
                    subStatusVal = Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
                } catch (e) {
                    subStatusVal = anuncio.sub_status.replace(/[\[\]"']/g, '').trim();
                }
            }

            const result = await client.query(`
                INSERT INTO anuncios_ml (id_anuncio, sku, descricao, status, sub_status, empresa, estoque_ml, prazo_disponibilidade, catalog_listing, frete, tipo_anuncio, ganhando_catalogo, experiencia_compra, vendas_total, preco, preco_promocional, tarifa, permalink, thumbnail, promocoes_json, qualidade, data_ultima_venda, dias_sem_vender, last_updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW())
                ON CONFLICT (id_anuncio) DO UPDATE SET
                    sku = EXCLUDED.sku,
                    descricao = EXCLUDED.descricao,
                    status = EXCLUDED.status,
                    sub_status = EXCLUDED.sub_status,
                    empresa = EXCLUDED.empresa,
                    estoque_ml = EXCLUDED.estoque_ml,
                    prazo_disponibilidade = EXCLUDED.prazo_disponibilidade,
                    catalog_listing = EXCLUDED.catalog_listing,
                    frete = EXCLUDED.frete,
                    tipo_anuncio = EXCLUDED.tipo_anuncio,
                    ganhando_catalogo = EXCLUDED.ganhando_catalogo,
                    experiencia_compra = EXCLUDED.experiencia_compra,
                    vendas_total = EXCLUDED.vendas_total,
                    preco = EXCLUDED.preco,
                    preco_promocional = EXCLUDED.preco_promocional,
                    tarifa = EXCLUDED.tarifa,
                    permalink = EXCLUDED.permalink,
                    thumbnail = EXCLUDED.thumbnail,
                    promocoes_json = EXCLUDED.promocoes_json,
                    qualidade = EXCLUDED.qualidade,
                    data_ultima_venda = EXCLUDED.data_ultima_venda,
                    dias_sem_vender = EXCLUDED.dias_sem_vender,
                    last_updated_at = NOW()
                RETURNING (xmax = 0) AS is_insert;
            `, [
                anuncio.id_anuncio,
                anuncio.sku || null,
                anuncio.descricao || null,
                anuncio.status || null,
                subStatusVal,
                anuncio.empresa || null,
                anuncio.estoque || 0,
                anuncio.prazo_disponibilidade || null,
                anuncio.catalog_listing || false,
                anuncio.frete || 0,
                tipoAnuncio,
                anuncio.ganhando_catalogo || false,
                anuncio.experiencia_compra || 0,
                anuncio.vendas_total || 0,
                anuncio.preco || 0,
                anuncio.preco_promocional || null,
                anuncio.tarifa || 0,
                anuncio.permalink || null,
                anuncio.thumbnail || null,
                promocoesJsonVal,
                anuncio.qualidade || null,
                anuncio.data_ultima_venda || null,
                anuncio.dias_sem_vender != null ? anuncio.dias_sem_vender : null
            ]);

            if (result.rows[0]?.is_insert) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }

        // Recalcula custos, impostos e margem de lucro com base na tabela produto_custos_impostos
        await client.query(`
            UPDATE anuncios_ml a
            SET 
                custo_produto = pci.custo,
                imposto = pci.imposto,
                margem_lucro = CASE 
                    WHEN COALESCE(NULLIF(a.preco_promocional, 0), a.preco) > 0 THEN 
                        ((COALESCE(NULLIF(a.preco_promocional, 0), a.preco) - pci.custo - COALESCE(a.frete, 0) - (COALESCE(NULLIF(a.preco_promocional, 0), a.preco) * (COALESCE(a.tarifa, 0) / 100.0)) - (COALESCE(NULLIF(a.preco_promocional, 0), a.preco) * (pci.imposto / 100.0))) / COALESCE(NULLIF(a.preco_promocional, 0), a.preco)) * 100.0
                    ELSE 0 
                END
            FROM produto_custos_impostos pci
            WHERE TRIM(a.sku) = TRIM(pci.sku);
        `);

        await client.query('COMMIT');
    } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
    } finally {
        client.release();
    }

    console.log(`[Anúncios] Sincronização finalizada no Inova: ${insertedCount} novos, ${updatedCount} atualizados.`);

    // 5. Dispara a sincronização do estoque virtual (plataforma) do Bling apenas no sync manual
    if (forcarSyncHub) {
        console.log('[Anúncios] Disparando sincronização do estoque plataforma (Bling)...');
        syncEstoquePlataforma().catch(err => {
            console.error('[Anúncios] Erro ao sincronizar estoque plataforma:', err.message);
        });
    }

    const message = hasFilters
        ? `Sincronização inteligente de ${anunciosToSync.length} anúncio(s) filtrado(s) concluída com sucesso!`
        : `Sincronização de todos os ${allAnuncios.length} anúncios concluída com sucesso!`;

    return {
        message,
        total: anunciosToSync.length,
        totalGeral: allAnuncios.length,
        novos: insertedCount,
        atualizados: updatedCount
    };
}

/**
 * Endpoint de sincronização acionado manualmente via botão no frontend
 */
exports.sincronizarAnuncios = async (req, res) => {
    try {
        const { search, status, catalog, tipo } = { ...req.query, ...req.body };
        const options = { search, status, catalog, tipo };

        const resultado = await sincronizarAnunciosInterno(true, options);
        res.status(200).json({
            success: true,
            ...resultado
        });
    } catch (error) {
        console.error('[Anúncios] Erro na rota de sincronização:', error.message);
        res.status(500).json({ error: 'Erro ao sincronizar anúncios com o Hub.' });
    }
};

// Exporta o método interno para o index.js / cron usar
exports.sincronizarAnunciosInterno = sincronizarAnunciosInterno;

/**
 * API para exportar relatório Excel respeitando os mesmos filtros
 */
exports.exportarAnunciosExcel = async (req, res) => {
    try {
        const {
            search = '',
            status = '',
            catalog = '',
            tipo = '',
            orderBy = 'last_updated_at',
            orderDir = 'DESC'
        } = req.query;

        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        if (status) {
            whereClauses.push(`a.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        if (catalog === 'com') {
            whereClauses.push(`a.catalog_listing = TRUE`);
        } else if (catalog === 'sem') {
            whereClauses.push(`a.catalog_listing = FALSE`);
        }

        if (tipo) {
            whereClauses.push(`a.tipo_anuncio = $${paramIndex}`);
            queryParams.push(tipo);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validação da ordenação
        const colunasPermitidas = ['id_anuncio', 'sku', 'status', 'estoque_ml', 'prazo_disponibilidade', 'frete', 'estoque_plataforma', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'tipo_anuncio'];
        const safeOrderBy = colunasPermitidas.includes(orderBy) ? orderBy : 'last_updated_at';
        const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let sqlOrderBy = `a.${safeOrderBy}`;
        if (safeOrderBy === 'estoque_plataforma') {
            sqlOrderBy = 'cp.estoque_plataforma';
        } else if (safeOrderBy === 'prazo_disponibilidade') {
            sqlOrderBy = `NULLIF(regexp_replace(a.prazo_disponibilidade, '\\D', '', 'g'), '')::integer`;
        }

        // Query sem paginação para trazer tudo que foi filtrado
        const query = `
            SELECT 
                a.id_anuncio,
                a.sku,
                a.descricao,
                a.status,
                a.empresa,
                a.estoque_ml,
                a.prazo_disponibilidade,
                a.catalog_listing,
                a.frete,
                a.tipo_anuncio,
                a.ganhando_catalogo,
                a.experiencia_compra,
                a.vendas_total,
                a.preco,
                a.preco_promocional,
                a.tarifa,
                a.permalink,
                a.thumbnail,
                a.custo_produto,
                a.imposto,
                a.margem_lucro,
                a.last_updated_at,
                cp.estoque_plataforma
            FROM anuncios_ml a
            LEFT JOIN (
                SELECT DISTINCT ON (sku) sku, estoque_plataforma
                FROM cached_products
                WHERE sku IS NOT NULL AND sku != ''
                ORDER BY sku, 
                    CASE 
                        WHEN bling_account = 'lucas' THEN 1 
                        WHEN bling_account = 'eliane' THEN 2 
                        ELSE 3 
                    END,
                    last_updated_at DESC
            ) cp ON cp.sku = a.sku
            ${whereCondition}
            ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
        `;

        const dataResult = await pool.query(query, queryParams);

        // Mapeia para formato amigável do Excel com TODOS os campos disponíveis
        const dataForExcel = dataResult.rows.map(row => {
            // Limpa o prazo para exibir formato legível
            let prazo = '-';
            if (row.prazo_disponibilidade != null && row.prazo_disponibilidade !== '') {
                const dias = String(row.prazo_disponibilidade).replace(/\D/g, '');
                prazo = dias !== '' ? `${dias} dias` : row.prazo_disponibilidade;
            }

            const tarifaVal = Number(row.tarifa) || 0;
            const tarifaFormatted = tarifaVal > 0 ? `${tarifaVal.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%` : '-';

            const concorrenciaLabel = row.catalog_listing
                ? (row.ganhando_catalogo ? 'Ganhando' : 'Perdendo')
                : '-';

            const margemVal = Number(row.margem_lucro) || 0;
            const margemFormatted = row.margem_lucro != null ? `${margemVal.toFixed(2).replace('.', ',')}%` : '-';

            return {
                'ID do Anúncio': row.id_anuncio || '-',
                'SKU': row.sku || '-',
                'Descrição': row.descricao || '-',
                'Empresa (Conta)': row.empresa || '-',
                'Status': row.status === 'active' ? 'Ativo' :
                    row.status === 'paused' ? 'Pausado' :
                        row.status === 'closed' ? 'Fechado' :
                            row.status === 'under_review' ? 'Em análise' :
                                row.status === 'inactive' ? 'Inativo' : row.status || '-',
                'Catálogo': row.catalog_listing ? 'Sim' : 'Não',
                'Concorrência': concorrenciaLabel,
                'Tipo': row.tipo_anuncio || '-',
                'Experiência Compra': row.experiencia_compra ? `${row.experiencia_compra}%` : '0%',
                'Vendas Total': row.vendas_total || 0,
                'Preço Original (R$)': row.preco != null ? `R$ ${Number(row.preco).toFixed(2).replace('.', ',')}` : '-',
                'Preço Promo (R$)': row.preco_promocional != null ? `R$ ${Number(row.preco_promocional).toFixed(2).replace('.', ',')}` : '-',
                'Tarifa (%)': tarifaFormatted,
                'Custo Produto (R$)': row.custo_produto != null && Number(row.custo_produto) > 0 ? `R$ ${Number(row.custo_produto).toFixed(2).replace('.', ',')}` : '-',
                'Imposto (%)': row.imposto != null && Number(row.imposto) > 0 ? `${Number(row.imposto).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%` : '-',
                'Margem Lucro (%)': margemFormatted,
                'Estoque ML': row.estoque_ml != null ? row.estoque_ml : '-',
                'Prazo Disponibilidade': prazo,
                'Frete (R$)': row.frete != null ? `R$ ${Number(row.frete).toFixed(2).replace('.', ',')}` : 'R$ 0,00',
                'Estoque Bling': row.estoque_plataforma != null ? row.estoque_plataforma : '-',
                'Link Anúncio (URL)': row.permalink || (row.id_anuncio ? `https://produto.mercadolivre.com.br/${row.id_anuncio}` : '-'),
                'Foto (URL)': row.thumbnail || '-',
                'Última Atualização': row.last_updated_at ? new Date(row.last_updated_at).toLocaleString('pt-BR') : '-'
            };
        });

        // Cria planilha Excel
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(dataForExcel);

        // Define largura automática das colunas
        const maxLens = {};
        dataForExcel.forEach(row => {
            Object.keys(row).forEach(key => {
                const len = String(row[key]).length;
                maxLens[key] = Math.max(maxLens[key] || 10, len, key.length);
            });
        });
        worksheet['!cols'] = Object.keys(maxLens).map(key => ({ wch: maxLens[key] + 3 }));

        xlsx.utils.book_append_sheet(workbook, worksheet, 'Anúncios');

        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Anuncios_${Date.now()}.xlsx"`);
        res.end(buffer);

    } catch (error) {
        console.error('[Anúncios Exportar] Erro:', error);
        res.status(500).send('Erro ao exportar o relatório Excel.');
    }
};

// =============================================
// === PREFERÊNCIAS DE COLUNAS DO USUÁRIO ===
// =============================================

/**
 * Busca a ordem personalizada de colunas salvos no banco de dados.
 */
exports.getColumnOrder = async (req, res) => {
    try {
        const userId = req.session?.user?.id || 1;
        const result = await pool.query(
            `SELECT column_order FROM user_column_preferences WHERE user_id = $1 AND view_name = 'anuncios_ml'`,
            [userId]
        );
        if (result.rows.length > 0) {
            return res.json({ columnOrder: result.rows[0].column_order });
        }
        res.json({ columnOrder: null });
    } catch (error) {
        console.error('[Anúncios API] Erro ao buscar ordem das colunas:', error);
        res.status(500).json({ message: 'Erro ao buscar ordem das colunas.' });
    }
};

/**
 * Salva a nova ordem personalizada de colunas no banco de dados.
 */
exports.saveColumnOrder = async (req, res) => {
    try {
        const userId = req.session?.user?.id || 1;
        const { columnOrder } = req.body;
        if (!Array.isArray(columnOrder)) {
            return res.status(400).json({ message: 'Ordem das colunas inválida.' });
        }

        await pool.query(
            `INSERT INTO user_column_preferences (user_id, view_name, column_order, updated_at)
             VALUES ($1, 'anuncios_ml', $2, NOW())
             ON CONFLICT (user_id, view_name) DO UPDATE SET
             column_order = EXCLUDED.column_order,
             updated_at = NOW()`,
            [userId, JSON.stringify(columnOrder)]
        );

        res.json({ success: true, message: 'Ordem das colunas salva com sucesso!' });
    } catch (error) {
        console.error('[Anúncios API] Erro ao salvar ordem das colunas:', error);
        res.status(500).json({ message: 'Erro ao salvar ordem das colunas.' });
    }
};

/**
 * Importa planilha de custos e impostos por SKU (.xlsx / .xls / .csv)
 */
exports.importarCustosEImpostos = async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            return res.status(400).json({ message: 'Planilha inválida ou vazia.' });
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!rows || rows.length <= 1) {
            return res.status(400).json({ message: 'A planilha não possui linhas de dados para importar.' });
        }

        const client = await pool.connect();
        let totalSkusProcessados = 0;

        try {
            await client.query('BEGIN');

            // Garante que a tabela produto_custos_impostos exista
            await client.query(`
                CREATE TABLE IF NOT EXISTS produto_custos_impostos (
                    sku VARCHAR(100) PRIMARY KEY,
                    custo NUMERIC(10, 2) DEFAULT 0,
                    imposto NUMERIC(5, 2) DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            `);

            // Ignora a primeira linha (cabeçalho)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;

                // Coluna A (0) = CUSTO, Coluna B (1) = IMPOSTO, Coluna C (2) = SKU
                const rawCusto = row[0];
                const rawImposto = row[1];
                const rawSku = row[2];

                if (rawSku == null || String(rawSku).trim() === '') continue;

                const sku = String(rawSku).trim();
                let custo = 0;
                let imposto = 0;

                if (rawCusto != null) {
                    const parsed = parseFloat(String(rawCusto).replace(',', '.'));
                    if (!isNaN(parsed)) custo = parsed;
                }

                if (rawImposto != null) {
                    const parsed = parseFloat(String(rawImposto).replace('%', '').replace(',', '.'));
                    if (!isNaN(parsed)) imposto = parsed;
                }

                // Salva / Atualiza na tabela produto_custos_impostos
                await client.query(`
                    INSERT INTO produto_custos_impostos (sku, custo, imposto, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                    custo = EXCLUDED.custo,
                    imposto = EXCLUDED.imposto,
                    updated_at = NOW()
                `, [sku, custo, imposto]);

                totalSkusProcessados++;
            }

            // Atualiza todos os anúncios na tabela anuncios_ml com a margem calculada
            const updateResult = await client.query(`
                UPDATE anuncios_ml a
                SET 
                    custo_produto = pci.custo,
                    imposto = pci.imposto,
                    margem_lucro = CASE 
                        WHEN COALESCE(NULLIF(a.preco_promocional, 0), a.preco) > 0 THEN 
                            ((COALESCE(NULLIF(a.preco_promocional, 0), a.preco) - pci.custo - COALESCE(a.frete, 0) - (COALESCE(NULLIF(a.preco_promocional, 0), a.preco) * (COALESCE(a.tarifa, 0) / 100.0)) - (COALESCE(NULLIF(a.preco_promocional, 0), a.preco) * (pci.imposto / 100.0))) / COALESCE(NULLIF(a.preco_promocional, 0), a.preco)) * 100.0
                        ELSE 0 
                    END,
                    last_updated_at = NOW()
                FROM produto_custos_impostos pci
                WHERE TRIM(a.sku) = TRIM(pci.sku);
            `);

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Importação concluída com sucesso! ${totalSkusProcessados} SKUs vinculados e ${updateResult.rowCount} anúncios com margem recalculada.`,
                skusProcessados: totalSkusProcessados,
                anunciosAtualizados: updateResult.rowCount
            });

        } catch (errDb) {
            await client.query('ROLLBACK');
            throw errDb;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('[Importar Custos] Erro:', error);
        res.status(500).json({ message: 'Erro ao importar planilha de custos e impostos: ' + error.message });
    }
};

// =============================================
// === GERENCIAR PROMOÇÕES ===
// =============================================

/**
 * Renderiza a página de gerenciamento de promoções.
 */
exports.renderPromocoesPage = (req, res) => {
    try {
        res.render('produtos/lista-promocoes', {
            title: 'Gerenciar Promoções',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de promoções:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de gerenciamento de promoções.');
        res.redirect('/anuncios');
    }
};

/**
 * API que busca os dados para a tabela dinâmica de promoções.
 */
exports.getPromocoesApi = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            search = '',
            status = '',
            catalog = '',
            orderBy = 'last_updated_at',
            orderDir = 'DESC'
        } = req.query;

        let whereClauses = [
            `a.promocoes_json IS NOT NULL AND a.promocoes_json::text != '[]' AND a.promocoes_json::text != 'null' AND a.promocoes_json::text != '' AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.promocoes_json) elem WHERE (elem->>'price') IS NOT NULL AND (elem->>'price')::numeric > 0)`
        ];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        if (status) {
            whereClauses.push(`a.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        if (catalog === 'com') {
            whereClauses.push(`a.catalog_listing = TRUE`);
        } else if (catalog === 'sem') {
            whereClauses.push(`a.catalog_listing = FALSE`);
        }

        if (req.query.tipo) {
            whereClauses.push(`a.tipo_anuncio = $${paramIndex}`);
            queryParams.push(req.query.tipo);
            paramIndex++;
        }

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const colunasPermitidas = ['id_anuncio', 'sku', 'descricao', 'status', 'estoque_ml', 'prazo_disponibilidade', 'estoque_plataforma', 'frete', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'preco_promocional', 'tipo_anuncio', 'ganhando_catalogo', 'tarifa', 'margem_lucro'];
        const safeOrderBy = colunasPermitidas.includes(orderBy) ? orderBy : 'last_updated_at';
        const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let sqlOrderBy = `a.${safeOrderBy}`;
        if (safeOrderBy === 'estoque_plataforma') {
            sqlOrderBy = 'cp.estoque_plataforma';
        } else if (safeOrderBy === 'prazo_disponibilidade') {
            sqlOrderBy = `NULLIF(regexp_replace(a.prazo_disponibilidade, '\\D', '', 'g'), '')::integer`;
        }

        const fetchAll = req.query.all === 'true' || req.query.fetchAll === 'true';

        let dataResult;
        if (fetchAll) {
            const mainQuery = `
                SELECT 
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.estoque_ml,
                    a.prazo_disponibilidade,
                    a.catalog_listing,
                    a.frete,
                    a.tipo_anuncio,
                    a.ganhando_catalogo,
                    a.experiencia_compra,
                    a.vendas_total,
                    a.preco,
                    a.preco_promocional,
                    a.tarifa,
                    a.permalink,
                    a.thumbnail,
                    a.custo_produto,
                    a.imposto,
                    a.margem_lucro,
                    a.promocoes_json,
                    a.last_updated_at,
                    cp.estoque_plataforma
                FROM anuncios_ml a
                LEFT JOIN (
                    SELECT DISTINCT ON (sku) sku, estoque_plataforma
                    FROM cached_products
                    WHERE sku IS NOT NULL AND sku != ''
                    ORDER BY sku, 
                        CASE 
                            WHEN bling_account = 'lucas' THEN 1 
                            WHEN bling_account = 'eliane' THEN 2 
                            ELSE 3 
                        END,
                        last_updated_at DESC
                ) cp ON cp.sku = a.sku
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
            `;
            dataResult = await pool.query(mainQuery, queryParams);
        } else {
            const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
            const mainQuery = `
                SELECT 
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.estoque_ml,
                    a.prazo_disponibilidade,
                    a.catalog_listing,
                    a.frete,
                    a.tipo_anuncio,
                    a.ganhando_catalogo,
                    a.experiencia_compra,
                    a.vendas_total,
                    a.preco,
                    a.preco_promocional,
                    a.tarifa,
                    a.permalink,
                    a.thumbnail,
                    a.custo_produto,
                    a.imposto,
                    a.margem_lucro,
                    a.promocoes_json,
                    a.last_updated_at,
                    cp.estoque_plataforma
                FROM anuncios_ml a
                LEFT JOIN (
                    SELECT DISTINCT ON (sku) sku, estoque_plataforma
                    FROM cached_products
                    WHERE sku IS NOT NULL AND sku != ''
                    ORDER BY sku, 
                        CASE 
                            WHEN bling_account = 'lucas' THEN 1 
                            WHEN bling_account = 'eliane' THEN 2 
                            ELSE 3 
                        END,
                        last_updated_at DESC
                ) cp ON cp.sku = a.sku
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            dataResult = await pool.query(mainQuery, [...queryParams, limit, offset]);
        }

        const countQuery = `SELECT COUNT(*) FROM anuncios_ml a ${whereCondition};`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        res.status(200).json({
            data: dataResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems }
        });

    } catch (error) {
        console.error('[API Promoções] Erro ao buscar dados:', error);
        res.status(500).json({ message: 'Erro ao buscar dados das promoções.' });
    }
};

/**
 * API para exportar relatório Excel de promoções.
 */
exports.exportarPromocoesExcel = async (req, res) => {
    try {
        const {
            search = '',
            status = '',
            catalog = '',
            tipo = '',
            orderBy = 'last_updated_at',
            orderDir = 'DESC'
        } = req.query;

        let whereClauses = [
            `a.promocoes_json IS NOT NULL AND a.promocoes_json::text != '[]' AND a.promocoes_json::text != 'null' AND a.promocoes_json::text != '' AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.promocoes_json) elem WHERE (elem->>'price') IS NOT NULL AND (elem->>'price')::numeric > 0)`
        ];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        if (status) {
            whereClauses.push(`a.status = $${paramIndex}`);
            queryParams.push(status);
            paramIndex++;
        }

        if (catalog === 'com') {
            whereClauses.push(`a.catalog_listing = TRUE`);
        } else if (catalog === 'sem') {
            whereClauses.push(`a.catalog_listing = FALSE`);
        }

        if (tipo) {
            whereClauses.push(`a.tipo_anuncio = $${paramIndex}`);
            queryParams.push(tipo);
            paramIndex++;
        }

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const colunasPermitidas = ['id_anuncio', 'sku', 'status', 'estoque_ml', 'prazo_disponibilidade', 'frete', 'estoque_plataforma', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'tipo_anuncio'];
        const safeOrderBy = colunasPermitidas.includes(orderBy) ? orderBy : 'last_updated_at';
        const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let sqlOrderBy = `a.${safeOrderBy}`;

        const query = `
            SELECT 
                a.id_anuncio,
                a.sku,
                a.descricao,
                a.status,
                a.empresa,
                a.estoque_ml,
                a.prazo_disponibilidade,
                a.catalog_listing,
                a.frete,
                a.tipo_anuncio,
                a.ganhando_catalogo,
                a.preco,
                a.preco_promocional,
                a.promocoes_json,
                a.last_updated_at,
                cp.estoque_plataforma
            FROM anuncios_ml a
            LEFT JOIN (
                SELECT DISTINCT ON (sku) sku, estoque_plataforma
                FROM cached_products
                WHERE sku IS NOT NULL AND sku != ''
                ORDER BY sku, 
                    CASE 
                        WHEN bling_account = 'lucas' THEN 1 
                        WHEN bling_account = 'eliane' THEN 2 
                        ELSE 3 
                    END,
                    last_updated_at DESC
            ) cp ON cp.sku = a.sku
            ${whereCondition}
            ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
        `;

        const dataResult = await pool.query(query, queryParams);

        const dataForExcel = dataResult.rows.map(row => {
            let promosSummary = '-';
            let promos = [];
            if (row.promocoes_json) {
                try {
                    promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
                } catch (e) { promos = []; }
            }

            if (Array.isArray(promos) && promos.length > 0) {
                promosSummary = promos.map(p => {
                    const st = p.status === 'started' || p.status === 'active' ? '[ATIVA]' : `[${p.status || 'Elegível'}]`;
                    const pr = p.price ? `R$ ${p.price}` : '';
                    return `${st} ${p.name || p.id} - ${pr}`;
                }).join(' | ');
            }

            const concorrenciaLabel = row.catalog_listing
                ? (row.ganhando_catalogo ? 'Ganhando' : 'Perdendo')
                : '-';

            return {
                'ID do Anúncio': row.id_anuncio || '-',
                'SKU': row.sku || '-',
                'Descrição': row.descricao || '-',
                'Empresa (Conta)': row.empresa || '-',
                'Status': row.status === 'active' ? 'Ativo' :
                    row.status === 'paused' ? 'Pausado' : row.status || '-',
                'Catálogo': row.catalog_listing ? 'Sim' : 'Não',
                'Concorrência': concorrenciaLabel,
                'Tipo': row.tipo_anuncio || '-',
                'Preço Original (R$)': row.preco != null ? `R$ ${Number(row.preco).toFixed(2).replace('.', ',')}` : '-',
                'Preço Promo (R$)': row.preco_promocional != null ? `R$ ${Number(row.preco_promocional).toFixed(2).replace('.', ',')}` : '-',
                'Frete (R$)': row.frete != null ? `R$ ${Number(row.frete).toFixed(2).replace('.', ',')}` : 'R$ 0,00',
                'Estoque Bling': row.estoque_plataforma != null ? row.estoque_plataforma : '-',
                'Promoções Disponíveis': promosSummary,
                'Última Atualização': row.last_updated_at ? new Date(row.last_updated_at).toLocaleString('pt-BR') : '-'
            };
        });

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(dataForExcel);

        const maxLens = {};
        dataForExcel.forEach(row => {
            Object.keys(row).forEach(key => {
                const len = String(row[key]).length;
                maxLens[key] = Math.max(maxLens[key] || 10, len, key.length);
            });
        });
        worksheet['!cols'] = Object.keys(maxLens).map(key => ({ wch: Math.min(maxLens[key] + 3, 60) }));

        xlsx.utils.book_append_sheet(workbook, worksheet, 'Promoções');

        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Promocoes_${Date.now()}.xlsx"`);
        res.end(buffer);

    } catch (error) {
        console.error('[Promoções Exportar] Erro:', error);
        res.status(500).send('Erro ao exportar o relatório Excel de promoções.');
    }
};


