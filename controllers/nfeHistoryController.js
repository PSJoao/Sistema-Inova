// controllers/nfeHistoryController.js
const ExcelJS = require('exceljs');

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

/**
 * Renderiza a nova página de Histórico de NF-e.
 */
exports.renderNfeHistoryPage = async (req, res) => {
    try {
        const justificativasQuery = `
            SELECT DISTINCT justificativa FROM emission_nfe_reports
            WHERE justificativa IS NOT NULL AND justificativa <> '' ORDER BY justificativa ASC;
        `;
        const transportadorasQuery = `
            SELECT DISTINCT transportadora_apelido FROM emission_nfe_reports
            WHERE transportadora_apelido IS NOT NULL AND transportadora_apelido <> ''
            AND transportadora_apelido NOT IN ('SHOPEE MAGAZINE', 'NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'MAGALU ENTREGAS')
            ORDER BY transportadora_apelido ASC;
        `;

        const [justificativasResult, transportadorasResult] = await Promise.all([
            pool.query(justificativasQuery),
            pool.query(transportadorasQuery)
        ]);

        res.render('relacao/nfe-history', {
            title: 'Histórico de Notas Fiscais',
            layout: 'main',
            justificativas: justificativasResult.rows.map(r => r.justificativa),
            transportadoras: transportadorasResult.rows.map(r => r.transportadora_apelido)
        });
    } catch (error) {
        console.error("Erro ao carregar a página de histórico de NF-e:", error);
        res.status(500).send("Erro interno ao carregar a página.");
    }
};

/**
 * API para buscar e filtrar o histórico de notas fiscais.
 */
