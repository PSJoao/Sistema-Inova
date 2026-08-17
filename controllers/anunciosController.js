// controllers/anunciosController.js
const { Pool } = require('pg');
const axios = require('axios');
const xlsx = require('xlsx');
const { syncEstoquePlataforma } = require('../blingSyncService');
const hubProdutosService = require('../hub/services/hubProdutosService');
const hubTokenService = require('../hub/services/hubTokenService');

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

// =============================================
// === CACHE DE PERFORMANCE ===
// =============================================

// Cache de catalog_totals em memória (TTL 60s)
let catalogTotalsCache = { data: null, expiresAt: 0 };
const CATALOG_CACHE_TTL = 60 * 1000; // 60 segundos

async function getCatalogTotals() {
    const now = Date.now();
    if (catalogTotalsCache.data && now < catalogTotalsCache.expiresAt) {
        return catalogTotalsCache.data;
    }
    try {
        const result = await pool.query(`
            SELECT catalog_product_id, COUNT(*)::int AS count 
            FROM anuncios_ml 
            WHERE catalog_product_id IS NOT NULL AND catalog_product_id != '' 
            GROUP BY catalog_product_id;
        `);
        const totals = {};
        result.rows.forEach(r => { totals[r.catalog_product_id] = r.count; });
        catalogTotalsCache = { data: totals, expiresAt: now + CATALOG_CACHE_TTL };
        return totals;
    } catch (e) {
        return catalogTotalsCache.data || {};
    }
}

// Invalidar cache de catalog_totals (chamado após sync)
function invalidateCatalogTotalsCache() {
    catalogTotalsCache = { data: null, expiresAt: 0 };
}

// Helper: Retorna o JOIN SQL para estoque_plataforma
// Tenta usar a Materialized View mv_cached_estoque (pré-calculada, ultra-rápida)
// Se não existir, faz fallback para a subquery DISTINCT ON original
let useMaterializedView = null; // null = não testado, true/false = resultado do teste

async function getEstoqueJoinSQL() {
    if (useMaterializedView === null) {
        try {
            await pool.query('SELECT 1 FROM mv_cached_estoque LIMIT 1');
            useMaterializedView = true;
            console.log('[Performance] Materialized View mv_cached_estoque detectada — usando JOIN otimizado.');
        } catch (e) {
            useMaterializedView = false;
            console.log('[Performance] Materialized View mv_cached_estoque não encontrada — usando subquery fallback.');
        }
    }
    if (useMaterializedView) {
        return 'LEFT JOIN mv_cached_estoque cp ON cp.sku = a.sku';
    }
    return `LEFT JOIN (
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
                ) cp ON cp.sku = a.sku`;
}

// Helper: Retorna se a coluna has_active_promo existe na tabela
let hasActivePromoColumn = null;

async function checkHasActivePromoColumn() {
    if (hasActivePromoColumn === null) {
        try {
            await pool.query('SELECT has_active_promo FROM anuncios_ml LIMIT 1');
            hasActivePromoColumn = true;
            console.log('[Performance] Coluna has_active_promo detectada — usando filtro otimizado para promoções.');
        } catch (e) {
            hasActivePromoColumn = false;
            console.log('[Performance] Coluna has_active_promo não encontrada — usando filtro EXISTS fallback.');
        }
    }
    return hasActivePromoColumn;
}

// Helper: Calcula has_active_promo a partir do JSON de promoções
function computeHasActivePromo(promocoesJson) {
    if (!promocoesJson) return false;
    try {
        const promos = typeof promocoesJson === 'string' ? JSON.parse(promocoesJson) : promocoesJson;
        if (!Array.isArray(promos)) return false;
        return promos.some(p => p && p.price != null && Number(p.price) > 0);
    } catch (e) {
        return false;
    }
}

// Refresh da Materialized View e atualização de has_active_promo após sync
async function refreshPerformanceArtifacts() {
    // Refresh Materialized View
    try {
        await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cached_estoque');
        console.log('[Performance] Materialized View mv_cached_estoque refreshed.');
    } catch (e) {
        // View pode não existir, ignorar
    }
    // Invalidar cache
    invalidateCatalogTotalsCache();
}

// =============================================
// === HELPERS DE CÁLCULO DE MARGEM ===
// =============================================

function calcularMargemLucro(anuncio, promoEspecifica = null) {
    if (!anuncio) return null;
    const custo = Number(anuncio.custo_produto) || 0;
    if (custo <= 0) return null;

    const precoOriginal = Number(anuncio.preco) || 0;
    let venda = 0;
    let meliPct = 0;

    if (promoEspecifica) {
        venda = Number(promoEspecifica.price) || 0;
        meliPct = promoEspecifica.meli_percentage != null ? Number(promoEspecifica.meli_percentage) : 0;
    } else {
        let promos = [];
        if (anuncio.promocoes_json) {
            try {
                promos = typeof anuncio.promocoes_json === 'string' ? JSON.parse(anuncio.promocoes_json) : anuncio.promocoes_json;
            } catch (e) { promos = []; }
        }
        promos = Array.isArray(promos) ? promos : [];

        const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
        activePromos.sort((a, b) => Number(a.price) - Number(b.price));
        const activePromo = activePromos[0] || null;
        if (activePromo) {
            venda = Number(activePromo.price);
            meliPct = activePromo.meli_percentage != null ? Number(activePromo.meli_percentage) : 0;
        } else if (anuncio.preco_promocional != null && Number(anuncio.preco_promocional) > 0) {
            venda = Number(anuncio.preco_promocional);
        } else {
            venda = precoOriginal;
        }
    }

    if (venda <= 0) return null;

    const impostoPct = Number(anuncio.imposto) || 0;
    const tarifaBasePct = Number(anuncio.tarifa) || 0;
    const freteVal = Number(anuncio.frete) || 0;

    // Reembolso ML em R$ = (meliPct / 100) * precoOriginal (arredondado com 2 casas decimais)
    const reembolsoVal = Number(((meliPct / 100.0) * precoOriginal).toFixed(2));
    const comissaoReais = venda * (tarifaBasePct / 100.0);
    const comissaoEfetiva = comissaoReais - reembolsoVal;
    const impostoReais = venda * (impostoPct / 100.0);

    const despesas = custo + freteVal + comissaoEfetiva + impostoReais;
    const lucro = venda - despesas;
    return (lucro / venda) * 100.0;
}

