const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Para existsSync e mkdirSync
const axios = require('axios'); // Necessário para blingApiGet
const { poolInova, poolMonitora } = require('../config/db');
const { ConsoleLogEntry } = require('selenium-webdriver/bidi/logEntries');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';

// --- MAPA DE TRANSPORTADORAS E FUNÇÕES AUXILIARES DE MAPEAMENTO ---
const TRANSPORTADORA_APELIDOS_MAP = {
  'JEW TRANSPORTES LTDA': 'JEW',
  'DOMINALOG': 'DOMINALOG',
  'I. AMORIN TRANSPORTES EIRELI': 'LOG+',
  'I AMORIN TRANSPORTES EIRELLI': 'LOG+',
  'RISSO ENCOMENDAS CENTRO OESTE LTDA': 'RISSO',
  'MFA TRANSPORTES E LOGISTICA': 'MFA',
  'M F A TRANSPORTES E LOGISTICA LTDA': 'MFA',
  'MFA TRANSPORTES E LOGISTICA LTDA': 'MFA',
  'GAO LOG TRANSPORTES': 'GAOLOG',
  'ATUAL CARGAS E TRANSPORTES LTDA': 'ATUAL CARGAS',
  'FRENET': 'FRENET',
  'NOVO MERCADO LIVRE': 'NOVO MERCADO LIVRE',
  'MERCADO LIVRE ELIANE': 'MERCADO LIVRE ELIANE',
  'SHOPEE MAGAZINE' : 'SHOPEE MAGAZINE',
  'MERCADO LIVRE MAGAZINE': 'MERCADO LIVRE MAGAZINE',
  'MAGALU ENTREGAS' : 'MAGALU ENTREGAS'
  // Adicione mais mapeamentos exatos conforme necessário. Priorize nomes completos do Bling.
};

function getApelidoFromNomeCompleto(nomeCompleto) {
    if (!nomeCompleto) return 'OUTROS';
    const nomeUpper = String(nomeCompleto).toUpperCase();
    for (const key in TRANSPORTADORA_APELIDOS_MAP) {
        if (nomeUpper.includes(key.toUpperCase())) { // .includes() é mais flexível para pequenas variações
            return TRANSPORTADORA_APELIDOS_MAP[key];
        }
    }
    const parts = nomeUpper.split(/[\s-]+/); 
    if (parts[0] && parts[0].length > 1) {
        const apelidoGerado = parts[0].substring(0, 15).replace(/[^A-Z0-9&]/ig, '');
        if (apelidoGerado.length > 1) {
            console.warn(`Apelido não mapeado para "${nomeCompleto}", usando fallback: "${apelidoGerado}"`);
            return apelidoGerado;
        }
    }
    return 'OUTROS';
}

function getNomeCompletoFromApelido(apelido) {
    if (!apelido) {
        return 'Transportadora Não Definida';
    }
    const apelidoUpper = apelido.toUpperCase();
    for (const nomeCompleto in TRANSPORTADORA_APELIDOS_MAP) {
        if (TRANSPORTADORA_APELIDOS_MAP[nomeCompleto].toUpperCase() === apelidoUpper) {
            return nomeCompleto;
        }
    }
    // Se o apelido foi um fallback (ex: primeira palavra), ele pode não estar no mapa para reverter.
    // Neste caso, o relatório usará o próprio apelido.
    console.warn(`Nome completo oficial não encontrado no mapa para o apelido "${apelido}". O relatório usará o apelido.`);
    return apelido; 
}

// --- FUNÇÕES AUXILIARES BLING ---
async function getBlingCredentials(accountName) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT access_token, token_type FROM bling_api_credentials WHERE account_name = $1',
            [accountName]
        );
        if (result.rows.length === 0) throw new Error(`Credenciais Bling para "${accountName}" não encontradas no DB.`);
        const creds = result.rows[0];
        if (!creds.access_token) throw new Error(`Access token não encontrado para "${accountName}" no DB.`);
        return { accessToken: creds.access_token, tokenType: creds.token_type || 'Bearer' };
    } catch (error) {
        console.error(`Erro em getBlingCredentials para "${accountName}":`, error.message);
        throw error; // Re-lança para ser tratado pela função chamadora
    } finally {
        if (client) client.release();
    }
}

async function blingApiGet(url, accountName) {
    const credentials = await getBlingCredentials(accountName);
    try {
        // console.log(`Fazendo GET para ${url} usando token da conta ${accountName}`);
        const response = await axios.get(url, {
            headers: {
                'Authorization': `${credentials.tokenType} ${credentials.accessToken}`,
                'Accept': 'application/json'
            },
            timeout: 20000 
        });
        return response.data; 
    } catch (error) {
        let errorMessage = `Erro na API Bling GET ${url} para conta ${accountName}.`;
        let errorStatus = 500;
        let errorData = null;
        if (error.response) {
            errorMessage += ` Status: ${error.response.status}. Resposta: ${JSON.stringify(error.response.data)}`;
            errorStatus = error.response.status;
            errorData = error.response.data;
        } else if (error.request) {
            errorMessage += ` Nenhuma resposta recebida.`;
        } else {
            errorMessage += ` Erro config. req: ${error.message}`;
        }
        console.error(errorMessage);
        const apiError = new Error(errorData?.error?.message || errorData?.message || `Erro API Bling (status ${errorStatus})`);
        apiError.status = errorStatus;
        apiError.data = errorData;
        throw apiError;
    }
}

