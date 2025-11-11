// ✍️ Site_Inova/controllers/acompanhamento/pedidosController.js (VERSÃO ATUALIZADA)

const { Pool } = require('pg');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

// --- Conexão Segura com o NOVO Banco 'inovaacompanhamento' ---
const poolAcompanhamento = new Pool({
    user: process.env.DB_ACOMP_USER,
    host: process.env.DB_ACOMP_HOST,
    database: process.env.DB_ACOMP_DATABASE,
    password: process.env.DB_ACOMP_PASSWORD,
    port: process.env.DB_ACOMP_PORT,
});

// --- Conexão com o Banco ANTIGO 'inovamonitoramento' ---
const poolMonitoramento = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});


// --- FUNÇÕES HELPER ---

function parsePtBrDate(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;

    const monthMap = {
        'janeiro': 0, 'fevereiro': 1, 'março': 2, 'abril': 3, 'maio': 4, 'junho': 5,
        'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
    };

    // Remove " de " e " hs." para facilitar o processamento
    const parts = dateString.replace(/ de /g, ' ').replace(' hs.', '').split(' ');
    // Ex: ["9", "julho", "2025", "23:12"]

    if (parts.length < 4) return null;

    const day = parseInt(parts[0], 10);
    const month = monthMap[parts[1].toLowerCase()];
    const year = parseInt(parts[2], 10);
    const timeParts = parts[3].split(':');
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    if (isNaN(day) || month === undefined || isNaN(year) || isNaN(hours) || isNaN(minutes)) {
        return null;
    }

    return new Date(year, month, day, hours, minutes);
}

function cleanCurrency(currencyValue) {
    if (currencyValue === null || currencyValue === undefined) return null;
    if (typeof currencyValue === 'number') return currencyValue;

    let s = String(currencyValue).trim().replace(/R\$\s*/, '');

    // Verifica se a vírgula é usada como separador decimal (formato brasileiro)
    // Ex: "1.249,90" -> remove o ponto, troca a vírgula por ponto -> "1249.90"
    if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    // Caso contrário, considera que o ponto é o separador decimal (se houver)
    // Ex: "1.249" -> se não houver decimal, o ponto é de milhar e deve ser removido
    else if (s.includes('.') && s.includes(',')) { // 1,249.90
         s = s.replace(/,/g, '');
    }


    const number = parseFloat(s);
    return isNaN(number) ? null : number;
}