async function recalcularMargensDB(clientOrPool) {
    const res = await clientOrPool.query(`
        SELECT id_anuncio, preco, preco_promocional, tarifa, imposto, custo_produto, frete, promocoes_json
        FROM anuncios_ml
        WHERE custo_produto IS NOT NULL AND custo_produto > 0
    `);

    for (const row of res.rows) {
        const margem = calcularMargemLucro(row);
        await clientOrPool.query(
            `UPDATE anuncios_ml SET margem_lucro = $1 WHERE id_anuncio = $2`,
            [margem != null ? margem : 0, row.id_anuncio]
        );
    }
}

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
            const searchField = String(req.query.searchField || req.query.campo || 'id_anuncio').toLowerCase();

            let targetCondition = `a.id_anuncio ILIKE $${paramIndex}`;
            let subqueryCondition = `id_anuncio ILIKE $${paramIndex}`;

            if (searchField === 'sku') {
                targetCondition = `a.sku ILIKE $${paramIndex}`;
                subqueryCondition = `sku ILIKE $${paramIndex}`;
            } else if (searchField === 'descricao') {
                targetCondition = `a.descricao ILIKE $${paramIndex}`;
                subqueryCondition = `descricao ILIKE $${paramIndex}`;
            } else if (searchField === 'geral' || searchField === 'all') {
                targetCondition = `(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`;
                subqueryCondition = `(sku ILIKE $${paramIndex} OR descricao ILIKE $${paramIndex} OR id_anuncio ILIKE $${paramIndex})`;
            }

            whereClauses.push(`(
                ${targetCondition}
                OR (
                    a.catalog_product_id IS NOT NULL 
                    AND a.catalog_product_id != '' 
                    AND a.catalog_product_id IN (
                        SELECT catalog_product_id 
                        FROM anuncios_ml 
                        WHERE ${subqueryCondition}
                          AND catalog_product_id IS NOT NULL 
                          AND catalog_product_id != ''
                    )
                )
            )`);
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

        if (req.query.empresa) {
            whereClauses.push(`a.empresa ILIKE $${paramIndex}`);
            queryParams.push(`%${req.query.empresa}%`);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validação da ordenação para evitar SQL Injection
        const colunasPermitidas = ['id_anuncio', 'sku', 'descricao', 'status', 'empresa', 'catalog_product_id', 'estoque_ml', 'prazo_disponibilidade', 'estoque_plataforma', 'frete', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'preco_promocional', 'tipo_anuncio', 'ganhando_catalogo', 'tarifa', 'margem_lucro'];
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

        const estoqueJoin = await getEstoqueJoinSQL();

        const selectColumns = `
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.catalog_product_id,
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
                    cp.estoque_plataforma`;

        let dataResult;
        if (fetchAll) {
            const mainQuery = `
                SELECT ${selectColumns}
                FROM anuncios_ml a
                ${estoqueJoin}
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
            `;
            dataResult = await pool.query(mainQuery, queryParams);
        } else {
            const mainQuery = `
                SELECT ${selectColumns}
                FROM anuncios_ml a
                ${estoqueJoin}
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            dataResult = await pool.query(mainQuery, [...queryParams, limit, offset]);
        }

        // Processa dinamicamente a menor promoção ativa e a margem de lucro
        const rowsWithMargin = dataResult.rows.map(row => {
            let promos = [];
            if (row.promocoes_json) {
                try {
                    promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
                } catch (e) { promos = []; }
            }
            promos = Array.isArray(promos) ? promos : [];

            // Filtra promoções ativas e ordena pelo menor preço
            const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
            activePromos.sort((a, b) => Number(a.price) - Number(b.price));

            const lowestActivePromo = activePromos[0] || null;
            let precoPromoAtual = row.preco_promocional;
            let nomePromoAtiva = null;

            if (lowestActivePromo) {
                precoPromoAtual = Number(lowestActivePromo.price);
                nomePromoAtiva = lowestActivePromo.name || lowestActivePromo.id || 'Promoção Ativa';
            }

            const rowAtualizado = {
                ...row,
                preco_promocional: precoPromoAtual,
                nome_promo_ativa: nomePromoAtiva
            };

            const margemCalculada = calcularMargemLucro(rowAtualizado, lowestActivePromo);

            return {
                ...rowAtualizado,
                margem_lucro: margemCalculada != null ? margemCalculada : row.margem_lucro
            };
        });

        // 2. Busca contagem total e catalog_totals EM PARALELO
        const countQuery = `SELECT COUNT(*) FROM anuncios_ml a ${whereCondition};`;
        const [countResult, catalogTotals] = await Promise.all([
            pool.query(countQuery, queryParams),
            getCatalogTotals()
        ]);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        res.status(200).json({
            data: rowsWithMargin,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems },
            catalog_totals: catalogTotals
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
        const field = String(options.searchField || options.campo || 'id_anuncio').toLowerCase();
        const sku = String(anuncio.sku || '').toLowerCase();
        const desc = String(anuncio.descricao || '').toLowerCase();
        const idAnuncio = String(anuncio.id_anuncio || '').toLowerCase();
        const catalogId = String(anuncio.catalog_product_id || '').toLowerCase();

        let matchesDirectly = false;
        if (field === 'sku') matchesDirectly = sku.includes(term);
        else if (field === 'descricao') matchesDirectly = desc.includes(term);
        else if (field === 'geral' || field === 'all') matchesDirectly = (sku.includes(term) || desc.includes(term) || idAnuncio.includes(term));
        else matchesDirectly = idAnuncio.includes(term);

        if (!matchesDirectly && !catalogId.includes(term)) {
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

        const hasActiveFilters = Boolean(options && (
            (options.search && String(options.search).trim() !== '') ||
            (options.status && String(options.status).trim() !== '') ||
            (options.catalog && String(options.catalog).trim() !== '') ||
            (options.tipo && String(options.tipo).trim() !== '') ||
            (options.empresa && String(options.empresa).trim() !== '') ||
            (options.margem_reemb && String(options.margem_reemb).trim() !== '')
        ));

        let specificIds = [];
        if (hasActiveFilters && Array.isArray(options.item_ids) && options.item_ids.length > 0) {
            // Usa os IDs de anúncio reais vindos do frontend (já são MLB IDs válidos)
            specificIds = options.item_ids.filter(id => id && String(id).toUpperCase().startsWith('MLB'));
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
    let deletedCount = 0;

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
                INSERT INTO anuncios_ml (id_anuncio, sku, descricao, status, sub_status, empresa, estoque_ml, prazo_disponibilidade, catalog_listing, frete, tipo_anuncio, ganhando_catalogo, experiencia_compra, vendas_total, preco, preco_promocional, tarifa, permalink, thumbnail, promocoes_json, qualidade, data_ultima_venda, dias_sem_vender, catalog_product_id, last_updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW())
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
                    catalog_product_id = EXCLUDED.catalog_product_id,
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
                anuncio.dias_sem_vender != null ? anuncio.dias_sem_vender : null,
                anuncio.catalog_product_id || null
            ]);

            if (result.rows[0]?.is_insert) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }

        // Limpeza de anúncios órfãos: existem no Inova mas NÃO existem mais no Hub
        // Só roda na sincronização completa (sem filtros) para evitar deletar itens que foram apenas filtrados
        if (!hasFilters && allAnuncios.length > 0) {
            const idsDoHub = allAnuncios.map(a => a.id_anuncio).filter(Boolean);
            const idsDoHubSet = new Set(idsDoHub);

            // Busca todos os IDs que existem no Inova
            const inovaResult = await client.query('SELECT id_anuncio FROM anuncios_ml');
            const idsOrfaos = inovaResult.rows
                .map(r => r.id_anuncio)
                .filter(id => !idsDoHubSet.has(id));

            if (idsOrfaos.length > 0) {
                console.log(`[Anúncios] Encontrados ${idsOrfaos.length} anúncio(s) órfão(s) no Inova (não existem mais no Hub). Removendo...`);

                // Deleta em blocos para evitar queries muito grandes
                const deleteChunkSize = 500;
                for (let i = 0; i < idsOrfaos.length; i += deleteChunkSize) {
                    const chunk = idsOrfaos.slice(i, i + deleteChunkSize);
                    const placeholders = chunk.map((_, idx) => `$${idx + 1}`).join(', ');
                    const deleteResult = await client.query(
                        `DELETE FROM anuncios_ml WHERE id_anuncio IN (${placeholders})`,
                        chunk
                    );
                    deletedCount += deleteResult.rowCount || 0;
                }

                console.log(`[Anúncios] ${deletedCount} anúncio(s) órfão(s) removido(s) do Inova.`);
            } else {
                console.log('[Anúncios] Nenhum anúncio órfão encontrado no Inova.');
            }
        }

        // Recalcula custos e impostos com base na tabela produto_custos_impostos (case-insensitive por SKU)
        await client.query(`
            UPDATE anuncios_ml a
            SET 
                custo_produto = pci.custo,
                imposto = pci.imposto
            FROM (
                SELECT DISTINCT ON (UPPER(TRIM(sku)))
                    UPPER(TRIM(sku)) AS clean_sku,
                    custo,
                    imposto
                FROM produto_custos_impostos
                ORDER BY UPPER(TRIM(sku)), updated_at DESC
            ) pci
            WHERE UPPER(TRIM(a.sku)) = pci.clean_sku;
        `);

        // Recalcula margem de lucro com reembolso ML
        await recalcularMargensDB(client);

        // Atualiza coluna has_active_promo para os anúncios sincronizados
        try {
            await client.query(`
                UPDATE anuncios_ml 
                SET has_active_promo = (
                    promocoes_json IS NOT NULL 
                    AND promocoes_json::text != '[]' 
                    AND promocoes_json::text != 'null' 
                    AND promocoes_json::text != '' 
                    AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(promocoes_json) elem 
                        WHERE (elem->>'price') IS NOT NULL 
                        AND (elem->>'price')::numeric > 0
                    )
                )
                WHERE last_updated_at >= NOW() - INTERVAL '5 minutes'
            `);
        } catch (e) {
            // Coluna pode não existir ainda, ignorar
        }

        await client.query('COMMIT');
    } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
    } finally {
        client.release();
    }

    console.log(`[Anúncios] Sincronização finalizada no Inova: ${insertedCount} novos, ${updatedCount} atualizados, ${deletedCount} removidos (órfãos).`);

    // 5. Refresh de artefatos de performance (Materialized View + cache)
    refreshPerformanceArtifacts().catch(err => {
        console.error('[Performance] Erro ao refreshar artefatos:', err.message);
    });

    // 6. Dispara a sincronização do estoque virtual (plataforma) do Bling apenas no sync manual
    if (forcarSyncHub) {
        console.log('[Anúncios] Disparando sincronização do estoque plataforma (Bling)...');
        syncEstoquePlataforma()
            .then(() => {
                // Refresh MV após estoque atualizar cached_products
                return refreshPerformanceArtifacts();
            })
            .catch(err => {
                console.error('[Anúncios] Erro ao sincronizar estoque plataforma:', err.message);
            });
    }

    const message = hasFilters
        ? `Sincronização inteligente de ${anunciosToSync.length} anúncio(s) filtrado(s) concluída com sucesso!`
        : `Sincronização de todos os ${allAnuncios.length} anúncios concluída com sucesso!${deletedCount > 0 ? ` ${deletedCount} anúncio(s) órfão(s) removido(s).` : ''}`;

    return {
        message,
        total: anunciosToSync.length,
        totalGeral: allAnuncios.length,
        novos: insertedCount,
        atualizados: updatedCount,
        removidos: deletedCount
    };
}

/**
 * Endpoint de sincronização acionado manualmente via botão no frontend
 */
exports.sincronizarAnuncios = async (req, res) => {
    try {
        const { search, status, catalog, tipo, item_ids } = { ...req.query, ...req.body };
        const options = { search, status, catalog, tipo, item_ids };

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
            const searchField = String(req.query.searchField || req.query.campo || 'id_anuncio').toLowerCase();

            let targetCondition = `a.id_anuncio ILIKE $${paramIndex}`;
            let subqueryCondition = `id_anuncio ILIKE $${paramIndex}`;

            if (searchField === 'sku') {
                targetCondition = `a.sku ILIKE $${paramIndex}`;
                subqueryCondition = `sku ILIKE $${paramIndex}`;
            } else if (searchField === 'descricao') {
                targetCondition = `a.descricao ILIKE $${paramIndex}`;
                subqueryCondition = `descricao ILIKE $${paramIndex}`;
            } else if (searchField === 'geral' || searchField === 'all') {
                targetCondition = `(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex})`;
                subqueryCondition = `(sku ILIKE $${paramIndex} OR descricao ILIKE $${paramIndex} OR id_anuncio ILIKE $${paramIndex})`;
            }

            whereClauses.push(`(
                ${targetCondition}
                OR (
                    a.catalog_product_id IS NOT NULL 
                    AND a.catalog_product_id != '' 
                    AND a.catalog_product_id IN (
                        SELECT catalog_product_id 
                        FROM anuncios_ml 
                        WHERE ${subqueryCondition}
                          AND catalog_product_id IS NOT NULL 
                          AND catalog_product_id != ''
                    )
                )
            )`);
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

        if (req.query.empresa) {
            whereClauses.push(`a.empresa ILIKE $${paramIndex}`);
            queryParams.push(`%${req.query.empresa}%`);
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
        const estoqueJoin = await getEstoqueJoinSQL();
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
                a.promocoes_json,
                a.last_updated_at,
                cp.estoque_plataforma
            FROM anuncios_ml a
            ${estoqueJoin}
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

            const margemCalc = calcularMargemLucro(row);
            const margemVal = margemCalc !== null ? margemCalc : Number(row.margem_lucro);
            const margemFormatted = margemVal != null && !isNaN(margemVal) ? `${margemVal.toFixed(2).replace('.', ',')}%` : '-';

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
// Helper para garantir a tabela e coluna column_widths
let userColumnPreferencesTableChecked = false;
async function ensureUserColumnPreferencesTable() {
    if (userColumnPreferencesTableChecked) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_column_preferences (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                view_name VARCHAR(100) NOT NULL,
                column_order JSONB,
                column_widths JSONB,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, view_name)
            );
        `);
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'user_column_preferences' AND column_name = 'column_widths'
                ) THEN
                    ALTER TABLE user_column_preferences ADD COLUMN column_widths JSONB;
                END IF;
            END $$;
        `);
        userColumnPreferencesTableChecked = true;
    } catch (e) {
        console.warn('[UserColumnPreferences] Aviso ao verificar tabela:', e.message);
    }
}

/**
 * Busca a ordem e largura personalizada de colunas salvas no banco de dados.
 */
exports.getColumnPreferences = async (req, res) => {
    try {
        const userId = req.session?.user?.id || 1;
        const viewName = req.query.view || req.query.viewName || (req.path.includes('promocoes') ? 'promocoes_ml' : 'anuncios_ml');

        await ensureUserColumnPreferencesTable();

        const result = await pool.query(
            `SELECT column_order, column_widths FROM user_column_preferences WHERE user_id = $1 AND view_name = $2`,
            [userId, viewName]
        );

        if (result.rows.length > 0) {
            let columnOrder = result.rows[0].column_order;
            let columnWidths = result.rows[0].column_widths;

            if (typeof columnOrder === 'string') {
                try { columnOrder = JSON.parse(columnOrder); } catch (e) { }
            }
            if (typeof columnWidths === 'string') {
                try { columnWidths = JSON.parse(columnWidths); } catch (e) { }
            }

            return res.json({
                columnOrder: columnOrder || null,
                columnWidths: columnWidths || null
            });
        }
        res.json({ columnOrder: null, columnWidths: null });
    } catch (error) {
        console.error('[Anúncios API] Erro ao buscar preferências das colunas:', error);
        res.status(500).json({ message: 'Erro ao buscar preferências das colunas.' });
    }
};

/**
 * Salva a nova ordem e larguras personalizadas de colunas no banco de dados.
 */
exports.saveColumnPreferences = async (req, res) => {
    try {
        const userId = req.session?.user?.id || 1;
        const { columnOrder, columnWidths, viewName: bodyViewName } = req.body;
        const viewName = bodyViewName || req.query.view || (req.path.includes('promocoes') ? 'promocoes_ml' : 'anuncios_ml');

        await ensureUserColumnPreferencesTable();

        const orderJson = Array.isArray(columnOrder) ? JSON.stringify(columnOrder) : null;
        const widthsJson = (columnWidths && typeof columnWidths === 'object') ? JSON.stringify(columnWidths) : null;

        await pool.query(
            `INSERT INTO user_column_preferences (user_id, view_name, column_order, column_widths, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id, view_name) DO UPDATE SET
             column_order = COALESCE(EXCLUDED.column_order, user_column_preferences.column_order),
             column_widths = COALESCE(EXCLUDED.column_widths, user_column_preferences.column_widths),
             updated_at = NOW()`,
            [userId, viewName, orderJson, widthsJson]
        );

        res.json({ success: true, message: 'Preferências das colunas salvas com sucesso!' });
    } catch (error) {
        console.error('[Anúncios API] Erro ao salvar preferências das colunas:', error);
        res.status(500).json({ message: 'Erro ao salvar preferências das colunas.' });
    }
};

// Aliases para compatibilidade retroativa
exports.getColumnOrder = exports.getColumnPreferences;
exports.saveColumnOrder = exports.saveColumnPreferences;

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

                const skuUpper = String(rawSku).trim().toUpperCase();
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

                // Remove registros prévios do mesmo SKU em caixa diferente se existirem
                await client.query(`
                    DELETE FROM produto_custos_impostos WHERE UPPER(TRIM(sku)) = $1 AND sku != $1;
                `, [skuUpper]);

                // Salva / Atualiza na tabela produto_custos_impostos
                await client.query(`
                    INSERT INTO produto_custos_impostos (sku, custo, imposto, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                    custo = EXCLUDED.custo,
                    imposto = EXCLUDED.imposto,
                    updated_at = NOW()
                `, [skuUpper, custo, imposto]);

                totalSkusProcessados++;
            }

            // Atualiza custos e impostos nos anúncios (case-insensitive por SKU)
            const updateResult = await client.query(`
                UPDATE anuncios_ml a
                SET 
                    custo_produto = pci.custo,
                    imposto = pci.imposto,
                    last_updated_at = NOW()
                FROM (
                    SELECT DISTINCT ON (UPPER(TRIM(sku)))
                        UPPER(TRIM(sku)) AS clean_sku,
                        custo,
                        imposto
                    FROM produto_custos_impostos
                    ORDER BY UPPER(TRIM(sku)), updated_at DESC
                ) pci
                WHERE UPPER(TRIM(a.sku)) = pci.clean_sku;
            `);

            // Recalcula margens de lucro de todos os anúncios com reembolso ML
            await recalcularMargensDB(client);

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

        // Usa coluna has_active_promo se disponível (índice parcial ultra-rápido)
        // Fallback para o EXISTS pesado se a coluna não existir
        const useOptimizedPromoFilter = await checkHasActivePromoColumn();
        let whereClauses = [
            useOptimizedPromoFilter
                ? `a.has_active_promo = TRUE`
                : `a.promocoes_json IS NOT NULL AND a.promocoes_json::text != '[]' AND a.promocoes_json::text != 'null' AND a.promocoes_json::text != '' AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.promocoes_json) elem WHERE (elem->>'price') IS NOT NULL AND (elem->>'price')::numeric > 0)`
        ];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            const searchField = String(req.query.searchField || req.query.campo || 'id_anuncio').toLowerCase();

            let targetCondition = `a.id_anuncio ILIKE $${paramIndex}`;
            let subqueryCondition = `id_anuncio ILIKE $${paramIndex}`;

            if (searchField === 'sku') {
                targetCondition = `a.sku ILIKE $${paramIndex}`;
                subqueryCondition = `sku ILIKE $${paramIndex}`;
            } else if (searchField === 'descricao') {
                targetCondition = `a.descricao ILIKE $${paramIndex}`;
                subqueryCondition = `descricao ILIKE $${paramIndex}`;
            } else if (searchField === 'geral' || searchField === 'all') {
                targetCondition = `(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex} OR a.promocoes_json::text ILIKE $${paramIndex})`;
                subqueryCondition = `(sku ILIKE $${paramIndex} OR descricao ILIKE $${paramIndex} OR id_anuncio ILIKE $${paramIndex} OR promocoes_json::text ILIKE $${paramIndex})`;
            }

            whereClauses.push(`(
                ${targetCondition}
                OR (
                    a.catalog_product_id IS NOT NULL 
                    AND a.catalog_product_id != '' 
                    AND a.catalog_product_id IN (
                        SELECT catalog_product_id 
                        FROM anuncios_ml 
                        WHERE ${subqueryCondition}
                          AND catalog_product_id IS NOT NULL 
                          AND catalog_product_id != ''
                    )
                )
            )`);
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

        if (req.query.empresa) {
            whereClauses.push(`a.empresa ILIKE $${paramIndex}`);
            queryParams.push(`%${req.query.empresa}%`);
            paramIndex++;
        }

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const colunasPermitidas = ['id_anuncio', 'sku', 'descricao', 'status', 'empresa', 'estoque_ml', 'prazo_disponibilidade', 'estoque_plataforma', 'frete', 'last_updated_at', 'vendas_total', 'experiencia_compra', 'preco', 'preco_promocional', 'tipo_anuncio', 'ganhando_catalogo', 'tarifa', 'margem_lucro'];
        const safeOrderBy = colunasPermitidas.includes(orderBy) ? orderBy : 'last_updated_at';
        const safeOrderDir = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let sqlOrderBy = `a.${safeOrderBy}`;
        if (safeOrderBy === 'estoque_plataforma') {
            sqlOrderBy = 'cp.estoque_plataforma';
        } else if (safeOrderBy === 'prazo_disponibilidade') {
            sqlOrderBy = `NULLIF(regexp_replace(a.prazo_disponibilidade, '\\D', '', 'g'), '')::integer`;
        }

        const fetchAll = req.query.all === 'true' || req.query.fetchAll === 'true';

        const estoqueJoin = await getEstoqueJoinSQL();

        const selectColumns = `
                    a.id,
                    a.id_anuncio,
                    a.sku,
                    a.descricao,
                    a.status,
                    a.empresa,
                    a.catalog_product_id,
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
                    cp.estoque_plataforma`;

        let dataResult;
        if (fetchAll) {
            const mainQuery = `
                SELECT ${selectColumns}
                FROM anuncios_ml a
                ${estoqueJoin}
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
            `;
            dataResult = await pool.query(mainQuery, queryParams);
        } else {
            const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
            const mainQuery = `
                SELECT ${selectColumns}
                FROM anuncios_ml a
                ${estoqueJoin}
                ${whereCondition}
                ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            dataResult = await pool.query(mainQuery, [...queryParams, limit, offset]);
        }

        // Processa dinamicamente a menor promoção ativa e a margem de lucro
        const rowsWithMargin = dataResult.rows.map(row => {
            let promos = [];
            if (row.promocoes_json) {
                try {
                    promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
                } catch (e) { promos = []; }
            }
            promos = Array.isArray(promos) ? promos : [];

            // Filtra promoções ativas e ordena pelo menor preço
            const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
            activePromos.sort((a, b) => Number(a.price) - Number(b.price));

            const lowestActivePromo = activePromos[0] || null;
            let precoPromoAtual = row.preco_promocional;
            let nomePromoAtiva = null;

            if (lowestActivePromo) {
                precoPromoAtual = Number(lowestActivePromo.price);
                nomePromoAtiva = lowestActivePromo.name || lowestActivePromo.id || 'Promoção Ativa';
                const rowAtualizado = {
                    ...row,
                    preco_promocional: precoPromoAtual,
                    nome_promo_ativa: nomePromoAtiva
                };
                const margemCalculada = calcularMargemLucro(rowAtualizado, lowestActivePromo);
                return {
                    ...rowAtualizado,
                    margem_lucro: margemCalculada
                };
            }

            return {
                ...row,
                preco_promocional: null,
                nome_promo_ativa: null,
                margem_lucro: null
            };
        });

        // Busca count, reembolso e catalog_totals EM PARALELO
        const countQuery = `SELECT COUNT(*) FROM anuncios_ml a ${whereCondition};`;
        let reembolsoPromise;
        try {
            reembolsoPromise = pool.query('SELECT promo_id, reembolso_maximo FROM promocoes_reembolso');
        } catch (e) {
            reembolsoPromise = Promise.resolve({ rows: [] });
        }

        const [countResult, reembolsoResult, catalogTotals] = await Promise.all([
            pool.query(countQuery, queryParams),
            reembolsoPromise,
            getCatalogTotals()
        ]);

        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        const reembolsoMap = {};
        for (const row of reembolsoResult.rows) {
            reembolsoMap[row.promo_id] = Number(row.reembolso_maximo);
        }

        res.status(200).json({
            data: rowsWithMargin,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems },
            reembolso_map: reembolsoMap,
            catalog_totals: catalogTotals
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
            promoStatus = '',
            promoReembolso = '',
            margemMin = '',
            margemMax = '',
            orderBy = 'last_updated_at',
            orderDir = 'DESC'
        } = req.query;

        // Usa coluna has_active_promo se disponível (índice parcial ultra-rápido)
        const useOptimizedPromoFilter = await checkHasActivePromoColumn();
        let whereClauses = [
            useOptimizedPromoFilter
                ? `a.has_active_promo = TRUE`
                : `a.promocoes_json IS NOT NULL AND a.promocoes_json::text != '[]' AND a.promocoes_json::text != 'null' AND a.promocoes_json::text != '' AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.promocoes_json) elem WHERE (elem->>'price') IS NOT NULL AND (elem->>'price')::numeric > 0)`
        ];
        const queryParams = [];
        let paramIndex = 1;

        if (search) {
            const searchTerm = `%${search}%`;
            const searchField = String(req.query.searchField || req.query.campo || 'id_anuncio').toLowerCase();

            let targetCondition = `a.id_anuncio ILIKE $${paramIndex}`;
            let subqueryCondition = `id_anuncio ILIKE $${paramIndex}`;

            if (searchField === 'sku') {
                targetCondition = `a.sku ILIKE $${paramIndex}`;
                subqueryCondition = `sku ILIKE $${paramIndex}`;
            } else if (searchField === 'descricao') {
                targetCondition = `a.descricao ILIKE $${paramIndex}`;
                subqueryCondition = `descricao ILIKE $${paramIndex}`;
            } else if (searchField === 'geral' || searchField === 'all') {
                targetCondition = `(a.sku ILIKE $${paramIndex} OR a.descricao ILIKE $${paramIndex} OR a.id_anuncio ILIKE $${paramIndex} OR a.promocoes_json::text ILIKE $${paramIndex})`;
                subqueryCondition = `(sku ILIKE $${paramIndex} OR descricao ILIKE $${paramIndex} OR id_anuncio ILIKE $${paramIndex} OR promocoes_json::text ILIKE $${paramIndex})`;
            }

            whereClauses.push(`(
                ${targetCondition}
                OR (
                    a.catalog_product_id IS NOT NULL 
                    AND a.catalog_product_id != '' 
                    AND a.catalog_product_id IN (
                        SELECT catalog_product_id 
                        FROM anuncios_ml 
                        WHERE ${subqueryCondition}
                          AND catalog_product_id IS NOT NULL 
                          AND catalog_product_id != ''
                    )
                )
            )`);
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

        const estoqueJoin = await getEstoqueJoinSQL();
        const query = `
            SELECT 
                a.id_anuncio,
                a.sku,
                a.descricao,
                a.status,
                a.empresa,
                a.catalog_product_id,
                a.estoque_ml,
                a.prazo_disponibilidade,
                a.catalog_listing,
                a.frete,
                a.tipo_anuncio,
                a.ganhando_catalogo,
                a.preco,
                a.preco_promocional,
                a.tarifa,
                a.custo_produto,
                a.imposto,
                a.promocoes_json,
                a.last_updated_at,
                cp.estoque_plataforma
            FROM anuncios_ml a
            ${estoqueJoin}
            ${whereCondition}
            ORDER BY ${sqlOrderBy} ${safeOrderDir} NULLS LAST;
        `;

        const dataResult = await pool.query(query, queryParams);

        const minMargemVal = margemMin !== '' ? parseFloat(margemMin) : null;
        const maxMargemVal = margemMax !== '' ? parseFloat(margemMax) : null;

        const filteredRows = dataResult.rows.filter(row => {
            let promos = [];
            if (row.promocoes_json) {
                try {
                    promos = typeof row.promocoes_json === 'string' ? JSON.parse(row.promocoes_json) : row.promocoes_json;
                } catch (e) { promos = []; }
            }
            promos = (Array.isArray(promos) ? promos : []).filter(p => p && p.price != null && Number(p.price) > 0);

            const matchingPromos = promos.filter(p => {
                const isActive = p.status === 'started' || p.status === 'active';
                if (promoStatus === 'ativas' && !isActive) return false;
                if (promoStatus === 'elegiveis' && isActive) return false;

                const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
                if (promoReembolso === 'com' && meliPct <= 0) return false;
                if (promoReembolso === 'sem' && meliPct > 0) return false;

                if (minMargemVal !== null || maxMargemVal !== null) {
                    const margemVal = calcularMargemLucro(row, p);
                    if (margemVal === null || isNaN(margemVal)) return false;
                    if (minMargemVal !== null && !isNaN(minMargemVal) && margemVal < minMargemVal) return false;
                    if (maxMargemVal !== null && !isNaN(maxMargemVal) && margemVal > maxMargemVal) return false;
                }
                return true;
            });

            row._filteredPromos = matchingPromos;
            return matchingPromos.length > 0;
        });

        const dataForExcel = filteredRows.map(row => {
            let promosSummary = '-';
            let promos = row._filteredPromos || [];

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


// =============================================
// === CENTRAL DE PROMOÇÕES (LISTAGEM ÚNICA) ===
// =============================================

/**
 * Renderiza a página Central de Promoções.
 */
exports.renderCentralPromocoesPage = (req, res) => {
    try {
        res.render('produtos/central-promocoes', {
            title: 'Central de Promoções',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a Central de Promoções:', error);
        req.flash('error_msg', 'Não foi possível carregar a Central de Promoções.');
        res.redirect('/anuncios');
    }
};

/**
 * API que busca promoções agrupadas por ID único.
 * Extrai todas as promoções de todos os anúncios, agrupa por promo.id,
 * e faz JOIN com a tabela promocoes_reembolso para trazer o reembolso_maximo.
 */
exports.getCentralPromocoesApi = async (req, res) => {
    try {
        // 1. Busca todos os anúncios que possuem promoções com preço > 0
        const anunciosResult = await pool.query(`
            SELECT id_anuncio, promocoes_json, empresa
            FROM anuncios_ml
            WHERE promocoes_json IS NOT NULL
              AND promocoes_json::text != '[]'
              AND promocoes_json::text != 'null'
              AND promocoes_json::text != ''
        `);

        // 2. Extrai e agrupa promoções por ID
        const promoMap = {}; // { promo_id: { ...promoData, anuncios_count, anuncio_ids } }

        for (const row of anunciosResult.rows) {
            let promos = [];
            try {
                promos = typeof row.promocoes_json === 'string'
                    ? JSON.parse(row.promocoes_json)
                    : row.promocoes_json;
                if (!Array.isArray(promos)) promos = [];
            } catch (e) { continue; }

            for (const p of promos) {
                if (!p || !p.id) continue;
                // Ignora promoções sem preço (price === 0 ou null)
                if (p.price == null || Number(p.price) <= 0) {
                    // Mantém mesmo assim se tiver um status relevante
                    // (algumas promoções candidate podem ter price=0)
                }

                const promoId = p.id;

                if (!promoMap[promoId]) {
                    promoMap[promoId] = {
                        promo_id: promoId,
                        name: p.name || null,
                        type: p.type || null,
                        status: p.status || null,
                        start_date: p.start_date || null,
                        finish_date: p.finish_date || null,
                        meli_percentage: p.meli_percentage != null ? Number(p.meli_percentage) : 0,
                        anuncios_count: 0,
                        anuncio_ids: new Set(),
                        empresas: new Set()
                    };
                }

                const existing = promoMap[promoId];
                existing.anuncio_ids.add(row.id_anuncio);
                if (row.empresa) existing.empresas.add(row.empresa);
                existing.anuncios_count = existing.anuncio_ids.size;

                // Atualiza nome se veio vazio
                if (!existing.name && p.name) existing.name = p.name;

                // Atualiza meli_percentage se tiver valor maior
                if (p.meli_percentage != null && Number(p.meli_percentage) > (existing.meli_percentage || 0)) {
                    existing.meli_percentage = Number(p.meli_percentage);
                }

                // Prioriza status ativo sobre outros
                const isCurrentActive = existing.status === 'started' || existing.status === 'active';
                const isNewActive = p.status === 'started' || p.status === 'active';
                if (isNewActive && !isCurrentActive) {
                    existing.status = p.status;
                }

                // Atualiza datas se faltavam
                if (!existing.start_date && p.start_date) existing.start_date = p.start_date;
                if (!existing.finish_date && p.finish_date) existing.finish_date = p.finish_date;
            }
        }

        // 3. Busca reembolso máximo da tabela dedicada
        let reembolsoMap = {};
        try {
            const reembolsoResult = await pool.query('SELECT promo_id, reembolso_maximo FROM promocoes_reembolso');
            for (const row of reembolsoResult.rows) {
                reembolsoMap[row.promo_id] = row.reembolso_maximo;
            }
        } catch (e) {
            console.warn('[Central Promoções] Tabela promocoes_reembolso não encontrada ou erro:', e.message);
        }

        // 4. Monta array final com reembolso
        const promosList = Object.values(promoMap).map(p => {
            // Remove os Sets antes de enviar
            const { anuncio_ids, empresas, ...rest } = p;
            return {
                ...rest,
                empresas: Array.from(empresas).filter(Boolean),
                reembolso_maximo: reembolsoMap[p.promo_id] != null ? Number(reembolsoMap[p.promo_id]) : null
            };
        });

        res.status(200).json({ data: promosList });

    } catch (error) {
        console.error('[Central Promoções] Erro ao buscar dados:', error);
        res.status(500).json({ message: 'Erro ao buscar promoções.' });
    }
};

/**
 * Salva/atualiza o reembolso máximo de uma promoção na tabela promocoes_reembolso.
 */
exports.salvarReembolsoMaximo = async (req, res) => {
    try {
        const { promo_id, promo_name, reembolso_maximo } = req.body;

        if (!promo_id) {
            return res.status(400).json({ error: 'promo_id é obrigatório.' });
        }

        // Validação do valor
        if (reembolso_maximo !== null && reembolso_maximo !== undefined) {
            const val = Number(reembolso_maximo);
            if (isNaN(val) || val < 0 || val > 100) {
                return res.status(400).json({ error: 'Valor inválido. Use um número entre 0 e 100.' });
            }
        }

        await pool.query(`
            INSERT INTO promocoes_reembolso (promo_id, promo_name, reembolso_maximo, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (promo_id) DO UPDATE SET
                promo_name = COALESCE(EXCLUDED.promo_name, promocoes_reembolso.promo_name),
                reembolso_maximo = EXCLUDED.reembolso_maximo,
                updated_at = NOW()
        `, [promo_id, promo_name || null, reembolso_maximo != null ? reembolso_maximo : null]);

        console.log(`[Central Promoções] Reembolso máximo salvo para ${promo_id}: ${reembolso_maximo}%`);

        res.status(200).json({ success: true, promo_id, reembolso_maximo });

    } catch (error) {
        console.error('[Central Promoções] Erro ao salvar reembolso:', error);
        res.status(500).json({ error: 'Erro ao salvar reembolso máximo.' });
    }
};

// =============================================
// === CONFIGURAÇÃO DE PRAZOS DE DISPONIBILIDADE ===
// =============================================

/**
 * Renderiza a página de configuração de prazos de disponibilidade.
 */
exports.renderConfigurarPrazosPage = (req, res) => {
    try {
        res.render('produtos/configurar-prazos', {
            title: 'Configurar Prazos de Disponibilidade',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de configurar prazos:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de configuração de prazos.');
        res.redirect('/anuncios');
    }
};

/**
 * API para buscar a listagem de Fornecedores e seus prazos configurados.
 */
exports.getConfigPrazosFornecedoresApi = async (req, res) => {
    try {
        const query = `
            SELECT 
                f.bling_id AS fornecedor_id,
                f.nome AS fornecedor_nome,
                COALESCE(cpf.prazo_dias, 0) AS prazo_dias,
                COUNT(DISTINCT cp.sku)::int AS total_skus
            FROM fornecedor f
            LEFT JOIN configuracao_prazos_fornecedor cpf 
                ON (cpf.fornecedor_id = f.bling_id OR (cpf.fornecedor_id IS NULL AND cpf.fornecedor_nome = f.nome))
            LEFT JOIN cached_structures cs 
                ON cs.fornecedor_bling_id = f.bling_id
            LEFT JOIN cached_products cp 
                ON cp.bling_id = cs.parent_product_bling_id AND cp.sku IS NOT NULL AND cp.sku != ''
            WHERE f.nome IS NOT NULL 
              AND TRIM(f.nome) != ''
              AND LOWER(TRIM(f.nome)) NOT IN ('não definido', 'nao definido', 'sem fornecedor')
            GROUP BY f.bling_id, f.nome, cpf.prazo_dias
            ORDER BY f.nome ASC;
        `;

        const result = await pool.query(query);
        res.status(200).json({ data: result.rows });

    } catch (error) {
        console.error('[Config Prazos] Erro ao buscar fornecedores:', error);
        res.status(500).json({ message: 'Erro ao buscar dados dos fornecedores.' });
    }
};

/**
 * API para salvar/atualizar o prazo de um Fornecedor.
 */
exports.salvarPrazoFornecedorApi = async (req, res) => {
    try {
        const { fornecedor_id, fornecedor_nome, prazo_dias } = req.body;

        if (!fornecedor_nome && !fornecedor_id) {
            return res.status(400).json({ error: 'Fornecedor é obrigatório.' });
        }

        const dias = Number(prazo_dias);
        if (isNaN(dias) || dias < 0 || dias > 45) {
            return res.status(400).json({ error: 'O prazo deve ser um número entre 0 e 45 dias.' });
        }

        await pool.query(`
            INSERT INTO configuracao_prazos_fornecedor (fornecedor_id, fornecedor_nome, prazo_dias, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (fornecedor_id) DO UPDATE SET
                fornecedor_nome = EXCLUDED.fornecedor_nome,
                prazo_dias = EXCLUDED.prazo_dias,
                updated_at = NOW()
        `, [fornecedor_id ? Number(fornecedor_id) : null, fornecedor_nome || '', dias]);

        console.log(`[Config Prazos] Prazo de fornecedor salvo para "${fornecedor_nome}": ${dias} dias`);
        res.status(200).json({ success: true, fornecedor_id, fornecedor_nome, prazo_dias: dias });

    } catch (error) {
        console.error('[Config Prazos] Erro ao salvar prazo do fornecedor:', error);
        res.status(500).json({ error: 'Erro ao salvar prazo do fornecedor.' });
    }
};

/**
 * API para buscar a listagem de Produtos (SKUs dos anúncios) com seus fornecedores e prazos.
 */
exports.getConfigPrazosProdutosApi = async (req, res) => {
    try {
        const query = `
            WITH skus_anuncios AS (
                SELECT 
                    sku,
                    MAX(descricao) AS descricao,
                    COUNT(DISTINCT id_anuncio)::int AS total_anuncios
                FROM anuncios_ml
                WHERE sku IS NOT NULL AND TRIM(sku) != ''
                GROUP BY sku
            ),
            produtos_bling AS (
                SELECT DISTINCT ON (sku)
                    sku,
                    bling_id,
                    nome,
                    estoque_plataforma
                FROM cached_products
                WHERE sku IS NOT NULL AND TRIM(sku) != ''
                ORDER BY sku, (bling_account = 'lucas') DESC, last_updated_at DESC
            ),
            estruturas_fornecedor AS (
                SELECT DISTINCT ON (cs.parent_product_bling_id)
                    cs.parent_product_bling_id,
                    f.bling_id AS fornecedor_id,
                    f.nome AS fornecedor_nome
                FROM cached_structures cs
                JOIN fornecedor f ON f.bling_id = cs.fornecedor_bling_id
                WHERE cs.fornecedor_bling_id IS NOT NULL
                  AND f.nome IS NOT NULL 
                  AND TRIM(f.nome) != ''
                  AND LOWER(TRIM(f.nome)) NOT IN ('não definido', 'nao definido', 'sem fornecedor')
                ORDER BY cs.parent_product_bling_id, cs.component_sku ASC
            )
            SELECT 
                sa.sku,
                COALESCE(sa.descricao, pb.nome, '') AS descricao,
                COALESCE(pb.estoque_plataforma, 0) AS estoque_plataforma,
                ef.fornecedor_id,
                COALESCE(ef.fornecedor_nome, 'Não definido') AS fornecedor_nome,
                COALESCE(cpf.prazo_dias, 0) AS prazo_fornecedor,
                COALESCE(cpp.prazo_dias, 0) AS prazo_personalizado,
                CASE 
                    WHEN COALESCE(cpp.prazo_dias, 0) > 0 THEN cpp.prazo_dias
                    WHEN COALESCE(cpf.prazo_dias, 0) > 0 THEN cpf.prazo_dias
                    ELSE 0
                END AS prazo_efetivo,
                sa.total_anuncios
            FROM skus_anuncios sa
            LEFT JOIN produtos_bling pb ON pb.sku = sa.sku
            LEFT JOIN estruturas_fornecedor ef ON ef.parent_product_bling_id = pb.bling_id
            LEFT JOIN configuracao_prazos_fornecedor cpf 
                ON (cpf.fornecedor_id = ef.fornecedor_id OR (cpf.fornecedor_id IS NULL AND cpf.fornecedor_nome = ef.fornecedor_nome))
            LEFT JOIN configuracao_prazos_produto cpp 
                ON UPPER(TRIM(cpp.sku)) = UPPER(TRIM(sa.sku))
            ORDER BY sa.sku ASC;
        `;

        const result = await pool.query(query);
        res.status(200).json({ data: result.rows });

    } catch (error) {
        console.error('[Config Prazos] Erro ao buscar produtos:', error);
        res.status(500).json({ message: 'Erro ao buscar produtos para configuração de prazos.' });
    }
};

/**
 * API para salvar/atualizar o prazo personalizado de um Produto (SKU).
 */
exports.salvarPrazoProdutoApi = async (req, res) => {
    try {
        const { sku, prazo_dias } = req.body;

        if (!sku) {
            return res.status(400).json({ error: 'SKU é obrigatório.' });
        }

        const cleanSku = String(sku).trim();
        const dias = Number(prazo_dias);
        if (isNaN(dias) || dias < 0 || dias > 45) {
            return res.status(400).json({ error: 'O prazo deve ser um número entre 0 e 45 dias.' });
        }

        await pool.query(`
            INSERT INTO configuracao_prazos_produto (sku, prazo_dias, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (sku) DO UPDATE SET
                prazo_dias = EXCLUDED.prazo_dias,
                updated_at = NOW()
        `, [cleanSku, dias]);

        console.log(`[Config Prazos] Prazo de produto salvo para SKU "${cleanSku}": ${dias} dias`);
        res.status(200).json({ success: true, sku: cleanSku, prazo_dias: dias });

    } catch (error) {
        console.error('[Config Prazos] Erro ao salvar prazo do produto:', error);
        res.status(500).json({ error: 'Erro ao salvar prazo do produto.' });
    }
};

/**
 * Processamento automático e central de aplicação/remoção de prazos nos anúncios do Mercado Livre.
 * Regras:
 * - Se estoque_plataforma <= 5 E prazo_efetivo > 0: aplica prazo no ML se já não estiver aplicado.
 * - Se estoque_plataforma >= 15 E anúncio tem prazo no ML: remove prazo no ML.
 */
async function processarPrazosAutomaticosInterno() {
    console.log('[Prazos ML] Iniciando verificação e aplicação de prazos...');

    try {
        const query = `
            WITH produtos_bling AS (
                SELECT DISTINCT ON (sku)
                    sku,
                    bling_id,
                    estoque_plataforma
                FROM cached_products
                WHERE sku IS NOT NULL AND TRIM(sku) != ''
                ORDER BY sku, (bling_account = 'lucas') DESC, last_updated_at DESC
            ),
            estruturas_fornecedor AS (
                SELECT DISTINCT ON (cs.parent_product_bling_id)
                    cs.parent_product_bling_id,
                    f.bling_id AS fornecedor_id,
                    f.nome AS fornecedor_nome
                FROM cached_structures cs
                JOIN fornecedor f ON f.bling_id = cs.fornecedor_bling_id
                WHERE cs.fornecedor_bling_id IS NOT NULL
                  AND f.nome IS NOT NULL 
                  AND TRIM(f.nome) != ''
                  AND LOWER(TRIM(f.nome)) NOT IN ('não definido', 'nao definido', 'sem fornecedor')
                ORDER BY cs.parent_product_bling_id, cs.component_sku ASC
            )
            SELECT 
                a.id_anuncio,
                a.sku,
                a.descricao,
                a.status,
                a.prazo_disponibilidade,
                COALESCE(pb.estoque_plataforma, 0) AS estoque_plataforma,
                ef.fornecedor_nome,
                COALESCE(cpp.prazo_dias, 0) AS prazo_sku,
                COALESCE(cpf.prazo_dias, 0) AS prazo_fornecedor,
                CASE 
                    WHEN COALESCE(cpp.prazo_dias, 0) > 0 THEN cpp.prazo_dias
                    WHEN COALESCE(cpf.prazo_dias, 0) > 0 THEN cpf.prazo_dias
                    ELSE 0
                END AS prazo_efetivo
            FROM anuncios_ml a
            LEFT JOIN produtos_bling pb ON pb.sku = a.sku
            LEFT JOIN estruturas_fornecedor ef ON ef.parent_product_bling_id = pb.bling_id
            LEFT JOIN configuracao_prazos_fornecedor cpf 
                ON (cpf.fornecedor_id = ef.fornecedor_id OR (cpf.fornecedor_id IS NULL AND cpf.fornecedor_nome = ef.fornecedor_nome))
            LEFT JOIN configuracao_prazos_produto cpp 
                ON UPPER(TRIM(cpp.sku)) = UPPER(TRIM(a.sku))
            WHERE a.status = 'active';
        `;

        const result = await pool.query(query);
        const anuncios = result.rows;

        function extrairDiasPrazo(prazo) {
            if (prazo === null || prazo === undefined) return 0;
            const str = String(prazo).trim().toLowerCase();
            if (str === '' || str === 'null' || str === 'undefined' || str === '0' || str === '0 dias' || str.includes('pronta') || str === '-') {
                return 0;
            }
            const digits = str.replace(/\D/g, '');
            return digits ? parseInt(digits, 10) : 0;
        }

        const gruposAplicar = {}; // { '5': [anuncioObj1, anuncioObj2] }
        const itensRemover = []; // [anuncioObj1, ...]

        for (const a of anuncios) {
            const estoque = Number(a.estoque_plataforma) || 0;
            const prazoEfetivo = Number(a.prazo_efetivo) || 0;
            const diasAtuais = extrairDiasPrazo(a.prazo_disponibilidade);

            // REGRA 1: Estoque <= 5 e tem prazo configurado > 0
            if (estoque <= 5 && prazoEfetivo > 0) {
                if (diasAtuais !== prazoEfetivo) {
                    if (!gruposAplicar[prazoEfetivo]) {
                        gruposAplicar[prazoEfetivo] = [];
                    }
                    gruposAplicar[prazoEfetivo].push(a);
                }
            }
            // REGRA 2: Estoque >= 15 e anúncio possui prazo de disponibilidade atualmente no ML
            else if (estoque >= 15 && diasAtuais > 0) {
                itensRemover.push(a);
            }
        }

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        let totalAplicados = 0;
        let totalRemovidos = 0;

        // 1. Executa aplicação por grupos de dias
        for (const [dias, itens] of Object.entries(gruposAplicar)) {
            const numDias = Number(dias);
            console.log(`[Prazos ML] Processando aplicação de ${numDias} dias para ${itens.length} anúncio(s)...`);

            for (const an of itens) {
                const itemId = an.id_anuncio;
                const prazoAnteriorStr = an.prazo_disponibilidade || '0 dias (Pronta Entrega)';
                const motivo = `Estoque Bling <= 5 (Estoque atual: ${an.estoque_plataforma})`;

                console.log(`[Prazos ML] [APLICANDO] Anúncio: ${itemId} | SKU: ${an.sku} | Fornecedor: ${an.fornecedor_nome || 'N/A'} | Estoque: ${an.estoque_plataforma} | Novo Prazo: ${numDias} dias | Prazo Anterior: ${prazoAnteriorStr}`);

                let isSucesso = false;
                let msgErro = null;

                try {
                    const conta = await hubProdutosService.resolverContaPorItem(itemId);
                    if (!conta) {
                        msgErro = 'Conta do Hub não encontrada';
                        console.warn(`[Prazos ML] Conta do Hub não encontrada para o anúncio ${itemId}`);
                    } else {
                        const accessToken = await hubTokenService.getValidAccessToken(conta);

                        try {
                            await hubProdutosService.setPrazoDisponibilidade(itemId, numDias, accessToken);
                            isSucesso = true;
                        } catch (errFirst) {
                            if (errFirst.response?.status === 409 || errFirst.response?.status === 429) {
                                await sleep(800);
                                await hubProdutosService.setPrazoDisponibilidade(itemId, numDias, accessToken);
                                isSucesso = true;
                            } else {
                                throw errFirst;
                            }
                        }
                    }

                    if (isSucesso) {
                        totalAplicados++;
                        await pool.query(
                            `UPDATE anuncios_ml SET prazo_disponibilidade = $1, last_updated_at = NOW() WHERE id_anuncio = $2`,
                            [`${numDias} dias`, itemId]
                        );
                    }
                } catch (errItem) {
                    msgErro = errItem.response?.data?.message || errItem.message;
                    console.error(`[Prazos ML] Erro ao aplicar prazo de ${numDias} dias no anúncio ${itemId}:`, errItem.response?.data || errItem.message);
                }

                // Salva no histórico
                try {
                    await pool.query(`
                        INSERT INTO historico_prazos_anuncios 
                        (id_anuncio, sku, descricao, fornecedor_nome, estoque_bling, acao, prazo_anterior, prazo_novo, motivo, sucesso, mensagem_erro, executado_por)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    `, [
                        itemId,
                        an.sku,
                        an.descricao,
                        an.fornecedor_nome,
                        an.estoque_plataforma,
                        'APLICADO',
                        prazoAnteriorStr,
                        `${numDias} dias`,
                        motivo,
                        isSucesso,
                        msgErro,
                        'Manual (Aplicar Prazos)'
                    ]);
                } catch (histErr) {
                    console.error('[Prazos ML] Erro ao gravar histórico de aplicação:', histErr.message);
                }

                await sleep(150);
            }
        }

        // 2. Executa remoção de prazos
        if (itensRemover.length > 0) {
            console.log(`[Prazos ML] Processando remoção de prazo para ${itensRemover.length} anúncio(s)...`);

            for (const an of itensRemover) {
                const itemId = an.id_anuncio;
                const prazoAnteriorStr = an.prazo_disponibilidade || 'Com Prazo';
                const motivo = `Estoque Bling >= 15 (Estoque atual: ${an.estoque_plataforma})`;

                console.log(`[Prazos ML] [REMOVENDO] Anúncio: ${itemId} | SKU: ${an.sku} | Fornecedor: ${an.fornecedor_nome || 'N/A'} | Estoque: ${an.estoque_plataforma} | Prazo Anterior: ${prazoAnteriorStr}`);

                let isSucesso = false;
                let msgErro = null;

                try {
                    const conta = await hubProdutosService.resolverContaPorItem(itemId);
                    if (!conta) {
                        msgErro = 'Conta do Hub não encontrada';
                        console.warn(`[Prazos ML] Conta do Hub não encontrada para o anúncio ${itemId}`);
                    } else {
                        const accessToken = await hubTokenService.getValidAccessToken(conta);

                        try {
                            await hubProdutosService.removerPrazoDisponibilidade(itemId, accessToken);
                            isSucesso = true;
                        } catch (errFirst) {
                            if (errFirst.response?.status === 409 || errFirst.response?.status === 429) {
                                await sleep(800);
                                await hubProdutosService.removerPrazoDisponibilidade(itemId, accessToken);
                                isSucesso = true;
                            } else {
                                throw errFirst;
                            }
                        }
                    }

                    if (isSucesso) {
                        totalRemovidos++;
                        await pool.query(
                            `UPDATE anuncios_ml SET prazo_disponibilidade = NULL, last_updated_at = NOW() WHERE id_anuncio = $1`,
                            [itemId]
                        );
                    }
                } catch (errItem) {
                    msgErro = errItem.response?.data?.message || errItem.message;
                    console.error(`[Prazos ML] Erro ao remover prazo do anúncio ${itemId}:`, errItem.response?.data || errItem.message);
                }

                // Salva no histórico
                try {
                    await pool.query(`
                        INSERT INTO historico_prazos_anuncios 
                        (id_anuncio, sku, descricao, fornecedor_nome, estoque_bling, acao, prazo_anterior, prazo_novo, motivo, sucesso, mensagem_erro, executado_por)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    `, [
                        itemId,
                        an.sku,
                        an.descricao,
                        an.fornecedor_nome,
                        an.estoque_plataforma,
                        'REMOVIDO',
                        prazoAnteriorStr,
                        '0 dias (Pronta Entrega)',
                        motivo,
                        isSucesso,
                        msgErro,
                        'Manual (Aplicar Prazos)'
                    ]);
                } catch (histErr) {
                    console.error('[Prazos ML] Erro ao gravar histórico de remoção:', histErr.message);
                }

                await sleep(150);
            }
        }

        const totalInalterados = anuncios.length - totalAplicados - totalRemovidos;
        console.log(`[Prazos ML] Processamento finalizado. Total: ${anuncios.length}, Aplicados: ${totalAplicados}, Removidos: ${totalRemovidos}, Inalterados: ${totalInalterados}.`);

        return {
            total: anuncios.length,
            aplicados: totalAplicados,
            removidos: totalRemovidos,
            inalterados: totalInalterados
        };

    } catch (error) {
        console.error('[Prazos ML] Erro geral durante o processamento:', error);
        return { total: 0, aplicados: 0, removidos: 0, inalterados: 0, erro: error.message };
    }
}

// Exporta o método interno para o blingSyncService usar
exports.processarPrazosAutomaticosInterno = processarPrazosAutomaticosInterno;

/**
 * Endpoint manual acionado pelo botão "Aplicar Prazos Agora"
 */
exports.aplicarPrazosManualApi = async (req, res) => {
    try {
        const resultado = await processarPrazosAutomaticosInterno();
        res.status(200).json({
            success: true,
            ...resultado
        });
    } catch (error) {
        console.error('[Prazos ML] Erro na rota manual de aplicação:', error);
        res.status(500).json({ error: 'Erro ao processar aplicação de prazos de disponibilidade.' });
    }
};

/**
 * API para buscar o Histórico de alterações de prazos.
 */
exports.getHistoricoPrazosApi = async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS historico_prazos_anuncios (
                id SERIAL PRIMARY KEY,
                id_anuncio VARCHAR(50) NOT NULL,
                sku VARCHAR(100),
                descricao TEXT,
                fornecedor_nome VARCHAR(255),
                estoque_bling INT,
                acao VARCHAR(50) NOT NULL,
                prazo_anterior VARCHAR(50),
                prazo_novo VARCHAR(50),
                motivo TEXT,
                sucesso BOOLEAN DEFAULT true,
                mensagem_erro TEXT,
                executado_por VARCHAR(100) DEFAULT 'Manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const query = `
            SELECT 
                id,
                id_anuncio,
                sku,
                descricao,
                fornecedor_nome,
                estoque_bling,
                acao,
                prazo_anterior,
                prazo_novo,
                motivo,
                sucesso,
                mensagem_erro,
                executado_por,
                TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI:SS') AS data_formatada,
                created_at
            FROM historico_prazos_anuncios
            ORDER BY created_at DESC
            LIMIT 500;
        `;

        const result = await pool.query(query);
        res.status(200).json({ data: result.rows });

    } catch (error) {
        console.error('[Config Prazos] Erro ao buscar histórico de prazos:', error);
        res.status(500).json({ message: 'Erro ao buscar dados do histórico.' });
    }
};


