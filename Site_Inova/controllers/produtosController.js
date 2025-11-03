// controllers/produtosController.js
const { Pool } = require('pg');

// Configuração do Pool do Banco de Dados (assumindo a mesma configuração do etiquetasController)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

/**
 * Renderiza a página de listagem de produtos (a "casca").
 * O conteúdo será preenchido pelo JavaScript.
 */
exports.renderProdutosListPage = (req, res) => {
    try {
        res.render('produtos/listagem', {
            title: 'Gerenciamento de Produtos',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de produtos:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de gerenciamento de produtos.');
        res.redirect('/');
    }
};

/**
 * API que busca os dados para a tabela dinâmica, com filtros e deduplicação.
 */
exports.getProdutosApi = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            search = '',
            tipo = 'produto' // Default 'produto'
        } = req.query;

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        let mainQuery = '';
        let countQuery = '';
        
        // Filtro para não mostrar SKUs N/A ou nulos
        if (tipo === 'produto') {
            whereClauses.push(`(sku IS NOT NULL AND sku != 'N/A' AND sku != '')`);
        } else {
            whereClauses.push(`(component_sku IS NOT NULL AND component_sku != 'N/A' AND component_sku != '')`);
        }

        if (search) {
            const searchTerm = `%${search}%`;
            if (tipo === 'produto') {
                whereClauses.push(`(sku ILIKE $${paramIndex} OR nome ILIKE $${paramIndex})`);
            } else { // tipo === 'estrutura'
                whereClauses.push(`(component_sku ILIKE $${paramIndex} OR structure_name ILIKE $${paramIndex} OR gtin ILIKE $${paramIndex})`);
            }
            queryParams.push(searchTerm);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // --- Lógica de SQL Dinâmica ---
        if (tipo === 'produto') {
            // **IMPORTANTE: Prioriza 'lucas' (1) sobre 'eliane' (2)**
            // O DISTINCT ON (sku) pegará a primeira linha, que será 'lucas' se existir.
            mainQuery = `
                SELECT DISTINCT ON (sku)
                    sku, nome, preco_custo, tipo_ml, bling_account
                FROM cached_products
                ${whereCondition}
                ORDER BY 
                    sku, 
                    CASE 
                        WHEN bling_account = 'lucas' THEN 1 
                        WHEN bling_account = 'eliane' THEN 2 
                        ELSE 3 
                    END,
                    last_updated_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            // A contagem também deve ser de SKUs distintos
            countQuery = `SELECT COUNT(DISTINCT sku) FROM cached_products ${whereCondition};`;
        
        } else { // tipo === 'estrutura'
            // **IMPORTANTE: Prioriza 'lucas' (1) sobre 'eliane' (2)**
             mainQuery = `
                SELECT DISTINCT ON (component_sku)
                    id, parent_product_bling_id, component_sku, component_location, structure_name, gtin, gtin_embalagem, parent_product_bling_account
                FROM cached_structures
                ${whereCondition}
                ORDER BY 
                    component_sku,
                    CASE 
                        WHEN parent_product_bling_account = 'lucas' THEN 1 
                        WHEN parent_product_bling_account = 'eliane' THEN 2 
                        ELSE 3 
                    END,
                    id DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            // Contagem distinta de SKUs de componentes
            countQuery = `SELECT COUNT(DISTINCT component_sku) FROM cached_structures ${whereCondition};`;
        }

        // 1. Busca os dados da página
        const dataResult = await pool.query(mainQuery, [...queryParams, limit, offset]);

        // 2. Busca a contagem total para paginação
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        res.status(200).json({
            data: dataResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems },
            tipo: tipo // Retorna o tipo para o JS saber como renderizar a tabela
        });

    } catch (error) {
        console.error("[API Produtos] Erro ao buscar dados:", error);
        res.status(500).json({ message: "Erro ao buscar dados dos produtos." });
    }
};

/**
 * Renderiza a página de edição para um PRODUTO.
 * Prioriza "lucas" para carregar os dados.
 */
exports.renderEditProdutoPage = async (req, res) => {
    const { sku } = req.params;
    try {
        // Busca o produto com este SKU, priorizando 'lucas'
        const query = `
            SELECT sku, nome, preco_custo, tipo_ml
            FROM cached_products 
            WHERE sku = $1 
            ORDER BY 
                CASE 
                    WHEN bling_account = 'lucas' THEN 1 
                    WHEN bling_account = 'eliane' THEN 2 
                    ELSE 3 
                END
            LIMIT 1;
        `;
        const result = await pool.query(query, [sku]);

        if (result.rows.length === 0) {
            req.flash('error_msg', 'Produto não encontrado.');
            return res.redirect('/produtos/listagem');
        }

        // Padrão de formulário (similar a /assistencia/editar/:id)
        res.render('produtos/editar-produto', {
            title: `Editar Produto`,
            layout: 'main',
            produto: result.rows[0] // Passa o produto (lucas ou eliane, o que encontrou)
        });

    } catch (error) {
        console.error(`Erro ao buscar produto ${sku}:`, error);
        req.flash('error_msg', 'Erro ao carregar dados do produto.');
        res.redirect('/produtos/listagem');
    }
};

