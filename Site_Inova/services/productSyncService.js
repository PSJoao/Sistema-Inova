// services/productSyncService.js
const { Pool } = require('pg');
// Importa a função de retentativa do blingSyncService original
const { apiRequestWithRetry } = require('../blingSyncService'); // Ajuste o caminho se necessário

// Configuração do banco de dados (igual ao blingSyncService)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';

/**
 * Processa e salva as estruturas de um produto específico no cache.
 * (Função inalterada - mantenha a versão anterior)
 */
async function processAndCacheStructuresForSku(productData, accountType, client) {
    if (!productData.estrutura?.componentes?.length) return;
    await client.query(
        'DELETE FROM cached_structures WHERE parent_product_bling_id = $1 AND parent_product_bling_account = $2',
        [productData.id, accountType]
    );
    for (const componente of productData.estrutura.componentes) {
        try {
            const componenteId = componente.produto?.id;
            if (!componenteId) continue;
            await new Promise(resolve => setTimeout(resolve, 500)); // Pausa
            const componenteDetails = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${componenteId}`, accountType)).data;
            await client.query(
                `INSERT INTO cached_structures (
                    parent_product_bling_id, parent_product_bling_account, component_sku,
                    component_location, structure_name, gtin, gtin_embalagem
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (parent_product_bling_id, parent_product_bling_account, component_sku)
                DO NOTHING`,
                [
                    productData.id, accountType, componenteDetails.codigo,
                    componenteDetails.estoque?.localizacao, componenteDetails.nome,
                    componenteDetails.gtin, componenteDetails.gtinEmbalagem
                ]
            );
            // console.log(`   [StructSync-${accountType}] Estrutura salva: Pai ${productData.codigo} -> Comp ${componenteDetails.codigo}`);
        } catch (error) {
            console.error(`[StructSync-${accountType}] Erro ao processar componente ID ${componente.produto?.id} do produto ${productData.codigo}. Pulando. Detalhe: ${error.message}`);
        }
    }
}


/**
 * Sincroniza uma lista de produtos (e suas estruturas) a partir dos SKUs fornecidos.
 * @param {string[]} skus Lista de SKUs a serem sincronizados.
 * @param {string} accountType 'lucas' ou 'eliane'.
 * @returns {Promise<object>} Um objeto com o resultado { successCount, errorCount, errors: [] }.
 */
async function syncProductsBySku(skus, accountType) {
    // Se não há SKUs, retorna imediatamente com a estrutura correta
    if (!skus || skus.length === 0) {
        return { successCount: 0, errorCount: 0, errors: [] }; // Garante que 'errors' é um array vazio
    }

    console.log(`[ProductSync-${accountType}] Iniciando sincronização para ${skus.length} SKUs.`);
    const client = await pool.connect();
    let successCount = 0;
    let errorCount = 0;
    const errors = []; // Inicializa como array vazio

    try {
        for (const sku of skus) {
            const skuTrimmed = sku.trim();
            if (!skuTrimmed) continue; // Pula SKUs vazios

            let skuToProcess = skuTrimmed; // SKU que será efetivamente usado na API
            let originalSku = skuTrimmed; // SKU da planilha

            // *** INÍCIO DA NOVA LÓGICA DE VERIFICAÇÃO ***
            try {
                // 1. Verifica se o SKU é um produto principal
                const productCheck = await client.query(
                    `SELECT 1 FROM cached_products WHERE sku = $1 AND bling_account = $2`,
                    [skuTrimmed, accountType]
                );

                if (productCheck.rowCount === 0) {
                    // 2. Se não for, verifica se é um componente (estrutura)
                    console.log(`[ProductSync-${accountType}] SKU ${skuTrimmed} não é um produto. Verificando se é um componente...`);
                    
                    const structureCheck = await client.query(
                        `SELECT p.sku AS parent_sku 
                         FROM cached_structures s
                         JOIN cached_products p ON s.parent_product_bling_id = p.bling_id 
                         WHERE s.component_sku = $1 
                           AND s.parent_product_bling_account = $2
                           AND p.bling_account = $2
                         LIMIT 1`,
                        [skuTrimmed, accountType]
                    );

                    if (structureCheck.rowCount > 0) {
                        // 3. É um componente! Define o 'skuToProcess' como o SKU do produto pai
                        skuToProcess = structureCheck.rows[0].parent_sku;
                        console.log(`[ProductSync-${accountType}] SKU ${skuTrimmed} é um componente. Sincronizando produto PAI: ${skuToProcess}`);
                    } else {
                        // 4. Não é produto nem componente. Trata como SKU novo (mantém skuToProcess = skuTrimmed)
                        console.log(`[ProductSync-${accountType}] SKU ${skuTrimmed} não encontrado no cache. Tentando buscar no Bling como SKU principal.`);
                    }
                }
            } catch (dbError) {
                console.error(`[ProductSync-${accountType}] Erro ao verificar SKU ${skuTrimmed} no cache: ${dbError.message}. Tentando como SKU principal.`);
                // Se houver erro no DB, apenas continua usando o SKU original
                skuToProcess = skuTrimmed;
            }
            // *** FIM DA NOVA LÓGICA DE VERIFICAÇÃO ***


            console.log(`[ProductSync-${accountType}] Processando SKU: ${originalSku} (como ${skuToProcess})`);

            try {
                // Inicia transação por produto
                await client.query('BEGIN');

                // 1. Busca produto (usando skuToProcess)
                const productSearchResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${encodeURIComponent(skuToProcess)}&tipo=P&ativos=true`, accountType);

                const productSearchResult = productSearchResponse.data;

                if (!productSearchResult || productSearchResult.length === 0) {
                    throw new Error(`Produto com SKU ${skuToProcess} (planilha: ${originalSku}) não encontrado ou inativo no Bling.`);
                }
                const productId = productSearchResult[0].id;

                // 2. Busca detalhes
                await new Promise(resolve => setTimeout(resolve, 500)); // Pausa
                const produtoDetalhesResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${productId}`, accountType);
                const produtoDetalhes = produtoDetalhesResponse.data;

                // 3. Salva/Atualiza produto no DB
                await client.query(
                    `INSERT INTO cached_products (
                        bling_id, bling_account, sku, nome, preco_custo, peso_bruto, volumes, last_updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (bling_id, bling_account)
                    DO UPDATE SET sku = EXCLUDED.sku, nome = EXCLUDED.nome, preco_custo = EXCLUDED.preco_custo,
                                 peso_bruto = EXCLUDED.peso_bruto, volumes = EXCLUDED.volumes, last_updated_at = NOW()`,
                    [
                        produtoDetalhes.id, accountType, produtoDetalhes.codigo, produtoDetalhes.nome,
                        produtoDetalhes.fornecedor?.precoCusto ?? null, produtoDetalhes.pesoBruto,
                        produtoDetalhes.volumes
                    ]
                );
                // console.log(`   [ProductSync-${accountType}] Produto ${skuToProcess} salvo/atualizado.`);

                // 4. Processa estruturas
                await processAndCacheStructuresForSku(produtoDetalhes, accountType, client);

                // Confirma transação do produto
                await client.query('COMMIT');
                successCount++;

            } catch (error) {
                // Desfaz transação em caso de erro para este SKU
                await client.query('ROLLBACK');
                console.error(`[ProductSync-${accountType}] Erro ao processar SKU ${originalSku} (processado como ${skuToProcess}): ${error.message}`);
                errorCount++;
                // Reporta o erro usando o SKU original da planilha
                errors.push({ sku: originalSku, message: error.message }); 
                // Continua para o próximo SKU
            }

            // Pausa entre SKUs diferentes
            await new Promise(resolve => setTimeout(resolve, 500));

        } // Fim do loop for (const sku of skus)

    } catch (generalError) {
        // Erro não relacionado a um SKU específico (ex: DB)
        console.error(`[ProductSync-${accountType}] Erro geral durante sincronização: ${generalError.message}`);
        errors.push({ sku: 'GERAL', message: generalError.message }); // Adiciona ao array 'errors'
        // Ajusta contagem de erros se erro geral ocorreu antes de processar todos
        errorCount = skus.length - successCount;
    } finally {
        client.release();
        console.log(`[ProductSync-${accountType}] Sincronização finalizada. Sucesso: ${successCount}, Erros: ${errorCount}`);
    }

    // Garante que o objeto retornado SEMPRE tenha 'errors' como array
    return { successCount, errorCount, errors };
}

module.exports = {
    syncProductsBySku
};