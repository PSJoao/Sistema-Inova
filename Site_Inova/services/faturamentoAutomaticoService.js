const axios = require('axios');
const { Pool } = require('pg');
const { getValidBlingToken } = require('./blingTokenManager');
// Importamos os getters e a função de requisição com retentativa
const { getLucasStatus, getElianeStatus, apiRequestWithRetry } = require('../blingSyncService');

const BLING_API_BASE_URL = 'https://api.bling.com.br/Api/v3';

// Configuração do Banco
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Controle de Estado Local
let isFaturamentoLucasRunning = false;
let isFaturamentoElianeRunning = false;

// Cache de produtos em memória para evitar consultas repetitivas durante a execução
const productCache = new Set();

// CNPJs ou Identificadores comuns do Mercado Livre
const ML_INTERMEDIADOR_CNPJ = '10.573.521/0001-91';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- FUNÇÕES DE PERSISTÊNCIA (BASEADO NO BLING SYNCSERVICE) ---

// Função auxiliar para marcar nota como manual
async function marcarComoManual(client, nfeId, blingAccount) {
    const query = `
        UPDATE cached_nfe 
        SET is_manual = true, last_updated_at = NOW()
        WHERE bling_id = $1 AND bling_account = $2
    `;
    await client.query(query, [nfeId, blingAccount]);
    console.log(`[Faturamento Auto] Nota ${nfeId} marcada como MANUAL (Quantidade > 1).`);
}

async function upsertNFe(client, data) {
    const query = `
        INSERT INTO cached_nfe (
            bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome,
            total_volumes, product_descriptions_list, data_emissao,
            etiqueta_nome, etiqueta_endereco, etiqueta_numero, etiqueta_complemento,
            etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, fone,
            product_ids_list, situacao, is_manual, last_updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
        ON CONFLICT (bling_id, bling_account)
        DO UPDATE SET
            nfe_numero = EXCLUDED.nfe_numero,
            chave_acesso = EXCLUDED.chave_acesso,
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
            is_manual = EXCLUDED.is_manual,
            last_updated_at = NOW()
    `;
    await client.query(query, [
        data.bling_id, data.bling_account, data.nfe_numero, data.chave_acesso, data.transportador_nome,
        data.total_volumes, data.product_descriptions_list, data.data_emissao,
        data.etiqueta_nome, data.etiqueta_endereco, data.etiqueta_numero, data.etiqueta_complemento,
        data.etiqueta_municipio, data.etiqueta_uf, data.etiqueta_cep, data.etiqueta_bairro, data.fone,
        data.product_ids_list, data.situacao, data.is_manual || false
    ]);
}

async function upsertProduct(client, data) {
    // Usamos a estrutura do cached_products com preco_custo, peso_bruto e volumes.
    const query = `
        INSERT INTO cached_products (bling_id, bling_account, sku, nome, preco_custo, peso_bruto, volumes, last_updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (bling_id, bling_account) 
        DO UPDATE SET 
            sku = EXCLUDED.sku, 
            nome = EXCLUDED.nome, 
            preco_custo = EXCLUDED.preco_custo, 
            peso_bruto = EXCLUDED.peso_bruto,
            volumes = EXCLUDED.volumes, 
            last_updated_at = CURRENT_TIMESTAMP;
    `;
    await client.query(query, [
        data.bling_id, 
        data.bling_account, 
        data.sku, 
        data.nome, 
        data.preco_custo || 0, 
        data.peso_bruto || 0,
        data.volumes || 1
    ]);
}

async function upsertNfeQuantidade(client, nfeNumero, produtoCodigo, quantidade) {
    const query = `
        INSERT INTO nfe_quantidade_produto (nfe_numero, produto_codigo, quantidade) 
        VALUES ($1, $2, $3)
        ON CONFLICT (nfe_numero, produto_codigo) DO UPDATE SET quantidade = EXCLUDED.quantidade;
    `;
    await client.query(query, [nfeNumero, produtoCodigo, quantidade]);
}

