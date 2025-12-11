const faturamentoService = require('../services/faturamentoAutomaticoService');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

exports.handleFaturamentoManual = async (req, res) => {
    const { accountName } = req.body;

    if (!accountName || (accountName !== 'lucas' && accountName !== 'eliane')) {
        return res.status(400).json({ 
            success: false, 
            message: 'Conta inválida. Informe "lucas" ou "eliane".' 
        });
    }

    console.log(`[Controller] Recebida solicitação de Faturamento Automático ML para: ${accountName}`);

    faturamentoService.startFaturamentoAutomatico(accountName)
        .then(() => {
            console.log(`[Controller] Ciclo de faturamento background finalizado para ${accountName}.`);
        })
        .catch((err) => {
            console.error(`[Controller] Erro não tratado no ciclo de faturamento de ${accountName}:`, err);
        });

    return res.status(200).json({ 
        success: true, 
        message: `Processo de Faturamento Automático (${accountName}) iniciado! Pode demorar alguns minutos para finalizar...` 
    });
};

// --- NOVAS FUNÇÕES DE LISTAGEM E RELATÓRIO ---

/**
 * Renderiza a página principal de listagem
 */
exports.renderListPage = (req, res) => {
    res.render('faturamentoAutomatico/listagem', {
        title: 'Faturamento Automático - Notas Pendentes',
        activeMenu: 'faturamento-auto' // Usado para destacar no menu se necessário
    });
};

/**
 * API para buscar notas pendentes com paginação e filtros
 */
exports.getPendingNotes = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        const search = req.query.search || '';
        const isManual = req.query.isManual; // 'true', 'false', ou ''

        // Base da Query
        let whereClauses = ['situacao = 1']; // Apenas pendentes
        let values = [];
        let valueCounter = 1;

        // Filtro de Busca (Número ou Chave ou Cliente/Descrição se tiver)
        if (search) {
            whereClauses.push(`(nfe_numero ILIKE $${valueCounter} OR chave_acesso ILIKE $${valueCounter} OR product_descriptions_list ILIKE $${valueCounter})`);
            values.push(`%${search}%`);
            valueCounter++;
        }

        // Filtro Is Manual
        if (isManual === 'true') {
            whereClauses.push(`is_manual = true`);
        } else if (isManual === 'false') {
            // Considera false ou null como automático
            whereClauses.push(`(is_manual = false OR is_manual IS NULL)`);
        }

        const whereString = whereClauses.join(' AND ');

        // Query de Contagem
        const countQuery = `SELECT COUNT(*) FROM cached_nfe WHERE ${whereString}`;
        const countResult = await pool.query(countQuery, values);
        const totalRecords = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalRecords / limit);

        // Query de Dados
        const dataQuery = `
            SELECT * FROM cached_nfe 
            WHERE ${whereString}
            ORDER BY data_emissao DESC, last_updated_at DESC
            LIMIT $${valueCounter} OFFSET $${valueCounter + 1}
        `;
        
        // Adiciona limit e offset aos values
        const dataValues = [...values, limit, offset];
        
        const result = await pool.query(dataQuery, dataValues);

        res.json({
            success: true,
            data: result.rows,
            currentPage: page,
            totalPages: totalPages,
            totalRecords: totalRecords
        });

    } catch (error) {
        console.error('[Faturamento Controller] Erro ao listar notas:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao buscar notas.' });
    }
};

/**
 * Gerar Relatório Excel das notas filtradas
 */
exports.generateReport = async (req, res) => {
    try {
        const search = req.query.search || '';
        const isManual = req.query.isManual;

        // Reconstrói os filtros (sem paginação)
        let whereClauses = ['situacao = 1'];
        let values = [];
        let valueCounter = 1;

        if (search) {
            whereClauses.push(`(nfe_numero ILIKE $${valueCounter} OR chave_acesso ILIKE $${valueCounter} OR product_descriptions_list ILIKE $${valueCounter})`);
            values.push(`%${search}%`);
            valueCounter++;
        }

        if (isManual === 'true') {
            whereClauses.push(`is_manual = true`);
        } else if (isManual === 'false') {
            whereClauses.push(`(is_manual = false OR is_manual IS NULL)`);
        }

        const query = `
            SELECT * FROM cached_nfe 
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY data_emissao DESC
        `;

        const result = await pool.query(query, values);

        // Criação do Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Notas Pendentes');

        worksheet.columns = [
            { header: 'Número NFe', key: 'nfe_numero', width: 15 },
            { header: 'Chave de Acesso', key: 'chave_acesso', width: 45 },
            { header: 'Data Emissão', key: 'data_emissao', width: 20 },
            { header: 'Status Proc.', key: 'status_proc', width: 15 },
            { header: 'Volumes', key: 'total_volumes', width: 10 },
            { header: 'Transportador', key: 'transportador_nome', width: 30 },
            { header: 'Produtos', key: 'products', width: 50 },
            { header: 'Última Atualização', key: 'last_updated_at', width: 20 }
        ];

        result.rows.forEach(row => {
            worksheet.addRow({
                nfe_numero: row.nfe_numero,
                chave_acesso: row.chave_acesso,
                data_emissao: row.data_emissao ? new Date(row.data_emissao).toLocaleString('pt-BR') : '',
                status_proc: row.is_manual ? 'MANUAL' : 'AUTOMÁTICO',
                total_volumes: row.total_volumes,
                transportador_nome: row.transportador_nome,
                products: row.product_descriptions_list,
                last_updated_at: row.last_updated_at ? new Date(row.last_updated_at).toLocaleString('pt-BR') : ''
            });
        });

        // Estilização básica cabeçalho
        worksheet.getRow(1).font = { bold: true };
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Relatorio_Faturamento_Pendentes.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('[Faturamento Controller] Erro ao gerar relatório:', error);
        res.status(500).send('Erro ao gerar relatório');
    }
};