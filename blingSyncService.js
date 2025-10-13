const { Pool } = require('pg');
const { blingApiGet } = require('./services/blingApiService'); // Supondo que sua função de API está aqui

// Configuração do banco de dados (copie do seu index.js ou de outro controller)
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';

// Variável de controle para a página de emissão
let isEmissaoPageActive = false;
let isNFeLucasRunning = false;
let isNFeElianeRunning = false;
let isProductSyncRunning = false;
let shouldStopNFeLucas = false;
let shouldStopNFeEliane = false;
const onDemandNfeQueue = [];
let isOnDemandNfeRunning = false;

// --- Wrapper Inteligente para Requisições com Retentativa (CORRIGIDO) ---
/**
 * Realiza uma chamada à API do Bling com uma lógica de retentativa para erros de limite de requisição (429).
 * @param {string} url A URL completa do endpoint.
 * @param {string} accountType O tipo de conta ('eliane' ou 'lucas').
 * @param {number} maxRetries O número máximo de tentativas.
 * @returns {Promise<object>} O objeto 'data' da resposta da API.
 * @throws {Error} Lança um erro se a chamada falhar após todas as tentativas.
 */
async function apiRequestWithRetry(url, accountType, maxRetries = 8) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Tenta executar a chamada normalmente
            return await blingApiGet(url, accountType);
        } catch (error) {
            // Se entrar aqui, QUALQUER erro acionará a retentativa.
            lastError = error;
            const delay = Math.pow(2, attempt - 1) * 1000; // Lógica de espera: 1s, 2s, 4s...
            
            console.warn(`[API Retry] Falha na requisição para a conta ${accountType}. Tentativa ${attempt} de ${maxRetries}. Aguardando ${delay / 1000}s...`);
            console.warn(`   > Motivo: ${error.message}`); // Mostra o motivo do erro para debug
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Se esgotar todas as tentativas, lança um erro final.
    console.error(`[API Retry] FALHA PERSISTENTE para a conta ${accountType} após ${maxRetries} tentativas. URL: ${url}`);
    throw new Error(`Falha persistente na API do Bling. Último erro: ${lastError.message}`);
}