async function upsertCachedPedidoVenda(client, pedidoDetalhes, nfeNumero, accountType) {
    const p = pedidoDetalhes;
    await client.query(`
        INSERT INTO cached_pedido_venda (
            bling_id, numero, numero_loja, data_pedido, data_saida, total_produtos, total_pedido,
            contato_id, contato_nome, contato_tipo_pessoa, contato_documento,
            situacao_id, situacao_valor, loja_id, desconto_valor,
            notafiscal_id, parcela_data_vencimento, parcela_valor, nfe_parent_numero,
            transporte_frete, intermediador_cnpj, taxa_comissao, custo_frete, valor_base, bling_account, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW()
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
            custo_frete = EXCLUDED.custo_frete, valor_base = EXCLUDED.valor_base, updated_at = NOW();
    `, [
        p.id, p.numero, p.numeroLoja, p.data, p.dataSaida, p.totalProdutos, p.total,
        p.contato?.id, p.contato?.nome, p.contato?.tipoPessoa, p.contato?.numeroDocumento,
        p.situacao?.id, p.situacao?.valor, p.loja?.id, p.desconto?.valor,
        p.notaFiscal?.id, p.parcelas?.[0]?.dataVencimento, p.parcelas?.[0]?.valor, nfeNumero,
        p.transporte?.frete, p.intermediador?.cnpj, p.taxas?.taxaComissao, p.taxas?.custoFrete, p.taxas?.valorBase, accountType
    ]);
}

// --- API HELPERS ---

async function getNfeDetalhada(nfeId, accountType) {
    try {
        const url = `${BLING_API_BASE_URL}/nfe/${nfeId}`;
        // Reutiliza a função de retentativa do blingSyncService
        const response = await apiRequestWithRetry(url, accountType); 
        return response.data;
    } catch (error) {
        console.error(`[Faturamento Auto] Erro ao buscar detalhes da NFe ${nfeId}:`, error.message);
        return null;
    }
}

