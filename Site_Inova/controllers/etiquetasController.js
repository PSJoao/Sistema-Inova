// controllers/etiquetasController.js
const multer = require('multer');
const { processarEtiquetas, buscarEtiquetaPorNF, validarProdutoPorEstruturas, finalizarBipagem, processarLoteNf } = require('../services/etiquetasService');
const archiver = require('archiver');
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');

const PDF_STORAGE_DIR = path.join(__dirname, '..', 'pdfEtiquetas');

async function ensurePdfStorageDir() {
    try {
        await fs.mkdir(PDF_STORAGE_DIR, { recursive: true });
        console.log(`Diretório de armazenamento de PDFs verificado/criado em: ${PDF_STORAGE_DIR}`);
    } catch (error) {
        console.error('Erro ao criar diretório de armazenamento de PDFs:', error);
    }
}
ensurePdfStorageDir();

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Configuração do Multer para upload de arquivos PDF em memória
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 450 * 1024 * 1024 }, // Limite de 450MB por requisição
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas PDFs são permitidos.'), false);
        }
    }
}).array('etiquetasPdfs', 50); // Permite até 50 arquivos com o name 'etiquetasPdfs'


const excelStorage = multer.memoryStorage();
const uploadExcel = multer({
    storage: excelStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10MB para Excel
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel' // .xls
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas Excel (.xlsx, .xls) é permitido.'), false);
        }
    }
}).single('nfExcelFile')


/**
 * Renderiza a página principal para upload das etiquetas e ativa a trava de sincronização.
 */
exports.renderEtiquetasPage = (req, res) => {
    try {
        res.render('etiquetas/index', {
            title: 'Organizador de Etiquetas Mercado Livre',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de etiquetas:', error);
        req.flash('error_msg', 'Não foi possível carregar a página do organizador de etiquetas.');
        res.redirect('/');
    }
};

exports.renderBipagemPage = (req, res) => {
    try {
        res.render('etiquetas/bipagem', {
            title: 'Bipagem de Etiquetas por Palete',
            layout: 'main'
        });
    } catch (error) {
        console.error('Erro ao renderizar a página de bipagem:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de bipagem.');
        res.redirect('/');
    }
};

exports.validarProdutoFechado = async (req, res) => {
    const { componentSkus: scannedCodes } = req.body;

    if (!scannedCodes || !Array.isArray(scannedCodes) || scannedCodes.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum código de estrutura fornecido.' });
    }

    try {
        const resultado = await validarProdutoPorEstruturas(scannedCodes);
        return res.json(resultado);
    } catch (error) {
        console.error(`[Validar Produto] Erro ao processar conjunto de códigos:`, error);
        return res.status(500).json({ success: false, message: `Erro interno: ${error.message}` });
    }
};

exports.finalizarBipagem = async (req, res) => {
    const { scanList } = req.body;

    if (!scanList || !Array.isArray(scanList) || scanList.length === 0) {
        return res.status(400).json({ success: false, message: 'Nenhum item bipado para finalizar.' });
    }

    try {
        // O serviço irá processar a lista, atualizar o DB e gerar o PDF
        const pdfBytes = await finalizarBipagem(scanList);

        const timestamp = Date.now();
        const pdfName = `Bipagem-Finalizada-${timestamp}.pdf`;

        // Envia o PDF como resposta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfName}"`);
        res.send(pdfBytes);

    } catch (error) {
        console.error('[Finalizar Bipagem] Erro catastrófico:', error);
        // Retorna um JSON de erro em vez de um PDF
        return res.status(500).json({ success: false, message: `Erro ao gerar PDF: ${error.message}` });
    }
};

/**
 * Processa os arquivos PDF enviados, organiza e gera o relatório.
 */
exports.processAndOrganizeEtiquetas = (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Erro no upload do multer:', err.message);
            req.flash('error_msg', `Erro no upload: ${err.message}`);
            return res.redirect('/etiquetas');
        }

        if (!req.files || req.files.length === 0) {
            req.flash('error_msg', 'Nenhum arquivo PDF foi enviado. Por favor, selecione os arquivos.');
            return res.redirect('/etiquetas');
        }

        try {
            console.log(`[Etiquetas] Recebidos ${req.files.length} arquivo(s) para processamento.`);

            const pdfInputs = req.files.map(file => ({
                buffer: file.buffer,
                originalFilename: file.originalname // Captura o nome original aqui
            }));

            // 1. Geramos o nome do arquivo ANTES de chamar o serviço.
            const timestamp = Date.now();
            const organizedPdfFilename = `Etiquetas-Organizadas-${timestamp}.pdf`;

            // 2. Passamos o nome do arquivo gerado (organizedPdfFilename) como segundo argumento.
            const { etiquetasPdf, relatorioPdf } = await processarEtiquetas(pdfInputs, organizedPdfFilename);

            //const timestamp = Date.now();
            //const organizedPdfFilename = `Etiquetas-Organizadas-${timestamp}.pdf`;
            const organizedPdfPath = path.join(PDF_STORAGE_DIR, organizedPdfFilename);
            try {
                await fs.writeFile(organizedPdfPath, etiquetasPdf);
                console.log(`PDF de etiquetas organizado salvo em: ${organizedPdfPath}`);
            } catch (saveError) {
                console.error('Erro ao salvar o PDF de etiquetas organizado:', saveError);
                // Continua mesmo se não salvar, mas loga o erro
            }

            // Configura a resposta para enviar um arquivo ZIP
            const zipName = `Etiquetas_e_Relatorio_${Date.now()}.zip`;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

            const archive = archiver('zip', {
                zlib: { level: 9 } // Nível de compressão
            });

            // Finaliza a resposta quando o arquivo zip for fechado
            archive.on('end', () => res.end());
            // Trata erros durante a criação do zip
            archive.on('error', (err) => { throw err; });

            // Adiciona o stream de resposta ao archive
            archive.pipe(res);

            // Adiciona os PDFs ao arquivo zip
            archive.append(etiquetasPdf, { name: `Etiquetas-Organizadas.pdf` });
            archive.append(relatorioPdf, { name: `Relatorio-de-Produtos.pdf` });

            // Finaliza o processo de criação do zip
            await archive.finalize();

        } catch (error) {
            console.error('Erro catastrófico ao processar as etiquetas:', error);
            req.flash('error_msg', `Erro ao processar os PDFs: ${error.message}`);
            res.redirect('/etiquetas');
        }
    });
};