// --- FUNÇÃO DE GERAÇÃO DE EXCEL ---
async function generateExcelReport(relationId, transportadoraApelido, tituloRelacaoAba, client) {
    console.log(`[Excel Simplificado] Iniciando geração para Relação ID: ${relationId}`);
    
    // 1. Coleta de Dados do Banco
    const itemsResult = await client.query(
        `SELECT enf.nfe_numero
         FROM transportation_relation_items tri
         JOIN emission_nfe_reports enf ON tri.nfe_report_id = enf.id
         WHERE tri.relation_id = $1 AND tri.status_item = 'incluida_bipada'`,
        [relationId]
    );
    const itemsParaRelacao = itemsResult.rows;

    if (itemsParaRelacao.length === 0) {
        console.log("[Excel Simplificado] Nenhum item bipado encontrado. Nenhum relatório será gerado.");
        return null; 
    }

    
    const transportadoraCompleto = getNomeCompletoFromApelido(transportadoraApelido);
    const dataRelacao = new Date().toLocaleDateString('pt-BR');

    // 2. Setup do Workbook e da Planilha (Sempre um novo arquivo)
    const workbook = new ExcelJS.Workbook();
    // Usa o título da aba (que já contém a data) para o nome do arquivo, garantindo unicidade.
    const finalNomeAba = tituloRelacaoAba.replace(/[\/\\]/g, '-').substring(0, 31);
    const sheet = workbook.addWorksheet(finalNomeAba);

    // 3. Definição das Colunas Simplificadas
    sheet.columns = [
        { header: 'Transportadora', key: 'transportadora', width: 40 },
        { header: 'Nº Nota Fiscal', key: 'nfe_numero', width: 20 },
        { header: 'Data', key: 'data', width: 15 }
    ];
    
    // Estilo para o cabeçalho
    sheet.getRow(1).font = { bold: true };

    // 4. Preenchimento dos Dados
    itemsParaRelacao.forEach(item => {
        sheet.addRow({
            transportadora: transportadoraCompleto,
            nfe_numero: parseInt(item.nfe_numero, 10),
            data: dataRelacao
        });
    });

    // 5. Salva o novo arquivo Excel
    const reportsDir = path.join(__dirname, '../relacoes'); 
    await fs.mkdir(reportsDir, { recursive: true });
    // Cria um nome de arquivo único baseado no título da aba
    const fileName = `${finalNomeAba}.xlsx`;
    const filePath = path.join(reportsDir, fileName);

    try {
        await workbook.xlsx.writeFile(filePath);
        console.log(`[Excel Simplificado] Relatório salvo com sucesso em: ${filePath}`);
        return filePath;
    } catch (writeError) {
        console.error(`[Excel Simplificado] ERRO ao salvar workbook: ${writeError.message}`);
        // Fallback para nome de arquivo com timestamp se o nome original falhar
        if (writeError.code === 'EBUSY') {
            const fallbackFileName = `Relacao_${Date.now()}.xlsx`;
            const fallbackPath = path.join(reportsDir, fallbackFileName);
            await workbook.xlsx.writeFile(fallbackPath);
            return fallbackPath;
        }
        throw writeError;
    }
}

// =============================================================================
// FUNÇÕES EXPORTADAS (ROUTE HANDLERS)
// =============================================================================

/**
 * Renderiza a página principal do módulo de Relações, listando transportadoras com NFs pendentes.
 */
exports.getIndexRelacoes = async (req, res) => {
  try {
    const transportadorasQuery = `
      SELECT DISTINCT transportadora_apelido, COUNT(*) as pending_count
      FROM emission_nfe_reports
      WHERE (status_para_relacao = 'pendente' OR status_para_relacao = 'justificada_adiada')
        AND transportadora_apelido IS NOT NULL AND transportadora_apelido <> 'OUTROS'
        AND cancelada = false
      GROUP BY transportadora_apelido ORDER BY transportadora_apelido ASC;
    `;
    
    const justificativasQuery = `
        SELECT DISTINCT justificativa FROM emission_nfe_reports
        WHERE justificativa IS NOT NULL AND justificativa <> ''
        ORDER BY justificativa ASC;
    `;

    const [transportadorasResult, justificativasResult] = await Promise.all([
        pool.query(transportadorasQuery),
        pool.query(justificativasQuery)
    ]);
    
    const transportadoras = transportadorasResult.rows.map(row => ({
        apelido: row.transportadora_apelido,
        count: parseInt(row.pending_count, 10)
    }));

    const transportadorasEscondidas = ['NOVO MERCADO LIVRE', 'MERCADO LIVRE ELIANE', 'MERCADO LIVRE MAGAZINE', 'SHOPEE MAGAZINE', 'MAGALU ENTREGAS', 'FRENET'];
    const transportadorasVisiveis = transportadoras.filter(transp => !transportadorasEscondidas.includes(transp.apelido.toUpperCase()));
    
    const justificativas = justificativasResult.rows.map(row => row.justificativa);

    res.render('relacao/index', {
      title: 'Relações de Transportadoras',
      transportadoras: transportadorasVisiveis,
      justificativas: justificativas,
      layout: 'main'
    });
  } catch (error) {
    console.error("Erro ao buscar dados para a página de relações:", error);
    req.flash('error', 'Erro ao carregar a página de relações.');
    res.redirect('/');
  }
};

/**
 * [ALTERADO] API para buscar e filtrar o histórico de notas fiscais com TODAS as colunas necessárias.
 */
