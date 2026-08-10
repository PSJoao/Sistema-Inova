// services/mlBatchService.js

const axios = require('axios');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getValidBlingToken } = require('./blingTokenManager');

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';
const TARGET_STATUS_IDS = {
    lucas: '716469',
    eliane: '840705'
};
const MAX_RETRIES = 5;
const DELAY_MS = 400;

const { Pool } = require('pg'); // Adicionar

// Configuração do Banco de Dados
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Helper para pausas (delay)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executa uma requisição axios com lógica de retentativa (Retry) e delay.
 * @param {Function} requestFn Função que retorna a Promise do axios.
 * @param {string} context Descrição do contexto para logs.
 */
async function executeWithRetry(requestFn, context) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Executa a requisição
            const result = await requestFn();
            return result;
        } catch (error) {
            lastError = error;
            const status = error.response ? error.response.status : 'Network/Unknown';
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            console.warn(`[ML Batch] Erro na tentativa ${attempt}/${MAX_RETRIES} para ${context}. Status: ${status}. Motivo: ${detail}`);

            // Não tenta novamente se for erro 4xx do cliente (ex: 400 Bad Request, 404 Not Found, 422 Unprocessable)
            // exceto 429 (Rate Limit Exceeded)
            if (error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
                break;
            }

            if (attempt === MAX_RETRIES) break;

            const retryDelay = 1000 * attempt;
            await sleep(retryDelay);
        }
    }
    throw lastError;
}