async function processOnDemandNfeQueue() {
    // Se já estiver processando ou a fila estiver vazia, sai.
    if (isOnDemandNfeRunning || onDemandNfeQueue.length === 0) {
        return;
    }
    // Trava para não processar mais de uma ao mesmo tempo.
    isOnDemandNfeRunning = true;

    // Aguarda se uma sincronização em massa estiver em andamento.
    while (isNFeLucasRunning || isNFeElianeRunning) {
        console.log('[OnDemandQueue] Sincronização em massa ativa. Aguardando...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3 segundos
    }

    const { nfeNumber, resolve, reject } = onDemandNfeQueue.shift();
    console.log(`[OnDemandQueue] Processando busca para a NF: ${nfeNumber}`);

    try {
        // A lógica principal da busca (será criada a seguir)
        const result = await processSingleNfe(nfeNumber);
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        // Libera a trava e tenta processar o próximo item da fila.
        isOnDemandNfeRunning = false;
        processOnDemandNfeQueue();
    }
}

async function processSingleNfe(nfeNumber) {
    // 1. Tenta encontrar o RESUMO da NFe para obter o ID do Bling
    let nfeResumo = null;
    let accountType = null;

    for (const conta of ['lucas', 'eliane']) {
        try {
            // CORREÇÃO: Usa o endpoint de listagem filtrando pelo número da nota para encontrar o ID.
            const response = await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe?numero=${nfeNumber}`, conta, 3);
            if (response.data && response.data.length > 0) {
                nfeResumo = response.data[0];
                accountType = conta;
                console.log(`[OnDemandQueue] NF ${nfeNumber} encontrada na conta ${accountType}. ID Bling: ${nfeResumo.id}`);
                break; // Para a busca assim que encontrar
            }
        } catch (error) {
            console.warn(`[OnDemandQueue] NF ${nfeNumber} não encontrada na conta ${conta} ou erro na busca. Detalhe: ${error.message}`);
        }
    }

    if (!nfeResumo || !nfeResumo.id) {
        throw new Error(`Nota Fiscal ${nfeNumber} não foi encontrada em nenhuma conta do Bling.`);
    }

    // 2. Se encontrou, processa e salva no cache (reutilizando sua lógica)
    const chaveDeAcesso = nfeResumo.chaveAcesso;
    if (!chaveDeAcesso) throw new Error('A NF encontrada no Bling não possui chave de acesso.');

    // Pula se por acaso já foi cacheada por outro processo
    const checkCache = await pool.query('SELECT 1 FROM cached_nfe WHERE chave_acesso = $1', [chaveDeAcesso]);
    if (checkCache.rows.length > 0) {
        console.log(`[OnDemandQueue] NF ${nfeNumber} já estava no cache. Retornando dados existentes.`);
        return true; // Sucesso, já está no cache
    }

    // Agora sim, busca os detalhes completos usando o ID que encontramos
    const nfeDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe/${nfeResumo.id}`, accountType)).data;
    
    // --- Início da lógica de processamento (permanece a mesma) ---
    if (nfeDetalhes.numeroPedidoLoja) {
        try {
            const pedidoSearchResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${nfeDetalhes.numeroPedidoLoja}`, accountType);
            if (pedidoSearchResponse.data && pedidoSearchResponse.data.length > 0) {
                const pedidoId = pedidoSearchResponse.data[0].id;
                const p = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}`, accountType)).data;
                await pool.query(`
                    INSERT INTO cached_pedido_venda (
                        bling_id, numero, numero_loja, data_pedido, data_saida, total_produtos, total_pedido, contato_id, contato_nome, contato_tipo_pessoa, contato_documento, situacao_id, situacao_valor, loja_id, desconto_valor, notafiscal_id, parcela_data_vencimento, parcela_valor, nfe_parent_numero, transporte_frete, intermediador_cnpj, taxa_comissao, custo_frete, valor_base, bling_account
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
                    ON CONFLICT (bling_id, bling_account) DO UPDATE SET
                        numero = EXCLUDED.numero, numero_loja = EXCLUDED.numero_loja, data_pedido = EXCLUDED.data_pedido, data_saida = EXCLUDED.data_saida, total_produtos = EXCLUDED.total_produtos, total_pedido = EXCLUDED.total_pedido, contato_id = EXCLUDED.contato_id, contato_nome = EXCLUDED.contato_nome, contato_tipo_pessoa = EXCLUDED.contato_tipo_pessoa, contato_documento = EXCLUDED.contato_documento, situacao_id = EXCLUDED.situacao_id, situacao_valor = EXCLUDED.situacao_valor, loja_id = EXCLUDED.loja_id, desconto_valor = EXCLUDED.desconto_valor, notafiscal_id = EXCLUDED.notafiscal_id, parcela_data_vencimento = EXCLUDED.parcela_data_vencimento, parcela_valor = EXCLUDED.parcela_valor, nfe_parent_numero = EXCLUDED.nfe_parent_numero, transporte_frete = EXCLUDED.transporte_frete, intermediador_cnpj = EXCLUDED.intermediador_cnpj, taxa_comissao = EXCLUDED.taxa_comissao, custo_frete = EXCLUDED.custo_frete, valor_base = EXCLUDED.valor_base;
                `, [ p.id, p.numero, p.numeroLoja, p.data, p.dataSaida, p.totalProdutos, p.total, p.contato?.id, p.contato?.nome, p.contato?.tipoPessoa, p.contato?.numeroDocumento, p.situacao?.id, p.situacao?.valor, p.loja?.id, p.desconto?.valor, p.notaFiscal?.id, p.parcelas?.[0]?.dataVencimento, p.parcelas?.[0]?.valor, nfeDetalhes.numero, p.transporte?.frete, p.intermediador?.cnpj, p.taxas?.taxaComissao, p.taxas?.custoFrete, p.taxas?.valorBase, accountType ]);
            }
        } catch (pedidoError) { console.error(`[OnDemandQueue] Erro ao processar pedido para a NF ${nfeDetalhes.numero}. Detalhe: ${pedidoError.message}`); }
    }

    let totalVolumesCalculado = 0;
    let idsBlingProduto = [];
    let descricoesProdutos = [];
    const quantidadesAgregadas = new Map();
    if (nfeDetalhes.itens?.length > 0) {
        for (const item of nfeDetalhes.itens) {
            const produtoCodigo = item.codigo;
            const quantidadeComprada = parseFloat(item.quantidade);
            if (produtoCodigo && !isNaN(quantidadeComprada)) {
                quantidadesAgregadas.set(produtoCodigo, (quantidadesAgregadas.get(produtoCodigo) || 0) + quantidadeComprada);
            }
            descricoesProdutos.push(String(item.descricao || 'S/ Descrição').substring(0, 100));
        }
    }
    if (quantidadesAgregadas.size > 0) {
        const skusDaNota = Array.from(quantidadesAgregadas.keys());
        const cachedProductsMap = new Map();
        const cachedProductsResult = await pool.query('SELECT sku, volumes FROM cached_products WHERE sku = ANY($1::text[]) AND bling_account = $2', [skusDaNota, accountType]);
        cachedProductsResult.rows.forEach(p => cachedProductsMap.set(p.sku, p));
        for (const [produtoCodigo, quantidadeTotal] of quantidadesAgregadas.entries()) {
            await pool.query('INSERT INTO nfe_quantidade_produto (nfe_numero, produto_codigo, quantidade) VALUES ($1, $2, $3) ON CONFLICT (nfe_numero, produto_codigo) DO UPDATE SET quantidade = EXCLUDED.quantidade;', [nfeDetalhes.numero, produtoCodigo, quantidadeTotal]);
            let volumesUnit = 0;
            if (cachedProductsMap.has(produtoCodigo)) {
                volumesUnit = parseFloat(cachedProductsMap.get(produtoCodigo).volumes || 0);
            } else {
                try {
                    const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, accountType);
                    if (prodSearchResp.data?.[0]?.id) {
                        const prodDetailsResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${prodSearchResp.data[0].id}`, accountType);
                        volumesUnit = parseFloat(prodDetailsResp.data.volumes || 0);
                    }
                } catch (productError) { console.error(`[OnDemandQueue] Erro ao buscar volumes do produto ${produtoCodigo}. Detalhe: ${productError.message}`); }
            }
            totalVolumesCalculado += volumesUnit * quantidadeTotal;
            try {
                const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, accountType);
                if (prodSearchResp.data?.[0]?.id) {
                    idsBlingProduto.push(String(prodSearchResp.data[0].id).substring(0, 100));
                }
            } catch (idError) { console.error(`[OnDemandQueue] Erro ao buscar ID do produto ${produtoCodigo}. Detalhe: ${idError.message}`); }
        }
    }
    const productListIds = idsBlingProduto.join('; ');
    const productListString = [...new Set(descricoesProdutos)].join('; ');
    const etiqueta = nfeDetalhes.transporte?.etiqueta || {};
    const contato = nfeDetalhes.contato || {};
    await pool.query(`
        INSERT INTO cached_nfe (
            bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome, total_volumes, product_descriptions_list, data_emissao, etiqueta_nome, etiqueta_endereco, etiqueta_numero, etiqueta_complemento, etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, fone, product_ids_list, situacao, last_updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
        ON CONFLICT (chave_acesso) DO NOTHING
    `, [ nfeDetalhes.id, accountType, nfeDetalhes.numero, nfeDetalhes.chaveAcesso, nfeDetalhes.transporte?.transportador?.nome, totalVolumesCalculado, productListString, nfeDetalhes.dataEmissao, etiqueta.nome, etiqueta.endereco, etiqueta.numero, etiqueta.complemento, etiqueta.municipio, etiqueta.uf, etiqueta.cep, etiqueta.bairro, contato.telefone, productListIds, nfeDetalhes.situacao ]);
    // --- Fim da lógica de processamento ---
    
    console.log(`[OnDemandQueue] NF ${nfeNumber} e seus dados foram salvos no cache com sucesso.`);
    return true; // Sucesso
}

function findAndCacheNfeByNumber(nfeNumber) {
    return new Promise((resolve, reject) => {
        onDemandNfeQueue.push({ nfeNumber, resolve, reject });
        console.log(`[OnDemandQueue] NF ${nfeNumber} adicionada à fila de busca.`);
        processOnDemandNfeQueue(); // Inicia o processador se ele estiver ocioso
    });
}


/**
 * Função para ser chamada pelo frontend para sinalizar que a página de emissão está em uso.
 * (Vamos criar a rota para isso depois, se necessário, ou usar outra técnica como WebSockets).
 */
function setEmissaoPageStatus(isActive) {
    console.log(`[BlingSyncService] Status da página de emissão alterado para: ${isActive}`);
    isEmissaoPageActive = isActive;
}

function getSyncStatus() {
    return {
        isEmissaoPageActive,
        isNFeRunning: isNFeLucasRunning || isNFeElianeRunning,
        isProductSyncRunning,
    };
}

async function processAndCacheStructuresLucas(productData, client) {
    if (!productData.estrutura?.componentes?.length) return;

    await client.query(
        'DELETE FROM cached_structures WHERE parent_product_bling_id = $1 AND parent_product_bling_account = $2',
        [productData.id, 'lucas']
    );

    for (const componente of productData.estrutura.componentes) {
        try {
            const componenteId = componente.produto?.id;
            if (!componenteId) continue;

            await new Promise(resolve => setTimeout(resolve, 500));
            const componenteDetails = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${componenteId}`, 'lucas')).data;

            await client.query(
                `INSERT INTO cached_structures (
                    parent_product_bling_id, parent_product_bling_account, component_sku,
                    component_location, structure_name
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (parent_product_bling_id, parent_product_bling_account, component_sku)
                DO NOTHING`,
                [
                    productData.id,
                    'lucas',
                    componenteDetails.codigo,
                    componenteDetails.estoque?.localizacao,
                    componenteDetails.nome
                ]
            );
        } catch (error) {
            console.error(`[LucasStruct] Erro ao processar componente ${componente.produto?.id} do produto ${productData.id}. Pulando componente. Detalhe: ${error.message}`);
        }
    }
}

