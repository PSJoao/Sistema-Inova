const { Pool } = require('pg');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const comprasPdfService = require('../services/comprasPdfService');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Configuração do multer para upload de arquivos em memória
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Limite 10MB
}).array('files', 4);

function normalizarTextoComparacao(txt) {
    if (!txt) return '';
    return String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Lê o arquivo lista-fornecedor-apelido.txt e mapeia os apelidos por fornecedor
 */
function carregarMapaApelidosFornecedores() {
    const mapa = new Map(); // normalizedName -> Set(aliases)
    try {
        const filePath = path.join(__dirname, '..', 'lista-fornecedor-apelido.txt');
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const nome = parts[0].trim();
                    const apelido = parts[1].trim();
                    if (nome && apelido) {
                        const chaveNome = normalizarTextoComparacao(nome);
                        if (!mapa.has(chaveNome)) {
                            mapa.set(chaveNome, new Set());
                        }
                        mapa.get(chaveNome).add(apelido);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Análise de Compras] Erro ao ler lista-fornecedor-apelido.txt:', err);
    }
    return mapa;
}

/**
 * Normaliza o nome do fornecedor e extrai sua chave de agrupamento representativa.
 * Ignora prefixos corporativos, preposições e termos genéricos para encontrar o nome real da fábrica.
 * Evita colisões entre iniciais curtas (ex: 'J. J.' e 'J. D.') enquanto unifica
 * nomes como 'INDÚSTRIA DE MÓVEIS HENN LTDA' e 'HENN MÓVEIS'.
 */
function extrairChaveFornecedor(nome) {
    if (!nome) return '';
    let limpo = String(nome).trim().replace(/\s+/g, ' ');
    const palavras = limpo.split(' ').map(p => p.trim()).filter(Boolean);
    if (palavras.length === 0) return '';

    const palavrasIgnoraveis = new Set([
        'IND', 'IND.', 'INDUSTRIA', 'INDÚSTRIA', 
        'COMERCIO', 'COMÉRCIO', 'COMERCIAL', 
        'DISTRIBUIDORA', 'FABRICA', 'FÁBRICA', 
        'CIA', 'CIA.', 'COMPANHIA', 'MANUFATURA',
        'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'EM', 'P/',
        'MOVEIS', 'MÓVEIS', 'ESTOFADOS', 'COLCHOES', 'COLCHÕES'
    ]);

    // Encontra a primeira palavra significativa
    let palavrasSignificativas = [];
    for (let i = 0; i < palavras.length; i++) {
        const pUpper = palavras[i].toUpperCase().replace(/[.,\-_/]/g, '');
        if (!palavrasIgnoraveis.has(pUpper)) {
            palavrasSignificativas = palavras.slice(i);
            break;
        }
    }

    if (palavrasSignificativas.length === 0) {
        palavrasSignificativas = palavras;
    }

    const p1 = palavrasSignificativas[0];
    const p1Clean = p1.toUpperCase().replace(/[.,\-_/]/g, '');

    // Se for sigla curta (<= 2 caracteres como 'J.', 'A.', 'JD') ou contiver ponto,
    // mantém as duas primeiras palavras significativas para não fundir 'J. J.' com 'J. D.'
    if ((p1Clean.length <= 2 || p1.includes('.')) && palavrasSignificativas.length > 1) {
        const p2 = palavrasSignificativas[1];
        return `${p1Clean} ${p2.toUpperCase().replace(/[.,\-_/]/g, '')}`;
    }

    return p1Clean;
}

/**
 * Renderiza a página principal
 */
exports.renderPage = async (req, res) => {
    try {
        const fornecedoresRes = await pool.query('SELECT bling_id, nome FROM fornecedor ORDER BY nome');
        const rows = fornecedoresRes.rows;
        const mapaApelidos = carregarMapaApelidosFornecedores();

        // Agrupamento inteligente por chave normalizada para unificar fornecedores duplicados
        const gruposMap = new Map();
        for (const f of rows) {
            if (!f.nome) continue;
            const chave = extrairChaveFornecedor(f.nome);
            if (!chave) continue;

            const fNomeNorm = normalizarTextoComparacao(f.nome);
            const aliasesForSupplier = new Set();

            mapaApelidos.forEach((setAliases, nomeOriginalNorm) => {
                if (fNomeNorm === nomeOriginalNorm || fNomeNorm.includes(nomeOriginalNorm) || nomeOriginalNorm.includes(fNomeNorm)) {
                    setAliases.forEach(a => aliasesForSupplier.add(a));
                }
            });

            if (!gruposMap.has(chave)) {
                gruposMap.set(chave, {
                    chave: chave,
                    nome: f.nome.trim(),
                    ids: [String(f.bling_id)],
                    aliases: aliasesForSupplier
                });
            } else {
                gruposMap.get(chave).ids.push(String(f.bling_id));
                aliasesForSupplier.forEach(a => gruposMap.get(chave).aliases.add(a));
            }
        }

        const fornecedores = Array.from(gruposMap.values()).map(g => {
            const aliasesArr = Array.from(g.aliases || []);
            const gNomeNorm = normalizarTextoComparacao(g.nome);
            
            // Filtra apelidos significativos (que realmente diferem do nome da fábrica)
            const apelidosDiferentes = aliasesArr.filter(a => {
                const aNorm = normalizarTextoComparacao(a);
                return aNorm && !gNomeNorm.includes(aNorm) && !aNorm.includes(gNomeNorm);
            });
            const apelidoPrincipal = apelidosDiferentes.length > 0 ? apelidosDiferentes[0] : null;

            return {
                chave: g.chave,
                nome: g.nome,
                idsStr: g.ids.join(','),
                aliasesStr: aliasesArr.join(';'),
                apelidoPrincipal: apelidoPrincipal
            };
        }).sort((a, b) => a.nome.localeCompare(b.nome));

        res.render('analise/lista-compras', {
            title: 'Análise de Compras',
            fornecedores: fornecedores
        });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao renderizar página:', error);
        res.status(500).send('Erro interno do servidor.');
    }
};

/**
 * Renderiza a página dedicada de importação de vendas
 */
exports.renderImportarVendasPage = async (req, res) => {
    try {
        res.render('analise/importar-vendas', {
            title: 'Importar Relatórios de Vendas'
        });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao renderizar página de upload:', error);
        res.status(500).send('Erro interno do servidor.');
    }
};

/**
 * Limpa e formata o nome da estrutura representativa de forma inteligente:
 * 1. Remove prefixo de código/SKU inicial, se houver (ex: '600521 - CADEIRA...' -> 'CADEIRA...')
 * 2. Remove sufixos de ESTOQUE e volumes (ex: '- ESTOQUE - V 1/1', 'ESTOQUE V 1/1', '- V 1/2', '- VOL 1', etc.)
 * 3. Preserva nomes compostos com hífen no corpo da descrição (ex: 'OFF-WHITE')
 */
function limparNomeEstrutura(structureName, parentName) {
    let str = (structureName || parentName || '').trim();
    if (!str) return '';

    // 1. Remove prefixo de código/SKU inicial (números ou código sem espaço seguido de ' - ' ou ' : ')
    str = str.replace(/^\s*([0-9]+|[A-Z0-9._/-]{3,25})\s*[-–—:]\s+(?=[A-Za-zÀ-ÿ0-9])/i, '');

    // 2. Remove sufixos de ESTOQUE e VOLUMES no final da string
    // Ex: " - ESTOQUE - V 1/1", " ESTOQUE V 1/1", " (ESTOQUE) (V 1/1)", " - ESTOQUE", " ESTOQUE"
    str = str.replace(/\s*[-–—]?\s*\(?\bESTOQUE\b\)?(\s*[-–—]?\s*\(?(V|VOL|VOL\.|VOLUME)\s*\d+(\/\d+)?\)?.*)?$/i, '');

    // Ex: " - V 1/1", " - V 1/2", " - VOL 1/2", " - VOL. 1", " - VOLUME 1", " V 1/1", " VOL 1/2", " V1/1", " (V 1/1)"
    str = str.replace(/\s*[-–—]?\s*\(?\b(V|VOL|VOL\.|VOLUME)\s*\d+(\/\d+)?\)?.*$/i, '');

    // 3. Remove "- ESTOQUE" residual ou traços / pontuações finais
    str = str.replace(/\s*[-–—]\s*ESTOQUE\s*$/i, '');
    str = str.replace(/\s*[-–—:,.()]\s*$/, '').trim();

    return str;
}

let tabelasGarantidas = false;
async function garantirTabelas() {
    if (tabelasGarantidas) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS analise_compras_dados (
                parent_product_bling_id BIGINT,
                sku VARCHAR(100),
                chegando INTEGER DEFAULT 0
            );
        `);
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'analise_compras_dados' AND column_name = 'sku') THEN
                    ALTER TABLE analise_compras_dados ADD COLUMN sku VARCHAR(100);
                END IF;
            END $$;
        `);
        tabelasGarantidas = true;
    } catch (err) {
        console.error('[Análise de Compras] Erro ao verificar estrutura de tabelas:', err);
    }
}