async function atualizarNotaNoBling(nfeOriginal, novosValores, token) {
    const url = `${BLING_API_BASE_URL}/nfe/${nfeOriginal.id}`;
    
    const itensAtualizados = nfeOriginal.itens.map((item, index) => {
        if (novosValores.itens && novosValores.itens[index]) {
            return {
                ...item,
                valor: novosValores.itens[index].novoValorUnitario
            };
        }
        return item;
    });

    const payload = {
        tipo: nfeOriginal.tipo,
        finalidade: nfeOriginal.finalidade,
        naturezaOperacao: { id: nfeOriginal.naturezaOperacao.id },
        loja: nfeOriginal.loja ? { id: nfeOriginal.loja.id } : undefined,
        contato: nfeOriginal.contato,
        
        // ZERAÇÕES CONFORME SOLICITADO
        transporte: {
            ...nfeOriginal.transporte,
            frete: 0, 
            fretePorConta: nfeOriginal.transporte.fretePorConta
        },
        despesas: 0, 
        desconto: 0, 
        seguro: nfeOriginal.seguro || 0, // Mantém o seguro
        
        itens: itensAtualizados,
        parcelas: nfeOriginal.parcelas
    };

    try {
        console.log(`[Faturamento Auto] Enviando PUT para NFe ${nfeOriginal.id}...`);
        await axios.put(url, payload, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log(`[Faturamento Auto] NFe ${nfeOriginal.id} atualizada com sucesso!`);
        return true;
    } catch (error) {
        const msg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[Faturamento Auto] ERRO ao atualizar NFe ${nfeOriginal.id}:`, msg);
        // Em caso de falha no PUT, marcamos a nota para revisão manual
        const client = await pool.connect();
        try {
             await marcarComoManual(client, nfeOriginal.id, nfeOriginal.bling_account);
             console.log(`[Faturamento Auto] Nota ${nfeOriginal.id} marcada como MANUAL devido a erro no PUT.`);
        } finally {
            client.release();
        }
        return false;
    }
}

/**
 * Lógica completa para buscar detalhes, sincronizar e aplicar o cálculo.
 */
async function processarLoteNotas(notas, accountName, token) {
    // 1. CHECAGEM INICIAL DE CACHE (Pula notas que já foram sincronizadas)
    const client = await pool.connect();
    let notasParaIgnorar = new Set();
    
    try {
        const notasParaProcessarIds = notas.map(n => n.numero);

        if (notasParaProcessarIds.length > 0) {
            const cachedCheck = await client.query(
                'SELECT bling_id FROM cached_nfe WHERE nfe_numero = $1 AND bling_account = $2',
                [notasParaProcessarIds, accountName]
            );

            console.log(cachedCheck.rows);
            
            // Adiciona todos os IDs que já existem no cache para o Set de ignorados
            cachedCheck.rows.forEach(r => notasParaIgnorar.add(String(r.bling_id)));

            if (notasParaIgnorar.size > 0) {
                console.log(`[Faturamento Auto] ${notasParaIgnorar.size} notas desta página já estão no cache e serão puladas (API Saved).`);
            }
        }
    } catch (error) {
        console.error('[Faturamento Auto] Erro ao checar cache de notas. Prosseguindo com todas as notas da página para garantir sincronização.', error.message);
        notasParaIgnorar.clear(); // Limpa o filtro em caso de erro no DB
    } finally {
        client.release(); // Libera a conexão de checagem
    }


    for (const notaResumo of notas) {
        // Trava de segurança (checa se o sync principal não começou)
        if (accountName === 'lucas' && getLucasStatus()) return false;
        if (accountName === 'eliane' && getElianeStatus()) return false;
        
        // CHECK PRINCIPAL: PULA NOTA SE JÁ ESTIVER NO CACHE
        if (notasParaIgnorar.has(String(notaResumo.id))) {
            continue;
        }

        // 1. Busca detalhes e Inicia Transação
        const nfeDetalhes = await getNfeDetalhada(notaResumo.id, accountName);
        if (!nfeDetalhes) continue;
        
        // Adiciona a conta para consistência
        nfeDetalhes.bling_account = accountName; 
        
        await sleep(200);

        const processingClient = await pool.connect();
        try {
            await processingClient.query('BEGIN'); 

            // --- 2. SINCRONIZAÇÃO COMPLETA ---

            let totalVolumesCalculado = 0;
            const idsBlingProduto = [];
            const descricoesProdutos = new Set();
            const quantidadesAgregadas = new Map();
            let totalQuantidade = 0;
            let totalValorProdutosOriginal = 0;
            let isML = false;

            // 2a. Processamento dos Itens (Agregação de quantidades e cálculo de volume)
            if (nfeDetalhes.itens && Array.isArray(nfeDetalhes.itens)) {
                for (const item of nfeDetalhes.itens) {
                    totalQuantidade += item.quantidade;
                    totalValorProdutosOriginal += (item.valor * item.quantidade);
                    descricoesProdutos.add(item.descricao || 'S/ Descrição');

                    const sku = item.codigo;
                    const quantidadeComprada = parseFloat(item.quantidade) || 0;
                    if (sku && !isNaN(quantidadeComprada)) {
                        quantidadesAgregadas.set(sku, (quantidadesAgregadas.get(sku) || 0) + quantidadeComprada);
                    }
                }
            }

            // 2b. Itera sobre SKUs agregados para buscar/cachear produtos e calcular volume
            if (quantidadesAgregadas.size > 0) {
                const skusDaNota = Array.from(quantidadesAgregadas.keys());
                const cachedProductsMap = new Map();

                if (skusDaNota.length > 0) {
                    const cachedProductsResult = await processingClient.query(
                        'SELECT sku, volumes, bling_id, preco_custo, peso_bruto FROM cached_products WHERE sku = ANY($1::text[]) AND bling_account = $2',
                        [skusDaNota, accountName]
                    );
                    cachedProductsResult.rows.forEach(p => cachedProductsMap.set(p.sku, p));
                }

                for (const [produtoCodigo, quantidadeTotal] of quantidadesAgregadas.entries()) {
                    await upsertNfeQuantidade(processingClient, nfeDetalhes.numero, produtoCodigo, quantidadeTotal);

                    let volumesUnit = 0;
                    let prodId = null;
                    let prodData = {};

                    if (cachedProductsMap.has(produtoCodigo)) {
                        const cachedProd = cachedProductsMap.get(produtoCodigo);
                        volumesUnit = parseFloat(cachedProd.volumes || 0);
                        prodId = cachedProd.bling_id;
                        prodData = cachedProd;
                    } else {
                        // Busca no Bling se não está no cache local
                        try {
                            await sleep(500); 
                            const prodSearchResp = await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos?codigos[]=${produtoCodigo}`, accountName);
                            if (prodSearchResp.data?.[0]?.id) {
                                prodId = prodSearchResp.data[0].id;
                                await sleep(500); 
                                const prodDetails = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/produtos/${prodId}`, accountName)).data;
                                
                                volumesUnit = parseFloat(prodDetails.volumes || 0); 
                                
                                // Prepara dados para upsert (Incluindo campos da DDL)
                                prodData = {
                                    bling_id: prodDetails.id,
                                    bling_account: accountName,
                                    sku: prodDetails.codigo,
                                    nome: prodDetails.nome,
                                    preco_custo: prodDetails.precoCusto || 0,
                                    peso_bruto: prodDetails.pesoBruto || 0,
                                    volumes: prodDetails.volumes || 1
                                };
                                await upsertProduct(processingClient, prodData);
                            }
                        } catch (idError) { 
                            console.error(`[Faturamento Auto] Erro ao buscar ID/Volumes do produto ${produtoCodigo}. Detalhe: ${idError.message}`); 
                        }
                    }
                    
                    if (prodId) idsBlingProduto.push(prodId);
                    totalVolumesCalculado += (volumesUnit * quantidadeTotal);
                }
            }

            // 2c. Upsert do Pedido de Venda Associado (Se houver)
            if (nfeDetalhes.numeroPedidoLoja) {
                try {
                    const pedidoSearchResponse = await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas?numerosLojas[]=${nfeDetalhes.numeroPedidoLoja}`, accountName);
                    if (pedidoSearchResponse.data && pedidoSearchResponse.data.length > 0) {
                        const pedidoId = pedidoSearchResponse.data[0].id;
                        await sleep(500);
                        const pedidoDetalhes = (await apiRequestWithRetry(`${BLING_API_BASE_URL}/pedidos/vendas/${pedidoId}`, accountName)).data;
                        await upsertCachedPedidoVenda(processingClient, pedidoDetalhes, nfeDetalhes.numero, accountName);
                        
                        // Verifica intermediador no pedido para o filtro ML
                        if (pedidoDetalhes.intermediador?.cnpj === ML_INTERMEDIADOR_CNPJ) {
                            isML = true;
                        }
                    }
                } catch (pedidoError) { 
                    console.error(`[Faturamento Auto] Erro ao buscar/salvar pedido para a NF ${nfeDetalhes.numero}. Detalhe: ${pedidoError.message}`); 
                }
            }
            
            // 2d. Upsert Inicial da Nota Fiscal com dados compilados
            const etiqueta = nfeDetalhes.transporte?.etiqueta || {};
            const contato = nfeDetalhes.contato || {};
            const nfeData = {
                bling_id: nfeDetalhes.id,
                bling_account: accountName,
                nfe_numero: nfeDetalhes.numero,
                chave_acesso: nfeDetalhes.chaveAcesso,
                transportador_nome: nfeDetalhes.transporte?.transportador?.nome,
                total_volumes: totalVolumesCalculado,
                product_descriptions_list: Array.from(descricoesProdutos).join('; '),
                data_emissao: nfeDetalhes.dataEmissao,
                etiqueta_nome: etiqueta.nome,
                etiqueta_endereco: etiqueta.endereco,
                etiqueta_numero: etiqueta.numero,
                etiqueta_complemento: etiqueta.complemento,
                etiqueta_municipio: etiqueta.municipio,
                etiqueta_uf: etiqueta.uf,
                etiqueta_cep: etiqueta.cep,
                etiqueta_bairro: etiqueta.bairro,
                fone: contato.telefone,
                product_ids_list: idsBlingProduto.join('; '),
                situacao: nfeDetalhes.situacao,
                is_manual: false // Valor padrão, será atualizado se necessário
            };
            await upsertNFe(processingClient, nfeData);


            // --- 3. LÓGICA DE NEGÓCIO E FATURAMENTO ---
            
            // Re-verifica se é ML (pode não ter vindo do pedido, mas pode estar no intermediador da NFe)
            if (!isML && nfeDetalhes.intermediador?.cnpj === ML_INTERMEDIADOR_CNPJ) {
                isML = true;
            }
            

            if (!isML) {
                await processingClient.query('COMMIT'); 
                continue; // Pula se não for Mercado Livre
            }

            // Regra da Quantidade > 1
            if (totalQuantidade > 1) {
                await marcarComoManual(processingClient, nfeDetalhes.id, accountName);
                await processingClient.query('COMMIT'); 
                continue;
            }
            
            // 4. CÁLCULO E PUT (Somente notas ML com Qtd=1)
            const valorFinalTotal = totalValorProdutosOriginal * 0.70;
            const qtdItensLinha = nfeDetalhes.itens.length; 
            const novosValores = { itens: [] };
            
            if (qtdItensLinha > 0) {
                 const novoValorPorItem = valorFinalTotal / qtdItensLinha;
                 
                 for (let i = 0; i < qtdItensLinha; i++) {
                     const item = nfeDetalhes.itens[i];
                     const unitarioCalculado = novoValorPorItem / item.quantidade;
                     novosValores.itens.push({
                         novoValorUnitario: parseFloat(unitarioCalculado.toFixed(4))
                     });
                 }
            } else {
                 console.warn(`[Faturamento Auto] NFe ${nfeDetalhes.numero} não possui itens. Pulando PUT.`);
                 await processingClient.query('COMMIT');
                 continue;
            }


            // Envia PUT para o Bling
            const putSuccess = await atualizarNotaNoBling(nfeDetalhes, novosValores, token);

            if (putSuccess) {
                console.log(`[Faturamento Auto] NFe ${nfeDetalhes.numero} faturada e atualizada com sucesso no Bling.`);
                await processingClient.query('COMMIT');
            } else {
                // Se o PUT falhou, a nota já foi marcada como is_manual dentro de atualizarNotaNoBling.
                // Aqui só garantimos o fim da transação.
                await processingClient.query('ROLLBACK'); 
            }

            // Delay API
            await sleep(400);

        } catch (error) {
            await processingClient.query('ROLLBACK');
            console.error(`[Faturamento Auto] Erro CRÍTICO ao processar NF ${notaResumo.id} (Sync/Logic):`, error.message);
            // Tenta marcar como manual para evitar repetição no próximo ciclo
            const manualMarkingClient = await pool.connect();
            try {
                await marcarComoManual(manualMarkingClient, notaResumo.id, accountName);
            } finally {
                manualMarkingClient.release();
            }
            
        } finally {
            processingClient.release();
        }
    }
    return true; 
}