exports.getNfeHistoryApi = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', situacao = '', justificativa = '', transportadora = '', orderBy = 'data_emissao', orderDir = 'DESC', dataInicial = '', dataFinal = '' } = req.query;
        const limitNum = parseInt(limit, 10) || 50;
        const pageNum = parseInt(page, 10) || 1;
        const offset = (pageNum - 1) * limitNum;

        let whereClauses = [`enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada', 'alerta')`];
        const queryParams = [];
        let paramIndex = 1;

        if (situacao) {
            if (situacao === 'Relacionada') whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
            else if (situacao === 'Pendente') whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
            else if (situacao === 'Cancelada') whereClauses.push(`enf.status_para_relacao = 'cancelada'`);
            else if (situacao === 'Alerta') whereClauses.push(`enf.status_para_relacao = 'alerta'`);
        }
        if (justificativa) {
            if (justificativa === 'SEM_JUSTIFICATIVA') whereClauses.push(`(enf.justificativa IS NULL OR enf.justificativa = '')`);
            else {
                whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                queryParams.push(justificativa);
            }
        }
        if (transportadora) {
            whereClauses.push(`enf.transportadora_apelido = $${paramIndex++}`);
            queryParams.push(transportadora);
        }
        if (dataInicial) {
            whereClauses.push(`cn.data_emissao >= $${paramIndex++}::timestamp`);
            queryParams.push(dataInicial);
        }
        if (dataFinal) {
            whereClauses.push(`cn.data_emissao <= ($${paramIndex++}::timestamp + interval '1 day')`);
            queryParams.push(dataFinal);
        }
        if (search) {
            whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex})`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        whereClauses.push(`enf.transportadora_apelido NOT IN ('SHOPEE MAGAZINE', 'NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'MAGALU ENTREGAS')`);
        whereClauses.push(`cn.data_emissao IS NOT NULL`);
        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const countQuery = `SELECT COUNT(DISTINCT enf.id) FROM emission_nfe_reports enf LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso ${whereCondition};`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limitNum);

        const allowedSortColumns = {
            nfe_numero: 'enf.nfe_numero',
            data_emissao: 'cn.data_emissao',
            status_para_relacao: 'enf.status_para_relacao',
            transportadora_apelido: 'enf.transportadora_apelido',
            product_descriptions_list: 'COALESCE(cn.product_descriptions_list, enf.product_descriptions_list)',
            justificativa: 'enf.justificativa',
            data_acao: 'COALESCE(tr.validated_at, enf.data_processamento)'
        };

        const sortColumn = allowedSortColumns[orderBy] || 'cn.data_emissao';
        const sortDirection = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const dataQuery = `
            SELECT 
                enf.id, enf.nfe_numero, enf.status_para_relacao, enf.justificativa, enf.transportadora_apelido, cn.data_emissao,
                COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list,
                COALESCE(tr.validated_at, enf.data_processamento) AS data_acao
            FROM emission_nfe_reports enf
            LEFT JOIN transportation_relation_items tri ON enf.id = tri.nfe_report_id
            LEFT JOIN transportation_relations tr ON tri.relation_id = tr.id
            LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
            ${whereCondition}
            ORDER BY ${sortColumn} ${sortDirection}
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        const nfeResult = await pool.query(dataQuery, [...queryParams, limitNum, offset]);

        res.status(200).json({
            nfeData: nfeResult.rows,
            pagination: { currentPage: pageNum, totalPages, totalItems }
        });
    } catch (error) {
        console.error("[NFE History API] Erro ao buscar dados:", error);
        res.status(500).json({ message: "Erro ao buscar histórico de notas." });
    }
};

/**
 * API para contar as estruturas dos produtos com base em uma lista de NFs.
 */
exports.getMissingProductCountApi = async (req, res) => {
    const { nfeNumeros } = req.body;
    if (!nfeNumeros || !Array.isArray(nfeNumeros) || nfeNumeros.length === 0) {
        return res.status(400).json({ message: "Lista de números de NF-e não fornecida." });
    }
    try {
        const structureCount = new Map();
        const nfeResult = await pool.query(
            `SELECT product_ids_list, product_descriptions_list FROM cached_nfe WHERE nfe_numero = ANY($1::text[])`,
            [nfeNumeros]
        );
        const allProductIds = new Set();
        const productDescriptionsMap = new Map();
        nfeResult.rows.forEach(nf => {
            const ids = (nf.product_ids_list || '').split(';').map(id => id.trim()).filter(Boolean);
            const descs = (nf.product_descriptions_list || '').split(';').map(d => d.trim());
            ids.forEach((id, index) => {
                allProductIds.add(id);
                if (!productDescriptionsMap.has(id)) {
                    productDescriptionsMap.set(id, descs[index] || `Produto ID ${id}`);
                }
            });
        });
        if (allProductIds.size === 0) return res.status(200).json({ structureCounts: [] });

        // [CORREÇÃO FINAL] Converte o array de texto para um array de BIGINT para a consulta.
        const structuresResult = await pool.query(
            `SELECT parent_product_bling_id, structure_name FROM cached_structures WHERE parent_product_bling_id = ANY($1::bigint[])`,
            [[...allProductIds]]
        );

        const parentProductsWithStructures = new Set(structuresResult.rows.map(s => s.parent_product_bling_id));
        nfeResult.rows.forEach(nf => {
            const productIdsInNfe = (nf.product_ids_list || '').split(';').map(id => id.trim()).filter(Boolean);
            productIdsInNfe.forEach(productId => {
                if (parentProductsWithStructures.has(productId)) {
                    structuresResult.rows.forEach(structure => {
                        if (structure.parent_product_bling_id === productId) {
                            structureCount.set(structure.structure_name, (structureCount.get(structure.structure_name) || 0) + 1);
                        }
                    });
                } else {
                    const productName = productDescriptionsMap.get(productId) || `Produto ID ${productId}`;
                    structureCount.set(productName, (structureCount.get(productName) || 0) + 1);
                }
            });
        });
        const sortedCounts = Array.from(structureCount.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);
        res.status(200).json({ structureCounts: sortedCounts });
    } catch (error) {
        console.error("[Missing Product Count API] Erro ao contar estruturas:", error);
        res.status(500).json({ message: "Erro ao processar a contagem de produtos." });
    }
};

async function getMissingProductCounts(nfeNumeros) {
    if (!nfeNumeros || nfeNumeros.length === 0) {
        return [];
    }
    const structureCount = new Map();
    const nfeResult = await pool.query(
        `SELECT product_ids_list, product_descriptions_list FROM cached_nfe WHERE nfe_numero = ANY($1::text[])`,
        [nfeNumeros]
    );
    const allProductIds = new Set();
    const productDescriptionsMap = new Map();
    nfeResult.rows.forEach(nf => {
        const ids = (nf.product_ids_list || '').split(';').map(id => id.trim()).filter(Boolean);
        const descs = (nf.product_descriptions_list || '').split(';').map(d => d.trim());
        ids.forEach((id, index) => {
            allProductIds.add(id);
            if (!productDescriptionsMap.has(id)) {
                productDescriptionsMap.set(id, descs[index] || `Produto ID ${id}`);
            }
        });
    });
    if (allProductIds.size === 0) return [];

    const structuresResult = await pool.query(
        `SELECT parent_product_bling_id, structure_name FROM cached_structures WHERE parent_product_bling_id = ANY($1::bigint[])`,
        [[...allProductIds]]
    );

    const parentProductsWithStructures = new Set(structuresResult.rows.map(s => String(s.parent_product_bling_id)));

    nfeResult.rows.forEach(nf => {
        const productIdsInNfe = (nf.product_ids_list || '').split(';').map(id => id.trim()).filter(Boolean);
        productIdsInNfe.forEach(productId => {
            if (parentProductsWithStructures.has(productId)) {
                structuresResult.rows.forEach(structure => {
                    if (String(structure.parent_product_bling_id) === productId) {
                        structureCount.set(structure.structure_name, (structureCount.get(structure.structure_name) || 0) + 1);
                    }
                });
            } else {
                const productName = productDescriptionsMap.get(productId) || `Produto ID ${productId}`;
                structureCount.set(productName, (structureCount.get(productName) || 0) + 1);
            }
        });
    });

    return Array.from(structureCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
}

exports.generateJustificationsReport = async (req, res) => {
    try {
        const { situacao = '', justificativa = '', search = '', transportadora = '', dataInicial = '', dataFinal = '' } = req.query;

        // 1. Busca os dados completos que correspondem ao filtro, sem paginação.
        let whereClauses = [`enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada')`];
        const queryParams = [];
        let paramIndex = 1;

        if (situacao) {
            if (situacao === 'Relacionada') whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
            else if (situacao === 'Pendente') whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
        }
        if (justificativa) {
            if (justificativa === 'SEM_JUSTIFICATIVA') whereClauses.push(`(enf.justificativa IS NULL OR enf.justificativa = '')`);
            else {
                whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                queryParams.push(justificativa);
            }
        }
        if (transportadora) {
            whereClauses.push(`enf.transportadora_apelido = $${paramIndex++}`);
            queryParams.push(transportadora);
        }
        if (dataInicial) {
            whereClauses.push(`cn.data_emissao >= $${paramIndex++}::timestamp`);
            queryParams.push(dataInicial);
        }
        if (dataFinal) {
            whereClauses.push(`cn.data_emissao <= ($${paramIndex++}::timestamp + interval '1 day')`);
            queryParams.push(dataFinal);
        }
        if (search) {
            whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex})`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const reportQuery = `
            SELECT  
                enf.nfe_numero,
                COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) AS "produtos",
                enf.justificativa,
                enf.transportadora_apelido,
                cn.data_emissao,
                CASE 
                    WHEN enf.status_para_relacao = 'relacionada' THEN tr.validated_at
                    ELSE NULL
                END AS validated_at,
                enf.status_para_relacao
            FROM emission_nfe_reports enf
            LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
            LEFT JOIN transportation_relation_items tri ON enf.id = tri.nfe_report_id
            LEFT JOIN transportation_relations tr ON tri.relation_id = tr.id
            ${whereCondition}
            ORDER BY enf.id DESC;
        `;

        const reportResult = await pool.query(reportQuery, queryParams);
        const reportData = reportResult.rows;

        // 2. Gera o arquivo Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Relatório de Notas');

        worksheet.columns = [
            { header: 'Nº da NF-e', key: 'nfe_numero', width: 20 },
            { header: 'Situação', key: 'status_para_relacao', width: 20 },
            { header: 'Data de Emissão', key: 'data_emissao', width: 20 },
            { header: 'Produtos', key: 'produtos', width: 80 },
            { header: 'Justificativa', key: 'justificativa', width: 35 },
            { header: 'Transportadora', key: 'transportadora_apelido', width: 35 },
            { header: 'Data de Envio', key: 'validated_at', width: 20 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.addRows(reportData);

        // 3. Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Relatorio_Notas.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Erro ao gerar relatório de justificativas:", error);
        res.status(500).send("Erro ao gerar o relatório de justificativas.");
    }
};

exports.generateMissingProductsReport = async (req, res) => {
    try {
        const { situacao = '', justificativa = '', search = '', transportadora = '', dataInicial = '', dataFinal = '' } = req.query;

        // 1. Primeiro, busca todos os números de NFE que correspondem ao filtro, sem paginação.
        let whereClauses = [`enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada')`];
        const queryParams = [];
        let paramIndex = 1;

        console.log("Justificativa recebida antes de verificar:", justificativa);

        if (situacao) {
            if (situacao === 'Relacionada') whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
            else if (situacao === 'Pendente') whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
        }
        if (justificativa && situacao === 'Pendente') {
            console.log("Justificativa recebida:", justificativa);
            if (justificativa === 'SEM_JUSTIFICATIVA') { res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'."); return; }
            else {
                if (justificativa === 'Não tem produto') {
                    whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                    queryParams.push(justificativa);
                }
                else {
                    res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'.");
                    return;
                }

            }
        }
        else {
            res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'.");
            return;
        }
        if (transportadora) {
            whereClauses.push(`enf.transportadora_apelido = $${paramIndex++}`);
            queryParams.push(transportadora);
        }
        if (dataInicial) {
            whereClauses.push(`cn.data_emissao >= $${paramIndex++}::timestamp`);
            queryParams.push(dataInicial);
        }
        if (dataFinal) {
            whereClauses.push(`cn.data_emissao <= ($${paramIndex++}::timestamp + interval '1 day')`);
            queryParams.push(dataFinal);
        }
        if (search) {
            whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex})`);
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;
        const nfeQuery = `SELECT enf.nfe_numero FROM emission_nfe_reports enf LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso ${whereCondition};`;
        const nfeResult = await pool.query(nfeQuery, queryParams);
        const nfeNumeros = nfeResult.rows.map(row => row.nfe_numero);

        // 2. Usa a função reutilizável para obter a contagem
        const structureCounts = await getMissingProductCounts(nfeNumeros);

        // 3. Gera o arquivo Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Estruturas Faltantes');

        worksheet.columns = [
            { header: 'Estrutura (Produto)', key: 'name', width: 70 },
            { header: 'Quantidade', key: 'count', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.addRows(structureCounts);

        // 4. Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Relatorio_Estruturas_Faltantes.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Erro ao gerar relatório de estruturas:", error);
        res.status(500).send("Erro ao gerar o relatório.");
    }
};


exports.limparJustificativaNfe = async (req, res) => {
    const { nfeId } = req.body;
    if (!nfeId) {
        return res.status(400).json({ success: false, message: "ID da NF-e não fornecido." });
    }
    try {
        await pool.query(
            `UPDATE emission_nfe_reports SET justificativa = NULL, status_para_relacao = 'pendente' WHERE id = $1`,
            [nfeId]
        );
        res.status(200).json({ success: true, message: "Justificativa limpa com sucesso. A nota voltou para o status 'pendente'." });
    } catch (error) {
        console.error("Erro ao limpar justificativa:", error);
        res.status(500).json({ success: false, message: "Erro interno ao limpar a justificativa." });
    }
};

exports.updateNfeJustification = async (req, res) => {
    const { nfeId, justification } = req.body;

    if (!nfeId || !justification) {
        return res.status(400).json({ success: false, message: "ID da NF-e e justificativa são obrigatórios." });
    }

    try {
        let status = 'justificada_adiada';
        if (justification === 'ADIAR') {
            status = 'pendente';
        }

        const query = `
            UPDATE emission_nfe_reports
            SET justificativa = $1, status_para_relacao = $2, data_processamento = NOW()
            WHERE id = $3
        `;
        await pool.query(query, [justification, status, nfeId]);

        res.status(200).json({ success: true, message: `Justificativa da NF-e atualizada com sucesso.` });
    } catch (error) {
        console.error("Erro ao atualizar justificativa da NF-e:", error);
        res.status(500).json({ success: false, message: "Erro interno ao atualizar a justificativa." });
    }
};

/**
 * Gera relatório de produtos pendentes separado por transportadora (lado a lado).
 * [ATUALIZADO] Exibe NOME do produto (cached_products) em vez do SKU.
 */
exports.generatePendingProductsByCarrierReport = async (req, res) => {
    try {
        // Lista de transportadoras para excluir
        const transportadorasExcluidas = [
            'SHOPEE MAGAZINE',
            'NOVO MERCADO LIVRE',
            'MERCADO LIVRE ELIANE',
            'MERCADO LIVRE MAGAZINE',
            'MAGALU ENTREGAS',
            'FRENET'
        ];

        const comando = `SELECT DISTINCT codigo FROM bipagem_state, jsonb_array_elements_text(barcodes_json) AS codigo`

        const resultado = await pool.query(comando);
        const formatado = "(" + resultado.rows.map(r => `'${r.codigo}'`).join(", ") + ")";

        // 1. Busca os produtos das notas pendentes agrupados por transportadora
        const query = `
            SELECT 
                enf.transportadora_apelido,
                -- Se encontrar o nome, usa o nome. Se não, usa o código (SKU) como fallback
                COALESCE(cp.nome, nqp.produto_codigo) AS produto_nome,
                SUM(nqp.quantidade) as total_qtd
            FROM emission_nfe_reports enf
            JOIN nfe_quantidade_produto nqp ON enf.nfe_numero = nqp.nfe_numero
            -- Subquery para garantir apenas 1 nome por SKU (o mais recente)
            LEFT JOIN (
                SELECT DISTINCT ON (sku) sku, nome 
                FROM cached_products 
                ORDER BY sku, last_updated_at DESC
            ) cp ON nqp.produto_codigo = cp.sku
            WHERE enf.status_para_relacao IN ('pendente', 'justificada_adiada')
            AND enf.cancelada = false
            ${transportadorasExcluidas.length > 0
                ? `AND enf.transportadora_apelido NOT IN (${transportadorasExcluidas.map(t => `'${t}'`).join(',')})`
                : ''}
            ${resultado.rows.length > 0
                ? `AND enf.nfe_chave_acesso_44d NOT IN ${formatado}`
                : ''}
            GROUP BY enf.transportadora_apelido, cp.nome, nqp.produto_codigo
            ORDER BY enf.transportadora_apelido ASC, produto_nome ASC;
        `;

        const result = await pool.query(query);
        const rows = result.rows;

        if (rows.length === 0) {
            return res.status(404).send("Nenhum produto pendente encontrado (verifique se todos já não estão em processo de bipagem).");
        }

        // 2. Organiza os dados em um objeto por transportadora
        const dataByCarrier = {};
        rows.forEach(row => {
            const transp = row.transportadora_apelido || 'INDEFINIDA';
            if (!dataByCarrier[transp]) {
                dataByCarrier[transp] = [];
            }
            dataByCarrier[transp].push({
                nome: row.produto_nome,
                qtd: parseFloat(row.total_qtd)
            });
        });

        // 3. Cria o Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Produtos Pendentes por Transp');

        let currentCol = 1;

        // Estilo da borda separadora (grossa na direita)
        const borderStyle = {
            right: { style: 'medium' }
        };

        Object.keys(dataByCarrier).forEach(carrierName => {
            const products = dataByCarrier[carrierName];
            const qtdColIndex = currentCol + 1; // Coluna B do par

            // --- Cabeçalho da Transportadora (Linha 1) ---
            worksheet.mergeCells(1, currentCol, 1, qtdColIndex);
            const headerCell = worksheet.getCell(1, currentCol);
            headerCell.value = carrierName;
            headerCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
            headerCell.alignment = { horizontal: 'center' };

            // Aplica borda
            headerCell.border = borderStyle;
            worksheet.getCell(1, qtdColIndex).border = borderStyle;

            // --- Sub-cabeçalhos (Linha 2) ---
            const nomeHeader = worksheet.getCell(2, currentCol);
            nomeHeader.value = 'Produto';
            nomeHeader.font = { bold: true };

            const qtdHeader = worksheet.getCell(2, qtdColIndex);
            qtdHeader.value = 'Qtd';
            qtdHeader.font = { bold: true };
            qtdHeader.border = borderStyle;

            // --- Preenche os produtos ---
            products.forEach((prod, index) => {
                const rowIndex = 3 + index;

                const nomeCell = worksheet.getCell(rowIndex, currentCol);
                nomeCell.value = prod.nome;

                const qtdCell = worksheet.getCell(rowIndex, qtdColIndex);
                qtdCell.value = prod.qtd;
                qtdCell.border = borderStyle;
            });

            // Ajusta largura das colunas
            worksheet.getColumn(currentCol).width = 60;
            worksheet.getColumn(qtdColIndex).width = 10;

            // Pula 2 colunas para a próxima transportadora
            currentCol += 2;
        });

        // 4. Envia para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Produtos_Pendentes_Por_Transportadora.xlsx"');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Erro ao gerar relatório de produtos por transportadora:", error);
        res.status(500).send("Erro interno ao gerar o relatório.");
    }
};

/**
 * [NOVO] API para cancelar (excluir) uma NF-e do sistema.
 */
exports.cancelarNfe = async (req, res) => {
    const { nfeId } = req.body;
    if (!nfeId) {
        return res.status(400).json({ success: false, message: "ID da NF-e não fornecido." });
    }
    try {
        // Primeiro, remove dos itens de relação para evitar erros de chave estrangeira
        //await pool.query(`DELETE FROM transportation_relation_items WHERE nfe_report_id = $1`, [nfeId]);
        // Depois, remove o registro principal
        await pool.query(`UPDATE emission_nfe_reports SET cancelada = true, status_para_relacao = 'cancelada' WHERE id = $1`, [nfeId]);

        res.status(200).json({ success: true, message: "Nota Fiscal cancelada com sucesso." });
    } catch (error) {
        console.error("Erro ao cancelar NF-e:", error);
        res.status(500).json({ success: false, message: "Erro interno ao cancelar a NF-e." });
    }
};

/**
 * Gera relatório de separação dinamicamente baseado nos filtros e busca do usuário.
 */
exports.generateSeparationReport = async (req, res) => {
    try {
        const { 
            situacao = '', 
            justificativa = '', 
            search = '', 
            transportadora = '', 
            dataInicial = '', 
            dataFinal = '', 
            orderBy = 'data_emissao', 
            orderDir = 'DESC',
            nfe_numeros = ''
        } = req.query;

        let whereClauses = [`enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada', 'alerta')`];
        const queryParams = [];
        let paramIndex = 1;

        if (nfe_numeros) {
            const numeros = nfe_numeros.split(',').map(n => n.trim()).filter(Boolean);
            whereClauses.push(`enf.nfe_numero = ANY($${paramIndex++}::text[])`);
            queryParams.push(numeros);
        } else {
            if (situacao) {
                if (situacao === 'Relacionada') whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
                else if (situacao === 'Pendente') whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
                else if (situacao === 'Cancelada') whereClauses.push(`enf.status_para_relacao = 'cancelada'`);
                else if (situacao === 'Alerta') whereClauses.push(`enf.status_para_relacao = 'alerta'`);
            }
            if (justificativa) {
                if (justificativa === 'SEM_JUSTIFICATIVA') whereClauses.push(`(enf.justificativa IS NULL OR enf.justificativa = '')`);
                else {
                    whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                    queryParams.push(justificativa);
                }
            }
            if (transportadora) {
                whereClauses.push(`enf.transportadora_apelido = $${paramIndex++}`);
                queryParams.push(transportadora);
            }
            if (dataInicial) {
                whereClauses.push(`cn.data_emissao >= $${paramIndex++}::timestamp`);
                queryParams.push(dataInicial);
            }
            if (dataFinal) {
                whereClauses.push(`cn.data_emissao <= ($${paramIndex++}::timestamp + interval '1 day')`);
                queryParams.push(dataFinal);
            }
            if (search) {
                whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex})`);
                queryParams.push(`%${search}%`);
                paramIndex++;
            }
        }

        whereClauses.push(`enf.transportadora_apelido NOT IN ('SHOPEE MAGAZINE', 'NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'MAGALU ENTREGAS')`);
        whereClauses.push(`cn.data_emissao IS NOT NULL`);

        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;

        const allowedSortColumns = {
            nfe_numero: 'enf.nfe_numero',
            data_emissao: 'cn.data_emissao',
            status_para_relacao: 'enf.status_para_relacao',
            transportadora_apelido: 'enf.transportadora_apelido',
            product_descriptions_list: 'COALESCE(cn.product_descriptions_list, enf.product_descriptions_list)',
            justificativa: 'enf.justificativa',
            data_acao: 'COALESCE(tr.validated_at, enf.data_processamento)'
        };

        const sortColumn = allowedSortColumns[orderBy] || 'cn.data_emissao';
        const sortDirection = orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const reportQuery = `
            SELECT 
                enf.nfe_numero,
                enf.transportadora_apelido,
                cn.data_emissao,
                cn.product_ids_list,
                COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) AS produtos
            FROM emission_nfe_reports enf
            LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
            LEFT JOIN transportation_relation_items tri ON enf.id = tri.nfe_report_id
            LEFT JOIN transportation_relations tr ON tri.relation_id = tr.id
            ${whereCondition}
            ORDER BY ${sortColumn} ${sortDirection};
        `;

        const reportResult = await pool.query(reportQuery, queryParams);
        const reportData = reportResult.rows;

        // 1. Coleta todos os nfe_numeros e product_ids para buscar quantidades e informações dos produtos
        const nfeNumeros = reportData.map(row => row.nfe_numero);
        const allProductIds = [];
        reportData.forEach(row => {
            const ids = (row.product_ids_list || '')
                .split(';')
                .map(id => id.replace(/[{}]/g, '').trim())
                .filter(Boolean)
                .map(id => parseInt(id, 10))
                .filter(Number.isInteger);
            allProductIds.push(...ids);
        });
        const uniqueProductIds = [...new Set(allProductIds)];

        // Consulta mapa de quantidades
        const quantidadeMap = new Map();
        if (nfeNumeros.length > 0) {
            const quantQuery = `
                SELECT nfe_numero, produto_codigo, quantidade
                FROM nfe_quantidade_produto
                WHERE nfe_numero = ANY($1::text[])
            `;
            const quantResult = await pool.query(quantQuery, [nfeNumeros]);
            quantResult.rows.forEach(row => {
                quantidadeMap.set(`${row.nfe_numero}|${row.produto_codigo?.trim().toUpperCase()}`, parseFloat(row.quantidade));
            });
        }

        // Consulta mapa de produtos (sku, volumes, nome)
        const productVolumeMap = new Map();
        if (uniqueProductIds.length > 0) {
            const prodQuery = `
                SELECT bling_id, sku, volumes, nome
                FROM cached_products
                WHERE bling_id = ANY($1::bigint[])
            `;
            const prodResult = await pool.query(prodQuery, [uniqueProductIds]);
            prodResult.rows.forEach(p => {
                productVolumeMap.set(Number(p.bling_id), {
                    sku: p.sku,
                    volumes: parseFloat(p.volumes || 0),
                    nome: p.nome || ''
                });
            });
        }

        // 2. Gera o arquivo PDF (A4 Paisagem)
        const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const pageHeight = 595.27;
        const pageWidth = 841.89;
        const margin = 15;
        const rowHeight = 22;

        const colNF_width = 70;
        const colTransp_width = 120;
        const colData_width = 70;
        const colQtd_width = 40;
        const colSku_width = 95;
        const colSep_width = 60;
        const colProd_width = pageWidth - (margin * 2) - (colNF_width + colTransp_width + colData_width + colQtd_width + colSku_width + colSep_width);

        const colNF_X = margin;
        const colTransp_X = colNF_X + colNF_width;
        const colData_X = colTransp_X + colTransp_width;
        const colQtd_X = colData_X + colData_width;
        const colSku_X = colQtd_X + colQtd_width;
        const colProd_X = colSku_X + colSku_width;
        const colSep_X = colProd_X + colProd_width;

        const formattedData = [];

        reportData.forEach(row => {
            let dataEmissaoStr = '';
            if (row.data_emissao) {
                const date = new Date(row.data_emissao);
                if (!isNaN(date.getTime())) {
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const year = date.getUTCFullYear();
                    dataEmissaoStr = `${day}/${month}/${year}`;
                }
            }

            const productIds = (row.product_ids_list || '')
                .split(';')
                .map(id => id.replace(/[{}]/g, '').trim())
                .filter(Boolean)
                .map(id => parseInt(id, 10))
                .filter(Number.isInteger);

            const productDescs = (row.produtos || '')
                .split(';')
                .map(d => d.trim())
                .filter(Boolean);

            if (productIds.length > 0) {
                productIds.forEach((productId, idx) => {
                    const skuInfo = productVolumeMap.get(productId);
                    const sku = skuInfo?.sku?.trim().toUpperCase() || '';
                    const key = `${row.nfe_numero}|${sku}`;
                    const quantity = skuInfo ? (quantidadeMap.get(key) || 0) : 0;

                    let productName = productDescs[idx] || skuInfo?.nome || 'Produto sem descrição';
                    if (skuInfo) {
                        const vols = skuInfo.volumes || 0;
                        productName = `${productName} - Qtd. Volumes Produto: ${vols}`;
                    }

                    formattedData.push({
                        nfe_numero: row.nfe_numero,
                        transportadora_apelido: row.transportadora_apelido,
                        data_emissao: dataEmissaoStr,
                        quantidade: quantity || 1,
                        sku: sku,
                        produtos: productName
                    });
                });
            } else {
                if (productDescs.length > 0) {
                    productDescs.forEach(desc => {
                        formattedData.push({
                            nfe_numero: row.nfe_numero,
                            transportadora_apelido: row.transportadora_apelido,
                            data_emissao: dataEmissaoStr,
                            quantidade: 1,
                            sku: '',
                            produtos: desc
                        });
                    });
                } else {
                    formattedData.push({
                        nfe_numero: row.nfe_numero,
                        transportadora_apelido: row.transportadora_apelido,
                        data_emissao: dataEmissaoStr,
                        quantidade: '',
                        sku: '',
                        produtos: ''
                    });
                }
            }
        });

        const sanitizeText = (str, fallback = '') => {
            if (!str) return fallback;
            return String(str)
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Remove acentos
                .replace(/[^\x00-\x7F]/g, '');   // Remove caracteres não-ASCII
        };

        const wrapText = (text, font, size, maxWidth) => {
            if (!text) return [''];
            const safeText = sanitizeText(text);
            const words = safeText.split(' ');
            const lines = [];
            let currentLine = '';

            for (const word of words) {
                if (font.widthOfTextAtSize(word, size) > maxWidth - 8) {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = '';
                    }
                    let part = '';
                    for (const char of word) {
                        const testPart = part + char;
                        if (font.widthOfTextAtSize(testPart, size) <= maxWidth - 8) {
                            part = testPart;
                        } else {
                            if (part) lines.push(part);
                            part = char;
                        }
                    }
                    if (part) currentLine = part;
                } else {
                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                    if (font.widthOfTextAtSize(testLine, size) <= maxWidth - 8) {
                        currentLine = testLine;
                    } else {
                        if (currentLine) lines.push(currentLine);
                        currentLine = word;
                    }
                }
            }
            if (currentLine) lines.push(currentLine);
            return lines.length > 0 ? lines : [''];
        };

        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;

        const drawHeader = () => {
            page.drawText(sanitizeText('Relatório de Separação de Produtos'), { x: margin, y: y - 14, font: boldFont, size: 14 });
            page.drawText(new Date().toLocaleString('pt-BR'), { x: pageWidth - margin - 120, y: y - 12, font: font, size: 9 });
            y -= 25;

            // Desenha o cabeçalho da tabela
            drawRow('NFE', 'Transp', 'Emissão', 'Qtd', 'SKU', 'Produto', 'Separado?', true);
        };

        const drawRow = (nf, transp, emissao, qtd, sku, prod, sep, isHeader = false) => {
            const cFont = isHeader ? boldFont : font;
            const fSize = isHeader ? 8.5 : 7.5;
            const lineSpacing = 11;
            const padding = 8;

            const linesNF = wrapText(nf, cFont, fSize, colNF_width);
            const linesTransp = wrapText(transp, cFont, fSize, colTransp_width);
            const linesEmissao = wrapText(emissao, cFont, fSize, colData_width);
            const linesQtd = wrapText(qtd, cFont, fSize, colQtd_width);
            const linesSku = wrapText(sku, cFont, fSize, colSku_width);
            const linesProd = wrapText(prod, cFont, fSize, colProd_width);
            const linesSep = wrapText(sep, cFont, fSize, colSep_width);

            const maxLines = Math.max(
                linesNF.length,
                linesTransp.length,
                linesEmissao.length,
                linesQtd.length,
                linesSku.length,
                linesProd.length,
                linesSep.length
            );

            const currentRowHeight = maxLines * lineSpacing + padding;

            // Verifica se a linha cabe na página atual
            if (y - currentRowHeight < margin) {
                page = pdfDoc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
                drawHeader();
            }

            const drawCell = (x, w, linesList) => {
                page.drawRectangle({
                    x,
                    y: y - currentRowHeight,
                    width: w,
                    height: currentRowHeight,
                    borderColor: rgb(0, 0, 0),
                    borderWidth: 0.5,
                    fillColor: isHeader ? rgb(0.9, 0.9, 0.9) : undefined
                });

                const totalTextHeight = linesList.length * lineSpacing;
                const startY = y - (currentRowHeight - totalTextHeight) / 2 - fSize;

                linesList.forEach((lineText, idx) => {
                    page.drawText(lineText, {
                        x: x + 4,
                        y: startY - (idx * lineSpacing),
                        font: cFont,
                        size: fSize
                    });
                });
            };

            drawCell(colNF_X, colNF_width, linesNF);
            drawCell(colTransp_X, colTransp_width, linesTransp);
            drawCell(colData_X, colData_width, linesEmissao);
            drawCell(colQtd_X, colQtd_width, linesQtd);
            drawCell(colSku_X, colSku_width, linesSku);
            drawCell(colProd_X, colProd_width, linesProd);
            drawCell(colSep_X, colSep_width, linesSep);

            y -= currentRowHeight;
        };

        // Desenha o cabeçalho inicial
        drawHeader();

        // Desenha as linhas de produto
        for (const row of formattedData) {
            drawRow(
                row.nfe_numero || '',
                row.transportadora_apelido || '',
                row.data_emissao || '',
                String(row.quantidade || ''),
                row.sku || '',
                row.produtos || '',
                ''
            );
        }

        const pdfBytes = await pdfDoc.save();

        // 3. Envia o arquivo para download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Relatorio_Separacao.pdf"');
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error("Erro ao gerar relatório de separação:", error);
        res.status(500).send("Erro ao gerar o relatório de separação.");
    }
};