exports.buscarNfIndividual = async (req, res) => {
    const { nfNumero } = req.body;
    console.log(`[Busca NF] Recebida solicitação para NF: ${nfNumero}`);

    if (!nfNumero || !/^\d+$/.test(nfNumero)) {
        return res.status(400).json({ success: false, message: 'Número da Nota Fiscal inválido.' });
    }

    try {
        // Chama o serviço para buscar a etiqueta
        const resultado = await buscarEtiquetaPorNF(nfNumero);

        if (resultado.success) {
            console.log(`[Busca NF] Etiqueta para NF ${nfNumero} encontrada.`);
            // Responde com sucesso, indicando que a etiqueta foi encontrada
            // O frontend usará essa resposta para mostrar o modal de confirmação
            return res.json({ success: true, nf: nfNumero });
        } else {
            console.log(`[Busca NF] Etiqueta para NF ${nfNumero} não encontrada nos PDFs recentes.`);
            return res.status(404).json({ success: false, message: 'Etiqueta não encontrada nos arquivos armazenados.' });
        }
    } catch (error) {
        console.error(`[Busca NF] Erro ao buscar etiqueta para NF ${nfNumero}:`, error);
        return res.status(500).json({ success: false, message: 'Erro interno ao buscar a etiqueta.' });
    }
};