const startFaturamentoAutomatico = async (accountName) => {
    if (accountName === 'lucas' && isFaturamentoLucasRunning) return console.log('Faturamento Lucas já rodando.');
    if (accountName === 'eliane' && isFaturamentoElianeRunning) return console.log('Faturamento Eliane já rodando.');

    if (accountName === 'lucas' && getLucasStatus()) return console.warn('Sync Lucas padrão rodando. Abortando Faturamento.');
    if (accountName === 'eliane' && getElianeStatus()) return console.warn('Sync Eliane padrão rodando. Abortando Faturamento.');

    if (accountName === 'lucas') isFaturamentoLucasRunning = true;
    if (accountName === 'eliane') isFaturamentoElianeRunning = true;

    productCache.clear();

    console.log(`>>> INICIANDO FATURAMENTO AUTOMÁTICO + SYNC [${accountName.toUpperCase()}] <<<`);

    try {
        const token = await getValidBlingToken(accountName);
        let page = 1;
        let temMais = true;

        while (temMais) {
            if ((accountName === 'lucas' && !isFaturamentoLucasRunning) || (accountName === 'eliane' && !isFaturamentoElianeRunning)) break;
            if ((accountName === 'lucas' && getLucasStatus()) || (accountName === 'eliane' && getElianeStatus())) break;

            console.log(`[Faturamento Auto] Buscando página ${page} de notas pendentes (situação 1)...`);
            
            // Busca apenas notas PENDENTES (situacao=1)
            const url = `${BLING_API_BASE_URL}/nfe?pagina=${page}&limite=100&situacao=1`;
            
            const response = await axios.get(url, { headers: { 'Authorization': `Bearer ${token}` } });
            const notas = response.data.data;

            if (!notas || notas.length === 0) {
                temMais = false;
                console.log('[Faturamento Auto] Nenhuma nota pendente encontrada. Fim.');
            } else {
                const continuar = await processarLoteNotas(notas, accountName, token);
                if (!continuar) temMais = false;
                else page++;
            }
            await sleep(1000);
        }
    } catch (error) {
        console.error(`[Faturamento Auto] Erro crítico no processo de ${accountName}:`, error.message);
    } finally {
        if (accountName === 'lucas') isFaturamentoLucasRunning = false;
        if (accountName === 'eliane') isFaturamentoElianeRunning = false;
        productCache.clear(); 
        console.log(`>>> FIM FATURAMENTO AUTOMÁTICO [${accountName.toUpperCase()}] <<<`);
    }
};

module.exports = {
    startFaturamentoAutomatico
};