// Executa em segundo plano na inicialização
//garantirTabelas().catch(() => {});

/**
 * Endpoint da API para buscar a listagem agrupada por estrutura representativa (sem duplicatas)
 */
exports.listarProdutos = async (req, res) => {
    try {
        const query = `
            WITH parent_rep AS (
                -- Para cada produto pai, determina a estrutura representativa (Volume 1)
                SELECT
                    p.bling_id AS parent_product_bling_id,
                    p.nome AS parent_produto_nome,
                    p.sku AS parent_sku,
                    p.tipo_ml AS parent_tipo_ml,
                    p.estoque AS parent_estoque,
                    COALESCE(p.estoque_plataforma, 0) AS parent_estoque_plataforma,
                    (ARRAY_AGG(s.component_sku ORDER BY 
                        CASE 
                            WHEN s.structure_name ILIKE '%V 1/%' OR s.structure_name ILIKE '%V 01/%' OR s.structure_name ILIKE '%V1/%' OR s.structure_name ILIKE '%VOL 1%' OR s.structure_name ILIKE '%VOL. 1%' OR s.structure_name ILIKE '%VOL1%' THEN 0 
                            ELSE 1 
                        END, 
                        s.component_sku ASC
                    ))[1] AS sku,
                    (ARRAY_AGG(s.structure_name ORDER BY 
                        CASE 
                            WHEN s.structure_name ILIKE '%V 1/%' OR s.structure_name ILIKE '%V 01/%' OR s.structure_name ILIKE '%V1/%' OR s.structure_name ILIKE '%VOL 1%' OR s.structure_name ILIKE '%VOL. 1%' OR s.structure_name ILIKE '%VOL1%' THEN 0 
                            ELSE 1 
                        END, 
                        s.component_sku ASC
                    ))[1] AS structure_name,
                    COALESCE(
                        (ARRAY_AGG(s.fornecedor_bling_id ORDER BY CASE WHEN s.fornecedor_bling_id IS NOT NULL THEN 0 ELSE 1 END))[1],
                        MAX(s.fornecedor_bling_id)
                    ) AS fornecedor_id
                FROM cached_structures s
                JOIN cached_products p ON p.bling_id = s.parent_product_bling_id
                WHERE s.component_sku IS NOT NULL AND s.component_sku != ''
                GROUP BY p.bling_id, p.nome, p.sku, p.tipo_ml, p.estoque, p.estoque_plataforma
            ),
            structure_grouped AS (
                -- Agrupa pelo SKU da estrutura para consolidar produtos pais diferentes que usam a mesma estrutura
                SELECT
                    pr.sku,
                    (ARRAY_AGG(pr.structure_name ORDER BY 
                        CASE WHEN pr.structure_name IS NOT NULL AND pr.structure_name != '' THEN 0 ELSE 1 END,
                        LENGTH(pr.structure_name) DESC
                    ))[1] AS structure_name,
                    (ARRAY_AGG(pr.parent_produto_nome ORDER BY LENGTH(pr.parent_produto_nome) DESC))[1] AS parent_produto_nome,
                    (ARRAY_AGG(pr.parent_sku ORDER BY 
                        CASE WHEN pr.parent_tipo_ml IS NOT NULL AND pr.parent_tipo_ml != '' THEN 0 ELSE 1 END,
                        LENGTH(pr.parent_sku) DESC
                    ))[1] AS parent_sku,
                    (ARRAY_AGG(pr.parent_tipo_ml ORDER BY 
                        CASE WHEN pr.parent_tipo_ml IS NOT NULL AND pr.parent_tipo_ml != '' THEN 0 ELSE 1 END
                    ))[1] AS parent_tipo_ml,
                    MIN(pr.parent_product_bling_id) AS parent_product_bling_id,
                    COALESCE(
                        (ARRAY_AGG(pr.fornecedor_id ORDER BY CASE WHEN pr.fornecedor_id IS NOT NULL THEN 0 ELSE 1 END))[1],
                        MAX(pr.fornecedor_id)
                    ) AS fornecedor_id,
                    MAX(pr.parent_estoque) AS fallback_estoque,
                    MAX(pr.parent_estoque_plataforma) AS fallback_estoque_plataforma
                FROM parent_rep pr
                GROUP BY pr.sku
            )
            SELECT
                sg.sku,
                sg.structure_name,
                sg.parent_produto_nome,
                sg.parent_product_bling_id,
                CASE 
                    WHEN sg.parent_tipo_ml IS NOT NULL AND sg.parent_tipo_ml != '' THEN sg.parent_sku 
                    ELSE NULL 
                END AS sku_ml,
                sg.parent_tipo_ml AS tipo_ml,
                COALESCE(sg.fornecedor_id, cs_forn.fornecedor_bling_id) AS fornecedor_id,
                COALESCE(f.nome, f_alt.nome, 'NÃO INFORMADO') AS fornecedor_nome,
                COALESCE(cp.estoque, sg.fallback_estoque, 0) AS estoque_atual,
                COALESCE(cp.estoque_plataforma, sg.fallback_estoque_plataforma, 0) AS estoque_plataforma,
                COALESCE(d.chegando, 0) AS chegando,
                COALESCE(v.vendas_3d, 0) AS vendas_3d,
                COALESCE(v.vendas_7d, 0) AS vendas_7d,
                COALESCE(v.vendas_15d, 0) AS vendas_15d,
                COALESCE(v.vendas_30d, 0) AS vendas_30d
            FROM structure_grouped sg
            LEFT JOIN cached_products cp ON UPPER(cp.sku) = UPPER(sg.sku)
            LEFT JOIN fornecedor f ON f.bling_id = sg.fornecedor_id
            LEFT JOIN LATERAL (
                SELECT cs2.fornecedor_bling_id 
                FROM cached_structures cs2 
                WHERE UPPER(cs2.component_sku) = UPPER(sg.sku) AND cs2.fornecedor_bling_id IS NOT NULL 
                LIMIT 1
            ) cs_forn ON true
            LEFT JOIN fornecedor f_alt ON f_alt.bling_id = cs_forn.fornecedor_bling_id
            LEFT JOIN LATERAL (
                SELECT d2.chegando 
                FROM analise_compras_dados d2 
                WHERE (sg.sku IS NOT NULL AND UPPER(d2.sku) = UPPER(sg.sku)) 
                   OR (sg.parent_product_bling_id IS NOT NULL AND d2.parent_product_bling_id = sg.parent_product_bling_id)
                ORDER BY CASE WHEN UPPER(d2.sku) = UPPER(sg.sku) THEN 0 ELSE 1 END
                LIMIT 1
            ) d ON true
            LEFT JOIN analise_compras_vendas v ON UPPER(v.component_sku) = UPPER(sg.sku)
            ORDER BY sg.sku ASC
        `;
        const { rows } = await pool.query(query);

        // Limpa o nome da estrutura representativa para cada produto (ex: 'KIT COM 1 PE')
        let produtos = rows.map(r => {
            const nomeLimpo = limparNomeEstrutura(r.structure_name, r.parent_produto_nome);
            return {
                ...r,
                produto_nome: nomeLimpo,
                structure_name_raw: r.structure_name
            };
        });

        // Se houver um filtro de fornecedor via query string
        const fornecedorIdFiltro = req.query.fornecedorId;
        if (fornecedorIdFiltro) {
            produtos = produtos.filter(p => String(p.fornecedor_id) === String(fornecedorIdFiltro));
        }

        res.json({ success: true, data: produtos });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao listar produtos:', error);
        res.status(500).json({ success: false, message: 'Erro ao listar produtos.' });
    }
};