exports.downloadNfIndividual = async (req, res) => {
    const { nf } = req.params;
    console.log(`[Download NF] Recebida solicitação para download da NF: ${nf}`);

    if (!nf || !/^\d+$/.test(nf)) {
        res.status(400).send('Número da Nota Fiscal inválido.');
        return;
    }

    try {
        // Re-executa a busca para obter o buffer do PDF da etiqueta
        const resultado = await buscarEtiquetaPorNF(nf);

        if (resultado.success && resultado.pdfBuffer) {
            console.log(`[Download NF] Gerando PDF individual para NF ${nf}`);
            const fileName = `Etiqueta-NF-${nf}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(resultado.pdfBuffer);
        } else {
            console.log(`[Download NF] NF ${nf} não encontrada para download.`);
            res.status(404).send('Etiqueta não encontrada.');
        }
    } catch (error) {
        console.error(`[Download NF] Erro ao gerar PDF para NF ${nf}:`, error);
        res.status(500).send('Erro interno ao gerar o PDF da etiqueta.');
    }
};

exports.saveMlBipagemState = async (req, res) => {
    const stateData = req.body; // Espera o objeto { scanList, productAggregates, ... }
    const stateKey = 'mercado_livre_bipagem'; // Chave fixa

    if (!stateData || typeof stateData !== 'object') {
        return res.status(400).json({ success: false, message: "Dados de estado inválidos ou ausentes." });
    }

    const client = await pool.connect();
    try {
        // UPSERT: Insere se não existir, atualiza se existir
        const query = `
            INSERT INTO ml_bipagem_state (state_key, state_json)
            VALUES ($1, $2)
            ON CONFLICT (state_key)
            DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW();
        `;
        await client.query(query, [stateKey, stateData]);
        res.status(200).json({ success: true, message: "Estado da bipagem salvo com sucesso." });
    } catch (error) {
        console.error(`Erro ao salvar estado da bipagem ML:`, error);
        res.status(500).json({ success: false, message: "Erro interno ao salvar o estado." });
    } finally {
        client.release();
    }
};

exports.loadMlBipagemState = async (req, res) => {
    const stateKey = 'mercado_livre_bipagem'; // Chave fixa
    const client = await pool.connect();
    try {
        const query = `
            SELECT state_json FROM ml_bipagem_state WHERE state_key = $1;
        `;
        const result = await client.query(query, [stateKey]);

        if (result.rows.length > 0 && result.rows[0].state_json) {
            // Retorna o estado encontrado
            res.status(200).json({ success: true, state: result.rows[0].state_json });
        } else {
            // Retorna sucesso, mas com estado nulo (indica que não há nada salvo)
            res.status(200).json({ success: true, state: null });
        }
    } catch (error) {
        console.error(`Erro ao carregar estado da bipagem ML:`, error);
        res.status(500).json({ success: false, message: "Erro interno ao carregar o estado." });
    } finally {
        client.release();
    }
};

exports.renderMlEtiquetasListPage = async (req, res) => {
    try {
        // Busca os status distintos para popular o filtro
        const statusResult = await pool.query(`
            SELECT DISTINCT situacao FROM cached_etiquetas_ml
            WHERE situacao IS NOT NULL ORDER BY situacao ASC
        `);
        const statusList = statusResult.rows.map(row => row.situacao);

        res.render('etiquetas/listagem', { // Aponta para a nova view
            title: 'Listagem de Etiquetas Mercado Livre',
            layout: 'main',
            statusList: statusList, // Passa a lista de status para o <select>
            // Passa helpers que podem ser úteis no template
            helpers: {
                eq: (v1, v2) => v1 === v2,
                formatDate: (dateString) => {
                    if (!dateString) return 'N/A';
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return 'Inválido';
                    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' }); // Formato dd/mm/aaaa
                },
                 formatDateTime: function(dateString) {
                    if (!dateString) return 'N/A';
                    const date = new Date(dateString);
                    if (isNaN(date.getTime())) return 'Data/Hora Inválida';

                    const day = String(date.getDate()).padStart(2, '0');
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const year = date.getFullYear();
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');

                    return `${day}/${month}/${year} ${hours}:${minutes}`;
                  }
            }
        });
    } catch (error) {
        console.error("Erro ao carregar a página de listagem de etiquetas ML:", error);
        req.flash('error', 'Erro ao carregar a página.');
        res.redirect('/etiquetas'); // Redireciona de volta para a página principal de etiquetas
    }
};

exports.getMlEtiquetasApi = async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '', situacao = '', startDate, endDate, sortBy = 'last_processed_at', sortOrder = 'DESC' } = req.query;
        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        if (situacao) {
            whereClauses.push(`situacao = $${paramIndex++}`);
            queryParams.push(situacao);
        }
        if (startDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') >= $${paramIndex++}`); // Compara apenas a data
            queryParams.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') <= $${paramIndex++}`); // Compara apenas a data
            queryParams.push(endDate);
        }
        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                nfe_numero ILIKE $${paramIndex} OR
                numero_loja ILIKE $${paramIndex} OR
                pack_id ILIKE $${paramIndex} OR
                skus ILIKE $${paramIndex} OR
                pdf_arquivo_origem ILIKE $${paramIndex}
            )`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validação da ordenação para evitar SQL Injection
        const allowedSortColumns = ['id', 'nfe_numero', 'numero_loja', 'pack_id', 'skus', 'quantidade_total', 'pdf_pagina', 'pdf_arquivo_origem', 'situacao', 'created_at', 'last_processed_at'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'last_processed_at'; // Default seguro
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'; // Default seguro
        const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder} NULLS LAST`; // NULLS LAST é bom para datas

        // Query para buscar os dados da página
        const dataQuery = `
            SELECT
                id, nfe_numero, numero_loja, pack_id, skus, quantidade_total,
                locations, pdf_pagina, pdf_arquivo_origem, situacao,
                created_at, last_processed_at
            FROM cached_etiquetas_ml
            ${whereCondition}
            ${orderByClause}
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        const dataResult = await pool.query(dataQuery, [...queryParams, limit, offset]);

        // Query para contar o total de itens filtrados (para paginação)
        const countQuery = `SELECT COUNT(*) FROM cached_etiquetas_ml ${whereCondition};`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / parseInt(limit, 10));

        res.status(200).json({
            etiquetasData: dataResult.rows,
            pagination: { currentPage: parseInt(page, 10), totalPages, totalItems }
        });

    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao buscar dados:", error);
        res.status(500).json({ message: "Erro ao buscar dados das etiquetas." });
    }
};

exports.exportMlEtiquetasExcel = async (req, res) => {
    try {
         const { search = '', situacao = '', startDate, endDate, sortBy = 'last_processed_at', sortOrder = 'DESC' } = req.query;

        // Reutiliza a lógica de filtros da API de busca
        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        if (situacao) {
            whereClauses.push(`situacao = $${paramIndex++}`);
            queryParams.push(situacao);
        }
        if (startDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') >= $${paramIndex++}`);
            queryParams.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`DATE(last_processed_at AT TIME ZONE 'UTC') <= $${paramIndex++}`);
            queryParams.push(endDate);
        }
         if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                nfe_numero ILIKE $${paramIndex} OR
                numero_loja ILIKE $${paramIndex} OR
                pack_id ILIKE $${paramIndex} OR
                skus ILIKE $${paramIndex} OR
                pdf_arquivo_origem ILIKE $${paramIndex}
            )`);
            queryParams.push(searchTerm);
            paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Ordenação (mesma lógica da API)
        const allowedSortColumns = ['id', 'nfe_numero', 'numero_loja', 'pack_id', 'skus', 'quantidade_total', 'pdf_pagina', 'pdf_arquivo_origem', 'situacao', 'created_at', 'last_processed_at'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'last_processed_at';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const orderByClause = `ORDER BY ${safeSortBy} ${safeSortOrder} NULLS LAST`;

        // Busca TODOS os dados filtrados (sem LIMIT/OFFSET)
        const query = `
            SELECT
                nfe_numero AS "NF-e",
                numero_loja AS "Venda",
                pack_id AS "Pack ID",
                skus AS "SKUs",
                quantidade_total AS "Qtd. Total",
                locations AS "Localização",
                pdf_arquivo_origem AS "Arquivo PDF",
                pdf_pagina AS "Página",
                situacao AS "Situação",
                last_processed_at AS "Última Atualização"
            FROM cached_etiquetas_ml
            ${whereCondition}
            ${orderByClause};
        `;
        const result = await pool.query(query, queryParams);
        const data = result.rows;

        if (data.length === 0) {
            // Se não houver dados, retorna erro 404 (ou redireciona com flash)
            return res.status(404).send('Nenhum dado encontrado para os filtros selecionados.');
        }

        // Gera o Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Etiquetas Mercado Livre');

        // Adiciona cabeçalhos baseados nas chaves do primeiro objeto (que já estão renomeadas com AS)
        worksheet.columns = Object.keys(data[0]).map(key => ({
            header: key, // Usa o nome da coluna SQL (com AS) como cabeçalho
            key: key,
            width: key === 'SKUs' || key === 'Arquivo PDF' ? 30 : (key === 'Localização' ? 20 : 15) // Ajusta larguras
        }));

        // Formata cabeçalho
        worksheet.getRow(1).font = { bold: true };

        // Adiciona os dados
        worksheet.addRows(data);

        // Formata colunas de data/hora
        const dateColumn = worksheet.getColumn('Última Atualização');
        dateColumn.numFmt = 'dd/mm/yyyy hh:mm:ss';
        const pageColumn = worksheet.getColumn('Página');
        // Adiciona 1 à página para exibição (índice 0 -> página 1)
        pageColumn.eachCell({ includeEmpty: false }, (cell) => {
            if (cell.value !== null && cell.value !== undefined && cell.row > 1) { // Pula cabeçalho
                cell.value = cell.value + 1;
            }
        });

        // Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Etiquetas_ML_${Date.now()}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao gerar relatório Excel:", error);
        res.status(500).send("Erro ao gerar o relatório Excel.");
    }
};

exports.buscarNfLote = (req, res) => {
    uploadExcel(req, res, async (err) => {
        if (err) {
            // Erros do Multer (tipo/tamanho)
            console.error('Erro no upload do Excel (Multer):', err.message);
            // Retorna JSON para o fetch() do frontend
            return res.status(400).json({ success: false, message: `Erro no upload: ${err.message}` });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo Excel foi enviado.' });
        }

        try {
            // Chama o novo serviço
            const { pdfBuffer, notFoundNfs } = await processarLoteNf(req.file.buffer);

            // Se o serviço rodou, envia o PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Etiquetas_Lote_NF_${Date.now()}.pdf"`);
            
            // **IMPORTANTE**: Passa as NFs não encontradas para o frontend através de um header customizado
            if (notFoundNfs.length > 0) {
                res.setHeader('X-Not-Found-NFs', notFoundNfs.join(','));
            }
            
            res.send(pdfBuffer);

        } catch (error) {
            // Erros do Service (Nenhuma NF encontrada, etc)
            console.error('Erro ao processar lote de NFs:', error);
            res.status(500).json({ success: false, message: `Erro ao processar o lote: ${error.message}` });
        }
    });
};

