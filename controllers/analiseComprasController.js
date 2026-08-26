const pool = require('../helpers/database');
const multer = require('multer');
const xlsx = require('xlsx');

// Configuração do multer para upload de arquivos em memória
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // Limite 10MB
}).array('files', 4);

/**
 * Renderiza a página principal
 */
exports.renderPage = async (req, res) => {
    try {
        const fornecedoresRes = await pool.query('SELECT bling_id, nome FROM fornecedor ORDER BY nome');
        const fornecedores = fornecedoresRes.rows;

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
 * Endpoint da API para buscar a listagem agrupada
 */
exports.listarProdutos = async (req, res) => {
    try {
        const query = `
            SELECT
                p.bling_id AS parent_product_bling_id,
                p.nome AS produto_nome,
                p.estoque AS estoque_atual,
                COALESCE(d.chegando, 0) AS chegando,
                MAX(f.bling_id) AS fornecedor_id,
                MAX(f.nome) AS fornecedor_nome,
                COALESCE(SUM(v.vendas_3d), 0) AS vendas_3d,
                COALESCE(SUM(v.vendas_7d), 0) AS vendas_7d,
                COALESCE(SUM(v.vendas_15d), 0) AS vendas_15d,
                COALESCE(SUM(v.vendas_30d), 0) AS vendas_30d
            FROM cached_structures s
            JOIN cached_products p ON p.bling_id = s.parent_product_bling_id
            LEFT JOIN analise_compras_dados d ON d.parent_product_bling_id = p.bling_id
            LEFT JOIN fornecedor f ON f.bling_id = s.fornecedor_bling_id
            LEFT JOIN analise_compras_vendas v ON v.component_sku = s.component_sku
            GROUP BY
                p.bling_id,
                p.nome,
                p.estoque,
                d.chegando
            ORDER BY p.nome
        `;
        const { rows } = await pool.query(query);

        // Se houver um filtro de fornecedor via query string
        const fornecedorIdFiltro = req.query.fornecedorId;
        let produtos = rows;
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
 * Atualiza o valor de "Chegando" de um produto pai
 */
exports.atualizarChegando = async (req, res) => {
    const { parent_product_bling_id, chegando } = req.body;

    if (!parent_product_bling_id || chegando === undefined) {
        return res.status(400).json({ success: false, message: 'ID do produto e valor chegando são obrigatórios.' });
    }

    try {
        await pool.query(
            `INSERT INTO analise_compras_dados (parent_product_bling_id, chegando)
             VALUES ($1, $2)
             ON CONFLICT (parent_product_bling_id)
             DO UPDATE SET chegando = EXCLUDED.chegando`,
            [parent_product_bling_id, chegando]
        );
        res.json({ success: true, message: 'Quantidade chegando atualizada com sucesso.' });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao atualizar chegando:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar dados.' });
    }
};

/**
 * Faz o processamento dos 4 arquivos Excel simultaneamente
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
        } catch(e) {
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
                
                const workbook = xlsx.read(file.buffer, { type: 'buffer' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                
                // Converte a aba pra array de arrays, pulando header
                const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
                
                // Ignorar a linha 1 (cabeçalho). i=1.
                // Coluna A (index 0) = component_sku
                // Coluna F (index 5) = Quantidade de Saídas
                for (let j = 1; j < data.length; j++) {
                    const row = data[j];
                    if (!row || row.length === 0) continue;
                    
                    const sku = row[0] ? String(row[0]).trim() : null;
                    const vendas = parseInt(row[5], 10) || 0;
                    
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
                res.json({ success: true, message: 'Dados de vendas importados com sucesso.' });
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

/**
 * Geração de Pedido em PDF (Estrutura Básica Engatilhada)
 */
exports.gerarPedidoPDF = async (req, res) => {
    const { fornecedor_id, items } = req.body;
    
    if (!fornecedor_id || !items || !items.length) {
        return res.status(400).json({ success: false, message: 'Fábrica/Fornecedor e itens são obrigatórios.' });
    }

    try {
        console.log(`[Análise de Compras] Geração de PDF para fornecedor ${fornecedor_id} com ${items.length} itens.`);
        // LOGICA DE PDF: a ser implementada na fase 2
        
        // Simular um retorno temporário
        res.json({ success: true, message: 'Pedido gerado com sucesso (Engatilhado para próxima fase).' });
    } catch (error) {
        console.error('[Análise de Compras] Erro ao gerar PDF de pedido:', error);
        res.status(500).json({ success: false, message: 'Erro ao gerar pedido.' });
    }
};