function excelSerialDateToJSDate(serial) {
    if (typeof serial !== 'number' || isNaN(serial)) return null;
    const ms = (serial - 25569) * 86400 * 1000;
    const dateObj = new Date(ms);
    if (dateObj instanceof Date && !isNaN(dateObj)) {
        // Formata para YYYY-MM-DD, garantindo que o fuso horário não interfira
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return null;
}

function parseDateString(dateString) {
    if (!dateString || typeof dateString !== 'string') return null;
    const match = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;

    const day = String(match[1]).padStart(2, '0');
    const month = String(match[2]).padStart(2, '0');
    const year = match[3];

    // Monta a string no formato universal AAAA-MM-DD
    return `${year}-${month}-${day}`;
}


/**
 * Função principal que busca dados faltantes no banco 'inovamonitoramento'.
 * @param {object} pedido - O objeto do pedido com dados parciais da planilha.
 * @returns {object} O objeto do pedido enriquecido com dados do banco.
 */
async function enriquecerDadosDoPedido(pedido) {
    // Busca o pedido de venda para obter o notafiscal_id
    const pedidoResult = await poolMonitoramento.query(
        'SELECT notafiscal_id FROM cached_pedido_venda WHERE numero_loja = $1',
        [pedido.numero_pedido]
    );

    if (pedidoResult.rows.length === 0) {
        return pedido; // Retorna o pedido como está se não encontrar correspondência
    }
    const { notafiscal_id } = pedidoResult.rows[0];

    // Busca a nota fiscal usando o notafiscal_id
    const nfeResult = await poolMonitoramento.query(
        'SELECT nfe_numero, etiqueta_uf, product_ids_list FROM cached_nfe WHERE bling_id = $1',
        [notafiscal_id]
    );

    if (nfeResult.rows.length > 0) {
        const nfe = nfeResult.rows[0];
        pedido.numero_nfe = nfe.nfe_numero;
        pedido.estado_uf = nfe.etiqueta_uf;

        // Busca o custo dos produtos
        if (nfe.product_ids_list) {
            const productIds = nfe.product_ids_list.split(';').map(id => parseInt(id.trim())).filter(Number.isFinite);
            const productResult = await poolMonitoramento.query(
                'SELECT SUM(preco_custo) as total_custo FROM cached_products WHERE bling_id = ANY($1::bigint[])',
                [productIds]
            );
            if (productResult.rows.length > 0) {
                pedido.custo_produto = productResult.rows[0].total_custo || 0;
            }
        }
    }
    
    return pedido;
}

async function preencherDadosFaltantes(pedido) {
    if (!pedido || !pedido.numero_pedido) return pedido;

    // Busca o pedido de venda para obter o notafiscal_id e outras informações
    const pedidoResult = await poolMonitoramento.query(
        'SELECT notafiscal_id, transporte_frete, desconto_valor, taxa_comissao FROM cached_pedido_venda WHERE numero_loja = $1',
        [pedido.numero_pedido]
    );

    if (pedidoResult.rows.length === 0) return pedido;

    const pedidoCache = pedidoResult.rows[0];

    // Preenche informações do pedido de venda se estiverem faltando
    if (!pedido.valor_frete && pedido.valor_frete !== 0) pedido.valor_frete = pedidoCache.transporte_frete;
    if (!pedido.desconto_produto && pedido.desconto_produto !== 0) pedido.desconto_produto = pedidoCache.desconto_valor;
    if (!pedido.comissao && pedido.comissao !== 0) pedido.comissao = pedidoCache.taxa_comissao;

    if (!pedidoCache.notafiscal_id) return pedido;

    // Busca a nota fiscal usando o notafiscal_id do pedido
    const nfeResult = await poolMonitoramento.query(
        'SELECT nfe_numero, etiqueta_uf, etiqueta_nome, product_ids_list, product_descriptions_list FROM cached_nfe WHERE bling_id = $1',
        [pedidoCache.notafiscal_id]
    );

    if (nfeResult.rows.length === 0) return pedido;

    const nfeCache = nfeResult.rows[0];

    // Preenche informações da nota fiscal se estiverem faltando
    if (!pedido.numero_nfe) pedido.numero_nfe = nfeCache.nfe_numero;
    if (!pedido.estado_uf) pedido.estado_uf = nfeCache.etiqueta_uf;
    if (!pedido.nome_cliente) pedido.nome_cliente = nfeCache.etiqueta_nome;

    if (!pedido.nome_produto && nfeCache.product_descriptions_list) {
        pedido.nome_produto = nfeCache.product_descriptions_list.split(';')[0];
    }

    if ((!pedido.custo_produto && pedido.custo_produto !== 0) && nfeCache.product_ids_list) {
        const productIds = nfeCache.product_ids_list.split(';').map(id => parseInt(id.trim())).filter(Number.isFinite);
        if (productIds.length > 0) {
            const productResult = await poolMonitoramento.query(
                'SELECT SUM(preco_custo) as total_custo, MIN(sku) as primeiro_sku FROM cached_products WHERE bling_id = ANY($1::bigint[])',
                [productIds]
            );
            if (productResult.rows.length > 0) {
                pedido.custo_produto = productResult.rows[0].total_custo || 0;
                if (!pedido.sku_loja) pedido.sku_loja = productResult.rows[0].primeiro_sku;
            }
        }
    }

    return pedido;
}


/**
 * Parser específico para o relatório do Magazine Luiza.
 * @param {Buffer} buffer - O buffer do arquivo da planilha.
 * @returns {Promise<Array>} Uma lista de objetos de pedido.
 */
async function parseRelatorioMagalu(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 1, cellDates: true }); // Pula a linha 1 (cabeçalho)

    const pedidosProcessados = [];
    for (const row of data) {
        if (!row || !row[1]) continue;
        const dataAprovacaoRaw = row[0];
        const dataAprovacao = typeof dataAprovacaoRaw === 'number' ? excelSerialDateToJSDate(dataAprovacaoRaw) : parseDateString(dataAprovacaoRaw);

        let pedido = {
            data_aprovacao: dataAprovacao, // Coluna A
            numero_pedido: row[1], // Coluna B
            valor_produto: cleanCurrency(row[5]), // Coluna F
            desconto_produto: cleanCurrency(row[6]), // Coluna G
            valor_frete: cleanCurrency(row[7]),  // Coluna H
            forma_pagamento: row[9], // Coluna J
            nome_cliente: row[24], // Coluna Y
            documento: row[25], // Coluna Z
            plataforma: 'Magazine Luiza'
        };

        // Enriquecer com dados do banco de dados
        pedido = await enriquecerDadosDoPedido(pedido);
        pedidosProcessados.push(pedido);
    }
    return pedidosProcessados;
}