exports.exportMlSkuQuantityReport = async (req, res) => {
    console.log("[API Etiquetas ML] Iniciando geração de relatório SKU/Qtd Pendente...");
    const client = await pool.connect();
    try {
        // 1. Busca todas as etiquetas com situação 'pendente'
        const query = `
            SELECT skus, quantidade_total
            FROM cached_etiquetas_ml
            WHERE situacao = 'pendente';
        `;
        const result = await client.query(query);
        const etiquetasPendentes = result.rows;

        if (etiquetasPendentes.length === 0) {
            console.log("[API Etiquetas ML] Nenhuma etiqueta pendente encontrada.");
            // Retorna um status indicando que não há dados, em vez de um arquivo vazio
            return res.status(404).send('Nenhuma etiqueta pendente encontrada para gerar o relatório.');
        }

        // 2. Agrega as quantidades por SKU
        const skuQuantityMap = new Map();

        etiquetasPendentes.forEach(etiqueta => {
            const skusString = etiqueta.skus || '';
            const quantidade = etiqueta.quantidade_total || 0; // Quantidade da ETIQUETA (geralmente 1?)

            const skusArray = skusString.split(',').map(s => s.trim()).filter(Boolean);

            skusArray.forEach(sku => {
                // Aqui estamos somando a 'quantidade_total' da etiqueta para cada SKU nela contido.
                // Se uma etiqueta tem 2 SKUs e quantidade_total=1, ambos SKUs terão +1 na contagem.
                // Se precisar da quantidade específica do SKU na NF, a lógica muda.
                skuQuantityMap.set(sku, (skuQuantityMap.get(sku) || 0) + quantidade);
            });
        });

        // 3. Prepara os dados para o Excel e calcula o total geral
        let totalGeral = 0;
        const dataForExcel = [];
        // Ordena por SKU alfabeticamente
        const sortedSkus = Array.from(skuQuantityMap.keys()).sort();

        sortedSkus.forEach(sku => {
            const quantidade = skuQuantityMap.get(sku);
            dataForExcel.push({ SKU: sku, Quantidade: quantidade });
            totalGeral += quantidade;
        });

        // Adiciona a linha de total
        dataForExcel.push({}); // Linha em branco
        dataForExcel.push({ SKU: 'TOTAL GERAL', Quantidade: totalGeral });

        // 4. Gera o arquivo Excel
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('SKUs Pendentes');

        worksheet.columns = [
            { header: 'SKU', key: 'SKU', width: 40 },
            { header: 'Quantidade Pendente', key: 'Quantidade', width: 25, style: { numFmt: '0' } } // Formata como número inteiro
        ];

        // Formata cabeçalho
        worksheet.getRow(1).font = { bold: true };

        // Adiciona os dados
        worksheet.addRows(dataForExcel);

        // Formata a linha de total
        const totalRow = worksheet.getRow(worksheet.rowCount); // Pega a última linha
        totalRow.font = { bold: true };
        totalRow.getCell('A').alignment = { horizontal: 'right' };
        totalRow.getCell('B').numFmt = '0'; // Garante formatação de número

        console.log("[API Etiquetas ML] Relatório SKU/Qtd Pendente gerado com sucesso.");

        // 5. Envia o arquivo para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_SKU_Quantidade_Pendente_${Date.now()}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("[API Etiquetas ML] Erro ao gerar relatório SKU/Qtd Pendente:", error);
        res.status(500).send("Erro ao gerar o relatório de SKUs pendentes.");
    } finally {
        if (client) client.release();
    }
};