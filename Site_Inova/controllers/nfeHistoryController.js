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
        const page = 1;
        const limit = 100;
        const offset = (page - 1) * limit;

        const justificativasQuery = `
            SELECT DISTINCT justificativa FROM emission_nfe_reports
            WHERE justificativa IS NOT NULL AND justificativa <> '' ORDER BY justificativa ASC;
        `;
        const dataQuery = `
            SELECT 
                enf.id, enf.nfe_numero, enf.status_para_relacao, enf.justificativa, enf.transportadora_apelido, cn.data_emissao,
                COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list,
                COALESCE(tr.validated_at, enf.data_processamento) AS data_acao
            FROM emission_nfe_reports enf
            LEFT JOIN transportation_relation_items tri ON enf.id = tri.nfe_report_id
            LEFT JOIN transportation_relations tr ON tri.relation_id = tr.id
            LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
            WHERE enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada', 'alerta')
            AND
            enf.transportadora_apelido NOT IN ('SHOPEE MAGAZINE', 'NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'MAGALU ENTREGAS')
            ORDER BY cn.data_emissao DESC
            LIMIT $1 OFFSET $2;
        `;

        const [justificativasResult, nfeResult] = await Promise.all([
            pool.query(justificativasQuery),
            pool.query(dataQuery, [limit, offset])
        ]);
        
        const countResult = await pool.query(`SELECT COUNT(id) FROM emission_nfe_reports WHERE status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada', 'alerta');`);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        res.render('relacao/nfe-history', {
            title: 'Histórico de Notas Fiscais',
            layout: 'main',
            justificativas: justificativasResult.rows.map(r => r.justificativa),
            nfeData: nfeResult.rows,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                isFirstPage: page === 1,
                isLastPage: page === totalPages
            }
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
        const { page = 1, search = '', situacao = '', justificativa = '' } = req.query;
        const limit = 100;
        const offset = (parseInt(page, 10) - 1) * limit;

        let whereClauses = [ `enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada', 'alerta')` ];
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
        if (search) {
             whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex})`);
             queryParams.push(`%${search}%`);
             paramIndex++;
        }

        //whereClauses.push(`enf.cancelada = false`);

        whereClauses.push(`enf.transportadora_apelido NOT IN ('SHOPEE MAGAZINE', 'NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'MAGALU ENTREGAS')`);
        whereClauses.push(`cn.data_emissao is NOT NULL`);
        const whereCondition = `WHERE ${whereClauses.join(' AND ')}`;
        
        const countQuery = `SELECT COUNT(DISTINCT enf.id) FROM emission_nfe_reports enf LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso ${whereCondition};`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

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
            ORDER BY cn.data_emissao DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        const nfeResult = await pool.query(dataQuery, [...queryParams, limit, offset]);

        res.status(200).json({
            nfeData: nfeResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems }
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
        const { situacao = '', justificativa = '', search = '' } = req.query;

        // 1. Busca os dados completos que correspondem ao filtro, sem paginação.
        let whereClauses = [ `enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada')` ];
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
        const { situacao = '', justificativa = '', search = '' } = req.query;

        // 1. Primeiro, busca todos os números de NFE que correspondem ao filtro, sem paginação.
        let whereClauses = [ `enf.status_para_relacao IN ('justificada_adiada', 'relacionada', 'pendente', 'cancelada')` ];
        const queryParams = [];
        let paramIndex = 1;

        console.log("Justificativa recebida antes de verificar:", justificativa);

        if (situacao) {
            if (situacao === 'Relacionada') whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
            else if (situacao === 'Pendente') whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
        }
        if (justificativa && situacao === 'Pendente') {
            console.log("Justificativa recebida:", justificativa);
            if (justificativa === 'SEM_JUSTIFICATIVA') {res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'."); return;}
            else {
                if (justificativa === 'Não tem produto')
                {
                    whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                    queryParams.push(justificativa);
                }
                else
                {
                    res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'.");
                    return;
                }
                
            }
        }
        else
        {
            res.status(500).send("Relatório válido apenas para filtragem de justificativa por 'Não tem produto' e situação 'Pendente'.");
            return;
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