async function parseRelatorioViaVarejo(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 5 });

    const pedidosProcessados = [];
    for (const row of data) {
        const statusPedido = row[2] ? String(row[2]).trim() : '';
        console.log(statusPedido);
        console.log(statusPedido === 'Enviado');
        if (statusPedido === 'Pagamento aprovado' || statusPedido === 'Enviado') {
            
            const dataAprovacaoRaw = row[4]; // Coluna E

            const dataAprovacao = typeof dataAprovacaoRaw === 'number' ? excelSerialDateToJSDate(dataAprovacaoRaw) : parseDateString(dataAprovacaoRaw);

            let pedido = {
                numero_pedido: row[0],
                data_aprovacao: dataAprovacao, // Usa a data corrigida
                nome_produto: row[6],
                sku_loja: row[7],
                forma_pagamento: row[9],
                valor_produto: cleanCurrency(row[10]),
                valor_frete: cleanCurrency(row[11]),
                nome_cliente: row[13],
                documento: row[14],
                plataforma: 'Via Varejo'
            };

            console.log(JSON.stringify(pedido, null, 2));

            pedido = await preencherDadosFaltantes(pedido);
            pedidosProcessados.push(pedido);
        }
    }
    return pedidosProcessados;
}


async function parseRelatorioMadeira(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Começa a ler a partir da linha 2 (índice 1)
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 1 });

    const pedidosProcessados = [];
    for (const row of data) {
        if (!row || !row[2]) continue;
        const dataAprovacaoRaw = row[8]; // Coluna I
        const dataAprovacao = typeof dataAprovacaoRaw === 'number' ? excelSerialDateToJSDate(dataAprovacaoRaw) : parseDateString(dataAprovacaoRaw);

        let pedido = {
            numero_pedido: row[2],      // Coluna C
            documento: row[4],          // Coluna E
            nome_cliente: row[5],       // Coluna F
            data_aprovacao: dataAprovacao,
            valor_produto: cleanCurrency(row[12]), // Coluna M
            comissao: cleanCurrency(row[13]),     // Coluna N
            forma_pagamento: row[14],   // Coluna O
            sku_loja: row[20],          // Coluna U
            nome_produto: row[21],      // Coluna V
            plataforma: 'Madeira Madeira'
        };

        pedido = await enriquecerDadosDoPedido(pedido);
        pedidosProcessados.push(pedido);
    }
    return pedidosProcessados;
}

async function parseRelatorioMercadoLivre(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 6 });

    const pedidosProcessados = [];
    for (const row of data) {
        if (!row[0]) continue;

        let dataAprovacao = null;
        const dataAprovacaoRaw = row[1];
        if (dataAprovacaoRaw) {
            let d;
            if (typeof dataAprovacaoRaw === 'number') {
                d = excelSerialDateToJSDate(dataAprovacaoRaw);
            } else if (typeof dataAprovacaoRaw === 'string') {
                // Tenta primeiro o parser de data por extenso
                d = parsePtBrDate(dataAprovacaoRaw);
                // Se falhar, tenta o construtor padrão como fallback
                if (!d) d = new Date(dataAprovacaoRaw);
            } else {
                d = new Date(dataAprovacaoRaw);
            }
            
            if (d instanceof Date && !isNaN(d)) {
                dataAprovacao = d;
            }
        }

        

        let pedido = {
            numero_pedido: row[0],
            data_aprovacao: dataAprovacao,
            valor_produto: cleanCurrency(row[7]),
            comissao: cleanCurrency(row[10]),
            valor_frete: cleanCurrency(row[11]),
            sku_loja: row[17],
            nome_produto: row[20],
            nome_cliente: row[30],
            documento: row[32],
            plataforma: 'Mercado Livre'
        };

        pedido = await preencherDadosFaltantes(pedido);
        pedidosProcessados.push(pedido);
    }
    return pedidosProcessados;
}