exports.processarArquivoDeMapeamento = async (inputFilePath) => {
    console.log(`[ML Mapping] Processando arquivo de tradução: ${inputFilePath}`);

    const workbook = xlsx.readFile(inputFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // header: 1 traz array de arrays
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    const client = await pool.connect();
    let processedCount = 0;

    try {
        await client.query('BEGIN');

        // Começa da linha 2 (índice 1 no array)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;

            // Coluna A (0) = Venda Real, Coluna B (1) = Pack ID
            // Removemos o '#' e espaços
            let vendaReal = row[0] ? String(row[0]).trim().replace(/#/g, '') : null;
            let packId = row[1] ? String(row[1]).trim().replace(/#/g, '') : null;

            if (!vendaReal || !packId) continue;

            // UPSERT: Se o pack_id já existir, atualiza o numero_venda
            await client.query(`
                INSERT INTO ml_pack_id_mapping (pack_id, numero_venda, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (pack_id) 
                DO UPDATE SET numero_venda = EXCLUDED.numero_venda, updated_at = CURRENT_TIMESTAMP
            `, [packId, vendaReal]);

            processedCount++;
        }

        await client.query('COMMIT');
        console.log(`[ML Mapping] Sucesso. ${processedCount} registros atualizados.`);

        // Limpa arquivo de upload
        try { fs.unlinkSync(inputFilePath); } catch (e) { }

        return { success: true, count: processedCount, message: 'Mapeamento atualizado com sucesso.' };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[ML Mapping] Erro ao salvar no banco:', error);
        throw error;
    } finally {
        client.release();
    }
};

exports.processarArquivoDePedidos = async (inputFilePath, accountName = 'lucas') => {
    const validAccount = (accountName && accountName.toLowerCase() === 'eliane') ? 'eliane' : 'lucas';
    const targetStatusId = TARGET_STATUS_IDS[validAccount] || TARGET_STATUS_IDS.lucas;
    console.log(`[ML Batch - ${validAccount.toUpperCase()}] Iniciando processamento do arquivo: ${inputFilePath} (Target Status: ${targetStatusId})`);

    // 1. Ler o arquivo Excel
    const workbook = xlsx.readFile(inputFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Converte para JSON array de arrays (linhas)
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    // Arrays para o relatório final
    const successList = [];
    const errorList = [];

    // 2. Iterar a partir da linha 7 (índice 6)
    const START_ROW_INDEX = 6; // Linha 7 visualmente

    for (let i = START_ROW_INDEX; i < rows.length; i++) {
        const row = rows[i];
        const numeroLoja = row && row[0] ? String(row[0]).trim() : null;

        if (!numeroLoja) continue;

        console.log(`[ML Batch - ${validAccount.toUpperCase()}] Processando pedido Loja: ${numeroLoja}...`);

        try {
            // --- PASSO A: BUSCAR ID DO PEDIDO (COM LÓGICA DE FALLBACK) ---
            await sleep(DELAY_MS); // Pausa mandatória antes da busca

            let pedidoEncontrado = null;

            // TENTATIVA 1: Busca Direta pelo número da planilha
            try {
                const searchFn = async () => {
                    const token = await getValidBlingToken(validAccount);
                    const cleanNumeroLoja = numeroLoja.replace(/#/g, '');
                    const url = `${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${encodeURIComponent(cleanNumeroLoja)}`;
                    return axios.get(url, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                };

                const searchResponse = await executeWithRetry(searchFn, `Busca Direta ${numeroLoja}`);

                if (searchResponse.data && searchResponse.data.data && searchResponse.data.data.length > 0) {
                    pedidoEncontrado = searchResponse.data.data[0];
                }
            } catch (ignoredError) {
                // Se der erro na busca direta, ignoramos para tentar o fallback
            }

            // TENTATIVA 2 (FALLBACK): Se não achou, busca na tabela de tradução
            if (!pedidoEncontrado) {
                const cleanPackId = numeroLoja.replace(/#/g, '');

                // Consulta o banco local
                const mapResult = await pool.query('SELECT numero_venda FROM ml_pack_id_mapping WHERE pack_id = $1', [cleanPackId]);

                if (mapResult.rows.length > 0) {
                    const numeroReal = mapResult.rows[0].numero_venda;
                    console.log(`   > [Fallback] Pack ID ${cleanPackId} traduzido para Venda ${numeroReal}. Buscando novamente...`);

                    await sleep(DELAY_MS); // Pausa mandatória para a nova requisição

                    try {
                        const fallbackSearchFn = async () => {
                            const token = await getValidBlingToken(validAccount);
                            const url = `${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${encodeURIComponent(numeroReal)}`;
                            return axios.get(url, {
                                headers: { Authorization: `Bearer ${token}` }
                            });
                        };

                        const fallbackResponse = await executeWithRetry(fallbackSearchFn, `Busca Fallback ${numeroReal}`);

                        if (fallbackResponse.data && fallbackResponse.data.data && fallbackResponse.data.data.length > 0) {
                            pedidoEncontrado = fallbackResponse.data.data[0];
                        }
                    } catch (fbErr) {
                        console.warn(`   > [Fallback] Falha ao buscar pelo número traduzido: ${fbErr.message}`);
                    }
                }
            }

            // Se após as duas tentativas ainda não tiver pedido, lança erro
            if (!pedidoEncontrado) {
                throw new Error('Pedido não encontrado no Bling (nem direto, nem via tradução de Pack ID).');
            }

            // Extrai dados do pedido encontrado
            const pedidoId = pedidoEncontrado.id;
            const situacaoAtual = String(pedidoEncontrado.situacao?.id);

            // Verifica redundância
            if (situacaoAtual === targetStatusId) {
                console.log(`   > Pedido ${numeroLoja} (ID: ${pedidoId}) já está na situação correta (${targetStatusId}). Pulando.`);
                successList.push([numeroLoja, 'Já estava atualizado (Ignorado)']);
                continue; // Pula para o próximo loop sem fazer o PATCH
            }

            console.log(`   > ID Bling encontrado: ${pedidoId}. Atualizando situação para ${targetStatusId}...`);

            // --- PASSO B: ATUALIZAR SITUAÇÃO (PATCH) ---
            await sleep(DELAY_MS); // Pausa mandatória entre busca e atualização

            const updateFn = async () => {
                const token = await getValidBlingToken(validAccount);
                const url = `${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}/situacoes/${targetStatusId}`;
                return axios.patch(url, { id: Number(targetStatusId) }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            };

            await executeWithRetry(updateFn, `Update Status Pedido ${pedidoId}`);

            // Sucesso
            successList.push([numeroLoja, 'Atualizado com sucesso']);
            console.log(`   > Sucesso: ${numeroLoja} -> Status ${targetStatusId}`);

        } catch (err) {
            let msg = err.message;
            if (err.response?.data) {
                const errorData = err.response.data;
                const errorDesc = errorData.error?.description || errorData.error?.message;
                const fieldsMsg = errorData.error?.fields
                    ? errorData.error.fields.map(f => `${f.field || f.element || ''}: ${f.msg || f.description || f.message || ''}`).join(', ')
                    : '';
                msg = [errorDesc, fieldsMsg].filter(Boolean).join(' | ') || JSON.stringify(errorData);
            }
            errorList.push([numeroLoja, msg]);
            console.error(`   > Falha: ${numeroLoja} - ${msg}`);
        }
    }

    // 3. Gerar Relatório de Saída
    console.log('[ML Batch] Gerando relatório final...');

    // Cria nova planilha
    const newWb = xlsx.utils.book_new();

    // Monta dados: Cabeçalho + Linhas
    const maxRows = Math.max(successList.length, errorList.length);
    const reportData = [['PEDIDOS COM SUCESSO', 'PEDIDOS COM ERRO (MOTIVO)']];

    for (let j = 0; j < maxRows; j++) {
        const successItem = successList[j] ? successList[j][0] : '';
        const errorItem = errorList[j] ? `${errorList[j][0]} - ${errorList[j][1]}` : '';
        reportData.push([successItem, errorItem]);
    }

    const newWs = xlsx.utils.aoa_to_sheet(reportData);

    // Ajuste de largura de coluna (cosmético)
    newWs['!cols'] = [{ wch: 30 }, { wch: 50 }];

    xlsx.utils.book_append_sheet(newWb, newWs, 'Relatorio Processamento');

    // Define nome do arquivo de saída
    const outputFileName = `Relatorio_ML_Batch_${Date.now()}.xlsx`;
    const outputDir = path.join(__dirname, '..', 'reports'); // Pasta reports na raiz

    // Garante que a pasta existe
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, outputFileName);
    xlsx.writeFile(newWb, outputPath);

    console.log(`[ML Batch] Processamento finalizado. Relatório salvo em: ${outputPath}`);

    return outputFileName; // Retorna apenas o nome para o controller fazer o download
};