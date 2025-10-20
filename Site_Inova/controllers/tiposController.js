// controllers/tiposController.js
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

// Configuração do banco de dados (copiada do etiquetasService)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

/**
 * Renderiza a página principal para gerenciamento de tipos.
 */
exports.renderTiposPage = (req, res) => {
    try {
        res.render('tipos/index', {
            title: 'Gerenciador de Tipos de Produto',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de tipos:', error);
        req.flash('error_msg', 'Não foi possível carregar a página do gerenciador de tipos.');
        res.redirect('/');
    }
};

/**
 * Processa a planilha de tipos enviada.
 */
exports.uploadTiposPlanilha = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo .xlsx foi enviado.' });
    }

    // Mapa das colunas para os tipos, conforme especificado
    const headerMap = {
        'A': 'caixaria',
        'B': 'fino',
        'C': 'kit',
        'D': 'quadrado'
    };
    // Colunas que vamos processar
    const colunasParaProcessar = ['A', 'B', 'C', 'D'];

    let updatedCount = 0;
    let notFoundSkus = [];
    
    const workbook = new ExcelJS.Workbook();
    const client = await pool.connect();

    try {
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
            throw new Error('A planilha está vazia ou corrompida.');
        }

        // Itera sobre as colunas A, B, C, D
        for (const colLetter of colunasParaProcessar) {
            const tipo = headerMap[colLetter];
            const column = worksheet.getColumn(colLetter);

            if (!column) continue;

            // Itera sobre cada célula da coluna
            // O 'eachCell' do exceljs é complexo, vamos usar um for simples
            for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
                const cell = worksheet.getCell(`${colLetter}${rowNumber}`);
                
                if (cell && cell.value) {
                    const sku = cell.value.toString().trim();
                    if (sku === '') continue;

                    const updateResult = await client.query(
                        'UPDATE cached_products SET tipo_ml = $1 WHERE UPPER(sku) = UPPER($2)',
                        [tipo, sku]
                    );

                    if (updateResult.rowCount > 0) {
                        updatedCount++;
                    } else {
                        notFoundSkus.push(sku);
                    }
                }
            }
        }
        
        return res.json({
            success: true,
            updated: updatedCount,
            notFound: notFoundSkus
        });

    } catch (error) {
        console.error('Erro ao processar planilha de tipos:', error);
        return res.status(500).json({ success: false, message: `Erro ao processar a planilha: ${error.message}` });
    } finally {
        if (client) client.release();
    }
};

/**
 * Processa a atualização de um tipo individual.
 */
exports.updateTipoIndividual = async (req, res) => {
    const { sku, tipo } = req.body;

    if (!sku || sku.trim() === '') {
        return res.status(400).json({ success: false, message: 'O campo SKU é obrigatório.' });
    }

    // Converte 'NENHUM' para NULL no banco
    const tipoParaDb = (tipo === 'NENHUM') ? null : tipo;
    const client = await pool.connect();

    try {
        const updateResult = await client.query(
            'UPDATE cached_products SET tipo_ml = $1 WHERE UPPER(sku) = UPPER($2)',
            [tipoParaDb, sku]
        );

        if (updateResult.rowCount > 0) {
            return res.json({
                success: true,
                message: `SKU ${sku} atualizado para o tipo '${tipo}'.`
            });
        } else {
            return res.json({
                success: false,
                message: `O SKU ${sku} não foi encontrado no banco de dados.`
            });
        }

    } catch (error) {
        console.error('Erro ao atualizar tipo individual:', error);
        return res.status(500).json({ success: false, message: `Erro interno do servidor: ${error.message}` });
    } finally {
        if (client) client.release();
    }
};