/**
 * Atualiza o valor de "Chegando" de um produto por SKU ou ID
 */
exports.atualizarChegando = async (req, res) => {
    const { parent_product_bling_id, sku, chegando } = req.body;

    if ((!sku && !parent_product_bling_id) || chegando === undefined) {
        return res.status(400).json({ success: false, message: 'Identificador (SKU ou ID) e valor chegando são obrigatórios.' });
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS analise_compras_dados (
                sku VARCHAR(100),
                parent_product_bling_id BIGINT,
                chegando INTEGER DEFAULT 0
            );
        `);
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'analise_compras_dados' AND column_name = 'sku') THEN
                    ALTER TABLE analise_compras_dados ADD COLUMN sku VARCHAR(100);
                END IF;
            END $$;
        `);

        if (sku) {
            const upd = await pool.query(
                `UPDATE analise_compras_dados SET chegando = $1 WHERE sku = $2 OR (parent_product_bling_id = $3 AND parent_product_bling_id IS NOT NULL)`,
                [chegando, sku, parent_product_bling_id || null]
            );
            if (upd.rowCount === 0) {
                await pool.query(
                    `INSERT INTO analise_compras_dados (sku, parent_product_bling_id, chegando) VALUES ($1, $2, $3)`,
                    [sku, parent_product_bling_id || null, chegando]
                );
            }
        } else {
            const upd = await pool.query(
                `UPDATE analise_compras_dados SET chegando = $1 WHERE parent_product_bling_id = $2`,
                [chegando, parent_product_bling_id]
            );
            if (upd.rowCount === 0) {
                await pool.query(
                    `INSERT INTO analise_compras_dados (parent_product_bling_id, chegando) VALUES ($1, $2)`,
                    [parent_product_bling_id, chegando]
                );
            }
        }

        res.json({ success: true, message: 'Quantidade chegando atualizada com sucesso.' });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao atualizar chegando:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar dados.' });
    }
};

/**
 * Converte número no formato brasileiro ("14,00", "2.370,60") para float JS
 */