async function processAndCacheStructuresEliane(productData, client) {
    if (!productData.estrutura?.componentes?.length) return;

    await client.query(
        'DELETE FROM cached_structures WHERE parent_product_bling_id = $1 AND parent_product_bling_account = $2',
        [productData.id, 'eliane']
    );

    for (const componente of productData.estrutura.componentes) {
        try {
            const componenteId = componente.produto?.id;
            if (!componenteId) continue;

            await new Promise(resolve => setTimeout(resolve, 500));
            const componenteDetails = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${componenteId}`, 'eliane')).data;

            await client.query(
                `INSERT INTO cached_structures (
                    parent_product_bling_id, parent_product_bling_account, component_sku,
                    component_location, structure_name
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (parent_product_bling_id, parent_product_bling_account, component_sku)
                DO NOTHING`,
                [
                    productData.id,
                    'eliane',
                    componenteDetails.codigo,
                    componenteDetails.estoque?.localizacao,
                    componenteDetails.nome
                ]
            );
        } catch (error) {
            console.error(`[ElianeStruct] Erro ao processar componente ${componente.produto?.id} do produto ${productData.id}. Pulando componente. Detalhe: ${error.message}`);
        }
    }
}

/**
 * Sincroniza TODOS os produtos de ambas as contas do Bling para o banco de dados local.
 */
async function syncBlingProductsLucas() {
    if (isProductSyncRunning) {
        return console.log('[LucasSync] Sincronização de produtos já em andamento. Pulando.');
    }

    shouldStopNFeLucas = true;
    shouldStopNFeEliane = true;
    while (isNFeLucasRunning || isNFeElianeRunning) {
        console.log('[LucasSync] Aguardando encerramento das sincronizações de NF-e...');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    isProductSyncRunning = true;
    console.log('[LucasSync] Iniciando sincronização COMPLETA de produtos da conta LUCAS...');

    const client = await pool.connect();
    try {
        let pagina = 1;

        while (true) {
            if (isEmissaoPageActive) {
                console.log('[LucasSync] Página de emissão ativa. Interrompendo sincronização.');
                break;
            }

            try {
                const response = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?pagina=${pagina}&limite=200&tipo=E`, 'lucas');
                if (!response.data || response.data.length === 0) break;

                for (const produto of response.data) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const produtoDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${produto.id}`, 'lucas')).data;

                        await client.query(
                            `INSERT INTO cached_products (
                                bling_id, bling_account, sku, nome, preco_custo, peso_bruto, volumes, last_updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                            ON CONFLICT (bling_id, bling_account)
                            DO UPDATE SET
                                sku = EXCLUDED.sku,
                                nome = EXCLUDED.nome,
                                preco_custo = EXCLUDED.preco_custo,
                                peso_bruto = EXCLUDED.peso_bruto,
                                volumes = EXCLUDED.volumes,
                                last_updated_at = NOW()`,
                            [
                                produtoDetalhes.id,
                                'lucas',
                                produtoDetalhes.codigo,
                                produtoDetalhes.nome,
                                produtoDetalhes.fornecedor?.precoCusto,
                                produtoDetalhes.pesoBruto,
                                produtoDetalhes.volumes
                            ]
                        );

                        await processAndCacheStructuresLucas(produtoDetalhes, client);
                    } catch (productError) {
                        console.error(`[LucasSync] Erro persistente ao processar produto ID ${produto.id}. Pulando produto. Detalhe: ${productError.message}`);
                        continue; // Pula para o próximo produto
                    }
                }

                console.log(`   - Página ${pagina} da conta Lucas sincronizada.`);
                pagina++;

            } catch (pageError) {
                console.error(`[LucasSync] Erro persistente ao buscar página de produtos ${pagina}. Interrompendo sync de produtos. Detalhe: ${pageError.message}`);
                break; // Sai do loop while
            }
        }

    } catch (error) {
        console.error('[LucasSync] Erro geral durante sincronização de produtos:', error.message);
    } finally {
        isProductSyncRunning = false;
        shouldStopNFeLucas = false;
        shouldStopNFeEliane = false;
        client.release();
        console.log('[LucasSync] Sincronização de produtos da conta Lucas finalizada.');
    }
}

async function syncBlingProductsEliane() {
    if (isProductSyncRunning) {
        return console.log('[ElianeSync] Sincronização de produtos já em andamento. Pulando.');
    }

    shouldStopNFeLucas = true;
    shouldStopNFeEliane = true;
    while (isNFeLucasRunning || isNFeElianeRunning) {
        console.log('[ElianeSync] Aguardando encerramento das sincronizações de NF-e...');
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    isProductSyncRunning = true;
    console.log('[ElianeSync] Iniciando sincronização COMPLETA de produtos da conta ELIANE...');

    const client = await pool.connect();
    try {
        let pagina = 1;

        while (true) {
            if (isEmissaoPageActive) {
                console.log('[ElianeSync] Página de emissão ativa. Interrompendo sincronização.');
                break;
            }

            try {
                const response = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?pagina=${pagina}&limite=200&tipo=E`, 'eliane');
                if (!response.data || response.data.length === 0) break;

                for (const produto of response.data) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const produtoDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${produto.id}`, 'eliane')).data;

                        await client.query(
                            `INSERT INTO cached_products (
                                bling_id, bling_account, sku, nome, preco_custo, peso_bruto, volumes, last_updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                            ON CONFLICT (bling_id, bling_account)
                            DO UPDATE SET
                                sku = EXCLUDED.sku,
                                nome = EXCLUDED.nome,
                                preco_custo = EXCLUDED.preco_custo,
                                peso_bruto = EXCLUDED.peso_bruto,
                                volumes = EXCLUDED.volumes,
                                last_updated_at = NOW()`,
                            [
                                produtoDetalhes.id,
                                'eliane',
                                produtoDetalhes.codigo,
                                produtoDetalhes.nome,
                                produtoDetalhes.fornecedor?.precoCusto,
                                produtoDetalhes.pesoBruto,
                                produtoDetalhes.volumes
                            ]
                        );

                        await processAndCacheStructuresEliane(produtoDetalhes, client);
                    } catch (productError) {
                        console.error(`[ElianeSync] Erro persistente ao processar produto ID ${produto.id}. Pulando produto. Detalhe: ${productError.message}`);
                        continue; // Pula para o próximo produto
                    }
                }

                console.log(`   - Página ${pagina} da conta Eliane sincronizada.`);
                pagina++;
            } catch (pageError) {
                console.error(`[ElianeSync] Erro persistente ao buscar página de produtos ${pagina}. Interrompendo sync de produtos. Detalhe: ${pageError.message}`);
                break; // Sai do loop while
            }
        }

    } catch (error) {
        console.error('[ElianeSync] Erro geral durante sincronização de produtos:', error.message);
    } finally {
        isProductSyncRunning = false;
        shouldStopNFeLucas = false;
        shouldStopNFeEliane = false;
        client.release();
        console.log('[ElianeSync] Sincronização de produtos da conta Eliane finalizada.');
    }
}



/**
 * Sincroniza as 10 últimas páginas de NF-e emitidas de ambas as contas.
 * SÓ EXECUTA se a página de emissão não estiver em uso.
 */
async function syncNFeLucas() {
    // Bloco de verificação inicial (trava) - Se já estiver rodando, ou produtos sincronizando, ou emissão aberta, a função para aqui.
    if (isNFeLucasRunning || isProductLucasSyncRunning) return console.log('[LucasSync] Sincronização de NF-e ou produtos já em andamento. Pulando.');
    if (isEmissaoPageActive) return console.log('[LucasSync] Página de emissão ativa. Sincronização de NF-e bloqueada.');

    isNFeLucasRunning = true;
    console.log('[LucasSync] Iniciando sincronização de NF-e e Pedidos da conta Lucas...');

    try {
        let totalNFsProcessadas = 0;

        // Loop para iterar por 5 páginas
        for (let pagina = 1; pagina <= 5; pagina++) {
            // Se a sincronização for interrompida externamente, sai do loop principal.
            if (shouldStopNFeLucas || isEmissaoPageActive) {
                console.log('[LucasSync] Sincronização interrompida.');
                break;
            }

            console.log(`[LucasSync] Processando página ${pagina} de NFs...`);
        
            try {
                const nfeListResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe?pagina=${pagina}&limite=100&tipo=1`, 'lucas');
                
                // Se a página não retornar nenhuma nota, não há mais o que buscar. Interrompe o loop.
                if (nfeListResponse.data.length === 0) {
                     console.log(`[LucasSync] Nenhuma NF-e encontrada na página ${pagina}. Finalizando busca.`);
                     break; 
                }

                for (const nfeResumo of nfeListResponse.data) {
                    // Verificação interna para interromper o processamento da página atual
                    if (shouldStopNFeLucas || isEmissaoPageActive) {
                        break; 
                    }
                    
                    try { // Bloco TRY para cada NFe individual
                        const chaveDeAcesso = nfeResumo.chaveAcesso;
                        if (!chaveDeAcesso) continue;

                        const checkCacheResult = await pool.query(
                            'SELECT 1 FROM cached_nfe WHERE chave_acesso = $1',
                            [chaveDeAcesso]
                        );
                        if (checkCacheResult.rows.length > 0) {
                            continue; // Pula para a próxima NFe do loop
                        }

                        // Lógica original para buscar detalhes da NF-e e do Pedido
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const nfeDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe/${nfeResumo.id}`, 'lucas')).data;

                        if (nfeDetalhes.numeroPedidoLoja) {
                            try {
                                const pedidoSearchResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${nfeDetalhes.numeroPedidoLoja}`, 'lucas');
                                
                                if (pedidoSearchResponse.data && pedidoSearchResponse.data.length > 0) {
                                    const pedidoId = pedidoSearchResponse.data[0].id;
                                    const pedidoDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}`, 'lucas')).data;
                                    
                                    const p = pedidoDetalhes; 
                                    await pool.query(`
                                        INSERT INTO cached_pedido_venda (
                                            bling_id, numero, numero_loja, data_pedido, data_saida, total_produtos, total_pedido,
                                            contato_id, contato_nome, contato_tipo_pessoa, contato_documento,
                                            situacao_id, situacao_valor, loja_id, desconto_valor,
                                            notafiscal_id, parcela_data_vencimento, parcela_valor, nfe_parent_numero,
                                            transporte_frete, intermediador_cnpj, taxa_comissao, custo_frete, valor_base, bling_account
                                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'lucas')
                                        ON CONFLICT (bling_id, bling_account) DO UPDATE SET
                                            numero = EXCLUDED.numero, numero_loja = EXCLUDED.numero_loja, data_pedido = EXCLUDED.data_pedido,
                                            data_saida = EXCLUDED.data_saida, total_produtos = EXCLUDED.total_produtos, total_pedido = EXCLUDED.total_pedido,
                                            contato_id = EXCLUDED.contato_id, contato_nome = EXCLUDED.contato_nome, contato_tipo_pessoa = EXCLUDED.contato_tipo_pessoa,
                                            contato_documento = EXCLUDED.contato_documento, situacao_id = EXCLUDED.situacao_id, situacao_valor = EXCLUDED.situacao_valor,
                                            loja_id = EXCLUDED.loja_id, desconto_valor = EXCLUDED.desconto_valor, notafiscal_id = EXCLUDED.notafiscal_id,
                                            parcela_data_vencimento = EXCLUDED.parcela_data_vencimento, parcela_valor = EXCLUDED.parcela_valor,
                                            nfe_parent_numero = EXCLUDED.nfe_parent_numero, transporte_frete = EXCLUDED.transporte_frete,
                                            intermediador_cnpj = EXCLUDED.intermediador_cnpj, taxa_comissao = EXCLUDED.taxa_comissao,
                                            custo_frete = EXCLUDED.custo_frete, valor_base = EXCLUDED.valor_base;
                                    `, [
                                        p.id, p.numero, p.numeroLoja, p.data, p.dataSaida, p.totalProdutos, p.total,
                                        p.contato?.id, p.contato?.nome, p.contato?.tipoPessoa, p.contato?.numeroDocumento,
                                        p.situacao?.id, p.situacao?.valor, p.loja?.id, p.desconto?.valor,
                                        p.notaFiscal?.id, p.parcelas?.[0]?.dataVencimento, p.parcelas?.[0]?.valor, nfeDetalhes.numero,
                                        p.transporte?.frete, p.intermediador?.cnpj, p.taxas?.taxaComissao, p.taxas?.custoFrete, p.taxas?.valorBase
                                    ]);
                                }
                            } catch (pedidoError) {
                                console.error(`  [LucasSync] Erro persistente ao processar pedido para a NF ${nfeDetalhes.numero}. Pulando pedido. Detalhe: ${pedidoError.message}`);
                            }
                        }

                        // Lógica original para calcular volumes e processar produtos
                        let totalVolumesCalculado = 0;
                        let idsBlingProduto = [];
                        let descricoesProdutos = [];
                        const quantidadesAgregadas = new Map();

                        if (nfeDetalhes.itens?.length > 0) {
                            for (const item of nfeDetalhes.itens) {
                                const produtoCodigo = item.codigo;
                                const quantidadeComprada = parseFloat(item.quantidade);
                                if (produtoCodigo && !isNaN(quantidadeComprada)) {
                                    quantidadesAgregadas.set(produtoCodigo, (quantidadesAgregadas.get(produtoCodigo) || 0) + quantidadeComprada);
                                }
                                descricoesProdutos.push(String(item.descricao || 'S/ Descrição').substring(0, 100));
                            }
                        }

                        if (quantidadesAgregadas.size > 0) {
                            const skusDaNota = Array.from(quantidadesAgregadas.keys());
                            const cachedProductsMap = new Map();

                            if (skusDaNota.length > 0) {
                                const cachedProductsResult = await pool.query(
                                    'SELECT sku, volumes FROM cached_products WHERE sku = ANY($1::text[]) AND bling_account = $2',
                                    [skusDaNota, 'lucas']
                                );
                                cachedProductsResult.rows.forEach(p => cachedProductsMap.set(p.sku, p));
                            }

                            for (const [produtoCodigo, quantidadeTotal] of quantidadesAgregadas.entries()) {
                                await pool.query(`
                                    INSERT INTO nfe_quantidade_produto (nfe_numero, produto_codigo, quantidade)
                                    VALUES ($1, $2, $3)
                                    ON CONFLICT (nfe_numero, produto_codigo)
                                    DO UPDATE SET quantidade = EXCLUDED.quantidade;
                                `, [nfeDetalhes.numero, produtoCodigo, quantidadeTotal]);
                                
                                let volumesUnit = 0;
                                if (cachedProductsMap.has(produtoCodigo)) {
                                    volumesUnit = parseFloat(cachedProductsMap.get(produtoCodigo).volumes || 0);
                                } else {
                                    try {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, 'lucas');
                                        if (prodSearchResp.data?.[0]?.id) {
                                            await new Promise(resolve => setTimeout(resolve, 500));
                                            const prodDetailsResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${prodSearchResp.data[0].id}`, 'lucas');
                                            volumesUnit = parseFloat(prodDetailsResp.data.volumes || 0);
                                        }
                                    } catch (productError) {
                                        console.error(`[LucasSync] Erro persistente ao buscar volumes do produto ${produtoCodigo}. Detalhe: ${productError.message}`);
                                    }
                                }
                                totalVolumesCalculado += volumesUnit * quantidadeTotal;
                                
                                try {
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                    const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, 'lucas');
                                    if (prodSearchResp.data?.[0]?.id) {
                                        idsBlingProduto.push(String(prodSearchResp.data[0].id).substring(0, 100));
                                    }
                                } catch(idError) {
                                    console.error(`[LucasSync] Erro persistente ao buscar ID do produto ${produtoCodigo}. Detalhe: ${idError.message}`);
                                }
                            }
                        }

                        // Lógica original para salvar a NF-e no banco de dados
                        const productListIds = idsBlingProduto.join('; ');
                        const productListString = [...new Set(descricoesProdutos)].join('; ');
                        const etiqueta = nfeDetalhes.transporte?.etiqueta || {};
                        const contato = nfeDetalhes.contato || {};

                        await pool.query(`
                            INSERT INTO cached_nfe (
                                bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome,
                                total_volumes, product_descriptions_list, data_emissao,
                                etiqueta_nome, etiqueta_endereco, etiqueta_numero, etiqueta_complemento,
                                etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, fone, product_ids_list, situacao,
                                last_updated_at
                            )
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
                            ON CONFLICT (chave_acesso)
                            DO UPDATE SET
                                transportador_nome = EXCLUDED.transportador_nome,
                                total_volumes = EXCLUDED.total_volumes,
                                product_descriptions_list = EXCLUDED.product_descriptions_list,
                                data_emissao = EXCLUDED.data_emissao,
                                etiqueta_nome = EXCLUDED.etiqueta_nome,
                                etiqueta_endereco = EXCLUDED.etiqueta_endereco,
                                etiqueta_numero = EXCLUDED.etiqueta_numero,
                                etiqueta_complemento = EXCLUDED.etiqueta_complemento,
                                etiqueta_municipio = EXCLUDED.etiqueta_municipio,
                                etiqueta_uf = EXCLUDED.etiqueta_uf,
                                etiqueta_cep = EXCLUDED.etiqueta_cep,
                                etiqueta_bairro = EXCLUDED.etiqueta_bairro,
                                fone = EXCLUDED.fone,
                                product_ids_list = EXCLUDED.product_ids_list,
                                situacao = EXCLUDED.situacao,
                                last_updated_at = NOW()
                        `, [
                            nfeDetalhes.id, 'lucas', nfeDetalhes.numero, nfeDetalhes.chaveAcesso,
                            nfeDetalhes.transporte?.transportador?.nome, totalVolumesCalculado,
                            productListString, nfeDetalhes.dataEmissao,
                            etiqueta.nome, etiqueta.endereco, etiqueta.numero, etiqueta.complemento,
                            etiqueta.municipio, etiqueta.uf, etiqueta.cep, etiqueta.bairro,
                            contato.telefone, productListIds, nfeDetalhes.situacao
                        ]);

                        totalNFsProcessadas++;

                    } catch (nfeError) {
                        console.error(`[LucasSync] Erro persistente na NF (ID Bling: ${nfeResumo.id}). Pulando NF. Detalhe: ${nfeError.message}`);
                        continue; // Pula para a próxima NFe
                    }
                } // Fim do for (nfeResumo)
            
            } catch (pageError) {
                console.error(`[LucasSync] Erro persistente ao buscar página de NFs ${pagina}. Interrompendo sync de NFs. Detalhe: ${pageError.message}`);
                break; // Em caso de erro na página, interrompe o loop principal
            }

            // Lógica para verificação de notas canceladas (executada a cada página)
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                const canceladasResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe?pagina=${pagina}&limite=100&tipo=1&situacao=2`, 'lucas');
                for (const cancelada of canceladasResp.data || []) {
                    const chave = cancelada.chaveAcesso;
                    if (!chave) continue;

                    const result = await pool.query('SELECT 1 FROM cached_nfe WHERE chave_acesso = $1', [chave]);
                    if (result.rows.length > 0) {
                        console.warn(`[LucasSync] Removendo NF cancelada do cache: ${chave}`);
                        await pool.query('DELETE FROM cached_nfe WHERE chave_acesso = $1', [chave]);
                        await pool.query(`UPDATE emission_nfe_reports SET cancelada = true, status_para_relacao = 'cancelada' WHERE nfe_chave_acesso_44d = $1`, [chave]);
                    }
                }
            } catch (cancelErr) {
                console.error(`[LucasSync] Falha ao verificar NFs canceladas na página ${pagina}:`, cancelErr.message);
            }
        } // Fim do for (pagina)

        console.log(`[LucasSync] NF-e finalizadas. Total processadas nesta execução: ${totalNFsProcessadas}`);
    } catch (error) {
        console.error('[LucasSync] Erro geral durante sincronização de NF-e:', error.message);
    } finally {
        isNFeLucasRunning = false; // Libera a trava
    }
}

async function syncNFeEliane() {
    // Bloco de verificação inicial (trava)
    if (isNFeElianeRunning || isProductElianeSyncRunning) return console.log('[ElianeSync] Sincronização já em andamento. Pulando.');
    if (isEmissaoPageActive) return console.log('[ElianeSync] Página de emissão ativa. Aguardando...');

    isNFeElianeRunning = true;
    console.log('[ElianeSync] Iniciando sincronização de NF-e e Pedidos da conta Eliane...');

    try {
        let totalNFsProcessadas = 0;

        // Loop para iterar por 5 páginas
        for (let pagina = 1; pagina <= 5; pagina++) {
            // Se a sincronização for interrompida externamente, sai do loop principal.
            if (shouldStopNFeEliane || isEmissaoPageActive) {
                console.log('[ElianeSync] Sincronização interrompida.');
                break;
            }

            console.log(`[ElianeSync] Processando página ${pagina} de NFs...`);

            try {
                const nfeListResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe?pagina=${pagina}&limite=100&tipo=1`, 'eliane');
                
                // Se a página não retornar nenhuma nota, não há mais o que buscar. Interrompe o loop.
                if (nfeListResponse.data.length === 0) {
                    console.log(`[ElianeSync] Nenhuma NF-e encontrada na página ${pagina}. Finalizando busca.`);
                    break;
                }
                 
                for (const nfeResumo of nfeListResponse.data) {
                    // Verificação interna para interromper o processamento da página atual
                    if (shouldStopNFeEliane || isEmissaoPageActive) {
                        break;
                    }
                    
                    try { // Bloco TRY para cada NFe individual
                        const chaveDeAcesso = nfeResumo.chaveAcesso;
                        if (!chaveDeAcesso) continue;

                        const checkCacheResult = await pool.query(
                            'SELECT 1 FROM cached_nfe WHERE chave_acesso = $1',
                            [chaveDeAcesso]
                        );
                        if (checkCacheResult.rows.length > 0) {
                            continue;
                        }

                        // Lógica original para buscar detalhes da NF-e e do Pedido
                        await new Promise(resolve => setTimeout(resolve, 500));
                        const nfeDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe/${nfeResumo.id}`, 'eliane')).data;

                        if (nfeDetalhes.numeroPedidoLoja) {
                            try {
                                const pedidoSearchResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${nfeDetalhes.numeroPedidoLoja}`, 'eliane');
                                
                                if (pedidoSearchResponse.data && pedidoSearchResponse.data.length > 0) {
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                    const pedidoId = pedidoSearchResponse.data[0].id;
                                    const pedidoDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}`, 'eliane')).data;
                                    
                                    const p = pedidoDetalhes;
                                    await pool.query(`
                                        INSERT INTO cached_pedido_venda (
                                            bling_id, numero, numero_loja, data_pedido, data_saida, total_produtos, total_pedido,
                                            contato_id, contato_nome, contato_tipo_pessoa, contato_documento,
                                            situacao_id, situacao_valor, loja_id, desconto_valor,
                                            notafiscal_id, parcela_data_vencimento, parcela_valor, nfe_parent_numero,
                                            transporte_frete, intermediador_cnpj, taxa_comissao, custo_frete, valor_base, bling_account
                                        ) VALUES (
                                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'eliane'
                                        )
                                        ON CONFLICT (bling_id, bling_account) DO UPDATE SET
                                            numero = EXCLUDED.numero, numero_loja = EXCLUDED.numero_loja, data_pedido = EXCLUDED.data_pedido,
                                            data_saida = EXCLUDED.data_saida, total_produtos = EXCLUDED.total_produtos, total_pedido = EXCLUDED.total_pedido,
                                            contato_id = EXCLUDED.contato_id, contato_nome = EXCLUDED.contato_nome, contato_tipo_pessoa = EXCLUDED.contato_tipo_pessoa,
                                            contato_documento = EXCLUDED.contato_documento, situacao_id = EXCLUDED.situacao_id, situacao_valor = EXCLUDED.situacao_valor,
                                            loja_id = EXCLUDED.loja_id, desconto_valor = EXCLUDED.desconto_valor, notafiscal_id = EXCLUDED.notafiscal_id,
                                            parcela_data_vencimento = EXCLUDED.parcela_data_vencimento, parcela_valor = EXCLUDED.parcela_valor,
                                            nfe_parent_numero = EXCLUDED.nfe_parent_numero, transporte_frete = EXCLUDED.transporte_frete,
                                            intermediador_cnpj = EXCLUDED.intermediador_cnpj, taxa_comissao = EXCLUDED.taxa_comissao,
                                            custo_frete = EXCLUDED.custo_frete, valor_base = EXCLUDED.valor_base;
                                    `, [
                                        p.id, p.numero, p.numeroLoja, p.data, p.dataSaida, p.totalProdutos, p.total,
                                        p.contato?.id, p.contato?.nome, p.contato?.tipoPessoa, p.contato?.numeroDocumento,
                                        p.situacao?.id, p.situacao?.valor, p.loja?.id, p.desconto?.valor,
                                        p.notaFiscal?.id, p.parcelas?.[0]?.dataVencimento, p.parcelas?.[0]?.valor, nfeDetalhes.numero,
                                        p.transporte?.frete, p.intermediador?.cnpj, p.taxas?.taxaComissao, p.taxas?.custoFrete, p.taxas?.valorBase
                                    ]);
                                }
                            } catch (pedidoError) {
                                console.error(`  [ElianeSync] Erro persistente ao processar pedido para a NF ${nfeDetalhes.numero}. Pulando pedido. Detalhe: ${pedidoError.message}`);
                            }
                        }
                        
                        // Lógica original para calcular volumes e processar produtos
                        let totalVolumesCalculado = 0;
                        let idsBlingProduto = [];
                        let descricoesProdutos = [];
                        const quantidadesAgregadas = new Map();

                        if (nfeDetalhes.itens?.length > 0) {
                            for (const item of nfeDetalhes.itens) {
                                const produtoCodigo = item.codigo;
                                const quantidadeComprada = parseFloat(item.quantidade);
                                if (produtoCodigo && !isNaN(quantidadeComprada)) {
                                    quantidadesAgregadas.set(produtoCodigo, (quantidadesAgregadas.get(produtoCodigo) || 0) + quantidadeComprada);
                                }
                                descricoesProdutos.push(String(item.descricao || 'S/ Descrição').substring(0, 100));
                            }
                        }

                        if (quantidadesAgregadas.size > 0) {
                            const skusDaNota = Array.from(quantidadesAgregadas.keys());
                            const cachedProductsMap = new Map();

                            if (skusDaNota.length > 0) {
                                const cachedProductsResult = await pool.query(
                                    'SELECT sku, volumes FROM cached_products WHERE sku = ANY($1::text[]) AND bling_account = $2',
                                    [skusDaNota, 'eliane']
                                );
                                cachedProductsResult.rows.forEach(p => cachedProductsMap.set(p.sku, p));
                            }

                            for (const [produtoCodigo, quantidadeTotal] of quantidadesAgregadas.entries()) {
                                await pool.query(`
                                    INSERT INTO nfe_quantidade_produto (nfe_numero, produto_codigo, quantidade)
                                    VALUES ($1, $2, $3)
                                    ON CONFLICT (nfe_numero, produto_codigo)
                                    DO UPDATE SET quantidade = EXCLUDED.quantidade;
                                `, [nfeDetalhes.numero, produtoCodigo, quantidadeTotal]);
                                
                                let volumesUnit = 0;
                                if (cachedProductsMap.has(produtoCodigo)) {
                                    volumesUnit = parseFloat(cachedProductsMap.get(produtoCodigo).volumes || 0);
                                } else {
                                    try {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, 'eliane');
                                        if (prodSearchResp.data?.[0]?.id) {
                                            await new Promise(resolve => setTimeout(resolve, 500));
                                            const prodDetailsResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${prodSearchResp.data[0].id}`, 'eliane');
                                            volumesUnit = parseFloat(prodDetailsResp.data.volumes || 0);
                                        }
                                    } catch (productError) {
                                        console.error(`[ElianeSync] Erro persistente ao buscar volumes do produto ${produtoCodigo}. Detalhe: ${productError.message}`);
                                    }
                                }
                                totalVolumesCalculado += volumesUnit * quantidadeTotal;
                                
                                try {
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                    const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, 'eliane');
                                    if (prodSearchResp.data?.[0]?.id) {
                                        idsBlingProduto.push(String(prodSearchResp.data[0].id).substring(0, 100));
                                    }
                                } catch(idError) {
                                    console.error(`[ElianeSync] Erro persistente ao buscar ID do produto ${produtoCodigo}. Detalhe: ${idError.message}`);
                                }
                            }
                        }

                        // Lógica original para salvar a NF-e no banco de dados
                        const productListIds = idsBlingProduto.join('; ');
                        const productListString = [...new Set(descricoesProdutos)].join('; ');
                        const etiqueta = nfeDetalhes.transporte?.etiqueta || {};
                        const contato = nfeDetalhes.contato || {};

                        await pool.query(`
                            INSERT INTO cached_nfe (
                                bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome,
                                total_volumes, product_descriptions_list, data_emissao,
                                etiqueta_nome, etiqueta_endereco, etiqueta_numero, etiqueta_complemento,
                                etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, fone, product_ids_list, situacao,
                                last_updated_at
                            )
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
                            ON CONFLICT (chave_acesso)
                            DO UPDATE SET
                                transportador_nome = EXCLUDED.transportador_nome,
                                total_volumes = EXCLUDED.total_volumes,
                                product_descriptions_list = EXCLUDED.product_descriptions_list,
                                data_emissao = EXCLUDED.data_emissao,
                                etiqueta_nome = EXCLUDED.etiqueta_nome,
                                etiqueta_endereco = EXCLUDED.etiqueta_endereco,
                                etiqueta_numero = EXCLUDED.etiqueta_numero,
                                etiqueta_complemento = EXCLUDED.etiqueta_complemento,
                                etiqueta_municipio = EXCLUDED.etiqueta_municipio,
                                etiqueta_uf = EXCLUDED.etiqueta_uf,
                                etiqueta_cep = EXCLUDED.etiqueta_cep,
                                etiqueta_bairro = EXCLUDED.etiqueta_bairro,
                                fone = EXCLUDED.fone,
                                product_ids_list = EXCLUDED.product_ids_list,
                                situacao = EXCLUDED.situacao,
                                last_updated_at = NOW()
                        `, [
                            nfeDetalhes.id, 'eliane', nfeDetalhes.numero, nfeDetalhes.chaveAcesso,
                            nfeDetalhes.transporte?.transportador?.nome, totalVolumesCalculado,
                            productListString, nfeDetalhes.dataEmissao,
                            etiqueta.nome, etiqueta.endereco, etiqueta.numero, etiqueta.complemento,
                            etiqueta.municipio, etiqueta.uf, etiqueta.cep, etiqueta.bairro,
                            contato.telefone, productListIds, nfeDetalhes.situacao
                        ]);

                        totalNFsProcessadas++;

                    } catch (nfeError) {
                        console.error(`[ElianeSync] Erro persistente na NF (ID Bling: ${nfeResumo.id}). Pulando NF. Detalhe: ${nfeError.message}`);
                        continue; // Pula para a próxima NFe
                    }
                } // Fim do for (nfeResumo)
                
            } catch (pageError) {
                console.error(`[ElianeSync] Erro persistente ao buscar página de NFs ${pagina}. Interrompendo sync de NFs. Detalhe: ${pageError.message}`);
                break; // Em caso de erro na página, interrompe o loop principal
            }
        
            // Lógica para verificação de notas canceladas (executada a cada página)
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                const canceladasResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/nfe?pagina=${pagina}&limite=100&tipo=1&situacao=2`, 'eliane');
                for (const cancelada of canceladasResp.data || []) {
                    const chave = cancelada.chaveAcesso;
                    if (!chave) continue;

                    const result = await pool.query('SELECT 1 FROM cached_nfe WHERE chave_acesso = $1', [chave]);
                    if (result.rows.length > 0) {
                        console.warn(`[ElianeSync] Removendo NF cancelada do cache: ${chave}`);
                        await pool.query('DELETE FROM cached_nfe WHERE chave_acesso = $1', [chave]);
                        await pool.query(`UPDATE emission_nfe_reports SET cancelada = true, status_para_relacao = 'cancelada' WHERE nfe_chave_acesso_44d = $1`, [chave]);
                    }
                }
            } catch (cancelErr) {
                console.error(`[ElianeSync] Falha ao verificar NFs canceladas na página ${pagina}:`, cancelErr.message);
            }
        } // Fim do for (pagina)
        
        console.log(`[ElianeSync] NF-e finalizadas. Total processadas nesta execução: ${totalNFsProcessadas}`);
    } catch (error) {
        console.error('[ElianeSync] Erro geral durante sincronização de NF-e:', error.message);
    } finally {
        isNFeElianeRunning = false; // Libera a trava
    }
}

module.exports = {
    syncNFeLucas,
    syncNFeEliane,
    getSyncStatus,
    syncBlingProductsLucas,
    syncBlingProductsEliane,
    setEmissaoPageStatus,
    findAndCacheNfeByNumber 
};