async function parseRelatorioAmazon(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // Começa a ler a partir da linha 2 (índice 1)
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 1 });

    const pedidosProcessados = [];
    for (const row of data) {
        const statusPedido = row[4] ? String(row[4]).trim() : ''; // Coluna E

        // Filtra apenas pelos status desejados
        if (statusPedido === 'Shipped') {
            const dataAprovacaoRaw = row[2]; // Coluna C
            let dataAprovacao = null;
            if (dataAprovacaoRaw) {
                let d = typeof dataAprovacaoRaw === 'number'
                    ? excelSerialDateToJSDate(dataAprovacaoRaw)
                    : new Date(dataAprovacaoRaw);
                if (d instanceof Date && !isNaN(d)) dataAprovacao = d;
            }

            let pedido = {
                numero_pedido: row[0],         // Coluna A
                data_aprovacao: dataAprovacao,
                nome_produto: row[10],         // Coluna K
                sku_loja: row[11],             // Coluna L
                valor_produto: cleanCurrency(row[16]), // Coluna Q
                valor_frete: cleanCurrency(row[18]),   // Coluna S
                forma_pagamento: row[29],      // Coluna AD
                documento: row[30],            // Coluna AE
                plataforma: 'Amazon'
            };

            pedido = await enriquecerDadosDoPedido(pedido);
            pedidosProcessados.push(pedido);
        }
    }
    return pedidosProcessados;
}

async function parseRelatorioAmericanas(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 1 });

    const pedidosProcessados = [];
    for (const row of data) {
        if (!row[10]) continue;

        // --- CORREÇÃO APLICADA AQUI ---
        let dataAprovacao = null;
        const dataAprovacaoRaw = row[13]; // Coluna N

        if (dataAprovacaoRaw) {
            let d;
            if (typeof dataAprovacaoRaw === 'number') {
                d = excelSerialDateToJSDate(dataAprovacaoRaw);
            } 
            // Se for uma string, tenta analisar como DD/MM/YYYY
            else if (typeof dataAprovacaoRaw === 'string' && dataAprovacaoRaw.includes('/')) {
                const parts = dataAprovacaoRaw.split(/[\/\s:]/); // Divide por /, espaço ou :
                // parts[0] = Dia, parts[1] = Mês, parts[2] = Ano
                if (parts.length >= 3) {
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10) - 1; // Mês em JS é 0-indexed
                    const year = parseInt(parts[2], 10);
                    d = new Date(year, month, day);
                }
            } else {
                // Fallback para outros formatos
                d = new Date(dataAprovacaoRaw);
            }

            if (d instanceof Date && !isNaN(d)) {
                dataAprovacao = d;
            }
        }

        const numeroPedidoOriginal = row[10];
        const numeroPedidoFormatado = `Lojas_Americanas-${numeroPedidoOriginal}`;

        let pedido = {
            numero_pedido: numeroPedidoFormatado,
            data_aprovacao: dataAprovacao, // Usa a data corrigida
            desconto_produto: cleanCurrency(row[30]),
            valor_frete: cleanCurrency(row[32]),
            valor_produto: cleanCurrency(row[33]),
            forma_pagamento: row[35],
            nome_cliente: row[38],
            documento: row[40],
            sku_loja: row[66],
            nome_produto: row[67],
            plataforma: 'Americanas'
        };

        pedido = await preencherDadosFaltantes(pedido);
        pedidosProcessados.push(pedido);
    }
    return pedidosProcessados;
}