function parseBRNumber(value) {
    if (value === null || value === undefined) return 0;
    let str = String(value).trim();
    // Remove aspas se existirem
    str = str.replace(/^"|"$/g, '');
    if (!str || str === '') return 0;
    // Remove pontos de milhar e troca vírgula decimal por ponto
    str = str.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

/**
 * Parseia um CSV delimitado por ponto-e-vírgula (;) com possíveis campos entre aspas.
 * Retorna array de arrays (linhas × colunas).
 */
function parseCSVSemicolon(text) {
    const lines = text.split(/\r?\n/);
    const result = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Split inteligente por ; respeitando aspas
        const cols = [];
        let current = '';
        let inQuotes = false;
        for (let c = 0; c < trimmed.length; c++) {
            const ch = trimmed[c];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ';' && !inQuotes) {
                cols.push(current.replace(/^"|"$/g, '').trim());
                current = '';
            } else {
                current += ch;
            }
        }
        cols.push(current.replace(/^"|"$/g, '').trim());
        result.push(cols);
    }
    return result;
}

/**
 * Faz o processamento dos 4 arquivos Excel/CSV simultaneamente
 */
exports.uploadVendas = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: 'Erro no upload: ' + err.message });
        }

        if (!req.files || req.files.length !== 4) {
            return res.status(400).json({ success: false, message: 'Você deve enviar exatamente 4 arquivos (3, 7, 15 e 30 dias).' });
        }

        let periodos;
        try {
            periodos = JSON.parse(req.body.periodos || '[]');
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Mapeamento de períodos inválido.' });
        }

        if (periodos.length !== 4) {
            return res.status(400).json({ success: false, message: 'Os períodos não foram mapeados corretamente.' });
        }

        const mapDadosVenda = {}; // { 'SKU': { '3': val, '7': val, '15': val, '30': val } }

        try {
            for (let i = 0; i < 4; i++) {
                const file = req.files[i];
                const periodo = periodos[i]; // '3', '7', '15' ou '30'
                const fileName = file.originalname.toLowerCase();

                let data; // array de arrays (linhas × colunas)

                if (fileName.endsWith('.csv')) {
                    // CSV: parsear manualmente com separador ; (padrão BR)
                    const text = file.buffer.toString('utf-8');
                    data = parseCSVSemicolon(text);
                } else {
                    // XLSX/XLS: usar xlsx normalmente
                    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                }

                // Ignorar a linha 0 (cabeçalho). Começamos do j=1.
                // Coluna A (index 0) = component_sku
                // Coluna F (index 5) = Quantidade de Saídas
                for (let j = 1; j < data.length; j++) {
                    const row = data[j];
                    if (!row || row.length === 0) continue;

                    const sku = row[0] ? String(row[0]).trim() : null;
                    const vendas = Math.round(parseBRNumber(row[5]));

                    if (sku) {
                        if (!mapDadosVenda[sku]) {
                            mapDadosVenda[sku] = { '3': 0, '7': 0, '15': 0, '30': 0 };
                        }
                        mapDadosVenda[sku][periodo] += vendas;
                    }
                }
            }

            // Agora salvar no banco de dados
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Limpa tabela inteira e insere os novos dados (sobrescreve os antigos)
                await client.query('TRUNCATE TABLE analise_compras_vendas');

                const skus = Object.keys(mapDadosVenda);
                for (let sku of skus) {
                    const d = mapDadosVenda[sku];
                    await client.query(
                        `INSERT INTO analise_compras_vendas (component_sku, vendas_3d, vendas_7d, vendas_15d, vendas_30d)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [sku, d['3'], d['7'], d['15'], d['30']]
                    );
                }

                await client.query('COMMIT');
                res.json({ success: true, message: `Dados de vendas importados com sucesso. ${skus.length} SKUs processados.` });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('[Análise de Compras] Erro ao processar planilhas:', error);
            res.status(500).json({ success: false, message: 'Erro interno ao processar planilhas.' });
        }
    });
};

// Configuração do multer para upload individual de arquivo de pesos
const uploadPesoSingle = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Limite 10MB
}).single('file');

/**
 * Garante a criação de tabelas necessárias no banco
 */
async function garantirTabelas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS analise_compras_dados (
                sku VARCHAR(100),
                parent_product_bling_id BIGINT,
                chegando INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS analise_compras_pedidos (
                id SERIAL PRIMARY KEY,
                numero_pedido VARCHAR(50),
                nome_fabrica VARCHAR(255) NOT NULL,
                fornecedor_id VARCHAR(100),
                status VARCHAR(50) DEFAULT 'pendente',
                itens JSONB NOT NULL DEFAULT '[]'::jsonb,
                total_itens INTEGER DEFAULT 0,
                total_unidades INTEGER DEFAULT 0,
                observacoes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                finalizado_em TIMESTAMP WITH TIME ZONE
            );

            CREATE TABLE IF NOT EXISTS analise_compras_pesos (
                sku VARCHAR(100) PRIMARY KEY,
                peso NUMERIC(10,3) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_analise_compras_pedidos_status ON analise_compras_pedidos(status);
            CREATE INDEX IF NOT EXISTS idx_analise_compras_pedidos_created_at ON analise_compras_pedidos(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_analise_compras_pesos_sku ON analise_compras_pesos(sku);
        `);
    } catch (err) {
        console.error('[Análise de Compras] Erro ao verificar estrutura de tabelas:', err);
    }
}

/**
 * Recalcula o valor de 'chegando' na tabela analise_compras_dados com base em todos os pedidos PENDENTES
 */