exports.getNfeHistoryApi = async (req, res) => {
    try {
        const { page = 1, search = '', situacao = '', justificativa = '' } = req.query;
        const limit = 100;
        const offset = (parseInt(page, 10) - 1) * limit;

        let whereClauses = [];
        const queryParams = [];
        let paramIndex = 1;

        if (situacao) {
            if (situacao === 'Relacionada') {
                whereClauses.push(`enf.status_para_relacao = 'relacionada'`);
            } else if (situacao === 'Pendente') {
                whereClauses.push(`enf.status_para_relacao IN ('pendente', 'justificada_adiada')`);
            } else if (situacao === 'Cancelada') {
                whereClauses.push(`enf.status_para_relacao = 'cancelada'`);
            }
        }

        if (justificativa) {
            if (justificativa === 'SEM_JUSTIFICATIVA') {
                whereClauses.push(`(enf.justificativa IS NULL OR enf.justificativa = '')`);
            } else {
                whereClauses.push(`enf.justificativa = $${paramIndex++}`);
                queryParams.push(justificativa);
            }
        }
        
        if (search) {
             whereClauses.push(`(enf.nfe_numero ILIKE $${paramIndex} OR cn.product_descriptions_list ILIKE $${paramIndex} OR enf.transportadora_apelido ILIKE $${paramIndex})`);
             queryParams.push(`%${search}%`);
             paramIndex++;
        }

        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // [CORREÇÃO] A query agora busca todas as colunas que você pediu
        const dataQuery = `
            SELECT 
                enf.id, 
                enf.nfe_numero, 
                enf.status_para_relacao, 
                enf.justificativa,
                enf.transportadora_apelido,
                COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list,
                -- Pega a data da relação se existir, senão a data da última modificação da NFE
                COALESCE(tr.validated_at, enf.data_ultima_modificacao) AS data_acao
            FROM emission_nfe_reports enf
            LEFT JOIN transportation_relation_items tri ON enf.id = tri.nfe_report_id
            LEFT JOIN transportation_relations tr ON tri.relation_id = tr.id
            LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
            ${whereCondition}
            ORDER BY enf.id DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        const finalDataParams = [...queryParams, limit, offset];
        const nfeResult = await pool.query(dataQuery, finalDataParams);

        const countQuery = `SELECT COUNT(enf.id) FROM emission_nfe_reports enf LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso ${whereCondition};`;
        const totalResult = await pool.query(countQuery, queryParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

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
 * [NOVO] API para contar as estruturas dos produtos com base em uma lista de NFs.
 */
exports.getMissingProductCountApi = async (req, res) => {
    const { nfeNumeros } = req.body; // Espera um array de números de NFE

    if (!nfeNumeros || !Array.isArray(nfeNumeros) || nfeNumeros.length === 0) {
        return res.status(400).json({ message: "Lista de números de NF-e não fornecida." });
    }

    try {
        const structureCount = new Map();

        // 1. Buscar todas as NFs de uma vez para pegar a lista de IDs de produtos
        const nfeResult = await pool.query(
            `SELECT product_ids_list, product_descriptions_list FROM cached_nfe WHERE nfe_numero = ANY($1::text[])`,
            [nfeNumeros]
        );

        const allProductIds = new Set();
        const productDescriptionsMap = new Map(); // Para mapear ID -> Descrição (para produtos simples)

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

        if (allProductIds.size === 0) {
            return res.status(200).json({ structureCounts: [] });
        }
        
        // 2. Buscar todas as estruturas relacionadas de uma vez
        const structuresResult = await pool.query(
            `SELECT parent_product_bling_id, structure_name FROM cached_structures WHERE parent_product_bling_id = ANY($1::text[])`,
            [[...allProductIds]]
        );

        const parentProductsWithStructures = new Set(structuresResult.rows.map(s => s.parent_product_bling_id));

        // 3. Contabilizar
        nfeResult.rows.forEach(nf => {
            const productIdsInNfe = (nf.product_ids_list || '').split(';').map(id => id.trim()).filter(Boolean);
            
            productIdsInNfe.forEach(productId => {
                if (parentProductsWithStructures.has(productId)) {
                    // É um produto composto, contamos suas estruturas
                    structuresResult.rows.forEach(structure => {
                        if (structure.parent_product_bling_id === productId) {
                            const currentCount = structureCount.get(structure.structure_name) || 0;
                            structureCount.set(structure.structure_name, currentCount + 1);
                        }
                    });
                } else {
                    // É um produto simples (a própria estrutura)
                    const productName = productDescriptionsMap.get(productId) || `Produto ID ${productId}`;
                    const currentCount = structureCount.get(productName) || 0;
                    structureCount.set(productName, currentCount + 1);
                }
            });
        });

        // 4. Formatar a saída
        const sortedCounts = Array.from(structureCount.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count); // Ordena do mais frequente para o menos

        res.status(200).json({ structureCounts: sortedCounts });

    } catch (error) {
        console.error("[Missing Product Count API] Erro ao contar estruturas:", error);
        res.status(500).json({ message: "Erro ao processar a contagem de produtos." });
    }
};

/**
 * Renderiza a página de bipagem para uma transportadora específica,
 * listando as NF-e pendentes (status 'pendente' ou 'justificada_adiada').
 */
exports.getBipagemPage = async (req, res) => {
    const { transportadoraApelido } = req.params;
    const edit_relation_id = req.query.edit_relation_id ? parseInt(req.query.edit_relation_id, 10) : null;

    console.log(`Carregando página de bipagem para: ${transportadoraApelido}. Modo de Edição ID: ${edit_relation_id || 'Nenhum'}`);

    try {
        let nfsQuery;
        let queryParams;

        // --- LÓGICA CONDICIONAL PARA A QUERY ---
        if (edit_relation_id && !isNaN(edit_relation_id)) {
            // MODO DE EDIÇÃO
            nfsQuery = `
                SELECT 
                    enf.id, enf.nfe_numero, enf.nfe_chave_acesso_44d, enf.total_volumes_calculado, enf.bling_account_type, enf.justificativa,
                    COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list
                FROM emission_nfe_reports enf
                LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
                WHERE 
                    enf.transportadora_apelido = $1 AND
                    (
                        (enf.status_para_relacao = 'pendente' OR enf.status_para_relacao = 'justificada_adiada') OR
                        enf.id IN (SELECT nfe_report_id FROM transportation_relation_items WHERE relation_id = $2)
                    )
                    AND enf.nfe_numero NOT IN ('ERRO', 'N/A') 
                    AND enf.cancelada = false
                ORDER BY CAST(NULLIF(REGEXP_REPLACE(enf.nfe_numero, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, id ASC;
            `;
            queryParams = [transportadoraApelido, edit_relation_id];
        } else {
            // MODO NORMAL
            nfsQuery = `
                SELECT 
                    enf.id, enf.nfe_numero, enf.nfe_chave_acesso_44d, enf.total_volumes_calculado, enf.bling_account_type, enf.justificativa,
                    COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list
                FROM emission_nfe_reports enf
                LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
                WHERE 
                    enf.transportadora_apelido = $1 AND (enf.status_para_relacao = 'pendente' OR enf.status_para_relacao = 'justificada_adiada')
                    AND enf.nfe_numero NOT IN ('ERRO', 'N/A') 
                    AND enf.cancelada = false
                ORDER BY 
                    CAST(NULLIF(REGEXP_REPLACE(enf.nfe_numero, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, id ASC;
            `;
            queryParams = [transportadoraApelido];
        }
        
        const nfsResult = await pool.query(nfsQuery, queryParams);
        
        // MODIFICADO: Adicionado 'justificativa' ao objeto mapeado
        const notasFiscaisPendentes = nfsResult.rows.map(nf => ({
            idRelatorio: nf.id, 
            numeroNF: nf.nfe_numero, 
            chaveAcesso44d: nf.nfe_chave_acesso_44d,
            totalVolumes: nf.total_volumes_calculado, 
            contaBling: nf.bling_account_type,
            produtos: nf.product_descriptions_list || "Nenhum produto listado.",
            justificativa: nf.justificativa || null // Passa a justificativa (ou null se não houver)
        }));

        let barcodesParaCarregar = [];
        if (edit_relation_id && !isNaN(edit_relation_id)) {
            // --- CORREÇÃO PARA EDIÇÃO DE RELAÇÕES ---
            // Busca cada nota da relação e sua contagem de volumes
            const relationItemsResult = await pool.query(
                `SELECT enr.nfe_chave_acesso_44d, enr.total_volumes_calculado 
                 FROM transportation_relation_items tri
                 JOIN emission_nfe_reports enr ON tri.nfe_report_id = enr.id
                 WHERE tri.relation_id = $1 AND tri.status_item = 'incluida_bipada'
                 AND enr.cancelada = false`, 
                [edit_relation_id]
            );
            
            // Para cada nota, adiciona a chave de acesso ao array o número de vezes correspondente aos volumes
            relationItemsResult.rows.forEach(item => {
                for (let i = 0; i < item.total_volumes_calculado; i++) {
                    barcodesParaCarregar.push(item.nfe_chave_acesso_44d);
                }
            });
        } else {
            const stateResult = await pool.query('SELECT barcodes_json FROM bipagem_state WHERE transportadora_apelido = $1', [transportadoraApelido]);
            if (stateResult.rows.length > 0) {
                barcodesParaCarregar = stateResult.rows[0].barcodes_json;
            }
        }

        const nomeCompleto = getNomeCompletoFromApelido(transportadoraApelido);
        
        // Agora 'notasFiscaisPendentes' contém a justificativa e será passado para o template 'bipagem.hbs'
        res.render('relacao/bipagem', {
            title: `Relação para ${nomeCompleto}`,
            transportadora: { apelido: transportadoraApelido, nomeCompleto: nomeCompleto },
            notasFiscaisPendentes,
            savedBarcodes: barcodesParaCarregar,
            editingRelationId: edit_relation_id || null,
            layout: 'main'
        });

    } catch (error) {
        console.error(`Erro ao carregar página de bipagem para ${transportadoraApelido}:`, error);
        req.flash('error', `Erro ao carregar página de bipagem.`);
        res.redirect('/relacoes');
    }
};

// ✍️ Adicione esta função completa ao seu /controllers/relacaoController.js

/**
 * Retorna os dados das notas fiscais pendentes em formato JSON para uma transportadora.
 */
exports.getPendentesApi = async (req, res) => {
    const { transportadoraApelido } = req.params;
    const edit_relation_id = req.query.edit_relation_id ? parseInt(req.query.edit_relation_id, 10) : null;

    try {
        // Usa a mesma lógica de query da sua função getBipagemPage
        let nfsQuery;
        let queryParams;

        if (edit_relation_id && !isNaN(edit_relation_id)) {
            // Query para o MODO DE EDIÇÃO
            nfsQuery = `
                SELECT 
                    enf.id, enf.nfe_numero, enf.nfe_chave_acesso_44d, enf.total_volumes_calculado, enf.bling_account_type, enf.justificativa,
                    COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list
                FROM emission_nfe_reports enf
                LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
                WHERE 
                    enf.transportadora_apelido = $1 AND
                    (
                        (enf.status_para_relacao = 'pendente' OR enf.status_para_relacao = 'justificada_adiada') OR
                        enf.id IN (SELECT nfe_report_id FROM transportation_relation_items WHERE relation_id = $2)
                    )
                    AND enf.nfe_numero NOT IN ('ERRO', 'N/A')
                    AND enf.cancelada = false 
                ORDER BY CAST(NULLIF(REGEXP_REPLACE(enf.nfe_numero, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, id ASC;
            `;
            queryParams = [transportadoraApelido, edit_relation_id];
        } else {
            // Query para o MODO NORMAL
            nfsQuery = `
                SELECT 
                    enf.id, enf.nfe_numero, enf.nfe_chave_acesso_44d, enf.total_volumes_calculado, enf.bling_account_type, enf.justificativa,
                    COALESCE(cn.product_descriptions_list, enf.product_descriptions_list) as product_descriptions_list
                FROM emission_nfe_reports enf
                LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
                WHERE 
                    enf.transportadora_apelido = $1 AND (enf.status_para_relacao = 'pendente' OR enf.status_para_relacao = 'justificada_adiada')
                    AND enf.nfe_numero NOT IN ('ERRO', 'N/A') 
                    AND enf.cancelada = false
                ORDER BY 
                    CAST(NULLIF(REGEXP_REPLACE(enf.nfe_numero, '[^0-9]', '', 'g'), '') AS INTEGER) ASC NULLS LAST, id ASC;
            `;
            queryParams = [transportadoraApelido];
        }
        
        const nfsResult = await pool.query(nfsQuery, queryParams);
        
        // Mapeia os dados para o formato que o frontend espera
        const notasFiscaisPendentes = nfsResult.rows.map(nf => ({
            idRelatorio: nf.id, 
            numeroNF: nf.nfe_numero, 
            chaveAcesso44d: nf.nfe_chave_acesso_44d,
            totalVolumes: nf.total_volumes_calculado, 
            contaBling: nf.bling_account_type,
            produtos: nf.product_descriptions_list || "Nenhum produto listado.",
            justificativa: nf.justificativa || null
        }));

        res.status(200).json({ notasFiscaisPendentes });

    } catch (error) {
        console.error(`Erro na API ao buscar pendentes para ${transportadoraApelido}:`, error);
        res.status(500).json({ message: "Erro ao buscar dados das notas fiscais." });
    }
};

/**
 * Processa a finalização de uma relação, salva no banco e chama a geração do Excel.
 */
exports.finalizeRelacao = async (req, res) => {
    const { transportadoraApelido } = req.params;
    const { bipadoItems, naoBipadoItems, editingRelationId } = req.body; 
    const username = req.session.username || 'sistema';

    if (!transportadoraApelido) return res.status(400).json({ message: "Apelido da transportadora não fornecido." });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Se um 'editingRelationId' foi enviado, significa que estamos editando.
        // Primeiro, deletamos a relação antiga usando nossa função auxiliar.
        if (editingRelationId) {
            console.log(`[FINALIZE_RELACAO] Modo de Edição: Deletando relação antiga ID: ${editingRelationId}`);
            await _deleteRelationLogic(client, editingRelationId);
        }

        // A partir daqui, o código continua como antes, criando a NOVA relação
        const dataHoje = new Date();
        const tituloRelacao = `${transportadoraApelido} ${dataHoje.toLocaleDateString('pt-BR')}`;

        const relacaoResult = await client.query(
            `INSERT INTO transportation_relations (transportadora_apelido, titulo_relacao, gerada_por_username)
             VALUES ($1, $2, $3) RETURNING id`,
            [transportadoraApelido, tituloRelacao, username]
        );
        const newRelationId = relacaoResult.rows[0].id;
        console.log(`[FINALIZE_RELACAO] Nova relação criada com ID: ${newRelationId}`);

        // Processar itens bipados
        if (bipadoItems && bipadoItems.length > 0) {
            // Cria um conjunto de IDs únicos para evitar duplicatas
            const uniqueNfeReportIds = [...new Set(bipadoItems.map(item => item.nfe_report_id))];

            for (const nfeId of uniqueNfeReportIds) {
                if (!nfeId) continue;
                await client.query(
                    `INSERT INTO transportation_relation_items (relation_id, nfe_report_id, status_item)
                     VALUES ($1, $2, 'incluida_bipada')
                     ON CONFLICT (nfe_report_id)
                     DO UPDATE SET relation_id = EXCLUDED.relation_id, status_item = 'incluida_bipada';`,
                    [newRelationId, nfeId]
                );
                await client.query(
                    "UPDATE emission_nfe_reports SET status_para_relacao = 'relacionada' WHERE id = $1 AND (status_para_relacao = 'pendente' OR status_para_relacao = 'justificada_adiada')",
                    [nfeId]
                );
            }
        }

        // Processar itens não bipados (com justificativas)
        if (naoBipadoItems && naoBipadoItems.length > 0) {
            for (const item of naoBipadoItems) {
                if (!item.nfe_report_id) continue;
                let statusItemNaRelacao = item.naoVaiSair === true ? 'cancelada_desta_relacao' : 'justificada_nao_incluida';
                let novoStatusParaReportPrincipal = item.naoVaiSair === true ? 'cancelada_permanente' : 'justificada_adiada';
                
                await client.query(
                    `INSERT INTO transportation_relation_items (relation_id, nfe_report_id, status_item, justificativa)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (nfe_report_id)
                    DO UPDATE SET
                        relation_id = EXCLUDED.relation_id,
                        status_item = EXCLUDED.status_item,
                        justificativa = EXCLUDED.justificativa;`,
                    [newRelationId, item.nfe_report_id, statusItemNaRelacao, item.justificativa || null]
                    );
                await client.query(
                    "UPDATE emission_nfe_reports SET status_para_relacao = $1, justificativa = $2 WHERE id = $3 AND (status_para_relacao = 'pendente' OR status_para_relacao = 'justificada_adiada')",
                    [novoStatusParaReportPrincipal, item.justificativa, item.nfe_report_id]
                );
            }
        }
        
        //const generatedExcelPath = await generateExcelReport(newRelationId, transportadoraApelido, tituloRelacao, client);
        
        /*if (generatedExcelPath) {
            const fileNameOnly = path.basename(generatedExcelPath);
            await client.query('UPDATE transportation_relations SET arquivo_excel_path = $1 WHERE id = $2', 
            [fileNameOnly, newRelationId]);
        }*/

        await client.query('DELETE FROM bipagem_state WHERE transportadora_apelido = $1', [transportadoraApelido]);
        console.log(`[FINALIZE_RELACAO] Estado de bipagem salvo para '${transportadoraApelido}' foi limpo.`);

        await client.query('COMMIT');
        
        res.status(201).json({ 
            message: `Relação para ${transportadoraApelido} (ID: ${newRelationId}) foi ${editingRelationId ? 'atualizada' : 'salva'} com sucesso.`,
            relationId: newRelationId,
            //excelPath: generatedExcelPath ? path.basename(generatedExcelPath) : null
        });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(`Erro ao finalizar relação para ${transportadoraApelido}:`, error);
        res.status(500).json({ message: `Erro interno ao finalizar relação: ${error.message}` });
    } finally {
        if (client) client.release();
    }
};

/**
 * Permite o download de um relatório Excel gerado.
 */
exports.downloadRelacaoExcel = async (req, res) => {
    const { relationId } = req.params;

    try {
        // 1. Busca os dados da relação (para o nome do arquivo)
        const relacaoResult = await pool.query(
            'SELECT transportadora_apelido, validated_at FROM transportation_relations WHERE id = $1',
            [relationId]
        );

        if (relacaoResult.rows.length === 0) {
            req.flash('error', 'Relação não encontrada.');
            return res.redirect('/relacoes');
        }

        const { transportadora_apelido, validated_at } = relacaoResult.rows[0];
        const nomeCompleto = transportadora_apelido;
        const dataFormatada = new Date(validated_at).toLocaleDateString('pt-BR').replace(/\//g, '-');

        // 2. Busca os itens da relação
        const itemsResult = await pool.query(
            `SELECT enf.nfe_numero
             FROM transportation_relation_items tri
             JOIN emission_nfe_reports enf ON tri.nfe_report_id = enf.id
             WHERE tri.relation_id = $1 AND tri.status_item = 'incluida_bipada'
             AND enf.cancelada = false`,
            [relationId]
        );

        // 3. Cria o arquivo Excel em memória
        const workbook = new ExcelJS.Workbook();
        const sheetName = `${transportadora_apelido} ${dataFormatada}`;
        const worksheet = workbook.addWorksheet(sheetName);

        worksheet.columns = [
            { header: 'Nº Nota Fiscal', key: 'nfe_numero', width: 20 },
            { header: 'Nº Pedido', key: 'pedido_venda', width: 25},
            { header: 'Data', key: 'data', width: 15 },
            { header: 'Transportadora', key: 'transportadora', width: 40 }
        ];
        worksheet.getRow(1).font = { bold: true };

        for (const item of itemsResult.rows) {
            const pedidosResult = await poolInova.query(
                `SELECT numero_pedido 
                FROM pedidos_em_rastreamento
                WHERE numero_nfe = $1`,
                [item.nfe_numero]
            );

            const numeroPedido = pedidosResult.rows[0]?.numero_pedido || "N/A";

            worksheet.addRow({
                nfe_numero: parseInt(item.nfe_numero, 10),
                pedido_venda: numeroPedido,
                data: dataFormatada,
                transportadora: nomeCompleto
            });
        }

        // 4. Envia o arquivo para o navegador
        const fileName = `Relacao-${transportadora_apelido}-${dataFormatada}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error(`Erro ao gerar relatório Excel para relação ID ${relationId}:`, error);
        req.flash('error', 'Falha ao gerar o relatório Excel.');
        res.redirect('/relacoes');
    }
};

// --- FUNÇÕES PARA A PÁGINA DE CANCELADAS ---
exports.getCanceladasPage = async (req, res) => {
    try {
        res.render('relacao/canceladas', {
            title: 'NF-e Canceladas (Não Sairão)',
            layout: 'main'
        });
    } catch (error) {
        console.error("Erro ao renderizar página de NF-e Canceladas:", error);
        req.flash('error', 'Erro ao carregar página de NF-e Canceladas.');
        res.redirect('/relacoes'); // Ou para a página inicial
    }
};

exports.getNfesCanceladasApi = async (req, res) => {
    try {
        const query = `
            SELECT enf.id, enf.nfe_numero, enf.nfe_chave_acesso_44d, enf.transportadora_apelido, 
                   e.title AS emissao_title, 
                   enf.data_processamento AS data_referencia -- Data do processamento original da NF no sistema de emissão
            FROM emission_nfe_reports enf
            LEFT JOIN emissions e ON enf.emission_id = e.id -- LEFT JOIN caso a emissão original seja deletada
            WHERE enf.status_para_relacao = 'cancelada_permanente'
            ORDER BY enf.data_processamento DESC, enf.nfe_numero ASC; 
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar NF-e canceladas (API):", error);
        res.status(500).json({ message: "Erro ao buscar NF-e canceladas." });
    }
};

exports.reativarNfeCanceladaApi = async (req, res) => {
    const nfeReportId = parseInt(req.params.nfeReportId, 10);
    if (isNaN(nfeReportId)) {
        return res.status(400).json({ message: "ID da NF-e do relatório inválido." });
    }
    try {
        const result = await pool.query(
            "UPDATE emission_nfe_reports SET status_para_relacao = 'pendente' WHERE id = $1 AND status_para_relacao = 'cancelada_permanente' RETURNING id, nfe_numero",
            [nfeReportId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: "NF-e não encontrada para reativação ou já estava ativa." });
        }
        res.status(200).json({ message: `NF-e Nº ${result.rows[0].nfe_numero} reativada. Ela aparecerá como pendente para futuras relações.` });
    } catch (error) {
        console.error(`Erro ao reativar NF-e (Report ID: ${nfeReportId}):`, error);
        res.status(500).json({ message: "Erro interno ao tentar reativar a NF-e." });
    }
};

// Em controllers/relacaoController.js

// Em controllers/relacaoController.js

exports.getPrintableRelacaoPage = async (req, res) => {
    const relationId = parseInt(req.params.relationId, 10);
    if (isNaN(relationId)) { return res.status(400).send("ID da Relação inválido."); }

    try {
        const relacaoResult = await pool.query('SELECT transportadora_apelido, is_validated, validated_at FROM transportation_relations WHERE id = $1', [relationId]);
        if (relacaoResult.rows.length === 0) { return res.status(404).send("Relação não encontrada."); }
        const { transportadora_apelido, is_validated, validated_at } = relacaoResult.rows[0];

        const itemsResult = await pool.query(
            `SELECT 
                enf.nfe_numero, 
                enf.total_volumes_calculado, 
                enf.bling_account_type,
                cn.bling_id -- Pega o ID do Bling da tabela de cache de NFs
             FROM transportation_relation_items tri 
             JOIN emission_nfe_reports enf ON tri.nfe_report_id = enf.id
             -- Faz o JOIN com o cache para buscar o bling_id
             LEFT JOIN cached_nfe cn ON enf.nfe_chave_acesso_44d = cn.chave_acesso
             WHERE tri.relation_id = $1 AND tri.status_item = 'incluida_bipada'
             AND enf.cancelada = false`,
            [relationId]
        );
        const itemsParaRelacao = itemsResult.rows;

        const empresaEliane = { nome: "ELIANE TRIDAPALLI ANZAI ME", cnpj: "34.321.153/0001-52" };
        const empresaLucas = { nome: "INOVA MAGAZINE COMERCIOS DE MOVEIS LTDA", cnpj: "40.062.295/0001-45" };
        const nfsEliane = itemsParaRelacao.filter(item => item.bling_account_type === 'eliane');
        const nfsLucas = itemsParaRelacao.filter(item => item.bling_account_type === 'lucas');

        const elianeBlingIds = nfsEliane.map(nf => nf.bling_id);
        const lucasBlingIds = nfsLucas.map(nf => nf.bling_id);
        
        const nfsPorParDeColunas = 50; // Cada "página" de colunas tem 50 linhas de dados (11 a 60)
        
        // O número de linhas na tabela será definido pela maior das duas listas
        const totalVisualRows = Math.max(nfsEliane.length, nfsLucas.length);

        // 1. Cria um "grid" de linhas vazio. O tamanho dele será o da maior lista.
        const printableRows = [];
        for (let i = 0; i < totalVisualRows; i++) {
            printableRows.push({}); // Adiciona um objeto vazio para cada linha visual
        }

        // 2. Preenche os dados da Eliane no grid
        nfsEliane.forEach((item, index) => {
            const targetRow = index % nfsPorParDeColunas;      // Linha alvo dentro do bloco (0-49)
            const targetColPair = Math.floor(index / nfsPorParDeColunas); // Par de colunas alvo (0, 1, ou 2)

            if (targetColPair < 3) { // Garante que não tente usar um 4º par de colunas
                printableRows[targetRow][`elianeNf${targetColPair + 1}`] = item.nfe_numero;
                printableRows[targetRow][`elianeVol${targetColPair + 1}`] = item.total_volumes_calculado || 0;
            }
        });

        // 3. Preenche os dados do Lucas no MESMO grid
        nfsLucas.forEach((item, index) => {
            const targetRow = index % nfsPorParDeColunas;
            const targetColPair = Math.floor(index / nfsPorParDeColunas);

            if (targetColPair < 3) {
                printableRows[targetRow][`lucasNf${targetColPair + 1}`] = item.nfe_numero;
                printableRows[targetRow][`lucasVol${targetColPair + 1}`] = item.total_volumes_calculado || 0;
            }
        });

        const numLinhasEmBranco = Math.max(0, 50 - printableRows.length);
        const totais = {
            elianeNfs: nfsEliane.length, elianeVols: nfsEliane.reduce((s, i) => s + (i.total_volumes_calculado || 0), 0),
            lucasNfs: nfsLucas.length, lucasVols: nfsLucas.reduce((s, i) => s + (i.total_volumes_calculado || 0), 0),
            geralNfs: itemsParaRelacao.length, geralVols: itemsParaRelacao.reduce((s, i) => s + (i.total_volumes_calculado || 0), 0)
        };
        
        res.render('relacao/print-relacao', {
            layout: 'print',
            title: `Impressão Relação - ${transportadora_apelido}`,
            transportadoraCompleto: getNomeCompletoFromApelido(transportadora_apelido),
            dataRelacao: new Date(validated_at).toLocaleDateString('pt-BR'),
            empresaEliane, empresaLucas,
            printableRows, numLinhasEmBranco,
            totais, itemsParaRelacao, is_validated,
            elianeBlingIds,
            lucasBlingIds
        });

    } catch (error) {
        console.error(`Erro ao gerar página de impressão:`, error);
        res.status(500).send("Erro interno ao gerar a página de impressão.");
    }
};

exports.updateNfeJustificationApi = async (req, res) => {
    const { nfeReportId } = req.params;
    const { justificativa } = req.body;
    const client = await pool.connect(); // Pega uma conexão do pool para a transação

    if (!justificativa) {
        return res.status(400).json({ message: "Justificativa não fornecida." });
    }

    try {
        // Inicia a transação
        await client.query('BEGIN');

        // 1. Atualiza a tabela principal 'emission_nfe_reports'
        // Define a justificativa e atualiza o status para 'justificada_adiada'
        const updateEmissionReportQuery = `
            UPDATE emission_nfe_reports
            SET 
                justificativa = $1,
                status_para_relacao = 'justificada_adiada'
            WHERE id = $2
            RETURNING nfe_numero;
        `;
        const result = await client.query(updateEmissionReportQuery, [justificativa, nfeReportId]);

        if (result.rowCount === 0) {
            // Se a nota não for encontrada, lança um erro para acionar o rollback
            throw new Error("Nota Fiscal não encontrada.");
        }
        
        // Isto garante que o histórico de justificativas em relações antigas também seja atualizado.
        const updateRelationItemsQuery = `
            UPDATE transportation_relation_items
            SET justificativa = $1
            WHERE nfe_report_id = $2;
        `;
        await client.query(updateRelationItemsQuery, [justificativa, nfeReportId]);

        // Se ambas as queries foram bem-sucedidas, confirma as alterações no banco
        await client.query('COMMIT');

        res.status(200).json({ message: `Justificativa da NF Nº ${result.rows[0].nfe_numero} foi atualizada com sucesso em todos os registros.` });

    } catch (error) {
        // Se qualquer erro ocorrer, desfaz todas as alterações
        await client.query('ROLLBACK');
        console.error(`Erro ao atualizar justificativa da NF-e ID ${nfeReportId}:`, error);
        res.status(500).json({ message: `Erro ao salvar justificativa: ${error.message}` });
    } finally {
        // Libera a conexão de volta para o pool
        client.release();
    }
};

/**
 * API: Busca todas as relações de transporte já salvas.
 */
exports.getSalvasApi = async (req, res) => {
    try {
        const query = `
            SELECT 
            id, 
            titulo_relacao, 
            transportadora_apelido, 
            gerada_por_username, 
            COALESCE(validated_at, data_geracao) AS validated_at,
            arquivo_excel_path, 
            is_validated, 
            is_checked
            FROM transportation_relations
            ORDER BY COALESCE(validated_at, data_geracao) DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar relações salvas (API):", error);
        res.status(500).json({ message: "Erro ao buscar relações salvas." });
    }
};

/**
 * API: Atualiza o status de uma NF-e específica.
 * Recebe o novo status no corpo da requisição.
 */
exports.updateNfeStatusApi = async (req, res) => {
    const nfeReportId = parseInt(req.params.nfeReportId, 10);
    const { novoStatus } = req.body; // ex: 'pendente', 'cancelada_permanente'

    const statusValidos = ['pendente', 'justificada_adiada', 'cancelada_permanente'];
    if (isNaN(nfeReportId) || !novoStatus || !statusValidos.includes(novoStatus)) {
        return res.status(400).json({ message: "Dados inválidos fornecidos." });
    }

    try {
        const result = await pool.query(
            "UPDATE emission_nfe_reports SET status_para_relacao = $1 WHERE id = $2 RETURNING id, nfe_numero",
            [novoStatus, nfeReportId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "NF-e não encontrada para atualização." });
        }
        res.status(200).json({ message: `Status da NF Nº ${result.rows[0].nfe_numero} atualizado para '${novoStatus}'.` });
    } catch (error) {
        console.error(`Erro ao atualizar status da NF-e (Report ID: ${nfeReportId}):`, error);
        res.status(500).json({ message: "Erro interno ao tentar atualizar o status." });
    }
};

exports.validateRelacao = async (req, res) => {
    const relationId = parseInt(req.params.relationId, 10);
    const username = req.session.username || 'sistema';

    if (isNaN(relationId)) {
        return res.status(400).json({ message: "ID da Relação inválido." });
    }

    try {
        const result = await pool.query(
            `UPDATE transportation_relations 
             SET is_validated = true, validated_at = NOW(), validated_by = $1 
             WHERE id = $2 RETURNING id, titulo_relacao`,
            [username, relationId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Relação não encontrada para validar." });
        }
        res.status(200).json({ message: `Relação "${result.rows[0].titulo_relacao}" validada com sucesso!` });

    } catch (error) {
        console.error(`Erro ao validar Relação ID ${relationId}:`, error);
        res.status(500).json({ message: "Erro interno ao validar a relação." });
    }
};

exports.checkRelacao = async (req, res) => {
    const relationId = parseInt(req.params.relationId, 10);
    const username = req.session.username || 'sistema';

    if (isNaN(relationId)) {
        return res.status(400).json({ message: "ID da Relação inválido." });
    }

    try {
        const result = await pool.query(
            `UPDATE transportation_relations 
             SET is_checked = true, checked_by = $1 
             WHERE id = $2 RETURNING id, titulo_relacao`,
            [username, relationId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "Relação não encontrada para checar." });
        }
        res.status(200).json({ message: `Relação "${result.rows[0].titulo_relacao}" checada com sucesso!` });

    } catch (error) {
        console.error(`Erro ao validar Relação ID ${relationId}:`, error);
        res.status(500).json({ message: "Erro interno ao checar a relação." });
    }
};


/**
 * API: Exclui uma relação E reverte o status das NFs associadas para 'pendente'.
 */
exports.deleteRelacao = async (req, res) => {
    const relationId = parseInt(req.params.id, 10);
    if (isNaN(relationId)) {
        return res.status(400).json({ message: "ID da Relação inválido." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Apenas chama a função de lógica interna
        await _deleteRelationLogic(client, relationId);
        
        await client.query('COMMIT');
        res.status(200).json({ message: `Relação excluída e notas retornadas ao status pendente.` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Erro ao excluir Relação ID ${relationId}:`, error);
        res.status(500).json({ message: `Erro ao excluir a relação: ${error.message}` });
    } finally {
        client.release();
    }
};

exports.saveBipagemState = async (req, res) => {
    const { transportadoraApelido } = req.params;
    const { barcodes } = req.body; // Espera um array de strings

    if (!transportadoraApelido || !Array.isArray(barcodes)) {
        return res.status(400).json({ message: "Dados inválidos." });
    }

    try {
        // Usa a sintaxe "UPSERT": Tenta inserir. Se já existir (conflito no apelido), atualiza.
        const query = `
            INSERT INTO bipagem_state (transportadora_apelido, barcodes_json)
            VALUES ($1, $2)
            ON CONFLICT (transportadora_apelido) 
            DO UPDATE SET barcodes_json = EXCLUDED.barcodes_json, updated_at = NOW();
        `;
        await pool.query(query, [transportadoraApelido, JSON.stringify(barcodes)]);

        res.status(200).json({ message: "Progresso da bipagem salvo com sucesso!" });
    } catch (error) {
        console.error(`Erro ao salvar estado da bipagem para ${transportadoraApelido}:`, error);
        res.status(500).json({ message: "Erro interno ao salvar o progresso." });
    }
};

async function _deleteRelationLogic(client, relationId) {
    console.log(`[Lógica Interna] Deletando relação antiga ID: ${relationId}`);
    const itemsResult = await client.query('SELECT nfe_report_id FROM transportation_relation_items WHERE relation_id = $1', [relationId]);
    const nfeReportIds = itemsResult.rows.map(row => row.nfe_report_id);

    if (nfeReportIds.length > 0) {
        const updateQuery = `UPDATE emission_nfe_reports SET status_para_relacao = 'pendente' WHERE id = ANY($1::int[]) AND status_para_relacao = 'relacionada'`;
        await client.query(updateQuery, [nfeReportIds]);
    }

    const deleteResult = await client.query('DELETE FROM transportation_relations WHERE id = $1 AND is_validated = false', [relationId]);
    if (deleteResult.rowCount === 0) {
        throw new Error("Relação não encontrada ou já está validada e não pode ser editada/excluída.");
    }
}

exports.clearBipagemState = async (req, res) => {
    const { transportadoraApelido } = req.params;

    if (!transportadoraApelido) {
        return res.status(400).json({ message: "Apelido da transportadora não fornecido." });
    }

    try {
        // A query deleta a linha inteira da tabela bipagem_state para aquela transportadora
        const result = await pool.query(
            'DELETE FROM bipagem_state WHERE transportadora_apelido = $1',
            [transportadoraApelido]
        );

        if (result.rowCount > 0) {
            console.log(`[Bipagem State] Estado salvo para '${transportadoraApelido}' foi limpo.`);
        }

        // Retorna sucesso mesmo se não havia nada para limpar
        res.status(200).json({ message: "Estado de bipagem limpo com sucesso." });

    } catch (error) {
        console.error(`Erro ao limpar estado de bipagem para ${transportadoraApelido}:`, error);
        res.status(500).json({ message: "Erro interno ao limpar o estado salvo." });
    }
};

/**
 * Atualiza a quantidade de volumes de uma nota fiscal específica.
 */
exports.updateNfeVolumes = async (req, res) => {
    const { nfeReportId } = req.params;
    const { newVolumes } = req.body;

    // Validação dos dados recebidos
    if (newVolumes === undefined || isNaN(parseInt(newVolumes, 10)) || parseInt(newVolumes, 10) < 0) {
        return res.status(400).json({ message: "Quantidade de volumes inválida." });
    }

    try {
        const result = await pool.query(
            'UPDATE emission_nfe_reports SET total_volumes_calculado = $1 WHERE id = $2 RETURNING nfe_numero',
            [parseInt(newVolumes, 10), nfeReportId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nota Fiscal não encontrada.' });
        }

        res.status(200).json({ 
            message: `Volumes da NF Nº ${result.rows[0].nfe_numero} atualizados para ${newVolumes}.`
        });

    } catch (error) {
        console.error(`Erro ao atualizar volumes da NF-e ID ${nfeReportId}:`, error);
        res.status(500).json({ message: `Erro interno ao atualizar volumes: ${error.message}` });
    }
};

// Em /controllers/relacaoController.js
// Local: /controllers/relacaoController.js

exports.getNfeWeightApi = async (req, res) => {
    const { nfeNumeros } = req.body;

    if (!nfeNumeros || !Array.isArray(nfeNumeros) || nfeNumeros.length === 0) {
        return res.status(400).json({ message: "Lista de números de NF-e não fornecida." });
    }

    console.log('--- DEBUG: get-nfe-weight ---');
    console.log('Números de NF-e recebidos:', nfeNumeros);

    const client = await pool.connect();
    try {
        const weightQuery = `
            WITH unique_products AS (
                SELECT DISTINCT ON (sku) -- Garante que cada SKU seja usado apenas uma vez
                    sku,
                    peso_bruto
                FROM
                    cached_products
            )
            SELECT
                SUM(up.peso_bruto * nqp.quantidade) as total_weight
            FROM
                nfe_quantidade_produto AS nqp
            JOIN
                unique_products AS up ON nqp.produto_codigo = up.sku
            WHERE
                nqp.nfe_numero = ANY($1::text[]);
        `;

        const productWeightsResult = await client.query(weightQuery, [nfeNumeros]);

        console.log('Resultado da soma de pesos (do DB):', productWeightsResult.rows[0]);

        // Se a query não retornar nada (ex: nenhum produto encontrado), o valor será 'null'.
        // O '|| 0' garante que, nesse caso, retornemos 0.
        const totalWeight = parseFloat(productWeightsResult.rows[0].total_weight) || 0;
        
        console.log('Peso total final calculado (considerando quantidades):', totalWeight);
        console.log('-----------------------------------');

        res.status(200).json({ totalWeight: totalWeight });

    } catch (error) {
        console.error("[API GetNfeWeight] Erro ao calcular peso:", error);
        res.status(500).json({ message: "Erro ao calcular o peso dos produtos." });
    } finally {
        if (client) client.release();
    }
};