exports.getPedidosApi = async (req, res) => {
    try {
        const { draw, start, length, search, order, columns, startDate, endDate, plataforma } = req.query;

        const limit = parseInt(length, 10) || 10;
        const offset = parseInt(start, 10) || 0;
        const searchValue = search.value || '';
        const orderColumnIndex = order?.[0]?.column;
        const orderDirection = order?.[0]?.dir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const orderColumnName = columns?.[orderColumnIndex]?.data;

        const allowedSortColumns = [
            'data_aprovacao', 'plataforma', 'numero_pedido', 'numero_nfe', 'nome_cliente',
            'estado_uf', 'sku_loja', 'valor_produto', 'valor_frete', 'desconto_produto',
            'custo_produto', 'comissao', 'comissao_percentual'
        ];
        const safeSortBy = allowedSortColumns.includes(orderColumnName) ? `"${orderColumnName}"` : '"data_aprovacao"';
        const orderClause = `ORDER BY ${safeSortBy} ${orderDirection} NULLS LAST`;

        let baseQuery = 'FROM acompanhamentos_consolidados';
        let queryConditions = ' WHERE 1=1';
        const queryParams = [];

        if (plataforma) {
            queryParams.push(plataforma);
            queryConditions += ` AND plataforma = $${queryParams.length}`;
        }
        if (startDate) {
            queryParams.push(startDate);
            queryConditions += ` AND data_aprovacao >= $${queryParams.length}`;
        }
        if (endDate) {
            queryParams.push(endDate);
            queryConditions += ` AND data_aprovacao <= $${queryParams.length}`;
        }
        if (searchValue) {
            queryParams.push(`%${searchValue}%`);
            const searchIndex = queryParams.length;
            queryConditions += ` AND (
                numero_pedido ILIKE $${searchIndex} OR
                nome_cliente ILIKE $${searchIndex} OR
                sku_loja ILIKE $${searchIndex} OR
                CAST(numero_nfe AS TEXT) ILIKE $${searchIndex}
            )`;
        }

        const dataQuery = `SELECT * ${baseQuery} ${queryConditions} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
        const countFilteredQuery = `SELECT COUNT(id) ${baseQuery} ${queryConditions}`;
        const totalQuery = `SELECT COUNT(id) ${baseQuery}`;

        const [pedidosResult, filteredResult, totalResult] = await Promise.all([
            poolAcompanhamento.query(dataQuery, queryParams),
            poolAcompanhamento.query(countFilteredQuery, queryParams),
            poolAcompanhamento.query(totalQuery)
        ]);

        const recordsFiltered = parseInt(filteredResult.rows[0].count, 10);
        const recordsTotal = parseInt(totalResult.rows[0].count, 10);

        // [NOVO] Cálculo inverso da comissão percentual
        const pedidosComPercentual = pedidosResult.rows.map(pedido => {
            if (pedido.comissao > 0 && (!pedido.comissao_percentual || pedido.comissao_percentual === 0)) {
                const baseCalculo = (Number(pedido.valor_produto || 0) + Number(pedido.valor_frete_pago || 0)) - Number(pedido.desconto_produto || 0);
                if (baseCalculo > 0) {
                    pedido.comissao_percentual = (pedido.comissao / baseCalculo) * 100;
                }
            }
            return pedido;
        });

        res.status(200).json({
            draw: parseInt(draw, 10),
            recordsTotal: recordsTotal,
            recordsFiltered: recordsFiltered,
            data: pedidosComPercentual
        });

    } catch (error) {
        console.error("Erro na API ao buscar pedidos para DataTables:", error);
        res.status(500).json({ draw: parseInt(req.query.draw, 10) || 0, recordsTotal: 0, recordsFiltered: 0, data: [], error: "Erro ao buscar dados." });
    }
};

exports.bulkUpdateComissao = async (req, res) => {
    const { pedidoIds, comissaoPercentual } = req.body;

    if (!pedidoIds || pedidoIds.length === 0 || comissaoPercentual === undefined) {
        return res.status(400).json({ message: 'Dados inválidos fornecidos.' });
    }

    const percentual = parseFloat(comissaoPercentual);
    if (isNaN(percentual) || percentual < 0 || percentual > 100) {
        return res.status(400).json({ message: 'Percentagem de comissão inválida.' });
    }

    const client = await poolAcompanhamento.connect();
    try {
        await client.query('BEGIN');
        
        const query = `
            UPDATE acompanhamentos_consolidados
            SET 
                comissao_percentual = $1,
                comissao = ((COALESCE(valor_produto, 0) + COALESCE(valor_frete, 0)) - COALESCE(desconto_produto, 0)) * ($1 / 100.0)
            WHERE id = ANY($2::int[]);
        `;
        
        const result = await client.query(query, [percentual, pedidoIds]);
        
        await client.query('COMMIT');
        
        res.status(200).json({ 
            message: `${result.rowCount} pedido(s) atualizado(s) com sucesso para ${percentual}% de comissão.` 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro na atualização em massa da comissão:', error);
        res.status(500).json({ message: 'Erro interno ao atualizar a comissão.' });
    } finally {
        client.release();
    }
};

exports.exibirPaginaUpload = (req, res) => {
    res.render('acompanhamentos/upload-reports', {
        title: 'Upload de Relatórios de Pedidos'
    });
};

exports.exibirPaginaPedidos = async (req, res) => {
    try {
        // A busca por plataformas continua, pois precisamos popular o <select> do filtro.
        const plataformasResult = await poolAcompanhamento.query('SELECT DISTINCT plataforma FROM acompanhamentos_consolidados WHERE plataforma IS NOT NULL ORDER BY plataforma ASC');

        // [MUDANÇA CRÍTICA]
        // Não buscamos mais TODOS os pedidos aqui.
        // A tabela será carregada dinamicamente via API.
        res.render('acompanhamentos/index', {
            title: 'Acompanhamento de Pedidos',
            plataformas: plataformasResult.rows,
            pedidos: [], // Passamos um array vazio para o template.
            layout: 'main'
        });

    } catch (error) {
        console.error("Erro ao carregar página de acompanhamento:", error);
        req.flash('error', 'Não foi possível carregar a página de acompanhamento.');
        res.redirect('/');
    }
};



exports.processarPlanilhas = async (req, res) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        req.flash('error', 'Nenhum arquivo foi enviado.');
        return res.redirect('/acompanhamento/pedidos');
    }

    const client = await poolAcompanhamento.connect();
    let totalPedidosProcessados = 0;
    let erros = [];

    try {
        await client.query('BEGIN');

        const parsers = {
            'relatorioMagalu': parseRelatorioMagalu, 'relatorioViaVarejo': parseRelatorioViaVarejo,
            'relatorioMadeira': parseRelatorioMadeira, 'relatorioMercadoLivre': parseRelatorioMercadoLivre,
            'relatorioAmazon': parseRelatorioAmazon, 'relatorioAmericanas': parseRelatorioAmericanas
        };

        for (const fieldName in req.files) {
            if (parsers[fieldName]) {
                const file = req.files[fieldName][0];
                try {
                    const pedidos = await parsers[fieldName](file.buffer);
                    
                    for (let pedido of pedidos) {
                        // CHAMA A FUNÇÃO DE ENRIQUECIMENTO FINAL
                        pedido = await preencherDadosFaltantes(pedido);
                        console.log(`Pedido enriquecido: ${JSON.stringify(pedido, null, 2)}`);
                        if (typeof pedido.comissao === 'number') {
                            pedido.comissao = Math.abs(pedido.comissao);
                        }

                        console.log(pedido.numero_nfe);

                        console.log(pedido.estado_uf);

                        const insertQuery = `
                            INSERT INTO acompanhamentos_consolidados (
                                numero_pedido, data_aprovacao, nome_produto, sku_loja, forma_pagamento, 
                                valor_produto, valor_frete, desconto_produto, nome_cliente, documento, 
                                estado_uf, numero_nfe, comissao, custo_produto, valor_frete_pago, plataforma
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                            ON CONFLICT (numero_pedido, sku_loja) DO UPDATE SET
                            data_aprovacao = EXCLUDED.data_aprovacao,
                            nome_produto = EXCLUDED.nome_produto,
                            forma_pagamento = EXCLUDED.forma_pagamento,
                            valor_produto = EXCLUDED.valor_produto,
                            valor_frete = EXCLUDED.valor_frete,
                            desconto_produto = EXCLUDED.desconto_produto,
                            nome_cliente = EXCLUDED.nome_cliente,
                            documento = EXCLUDED.documento,
                            estado_uf = EXCLUDED.estado_uf,
                            numero_nfe = EXCLUDED.numero_nfe,
                            comissao = EXCLUDED.comissao,
                            custo_produto = EXCLUDED.custo_produto,
                            valor_frete_pago = EXCLUDED.valor_frete_pago,
                            plataforma = EXCLUDED.plataforma,
                            data_upload = CURRENT_TIMESTAMP
                        `;
                        await client.query(insertQuery, [
                            pedido.numero_pedido, pedido.data_aprovacao, pedido.nome_produto, pedido.sku_loja, pedido.forma_pagamento,
                            pedido.valor_produto, pedido.valor_frete, pedido.desconto_produto, pedido.nome_cliente, pedido.documento,
                            pedido.estado_uf, pedido.numero_nfe, pedido.comissao, pedido.custo_produto, null, pedido.plataforma
                        ]);
                        totalPedidosProcessados++;
                    }
                } catch (parseError) {
                    erros.push(`Erro ao processar o arquivo de ${fieldName}: ${parseError.message}`);
                }
            }
        }

        await client.query('COMMIT');
        if (erros.length > 0) req.flash('error', erros.join('<br>'));
        if (totalPedidosProcessados > 0) req.flash('success', `${totalPedidosProcessados} registros de pedidos foram processados e salvos com sucesso!`);
        else if (erros.length === 0) req.flash('info', 'Nenhum novo pedido para processar nos arquivos enviados.');

    } catch (error) {
        await client.query('ROLLBACK');
        req.flash('error', 'Ocorreu um erro crítico durante o processamento.');
    } finally {
        client.release();
    }
    res.redirect('/acompanhamento/pedidos/upload-reports');
};

/**
 * NOVO: Gera e envia o relatório consolidado em Excel.
 */
exports.baixarRelatorioConsolidado = async (req, res) => {
    try {
        const { rows } = await poolAcompanhamento.query('SELECT * FROM acompanhamentos_consolidados ORDER BY data_aprovacao DESC');

        if (rows.length === 0) {
            req.flash('info', 'Não há dados para gerar o relatório.');
            return res.redirect('/acompanhamento/pedidos');
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Relatório Consolidado');

        worksheet.columns = [
            { header: 'Número do Pedido', key: 'numero_pedido', width: 30 },
            { header: 'Data de Aprovação', key: 'data_aprovacao', width: 15, style: { numFmt: 'dd/mm/yyyy' } },
            { header: 'Nome do Produto', key: 'nome_produto', width: 50 },
            { header: 'SKU', key: 'sku_loja', width: 20 },
            { header: 'Forma de Pagamento', key: 'forma_pagamento', width: 20 },
            { header: 'Valor do Produto', key: 'valor_produto', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Valor do Frete', key: 'valor_frete', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Desconto', key: 'desconto_produto', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Cliente', key: 'nome_cliente', width: 30 },
            { header: 'Documento', key: 'documento', width: 20 },
            { header: 'UF', key: 'estado_uf', width: 8 },
            { header: 'Nº NF-e', key: 'numero_nfe', width: 15 },
            { header: 'Comissão', key: 'comissao', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Custo do Produto', key: 'custo_produto', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Frete Pago', key: 'valor_frete_pago', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Plataforma', key: 'plataforma', width: 20 },
        ];
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.addRows(rows);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Consolidado_${Date.now()}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Erro ao gerar relatório consolidado:', error);
        req.flash('error', 'Falha ao gerar o relatório.');
        res.redirect('/acompanhamento/pedidos/upload-reports');
    }
};

exports.deletePedido = async (req, res) => {
    const { id } = req.params;
    try {
        const deleteResult = await poolAcompanhamento.query('DELETE FROM acompanhamentos_consolidados WHERE id = $1', [id]);
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ message: 'Pedido não encontrado.' });
        }
        res.status(200).json({ message: 'Pedido apagado com sucesso.' });
    } catch (error) {
        console.error(`Erro ao apagar pedido ID ${id}:`, error);
        res.status(500).json({ message: 'Erro interno ao apagar o pedido.' });
    }
};