async function sincronizarChegandoProdutos(targetItems = null) {
    try {
        // Busca todos os pedidos pendentes (ativos)
        const { rows: pedidosPendentes } = await pool.query(
            "SELECT itens FROM analise_compras_pedidos WHERE status = 'pendente'"
        );

        // Agrega a quantidade pendente por SKU e por parent_product_bling_id
        const mapQtdPorSku = new Map();
        const mapQtdPorParent = new Map();

        for (const ped of pedidosPendentes) {
            const itens = Array.isArray(ped.itens) ? ped.itens : [];
            for (const it of itens) {
                const qtd = parseInt(it.quantidade, 10) || 0;
                if (qtd > 0) {
                    if (it.sku) {
                        const skuUpper = String(it.sku).trim().toUpperCase();
                        mapQtdPorSku.set(skuUpper, (mapQtdPorSku.get(skuUpper) || 0) + qtd);
                    }
                    if (it.parent_product_bling_id) {
                        const pId = parseInt(it.parent_product_bling_id, 10);
                        mapQtdPorParent.set(pId, (mapQtdPorParent.get(pId) || 0) + qtd);
                    }
                }
            }
        }

        let itemsToProcess = [];
        if (targetItems && Array.isArray(targetItems)) {
            itemsToProcess = targetItems;
        } else {
            const { rows: dadosExistentes } = await pool.query('SELECT sku, parent_product_bling_id FROM analise_compras_dados');
            itemsToProcess = dadosExistentes;
            mapQtdPorSku.forEach((_, sku) => itemsToProcess.push({ sku }));
            mapQtdPorParent.forEach((_, pId) => itemsToProcess.push({ parent_product_bling_id: pId }));
        }

        const processados = new Set();
        for (const it of itemsToProcess) {
            const sku = it.sku ? String(it.sku).trim() : null;
            const parentId = it.parent_product_bling_id ? parseInt(it.parent_product_bling_id, 10) : null;
            const key = `${sku || ''}_${parentId || ''}`;
            if (processados.has(key)) continue;
            processados.add(key);

            let novaQtd = 0;
            if (sku && mapQtdPorSku.has(sku.toUpperCase())) {
                novaQtd = mapQtdPorSku.get(sku.toUpperCase());
            } else if (parentId && mapQtdPorParent.has(parentId)) {
                novaQtd = mapQtdPorParent.get(parentId);
            }

            if (sku) {
                const upd = await pool.query(
                    `UPDATE analise_compras_dados SET chegando = $1, parent_product_bling_id = COALESCE($3, parent_product_bling_id) WHERE UPPER(sku) = UPPER($2)`,
                    [novaQtd, sku, parentId]
                );
                if (upd.rowCount === 0 && novaQtd > 0) {
                    await pool.query(
                        `INSERT INTO analise_compras_dados (sku, parent_product_bling_id, chegando) VALUES ($1, $2, $3)`,
                        [sku, parentId, novaQtd]
                    );
                }
            } else if (parentId) {
                const upd = await pool.query(
                    `UPDATE analise_compras_dados SET chegando = $1 WHERE parent_product_bling_id = $2`,
                    [novaQtd, parentId]
                );
                if (upd.rowCount === 0 && novaQtd > 0) {
                    await pool.query(
                        `INSERT INTO analise_compras_dados (parent_product_bling_id, chegando) VALUES ($1, $2)`,
                        [parentId, novaQtd]
                    );
                }
            }
        }
    } catch (err) {
        console.error('[Análise de Compras] Erro ao sincronizar chegando dos produtos:', err);
    }
}

/**
 * Atualiza o campo Chegando manualmente via tabela
 */