/**
 * Renderiza a página de edição para uma ESTRUTURA.
 * Prioriza "lucas" para carregar os dados.
 */
exports.renderEditEstruturaPage = async (req, res) => {
    const { sku } = req.params; // O SKU aqui é o component_sku
    try {
        // Busca a estrutura com este component_sku, priorizando 'lucas'
        const query = `
            SELECT id, component_sku, component_location, structure_name, gtin, gtin_embalagem
            FROM cached_structures 
            WHERE component_sku = $1 
            ORDER BY 
                CASE 
                    WHEN parent_product_bling_account = 'lucas' THEN 1 
                    WHEN parent_product_bling_account = 'eliane' THEN 2 
                    ELSE 3 
                END
            LIMIT 1;
        `;
        const result = await pool.query(query, [sku]);

        if (result.rows.length === 0) {
            req.flash('error_msg', 'Estrutura não encontrada.');
            return res.redirect('/produtos/listagem');
        }

        res.render('produtos/editar-estrutura', {
            title: `Editar Estrutura`,
            layout: 'main',
            estrutura: result.rows[0]
        });

    } catch (error) {
        console.error(`Erro ao buscar estrutura ${sku}:`, error);
        req.flash('error_msg', 'Erro ao carregar dados da estrutura.');
        res.redirect('/produtos/listagem');
    }
};

/**
 * Atualiza TODOS os produtos que compartilham o mesmo OLD_SKU.
 */
exports.updateProduto = async (req, res) => {
    // Campos editáveis
    const { old_sku, sku, nome, preco_custo, tipo_ml } = req.body;

    // Validação básica
    if (!old_sku) {
        req.flash('error_msg', 'SKU original não encontrado. Não foi possível salvar.');
        return res.redirect('/produtos/listagem');
    }
     if (!sku || sku.trim() === '' || sku.trim() === 'N/A') {
        req.flash('error_msg', 'O novo SKU não pode ser vazio ou "N/A".');
        return res.redirect(`/produtos/editar/produto/${old_sku}`);
    }

    try {
        // **LÓGICA "EDITAR TODOS"**: O UPDATE é feito com WHERE no OLD_SKU.
        const query = `
            UPDATE cached_products
            SET 
                sku = $1,
                nome = $2, 
                preco_custo = $3, 
                tipo_ml = $4,
                last_updated_at = NOW()
            WHERE sku = $5;
        `;
        
        // Converte para null se estiver vazio e ajusta tipos
        const custoNum = preco_custo ? parseFloat(preco_custo) : null;
        const tipoMlVal = tipo_ml ? tipo_ml.trim() : null;

        await pool.query(query, [sku.trim(), nome, custoNum, tipoMlVal, old_sku]);

        req.flash('success_msg', `Produto SKU ${old_sku} atualizado para ${sku} com sucesso.`);
        res.redirect('/produtos/listagem');

    } catch (error) {
        console.error(`Erro ao atualizar produto ${old_sku}:`, error);
        req.flash('error_msg', 'Erro ao salvar alterações.');
        res.redirect(`/produtos/editar/produto/${old_sku}`);
    }
};

/**
 * Atualiza TODAS as estruturas que compartilham o mesmo old_component_sku.
 */
exports.updateEstrutura = async (req, res) => {
    // Campos editáveis
    const { old_component_sku, component_sku, structure_name, component_location, gtin, gtin_embalagem } = req.body;

    if (!old_component_sku) {
        req.flash('error_msg', 'SKU original não encontrado. Não foi possível salvar.');
        return res.redirect('/produtos/listagem');
    }
    if (!component_sku || component_sku.trim() === '' || component_sku.trim() === 'N/A') {
        req.flash('error_msg', 'O novo SKU não pode ser vazio ou "N/A".');
        return res.redirect(`/produtos/editar/estrutura/${old_component_sku}`);
    }

    try {
        // **LÓGICA "EDITAR TODOS"**: O UPDATE é feito com WHERE no old_component_sku.
        const query = `
            UPDATE cached_structures
            SET 
                component_sku = $1,
                structure_name = $2,
                component_location = $3, 
                gtin = $4, 
                gtin_embalagem = $5
            WHERE component_sku = $6;
        `;
        
        // Converte para null se estiver vazio
        const locVal = component_location ? component_location.trim() : null;
        const gtinVal = gtin ? gtin.trim() : null;
        const gtinEmbVal = gtin_embalagem ? gtin_embalagem.trim() : null;

        await pool.query(query, [component_sku.trim(), structure_name, locVal, gtinVal, gtinEmbVal, old_component_sku]);

        req.flash('success_msg', `Estrutura SKU ${old_component_sku} atualizada para ${component_sku} com sucesso.`);
        res.redirect('/produtos/listagem?tipo=estrutura'); // Volta para a listagem de estruturas

    } catch (error) {
        console.error(`Erro ao atualizar estrutura ${old_component_sku}:`, error);
        req.flash('error_msg', 'Erro ao salvar alterações.');
        res.redirect(`/produtos/editar/estrutura/${old_component_sku}`);
    }
};