exports.atualizarChegando = async (req, res) => {
    try {
        await garantirTabelas();
        const { sku, parent_product_bling_id, chegando } = req.body;
        const valor = parseInt(chegando, 10) || 0;

        if (sku) {
            const upd = await pool.query(
                `UPDATE analise_compras_dados SET chegando = $1 WHERE UPPER(sku) = UPPER($2)`,
                [valor, sku]
            );
            if (upd.rowCount === 0) {
                await pool.query(
                    `INSERT INTO analise_compras_dados (sku, parent_product_bling_id, chegando) VALUES ($1, $2, $3)`,
                    [sku, parent_product_bling_id || null, valor]
                );
            }
        } else if (parent_product_bling_id) {
            const upd = await pool.query(
                `UPDATE analise_compras_dados SET chegando = $1 WHERE parent_product_bling_id = $2`,
                [valor, parent_product_bling_id]
            );
            if (upd.rowCount === 0) {
                await pool.query(
                    `INSERT INTO analise_compras_dados (parent_product_bling_id, chegando) VALUES ($1, $2)`,
                    [parent_product_bling_id, valor]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao atualizar chegando:', err);
        res.status(500).json({ success: false, message: 'Erro ao salvar campo chegando.' });
    }
};

/**
 * Renderiza a página de Controle de Pedidos
 */
exports.renderPedidosPage = async (req, res) => {
    try {
        await garantirTabelas();
        res.render('analise/pedidos', {
            title: 'Controle de Pedidos de Compra'
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao renderizar página de pedidos:', err);
        res.status(500).send('Erro interno do servidor.');
    }
};

/**
 * Listagem de Pedidos de Compra (API JSON)
 */
exports.listarPedidos = async (req, res) => {
    try {
        await garantirTabelas();
        const statusFiltro = req.query.status || 'todos';

        let query = 'SELECT * FROM analise_compras_pedidos';
        const params = [];

        if (statusFiltro && statusFiltro !== 'todos') {
            query += ' WHERE status = $1';
            params.push(statusFiltro);
        }

        query += ' ORDER BY CASE WHEN status = \'pendente\' THEN 0 ELSE 1 END, created_at DESC';

        const { rows } = await pool.query(query, params);

        const { rows: countRows } = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pendente') as total_pendentes,
                COUNT(*) FILTER (WHERE status = 'finalizado') as total_finalizados,
                COALESCE(SUM(total_unidades) FILTER (WHERE status = 'pendente'), 0) as total_unidades_chegando,
                COUNT(DISTINCT nome_fabrica) FILTER (WHERE status = 'pendente') as total_fabricas_pendentes
            FROM analise_compras_pedidos
        `);

        const stats = countRows[0] || {
            total_pendentes: 0,
            total_finalizados: 0,
            total_unidades_chegando: 0,
            total_fabricas_pendentes: 0
        };

        res.json({
            success: true,
            pedidos: rows,
            stats: stats
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao listar pedidos:', err);
        res.status(500).json({ success: false, message: 'Erro ao buscar pedidos.' });
    }
};

/**
 * Obtém detalhes de um único pedido por ID
 */
exports.obterPedido = async (req, res) => {
    try {
        await garantirTabelas();
        const { id } = req.params;
        const { rows } = await pool.query('SELECT * FROM analise_compras_pedidos WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }
        res.json({ success: true, pedido: rows[0] });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao buscar pedido:', err);
        res.status(500).json({ success: false, message: 'Erro ao buscar dados do pedido.' });
    }
};

/**
 * Geração de Pedido em PDF e salvamento automático em banco de dados
 */
exports.gerarPedidoPDF = async (req, res) => {
    const { nomeFabrica, items, observacoes, fornecedor_id } = req.body;

    if (!nomeFabrica || !items || !items.length) {
        return res.status(400).json({ success: false, message: 'Fábrica/Fornecedor e itens são obrigatórios.' });
    }

    try {
        await garantirTabelas();

        const itensFiltrados = items.filter(it => (parseInt(it.quantidade, 10) || 0) > 0).map(it => ({
            ...it,
            nome: limparNomeEstrutura(it.nome),
            quantidade: parseInt(it.quantidade, 10) || 0
        }));

        if (itensFiltrados.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum item com quantidade positiva para o pedido.' });
        }

        const totalItens = itensFiltrados.length;
        const totalUnidades = itensFiltrados.reduce((sum, it) => sum + it.quantidade, 0);

        const dataAgora = new Date();
        const anoMes = dataAgora.toISOString().slice(2, 7).replace('-', '');
        const { rows: maxRows } = await pool.query('SELECT MAX(id) as max_id FROM analise_compras_pedidos');
        const nextId = (parseInt(maxRows[0]?.max_id, 10) || 0) + 1;
        const numeroPedido = `PED-${anoMes}-${String(nextId).padStart(4, '0')}`;

        const { rows: insertedRows } = await pool.query(
            `INSERT INTO analise_compras_pedidos (numero_pedido, nome_fabrica, fornecedor_id, status, itens, total_itens, total_unidades, observacoes)
             VALUES ($1, $2, $3, 'pendente', $4, $5, $6, $7)
             RETURNING *`,
            [numeroPedido, nomeFabrica, fornecedor_id || null, JSON.stringify(itensFiltrados), totalItens, totalUnidades, observacoes || null]
        );

        // Sincroniza o campo 'chegando' para todos os itens do pedido
        await sincronizarChegandoProdutos(itensFiltrados);

        const pdfBuffer = await comprasPdfService.gerarPedidoPdfBuffer({
            nomeFabrica,
            itens: itensFiltrados
        });

        const safeNomeFabrica = String(nomeFabrica).replace(/[^a-zA-Z0-9]/g, '_');
        const dataStr = dataAgora.toLocaleDateString('pt-BR').replace(/\//g, '-');
        const filename = `Pedido_${safeNomeFabrica}_${dataStr}.pdf`;

        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({
                success: true,
                pedido: insertedRows[0],
                filename: filename
            });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.setHeader('X-Order-Id', String(insertedRows[0]?.id || ''));

        return res.send(pdfBuffer);
    } catch (error) {
        console.error('[Análise de Compras] Erro ao gerar PDF e salvar pedido:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao gerar e salvar o pedido.' });
    }
};

/**
 * Atualização/Edição dos itens de um pedido existente
 */
exports.atualizarPedido = async (req, res) => {
    try {
        await garantirTabelas();
        const { id } = req.params;
        const { items, observacoes, nomeFabrica } = req.body;

        const { rows: pedidoAtual } = await pool.query('SELECT * FROM analise_compras_pedidos WHERE id = $1', [id]);
        if (pedidoAtual.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }

        const itensAntigos = Array.isArray(pedidoAtual[0].itens) ? pedidoAtual[0].itens : [];

        const itensFiltrados = (items || []).filter(it => (parseInt(it.quantidade, 10) || 0) > 0).map(it => ({
            ...it,
            nome: limparNomeEstrutura(it.nome),
            quantidade: parseInt(it.quantidade, 10) || 0
        }));

        const totalItens = itensFiltrados.length;
        const totalUnidades = itensFiltrados.reduce((sum, it) => sum + it.quantidade, 0);

        const { rows: updatedRows } = await pool.query(
            `UPDATE analise_compras_pedidos 
             SET itens = $1, total_itens = $2, total_unidades = $3, observacoes = COALESCE($4, observacoes),
                 nome_fabrica = COALESCE($5, nome_fabrica), updated_at = CURRENT_TIMESTAMP
             WHERE id = $6
             RETURNING *`,
            [JSON.stringify(itensFiltrados), totalItens, totalUnidades, observacoes, nomeFabrica || null, id]
        );

        // Sincroniza chegando para todos os itens antigos e novos
        const todosItensAfetados = [...itensAntigos, ...itensFiltrados];
        await sincronizarChegandoProdutos(todosItensAfetados);

        res.json({
            success: true,
            message: 'Pedido atualizado com sucesso!',
            pedido: updatedRows[0]
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao atualizar pedido:', err);
        res.status(500).json({ success: false, message: 'Erro ao atualizar pedido.' });
    }
};

/**
 * Marca um pedido como finalizado (soft delete visual) e limpa o estoque chegando correspondente
 */
exports.finalizarPedido = async (req, res) => {
    try {
        await garantirTabelas();
        const { id } = req.params;

        const { rows: pedidoAtual } = await pool.query('SELECT * FROM analise_compras_pedidos WHERE id = $1', [id]);
        if (pedidoAtual.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }

        const { rows: updatedRows } = await pool.query(
            `UPDATE analise_compras_pedidos 
             SET status = 'finalizado', finalizado_em = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        const itens = Array.isArray(pedidoAtual[0].itens) ? pedidoAtual[0].itens : [];
        await sincronizarChegandoProdutos(itens);

        res.json({
            success: true,
            message: 'Pedido finalizado com sucesso! As quantidades em chegada foram atualizadas.',
            pedido: updatedRows[0]
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao finalizar pedido:', err);
        res.status(500).json({ success: false, message: 'Erro ao finalizar pedido.' });
    }
};

/**
 * Cancela um pedido de compra
 */
exports.cancelarPedido = async (req, res) => {
    try {
        await garantirTabelas();
        const { id } = req.params;

        const { rows: pedidoAtual } = await pool.query('SELECT * FROM analise_compras_pedidos WHERE id = $1', [id]);
        if (pedidoAtual.length === 0) {
            return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
        }

        const { rows: updatedRows } = await pool.query(
            `UPDATE analise_compras_pedidos 
             SET status = 'cancelado', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        const itens = Array.isArray(pedidoAtual[0].itens) ? pedidoAtual[0].itens : [];
        await sincronizarChegandoProdutos(itens);

        res.json({
            success: true,
            message: 'Pedido cancelado com sucesso!',
            pedido: updatedRows[0]
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao cancelar pedido:', err);
        res.status(500).json({ success: false, message: 'Erro ao cancelar pedido.' });
    }
};

/**
 * Download direto do PDF de um pedido já registrado
 */
exports.baixarPdfPedidoSalvo = async (req, res) => {
    try {
        await garantirTabelas();
        const { id } = req.params;
        const { rows } = await pool.query('SELECT * FROM analise_compras_pedidos WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).send('Pedido não encontrado.');
        }

        const pedido = rows[0];
        const itens = Array.isArray(pedido.itens) ? pedido.itens : [];

        const pdfBuffer = await comprasPdfService.gerarPedidoPdfBuffer({
            nomeFabrica: pedido.nome_fabrica,
            itens: itens
        });

        const safeNomeFabrica = String(pedido.nome_fabrica).replace(/[^a-zA-Z0-9]/g, '_');
        const numPed = pedido.numero_pedido || `Ped_${pedido.id}`;
        const filename = `${numPed}_${safeNomeFabrica}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        return res.send(pdfBuffer);
    } catch (err) {
        console.error('[Análise de Compras] Erro ao gerar PDF de pedido salvo:', err);
        res.status(500).send('Erro ao gerar PDF do pedido.');
    }
};

/**
 * Converte valor de peso inteligente suportando ponto, vírgula, 'kg' e espaços
 * Ex: '0,30', '0.5', '0,3kg', '1.48 KG', 1.25 -> float em KG
 */
function parsePesoKg(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : Math.max(0, val);
    let str = String(val).toLowerCase().trim();
    // Remove sufixos como kg, kgs, quilos, kilos e espaços
    str = str.replace(/kg|kgs|quilos|kilos/g, '').trim();
    // Remove aspas
    str = str.replace(/^"|"$/g, '');
    // Se tiver vírgula, troca por ponto
    str = str.replace(',', '.');
    // Remove caracteres que não sejam dígitos e ponto
    str = str.replace(/[^0-9.]/g, '');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : Math.max(0, num);
}

/**
 * Renderiza a página de Controle de Pesos
 */
exports.renderPesosPage = async (req, res) => {
    try {
        await garantirTabelas();
        res.render('analise/pesos', {
            title: 'Controle de Pesos dos Produtos'
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao renderizar página de pesos:', err);
        res.status(500).send('Erro interno do servidor.');
    }
};

/**
 * Listagem de Pesos Cadastrados (API JSON)
 */
exports.listarPesos = async (req, res) => {
    try {
        await garantirTabelas();
        const { rows } = await pool.query('SELECT sku, peso, updated_at FROM analise_compras_pesos ORDER BY sku ASC');
        
        let somaPesos = 0;
        rows.forEach(r => {
            somaPesos += parseFloat(r.peso) || 0;
        });

        const totalSkus = rows.length;
        const pesoMedio = totalSkus > 0 ? (somaPesos / totalSkus) : 0;

        res.json({
            success: true,
            data: rows,
            stats: {
                total_skus: totalSkus,
                peso_medio: pesoMedio
            }
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao listar pesos:', err);
        res.status(500).json({ success: false, message: 'Erro ao buscar pesos cadastrados.' });
    }
};

/**
 * Upload de Planilha Excel/CSV de Pesos (Coluna A = SKU, Coluna B = Peso)
 * Limpa a tabela anterior e insere os novos dados.
 */
exports.uploadPesos = (req, res) => {
    uploadPesoSingle(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ success: false, message: 'Erro no upload: ' + err.message });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
        }

        try {
            await garantirTabelas();
            const file = req.file;
            const fileName = file.originalname.toLowerCase();

            let data; // Array de arrays
            if (fileName.endsWith('.csv')) {
                const text = file.buffer.toString('utf-8');
                data = parseCSVSemicolon(text);
                if (data.length === 0 || (data.length > 0 && data[0].length === 1 && text.includes(','))) {
                    // Fallback para CSV com vírgula se não usar ponto e vírgula
                    data = text.split(/\r?\n/).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim())).filter(l => l.some(Boolean));
                }
            } else {
                const workbook = xlsx.read(file.buffer, { type: 'buffer' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
            }

            if (!data || data.length === 0) {
                return res.status(400).json({ success: false, message: 'O arquivo está vazio.' });
            }

            // Mapa para armazenar { SKU_UPPERCASE: peso } sem duplicatas
            const mapPesos = new Map();

            // Identifica se a primeira linha é cabeçalho
            let startIdx = 0;
            const firstRowCol0 = String(data[0][0] || '').toLowerCase().trim();
            const firstRowCol1 = String(data[0][1] || '').toLowerCase().trim();
            if (firstRowCol0.includes('sku') || firstRowCol0.includes('codigo') || firstRowCol0.includes('produto') || firstRowCol1.includes('peso')) {
                startIdx = 1;
            }

            for (let i = startIdx; i < data.length; i++) {
                const row = data[i];
                if (!row || row.length === 0) continue;

                const skuRaw = row[0];
                const pesoRaw = row[1];

                if (!skuRaw) continue;

                const sku = String(skuRaw).trim().toUpperCase();
                if (!sku || sku === 'SKU' || sku === 'CÓDIGO' || sku === 'CODIGO') continue;

                const peso = parsePesoKg(pesoRaw);
                mapPesos.set(sku, peso);
            }

            const skusProcessados = Array.from(mapPesos.entries());

            if (skusProcessados.length === 0) {
                return res.status(400).json({ success: false, message: 'Nenhum SKU válido encontrado na planilha.' });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Sempre limpa os dados anteriores antes de inserir a nova planilha
                await client.query('TRUNCATE TABLE analise_compras_pesos');

                for (const [sku, peso] of skusProcessados) {
                    await client.query(
                        `INSERT INTO analise_compras_pesos (sku, peso, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
                        [sku, peso]
                    );
                }

                await client.query('COMMIT');

                res.json({
                    success: true,
                    message: `${skusProcessados.length} SKUs e pesos importados com sucesso!`,
                    total: skusProcessados.length
                });
            } catch (dbErr) {
                await client.query('ROLLBACK');
                throw dbErr;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('[Análise de Compras] Erro no upload de pesos:', error);
            res.status(500).json({ success: false, message: 'Erro ao processar planilha de pesos: ' + error.message });
        }
    });
};

/**
 * Salva ou atualiza um único SKU e seu peso manualmente
 */
exports.salvarPesoIndividual = async (req, res) => {
    try {
        await garantirTabelas();
        const { sku, peso } = req.body;

        if (!sku) {
            return res.status(400).json({ success: false, message: 'SKU é obrigatório.' });
        }

        const skuUpper = String(sku).trim().toUpperCase();
        const pesoValor = parsePesoKg(peso);

        const { rows } = await pool.query(
            `INSERT INTO analise_compras_pesos (sku, peso, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (sku)
             DO UPDATE SET peso = EXCLUDED.peso, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [skuUpper, pesoValor]
        );

        res.json({
            success: true,
            message: `Peso do SKU ${skuUpper} salvo com sucesso!`,
            data: rows[0]
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao salvar peso:', err);
        res.status(500).json({ success: false, message: 'Erro ao salvar peso do produto.' });
    }
};

/**
 * Exclui um SKU da tabela de pesos
 */
exports.excluirPeso = async (req, res) => {
    try {
        await garantirTabelas();
        const { sku } = req.params;

        if (!sku) {
            return res.status(400).json({ success: false, message: 'SKU é obrigatório.' });
        }

        const skuUpper = String(sku).trim().toUpperCase();
        const result = await pool.query('DELETE FROM analise_compras_pesos WHERE UPPER(sku) = UPPER($1)', [skuUpper]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'SKU não encontrado.' });
        }

        res.json({
            success: true,
            message: `SKU ${skuUpper} removido com sucesso!`
        });
    } catch (err) {
        console.error('[Análise de Compras] Erro ao excluir peso:', err);
        res.status(500).json({ success: false, message: 'Erro ao excluir peso.' });
    }
};

/**
 * Salva alterações em lote na tabela de pesos
 */
exports.salvarLotePesos = async (req, res) => {
    try {
        await garantirTabelas();
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Nenhum item fornecido para salvar.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const item of items) {
                if (!item.sku) continue;
                const skuUpper = String(item.sku).trim().toUpperCase();
                const pesoValor = parsePesoKg(item.peso);

                await client.query(
                    `INSERT INTO analise_compras_pesos (sku, peso, updated_at)
                     VALUES ($1, $2, CURRENT_TIMESTAMP)
                     ON CONFLICT (sku)
                     DO UPDATE SET peso = EXCLUDED.peso, updated_at = CURRENT_TIMESTAMP`,
                    [skuUpper, pesoValor]
                );
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Alterações salvas com sucesso!' });
        } catch (dbErr) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('[Análise de Compras] Erro ao salvar lote de pesos:', err);
        res.status(500).json({ success: false, message: 'Erro ao salvar alterações.' });
    }
};

/**
 * Geração de Romaneio de Carga / Coleta em PDF a partir de múltiplos pedidos selecionados
 */
exports.gerarRomaneioPDF = async (req, res) => {
    try {
        await garantirTabelas();
        const { pedidosIds } = req.body;

        if (!Array.isArray(pedidosIds) || pedidosIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Selecione pelo menos um pedido para gerar o romaneio.' });
        }

        const idsNumericos = pedidosIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
        if (idsNumericos.length === 0) {
            return res.status(400).json({ success: false, message: 'IDs de pedidos inválidos.' });
        }

        const { rows: pedidos } = await pool.query(
            `SELECT * FROM analise_compras_pedidos WHERE id = ANY($1::int[]) ORDER BY nome_fabrica ASC, created_at DESC`,
            [idsNumericos]
        );

        if (pedidos.length === 0) {
            return res.status(404).json({ success: false, message: 'Nenhum pedido encontrado com os IDs fornecidos.' });
        }

        // Consolidação dos itens por SKU
        // Mapa: SKU_UPPERCASE -> { sku, nome, quantidade, fabricas: Set }
        const mapItensConsolidados = new Map();

        for (const ped of pedidos) {
            const itens = Array.isArray(ped.itens) ? ped.itens : [];
            for (const it of itens) {
                const qtd = parseInt(it.quantidade, 10) || 0;
                if (qtd <= 0) continue;

                const sku = it.sku ? String(it.sku).trim().toUpperCase() : 'SEM_SKU';
                const key = sku;

                if (!mapItensConsolidados.has(key)) {
                    mapItensConsolidados.set(key, {
                        sku: it.sku ? String(it.sku).trim() : '-',
                        nome: limparNomeEstrutura(it.nome),
                        quantidade: qtd,
                        fabricas: new Set(ped.nome_fabrica ? [ped.nome_fabrica] : [])
                    });
                } else {
                    const existente = mapItensConsolidados.get(key);
                    existente.quantidade += qtd;
                    if (ped.nome_fabrica) existente.fabricas.add(ped.nome_fabrica);
                    // Mantém nome mais completo se o atual for genérico
                    if (it.nome && it.nome.length > existente.nome.length) {
                        existente.nome = limparNomeEstrutura(it.nome);
                    }
                }
            }
        }

        const skusList = Array.from(mapItensConsolidados.keys()).filter(k => k !== 'SEM_SKU');
        
        // Busca os pesos cadastrados para esses SKUs
        const pesoMap = new Map();
        if (skusList.length > 0) {
            const { rows: pesosRows } = await pool.query(
                `SELECT sku, peso FROM analise_compras_pesos WHERE UPPER(sku) = ANY($1::text[])`,
                [skusList]
            );
            pesosRows.forEach(pr => {
                pesoMap.set(String(pr.sku).trim().toUpperCase(), parseFloat(pr.peso) || 0);
            });
        }

        // Monta a lista consolidada final com cálculos de peso
        let totalPesoKg = 0;
        let totalPecas = 0;

        const itensConsolidados = Array.from(mapItensConsolidados.values()).map(it => {
            const skuUpper = String(it.sku).trim().toUpperCase();
            const pesoUnit = pesoMap.get(skuUpper) || 0;
            const pesoTot = pesoUnit * it.quantidade;

            totalPesoKg += pesoTot;
            totalPecas += it.quantidade;

            return {
                sku: it.sku,
                nome: it.nome,
                quantidade: it.quantidade,
                fabricas: Array.from(it.fabricas).join(', '),
                peso_unitario: pesoUnit,
                peso_total: pesoTot
            };
        }).sort((a, b) => a.sku.localeCompare(b.sku));

        const totais = {
            totalPedidos: pedidos.length,
            totalItens: itensConsolidados.length,
            totalUnidades: totalPecas,
            pesoTotalKg: totalPesoKg
        };

        const dataAgora = new Date();
        const anoMesDia = dataAgora.toISOString().slice(2, 10).replace(/-/g, '');
        const numeroRomaneio = `ROM-${anoMesDia}-${String(Math.floor(1000 + Math.random() * 9000))}`;

        const pdfBuffer = await comprasPdfService.gerarRomaneioPdfBuffer({
            pedidos,
            itensConsolidados,
            totais,
            numeroRomaneio
        });

        const filename = `Romaneio_Carga_${numeroRomaneio}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        return res.send(pdfBuffer);
    } catch (error) {
        console.error('[Análise de Compras] Erro ao gerar PDF de romaneio:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar PDF do romaneio: ' + error.message });
    }
};

