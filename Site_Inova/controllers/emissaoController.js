// controllers/emissaoController.js
const { Pool } = require('pg');
const axios = require('axios'); // Necessário para blingApiGet
const { setEmissaoPageStatus, getSyncStatus, findAndCacheNfeByNumber, syncNFeLucas, syncNFeEliane } = require('../blingSyncService');
const { getValidBlingToken } = require('../services/blingTokenManager');
const { generateLabelsPdf } = require('../services/pdfService');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// --- MAPA DE TRANSPORTADORAS E FUNÇÕES AUXILIARES DE MAPEAMENTO ---
// COPIADO DO relacaoController.js - IDEALMENTE, MOVER PARA UM ARQUIVO UTILS COMPARTILHADO
const TRANSPORTADORA_APELIDOS_MAP = {
  'JEW TRANSPORTES LTDA': 'JEW',
  'DOMINALOG': 'DOMINALOG',
  'I. AMORIN TRANSPORTES EIRELI': 'LOG+',
  'I AMORIN TRANSPORTES EIRELLI': 'LOG+',
  'LOG MAIS TRANSPORTES LTDA': 'LOG+',
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
};

function getApelidoFromNomeCompleto(nomeCompleto) {
    if (!nomeCompleto) return 'OUTROS';
    const nomeUpper = String(nomeCompleto).toUpperCase();
    for (const key in TRANSPORTADORA_APELIDOS_MAP) {
        if (nomeUpper.includes(key.toUpperCase())) {
            return TRANSPORTADORA_APELIDOS_MAP[key];
        }
    }
    const parts = nomeUpper.split(/[\s-]+/); 
    if (parts[0] && parts[0].length > 1) {
        const apelidoGerado = parts[0].substring(0, 15).replace(/[^A-Z0-9&]/ig, '');
        if (apelidoGerado.length > 1) {
            console.warn(`Apelido não mapeado para "${nomeCompleto}" no emissaoController, usando fallback: "${apelidoGerado}"`);
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
// --- FIM DO MAPA E FUNÇÃO DE APELIDO ---


// --- FUNÇÕES AUXILIARES BLING ---
const blingTokensCache = {
    lucas: { accessToken: null, tokenType: 'Bearer', expiresAt: 0 },
    eliane: { accessToken: null, tokenType: 'Bearer', expiresAt: 0 }
};
const CACHE_TTL_MILLISECONDS = 5 * 60 * 1000;

async function getBlingCredentialsFromDB(accountName, client) {
    // Esta função é chamada se o cache expirar ou estiver vazio
    console.log(`Buscando credenciais do DB para ${accountName} (cache miss/expired)`);
    const dbResult = await client.query(
        `SELECT access_token, token_type, expires_in, token_generated_at 
         FROM bling_api_credentials WHERE account_name = $1`,
        [accountName]
    );
    if (dbResult.rows.length === 0) throw new Error(`Credenciais Bling para "${accountName}" não configuradas.`);
    
    const creds = dbResult.rows[0];
    if (!creds.access_token || !creds.token_generated_at || !creds.expires_in) {
        // Se dados essenciais faltam, o token do DB é considerado inválido/incompleto
        // O processo de refresh externo DEVE garantir que estes campos estão corretos.
        console.error(`Dados de token incompletos no DB para ${accountName}. O refresh externo precisa rodar.`);
        throw new Error(`Token inválido/incompleto no DB para ${accountName}. Aguarde o refresh automático.`);
    }

    const tokenGeneratedAt = new Date(creds.token_generated_at);
    const expiresInMs = parseInt(creds.expires_in, 10) * 1000;
    
    blingTokensCache[accountName] = {
        accessToken: creds.access_token,
        tokenType: creds.token_type || 'Bearer',
        expiresAt: tokenGeneratedAt.getTime() + expiresInMs
    };
    return blingTokensCache[accountName];
}

async function getBlingCredentials(accountName) {
    const now = Date.now();
    const cached = blingTokensCache[accountName];

    // Verifica se tem cache e se o cache ainda é "recente" (não necessariamente válido pela API, mas recente do DB)
    // A validade real (expiresAt vs now com margem) será checada pelo processo de refresh externo.
    // Aqui, apenas relemos do DB periodicamente para pegar atualizações feitas pelo processo externo.
    // Vamos simplificar: se o cache tem mais de CACHE_TTL_MILLISECONDS desde a última leitura do DB, recarrega do DB.
    // O processo externo é o responsável por garantir que o token no DB é válido.
    
    // Se não tem token no cache OU se o "expiresAt" do cache é antigo (indicando que faz tempo que não lemos do DB)
    // Vamos considerar que "expiresAt" no cache é quando o token de fato expira.
    // O processo externo atualiza o DB. Nós lemos do DB se o nosso cache está velho.
    
    // Se o token em cache está para expirar (considerando uma margem) OU não existe token
    if (!cached || !cached.accessToken || now >= (cached.expiresAt - (5 * 60 * 1000))) { // Margem de 5 min
        console.log(`Cache para "${accountName}" está expirado ou ausente. Buscando do DB.`);
        const client = await pool.connect();
        try {
            // Esta função agora apenas LÊ do banco. O REFRESH é externo.
            const dbCreds = await client.query(
                'SELECT access_token, token_type, expires_in, token_generated_at FROM bling_api_credentials WHERE account_name = $1',
                [accountName]
            );
            if (dbCreds.rows.length === 0) throw new Error(`Credenciais Bling para "${accountName}" não encontradas.`);
            const creds = dbCreds.rows[0];
            if (!creds.access_token || !creds.expires_in || !creds.token_generated_at) {
                throw new Error(`Dados de token incompletos no DB para ${accountName}. Processo de refresh externo falhou ou não rodou.`);
            }
            
            const tokenGeneratedTime = new Date(creds.token_generated_at).getTime();
            const expiresInMs = parseInt(creds.expires_in, 10) * 1000;

            blingTokensCache[accountName] = {
                accessToken: creds.access_token,
                tokenType: creds.token_type || 'Bearer',
                expiresAt: tokenGeneratedTime + expiresInMs // Quando o token do DB realmente expira
            };
            console.log(`Cache para "${accountName}" atualizado do DB.`);
            
            // Verifica novamente se o token recém-lido do DB já está expirado (caso o refresh externo esteja muito atrasado)
            if (now >= (blingTokensCache[accountName].expiresAt - (5 * 60 * 1000))) {
                 console.error(`ATENÇÃO: Token para "${accountName}" lido do DB JÁ ESTÁ EXPIRADO OU PRÓXIMO! O processo de refresh externo pode estar com problemas.`);
                 // Lançar erro aqui impede a operação, o que pode ser desejável se o token está realmente ruim.
                 // throw new Error(`Token Bling para ${accountName} está expirado no banco de dados. Operação não pode continuar.`);
            }

        } catch (error) {
            console.error(`Erro ao buscar/atualizar cache de credenciais para "${accountName}":`, error);
            // Se falhar ao buscar do DB, e o cache antigo ainda existir e for "usável" (não muito velho), poderia usar o cache antigo.
            // Mas se o motivo da busca no DB foi expiração, então o cache antigo não serve.
            // Melhor lançar o erro para a chamada da API falhar e ser investigado.
            throw error;
        } finally {
            if (client) client.release();
        }
    } else {
        // console.log(`Usando token do cache para "${accountName}"`);
    }

    if (!blingTokensCache[accountName] || !blingTokensCache[accountName].accessToken) {
        throw new Error(`Não foi possível obter um access token válido para a conta ${accountName}.`);
    }
    return blingTokensCache[accountName];
}

async function blingApiGet(url, accountName) {
    const credentials = await getBlingCredentials(accountName);
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `${credentials.tokenType} ${credentials.accessToken}`,
                'Accept': 'application/json'
            },
            timeout: 20000 
        });
        return response.data; 
    } catch (error) {
        let errorMessage = `Erro na API Bling GET ${url} para conta ${accountName} (emissaoController).`;
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

function parseBlingBarcode(barcodeScanned) {
    const cleanedBarcode = barcodeScanned.replace(/\s+/g, '');
    if (cleanedBarcode.length < 44) {
        console.warn(`Código de barras inválido (curto): ${barcodeScanned} -> ${cleanedBarcode} (emissaoController)`);
        return null;
    }

    const chaveAcesso = cleanedBarcode.substring(0, 44);
    const cnpjEmitente = chaveAcesso.substring(6, 20); // Dígitos 7 a 20

    let accountType = null;
    if (cnpjEmitente === '40062295000145') accountType = 'lucas';
    else if (cnpjEmitente === '34321153000152') accountType = 'eliane';
    else {
        console.warn(`CNPJ ${cnpjEmitente} não reconhecido na chave: ${chaveAcesso} (emissaoController)`);
        return null;
    }

    return { chaveAcesso, accountType };
}

// =============================================================================
// FUNÇÕES EXPORTADAS (ROUTE HANDLERS)
// =============================================================================

exports.getEmissaoPage = (req, res) => {
    const lastEmissionTitle = req.session.lastEmissionTitle || '';

    res.render('relacao/emissao', {
        title: 'Nova Emissão de NF-e',
        layout: 'main',
        lastEmissionTitle: lastEmissionTitle,
        transportadorasMap: TRANSPORTADORA_APELIDOS_MAP 
    });
};

exports.getAllEmissions = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, created_at FROM emissions ORDER BY created_at DESC');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar todas as emissões:", error);
    res.status(500).json({ message: "Erro ao buscar emissões." });
  }
};

exports.createAndFinalizeEmissao = async (req, res) => {
    const { title, barcodes: barcodesData, isResubmissionWithCarriers } = req.body;
    if (!title) return res.status(400).json({ message: "Título é obrigatório." });

    let client;

    // ROTA 2: TRATAMENTO DO REENVIO COM TRANSPORTADORAS MANUAIS
    if (isResubmissionWithCarriers) {
        console.log("Recebido reenvio com transportadoras manuais. Salvando diretamente...");
        client = await pool.connect();
        try {
            await client.query('BEGIN');
            const emissionResult = await client.query('INSERT INTO emissions (title) VALUES ($1) RETURNING id', [title]);
            const newEmissionId = emissionResult.rows[0].id;

            for (const report of barcodesData) {
                if (!report.nfe_chave_acesso_usada) {
                    console.error("Payload de reenvio inválido: relatório sem nfe_chave_acesso_usada.", report);
                    continue;
                }
                await client.query('INSERT INTO emission_barcodes (emission_id, barcode_value) VALUES ($1, $2)', [newEmissionId, report.nfe_chave_acesso_usada]);
                
                if (report.manualCarrierApelido) {
                    report.apelidoDaTransportadora = report.manualCarrierApelido;
                    report.transportador_nome = getNomeCompletoFromApelido(report.manualCarrierApelido);
                }
                
                await client.query(
                    `INSERT INTO emission_nfe_reports (emission_id, bling_account_type, nfe_numero, transportador_nome, total_volumes_calculado, status_processamento, detalhes_erro, nfe_chave_acesso_usada, nfe_chave_acesso_44d, transportadora_apelido, product_descriptions_list, eh_frenet, status_para_relacao) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendente')`,
                    [ 
                        newEmissionId, report.bling_account_type, report.nfe_numero, 
                        report.transportador_nome, report.total_volumes_calculado, report.status_processamento, 
                        report.detalhes_erro, report.nfe_chave_acesso_usada, report.nfe_chave_acesso_44d, 
                        report.apelidoDaTransportadora, Array.isArray(report.product_descriptions_list) ? report.product_descriptions_list.join('; ') : '', 
                        report.ehFrenet
                    ]
                );
            }
            await client.query('COMMIT');
            return res.status(201).json({ message: `Emissão "${title}" criada com sucesso.` });
        } catch (error) {
            if(client) await client.query('ROLLBACK');
            console.error("Erro ao salvar reenvio da emissão:", error);
            return res.status(500).json({ message: `Erro ao salvar reenvio: ${error.message}` });
        } finally {
            if (client) client.release();
        }
    }

    // ROTA 1: FLUXO NORMAL DA PRIMEIRA SUBMISSÃO
    try {
        const barcodesWithInfo = Array.isArray(barcodesData) ? barcodesData : [];

        console.log("Verificando validade dos tokens Bling antes de iniciar o processamento...");
        
        // 1. Identifica quais contas ('eliane', 'lucas') estão envolvidas nesta emissão
        const accountsInvolved = new Set(barcodesWithInfo.map(b => parseBlingBarcode(b.value)?.accountType).filter(Boolean));
        
        if (accountsInvolved.size === 0 && barcodesWithInfo.length > 0) {
            return res.status(400).json({ message: "Não foi possível determinar as contas Bling a partir dos códigos de barras." });
        }

        // 2. Tenta obter um token válido para cada conta envolvida.
        // A função getValidBlingToken fará o refresh automaticamente se necessário.
        try {
            for (const account of accountsInvolved) {
                console.log(` -> Validando token para a conta: ${account}`);
                await getValidBlingToken(account);
            }
            console.log("Tokens Bling validados com sucesso.");
        } catch (tokenError) {
            console.error("ERRO CRÍTICO: Falha na validação de um token do Bling.", tokenError);
            return res.status(503).json({ message: `Não foi possível validar o token de acesso do Bling. O sistema do Bling pode estar instável ou as credenciais precisam ser renovadas. Detalhe: ${tokenError.message}` });
        }

        const barcodesValues = barcodesWithInfo.map(b => b.value);

        // --- Verificação de Duplicidade Global ---
        if (barcodesValues.length > 0) {
            const chavesParaVerificar = barcodesValues.map(bc => parseBlingBarcode(bc)?.chaveAcesso).filter(Boolean);
            if (chavesParaVerificar.length > 0) {
                // A query agora também retorna a chave de acesso para identificação
                const dupeQuery = `
                    SELECT enr.nfe_chave_acesso_44d as chave, enr.nfe_numero as numero
                    FROM emission_nfe_reports enr 
                    WHERE enr.nfe_chave_acesso_44d = ANY($1::text[])
                `;
                const dupeResult = await pool.query(dupeQuery, [chavesParaVerificar]);

                // Se encontrou duplicatas...
                if (dupeResult.rows.length > 0) {
                    // Cria a "lista de limpeza" com as chaves duplicadas
                    const duplicateKeys = dupeResult.rows.map(row => row.chave);
                    const duplicateNumbers = dupeResult.rows.map(row => row.numero);
                    const errorMessage = `Algumas NFs já existem em emissões anteriores. Os campos duplicados serão removidos da sua lista. Notas Duplicadas: ${duplicateNumbers}`;
                    
                    // Retorna o erro 409 com a mensagem E a lista de chaves
                    return res.status(409).json({
                        message: errorMessage,
                        duplicateKeys: duplicateKeys 
                    });
                }
            }
        }
        
        // ETAPA 1: PROCESSAMENTO EM MEMÓRIA COM CACHE
        console.log("Iniciando processamento em memória, com verificação de cache...");
        let processedReports = [];
        let needsManualCarrierAssignment = false;
        
        const chavesParaBuscarDoCache = barcodesWithInfo.map(b => parseBlingBarcode(b.value)?.chaveAcesso).filter(Boolean);
        const cachedNfesResult = await pool.query('SELECT * FROM cached_nfe WHERE chave_acesso = ANY($1::text[])', [chavesParaBuscarDoCache]);
        const cachedNfesMap = new Map(cachedNfesResult.rows.map(nf => [nf.chave_acesso, nf]));

        for (const barcodeInfo of barcodesWithInfo) {
            const scannedBarcode = barcodeInfo.value;
            const ehFrenet = barcodeInfo.isFrenet || false;
            let report = { nfe_chave_acesso_usada: scannedBarcode, ehFrenet, product_descriptions_list: [] };
            const parsedInfo = parseBlingBarcode(scannedBarcode);
            report.nfe_chave_acesso_44d = parsedInfo.chaveAcesso;
            report.bling_account_type = parsedInfo.accountType;

            const cachedData = cachedNfesMap.get(report.nfe_chave_acesso_44d);
            if (cachedData) {
                console.log(` -> Usando dados do cache para a NF ...${report.nfe_chave_acesso_44d.slice(-9)}`);
                report.nfe_numero = cachedData.nfe_numero;
                report.transportador_nome = cachedData.transportador_nome;
                
                report.total_volumes_calculado = cachedData.total_volumes || 0; 
                report.status_processamento = 'SUCCESS_CACHE';
            } else {
                console.log(` -> Cache miss para a NF ...${report.nfe_chave_acesso_44d.slice(-9)}. Buscando na API...`);
                try {
                    const nfeSearchResponse = await blingApiGet(`https://api.bling.com.br/Api/v3/nfe?chaveAcesso=${report.nfe_chave_acesso_44d}`, report.bling_account_type);
                    if (!nfeSearchResponse.data?.[0]?.id) throw new Error(`NF-e não encontrada no Bling.`);
                    
                    const nfeDetailsResponse = await blingApiGet(`https://api.bling.com.br/Api/v3/nfe/${nfeSearchResponse.data[0].id}`, report.bling_account_type);
                    const nfeDetails = nfeDetailsResponse.data;

                    report.nfe_numero = nfeDetails.numero?.toString() || 'N/A';
                    report.transportador_nome = nfeDetails.transporte?.transportador?.nome || 'N/D';
                    
                    // --- INÍCIO DA LÓGICA DE VOLUMES COM CACHE DE PRODUTOS ---
                    let volumesCalculadoParaEstaNF = 0;
                    if (nfeDetails.itens && nfeDetails.itens.length > 0) {
                        const skusDaNota = nfeDetails.itens.map(item => item.codigo).filter(Boolean);
                        const cachedProductsResult = await pool.query('SELECT sku, volumes FROM cached_products WHERE sku = ANY($1::text[]) AND bling_account = $2', [skusDaNota, report.bling_account_type]);
                        const cachedProductsMap = new Map(cachedProductsResult.rows.map(p => [p.sku, p.volumes]));
                        
                        for (const item of nfeDetails.itens) {
                            report.product_descriptions_list.push(String(item.descricao || 'S/ Descrição').substring(0, 100));
                            const produtoCodigo = item.codigo; const quantidadeComprada = parseFloat(item.quantidade);
                            if (!produtoCodigo || isNaN(quantidadeComprada)) continue;
                            
                            let volumesUnit = 0;
                            if (cachedProductsMap.has(produtoCodigo)) {
                                volumesUnit = cachedProductsMap.get(produtoCodigo) || 0;
                            } else {
                                try {
                                    const prodSearchResp = await blingApiGet(`https://api.bling.com.br/Api/v3/produtos?codigos[]=${produtoCodigo}`, report.bling_account_type);
                                    if (prodSearchResp.data?.[0]?.id) {
                                        const prodDetailsResp = await blingApiGet(`https://api.bling.com.br/Api/v3/produtos/${prodSearchResp.data[0].id}`, report.bling_account_type);
                                        volumesUnit = parseFloat(prodDetailsResp.data.volumes || 0);
                                    }
                                } catch (productError) { console.error(`Erro ao buscar produto ${produtoCodigo}: ${productError.message}`); }
                            }
                            volumesCalculadoParaEstaNF += volumesUnit * quantidadeComprada;
                        }
                    }
                    report.total_volumes_calculado = volumesCalculadoParaEstaNF;
                    // --- FIM DA LÓGICA DE VOLUMES COM CACHE DE PRODUTOS ---
                    
                    report.status_processamento = 'SUCCESS';

                    const etiqueta = nfeDetails.transporte?.etiqueta || {};
                    const contato = nfeDetails.contato || {};

                    console.log(`   -> Salvando NF ...${report.nfe_chave_acesso_44d.slice(-9)} no cache local...`);
                    await pool.query(
                        `INSERT INTO cached_nfe (
                                bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome, total_volumes, product_descriptions_list, data_emissao, 
                                etiqueta_nome, etiqueta_endereco, etiqueta_numero, etiqueta_complemento, 
                                etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, fone,
                                last_updated_at
                        )
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
                         ON CONFLICT (chave_acesso) DO NOTHING`, // Apenas insere, não atualiza, pois a sync fará isso
                        [
                            nfeDetails.id, 
                            report.bling_account_type, 
                            report.nfe_numero, 
                            report.nfe_chave_acesso_44d,
                            report.transportador_nome, 
                            report.total_volumes_calculado,
                            report.product_descriptions_list.join('; '),
                            nfeDetails.dataEmissao,
                            etiqueta.nome, etiqueta.endereco, etiqueta.numero, etiqueta.complemento,
                            etiqueta.municipio, etiqueta.uf, etiqueta.cep, etiqueta.bairro,
                            contato.telefone
                        ]
                    );
                } catch (apiError) {
                    report.status_processamento = 'ERROR_API';
                    report.detalhes_erro = apiError.message;
                }
            }
            
            if (report.ehFrenet) {
                report.transportador_nome = 'Frenet';
                report.apelidoDaTransportadora = 'FRENET';
            } else {
                report.apelidoDaTransportadora = getApelidoFromNomeCompleto(report.transportador_nome);
            }
            
            if ((report.transportador_nome === 'N/D' || report.transportador_nome === null || report.transportador_nome === '') && !report.ehFrenet) {
                needsManualCarrierAssignment = true;
            }
            processedReports.push(report);
            
            if (!cachedData && barcodesWithInfo.indexOf(barcodeInfo) < barcodesWithInfo.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
        }

        // ETAPA 2: VERIFICAÇÃO E RESPOSTA CONDICIONAL
        if (needsManualCarrierAssignment) {
            return res.status(200).json({ status: 'carrier_assignment_required', processedReports: processedReports });
        }
        
        // ETAPA 3: Se tudo OK, salva no banco
        client = await pool.connect();
        await client.query('BEGIN');
        const emissionResult = await client.query('INSERT INTO emissions (title) VALUES ($1) RETURNING id', [title]);
        const newEmissionId = emissionResult.rows[0].id;
        for (const value of barcodesValues) { await client.query('INSERT INTO emission_barcodes (emission_id, barcode_value) VALUES ($1, $2)', [newEmissionId, value]); }
        for (const report of processedReports) {
             await client.query(
                `INSERT INTO emission_nfe_reports (emission_id, bling_account_type, nfe_numero, transportador_nome, total_volumes_calculado, status_processamento, detalhes_erro, nfe_chave_acesso_usada, nfe_chave_acesso_44d, transportadora_apelido, product_descriptions_list, eh_frenet, status_para_relacao) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendente')`,
                [ newEmissionId, report.bling_account_type, report.nfe_numero, report.transportador_nome, report.total_volumes_calculado, report.status_processamento, report.detalhes_erro, report.nfe_chave_acesso_usada, report.nfe_chave_acesso_44d, report.apelidoDaTransportadora, (report.product_descriptions_list || []).join('; '), report.ehFrenet ]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ message: `Emissão "${title}" criada com sucesso.` });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error("Erro crítico ao criar e finalizar emissão:", error);
        res.status(500).json({ message: error.message || "Erro crítico ao salvar a emissão." });
    } finally {
        if (client) client.release();
    }
};


exports.getEmissaoDetails = async (req, res) => {
    const emissionId = parseInt(req.params.id, 10);
    if (isNaN(emissionId)) {
        return res.status(400).json({ message: "ID da emissão inválido." });
    }
    try {
        const emissionResult = await pool.query('SELECT id, title, created_at FROM emissions WHERE id = $1', [emissionId]);
        if (emissionResult.rowCount === 0) {
            return res.status(404).json({ message: "Emissão não encontrada." });
        }
        const emission = emissionResult.rows[0];

        const barcodesRawResult = await pool.query(
            'SELECT barcode_value, scan_order FROM emission_barcodes WHERE emission_id = $1 ORDER BY scan_order ASC',
            [emissionId]
        );
        emission.scanned_barcodes = barcodesRawResult.rows;

        const reportsResult = await pool.query(
            `SELECT id, bling_account_type, nfe_numero, nfe_chave_acesso_usada, transportador_nome, 
                    total_volumes_calculado, status_processamento, detalhes_erro, data_processamento, 
                    nfe_chave_acesso_44d, transportadora_apelido, status_para_relacao, product_descriptions_list 
             FROM emission_nfe_reports 
             WHERE emission_id = $1 ORDER BY id ASC`, // Adicionado product_descriptions_list
            [emissionId]
        );
        emission.nfe_reports = reportsResult.rows;

        res.status(200).json(emission);
    } catch (error) {
        console.error(`Erro ao buscar detalhes da emissão ${emissionId}:`, error);
        res.status(500).json({ message: "Erro ao buscar detalhes da emissão." });
    }
};

exports.removeEmissao = async (req, res) => {
    const { id } = req.params;
    console.log(`[DELETE_EMISSAO] Recebida requisição para deletar emissão ID: ${id}`);
    
    const client = await pool.connect();
    try {
        // Inicia uma transação para garantir que tudo aconteça ou nada aconteça
        await client.query('BEGIN');

        // Passo 1: Encontrar todos os códigos de barras associados a esta emissão.
        const barcodesResult = await client.query(
            'SELECT nfe_chave_acesso_usada FROM emission_nfe_reports WHERE emission_id = $1',
            [id]
        );
        const barcodesToRemove = barcodesResult.rows.map(r => r.nfe_chave_acesso_usada);

        console.log(`[DELETE_EMISSAO] Encontrados ${barcodesToRemove.length} códigos para limpar do estado de bipagem.`);

        // Passo 2: Se encontramos códigos, removemos eles de qualquer estado salvo.
        if (barcodesToRemove.length > 0) {
            // Esta query do PostgreSQL usa o operador '-' para remover elementos de um array JSONB.
            const updateStateQuery = `
                UPDATE bipagem_state
                SET barcodes_json = barcodes_json - $1::text[]
            `;
            const updateStateResult = await client.query(updateStateQuery, [barcodesToRemove]);
            console.log(`[DELETE_EMISSAO] ${updateStateResult.rowCount} registro(s) de 'bipagem_state' foi(ram) atualizado(s).`);
        }

        // Passo 3: Deletar a emissão principal. 
        // (Isso deve deletar em cascata os 'emission_nfe_reports' e 'emission_barcodes' 
        // se a sua chave estrangeira estiver configurada com ON DELETE CASCADE)
        const deleteResult = await client.query(
            'DELETE FROM emissions WHERE id = $1 RETURNING title', 
            [id]
        );
        
        if (deleteResult.rowCount === 0) {
            throw new Error('Emissão não encontrada para exclusão.');
        }

        const deletedTitle = deleteResult.rows[0].title;
        console.log(`[DELETE_EMISSAO] Emissão "${deletedTitle}" deletada com sucesso.`);

        // Se tudo deu certo, confirma as mudanças no banco de dados
        await client.query('COMMIT');
        
        res.status(200).json({ message: `Emissão "${deletedTitle}" e seus relatórios foram removidos com sucesso.` });

    } catch (error) {
        // Se qualquer passo falhar, desfaz todas as alterações
        await client.query('ROLLBACK');
        console.error(`Erro ao deletar emissão ID ${id}:`, error);
        res.status(500).json({ message: `Erro ao deletar emissão: ${error.message}` });
    } finally {
        // Libera a conexão de volta para o pool
        if (client) client.release();
    }
};

// Função para tentar "trancar" a página de emissão
exports.acquireEmissionLock = async (req, res) => {
    const username = req.session.username || 'desconhecido';
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // A cláusula FOR UPDATE tranca a linha, impedindo que duas pessoas tentem ao mesmo tempo
        const lockResult = await client.query("SELECT * FROM app_locks WHERE lock_key = 'EMISSION_LOCK' FOR UPDATE");
        
        const lock = lockResult.rows[0];
        const fiveMinutesAgo = new Date(new Date().getTime() - (5 * 60 * 1000));

        // A página está livre se 'is_locked' for falso OU se a trava for muito antiga (mais de 5 minutos)
        if (!lock.is_locked || new Date(lock.locked_at) < fiveMinutesAgo) {
            await client.query(
                "UPDATE app_locks SET is_locked = true, locked_by = $1, locked_at = NOW() WHERE lock_key = 'EMISSION_LOCK'",
                [username]
            );
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Trava adquirida com sucesso.' });
        } else {
            // A página está ocupada por outro usuário
            await client.query('ROLLBACK');
            res.status(409).json({ // 409 Conflict
                success: false,
                message: `A página de emissão já está em uso por ${lock.locked_by} desde ${new Date(lock.locked_at).toLocaleTimeString('pt-BR')}.`
            });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao adquirir trava de emissão:', error);
        res.status(500).json({ message: 'Erro no servidor ao tentar acessar a página.' });
    } finally {
        client.release();
    }
};

// Função para "destrancar" a página de emissão
exports.releaseEmissionLock = async (req, res) => {
    const username = req.session.username || 'desconhecido';
    try {
        // Só libera a trava se o usuário que está liberando for o mesmo que travou
        await pool.query(
            "UPDATE app_locks SET is_locked = false, locked_by = NULL, locked_at = NULL WHERE lock_key = 'EMISSION_LOCK' AND locked_by = $1",
            [username]
        );
        res.status(200).json({ success: true, message: 'Trava liberada.' });
    } catch (error) {
        console.error('Erro ao liberar trava de emissão:', error);
        res.status(500).json({ message: 'Erro no servidor ao liberar a trava.' });
    }
};

exports.acquireEmissionLock = async (req, res) => {
    const username = req.session.username || 'desconhecido';
    console.log(`[LOCK] Tentativa de trava por: ${username}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const lockResult = await client.query("SELECT * FROM app_locks WHERE lock_key = 'EMISSION_LOCK' FOR UPDATE");
        
        const lock = lockResult.rows[0];
        const fiveMinutesAgo = new Date(new Date().getTime() - (5 * 60 * 1000));

        // A página está livre se 'is_locked' for falso OU se a trava for muito antiga
        if (!lock.is_locked || new Date(lock.locked_at) < fiveMinutesAgo) {
            await client.query(
                "UPDATE app_locks SET is_locked = true, locked_by = $1, locked_at = NOW() WHERE lock_key = 'EMISSION_LOCK'",
                [username]
            );
            await client.query('COMMIT');
            setEmissaoPageStatus(true); // Atualiza a variável de controle da sincronização
            res.status(200).json({ success: true, message: 'Trava adquirida com sucesso.' });
        } else {
            await client.query('ROLLBACK');
            res.status(409).json({ // 409 Conflict
                success: false,
                message: `A página de emissão já está em uso por ${lock.locked_by} desde ${new Date(lock.locked_at).toLocaleTimeString('pt-BR')}.`
            });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao adquirir trava de emissão:', error);
        res.status(500).json({ message: 'Erro no servidor ao tentar acessar a página.' });
    } finally {
        client.release();
    }
};

exports.releaseEmissionLock = async (req, res) => {
    const username = req.session.username || 'desconhecido';
    console.log(`[LOCK] Tentativa de liberação por: ${username}`);
    try {
        // A trava só é liberada pelo mesmo usuário que a adquiriu, para segurança
        const result = await pool.query(
            "UPDATE app_locks SET is_locked = false, locked_by = NULL, locked_at = NULL WHERE lock_key = 'EMISSION_LOCK' AND locked_by = $1",
            [username]
        );

        // Se a query acima não afetou nenhuma linha, pode ser que outro admin já liberou
        // ou a trava expirou e foi pega por outro. Não tratamos como erro.
        if (result.rowCount > 0) {
             console.log(`[LOCK] Trava liberada com sucesso por ${username}.`);
        } else {
             console.log(`[LOCK] Tentativa de liberação, mas a trava não pertencia a ${username} ou já estava livre.`);
        }
        
        setEmissaoPageStatus(false); // Atualiza a variável de controle da sincronização
        res.status(200).json({ success: true, message: 'Trava liberada.' });
    } catch (error) {
        console.error('Erro ao liberar trava de emissão:', error);
        res.status(500).json({ message: 'Erro no servidor ao liberar a trava.' });
    }
};

exports.getNfeManagementPage = async (req, res) => {
    try {
        // A função agora só renderiza a página. O JavaScript cuidará de buscar os dados.
        res.render('relacao/nfe-management', {
            title: 'Gerar Etiquetas de NF-e',
            layout: 'main'
        });
    } catch (error) {
        console.error("Erro ao carregar a página de gerenciamento de NF-e:", error);
        req.flash('error', 'Erro ao carregar a página de gerenciamento de NF-e.');
        res.redirect('/');
    }
};

exports.getNfeCacheApi = async (req, res) => {
    try {
        const { page = 1, account, search = '', sortBy = 'data_desc', status, plataforma } = req.query;
        const limit = 100; // 100 notas por página, como você pediu
        const offset = (page - 1) * limit;

        let fromClause = 'FROM cached_nfe';
        let whereClauses = [];
        let queryParams = [];
        let paramIndex = 1;

        if (plataforma) {
            fromClause += ' JOIN cached_pedido_venda cp ON cached_nfe.nfe_numero = cp.nfe_parent_numero';
            whereClauses.push(`cp.intermediador_cnpj = $${paramIndex++}`);
            queryParams.push(plataforma);
        }

        if (account && ['eliane', 'lucas'].includes(account)) {
            whereClauses.push(`cached_nfe.bling_account = $${paramIndex++}`);
            queryParams.push(account);
        }

        if (search) {
            whereClauses.push(`(cached_nfe.nfe_numero ILIKE $${paramIndex++} OR cached_nfe.transportador_nome ILIKE $${paramIndex++})`);
            queryParams.push(`%${search}%`);
            queryParams.push(`%${search}%`);
        }

        if (status === 'Aprovado') {
            whereClauses.push(`cached_nfe.situacao = 5`);
        } else if (status === 'Emitida') {
            whereClauses.push(`cached_nfe.situacao = 6`);
        } else {
            whereClauses.push(`cached_nfe.situacao IN (5, 6)`);
        }
        
        whereClauses.push(`cached_nfe.product_descriptions_list <> 'Peças de Assistencias'`);
        const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Lógica de Ordenação
        let orderByClause = 'ORDER BY cached_nfe.data_emissao DESC';
        if (sortBy === 'data_asc') {
            orderByClause = 'ORDER BY cached_nfe.data_emissao ASC';
        }

        // Query para buscar os dados da página atual
        const dataQuery = `
            SELECT DISTINCT cached_nfe.bling_id, cached_nfe.nfe_numero, cached_nfe.transportador_nome, cached_nfe.total_volumes, cached_nfe.data_emissao, cached_nfe.situacao
            ${fromClause}
            ${whereCondition}
            ${orderByClause}
            LIMIT $${paramIndex++} OFFSET $${paramIndex++};
        `;
        queryParams.push(limit, offset);
        //const finalDataParams = [...queryParams, limit, offset];
        const nfeResult = await pool.query(dataQuery, queryParams);

        // Query para contar o total de itens para a paginação
        // Removemos LIMIT e OFFSET dos parâmetros para a contagem
        const countParams = queryParams.slice(0, paramIndex - 3);
        const countQuery = `SELECT COUNT(*) ${fromClause} ${whereCondition};`;
        const totalResult = await pool.query(countQuery, countParams);
        const totalItems = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        res.status(200).json({
            nfeData: nfeResult.rows,
            pagination: {
                currentPage: parseInt(page, 10),
                totalPages: totalPages,
                totalItems: totalItems
            }
        });

    } catch (error) {
        console.error("Erro na API ao buscar notas em cache:", error);
        res.status(500).json({ message: "Erro ao buscar dados das notas fiscais." });
    }
};

// Em controllers/emissaoController.js

// Em controllers/emissaoController.js

exports.getPrintLabelsPage = async (req, res) => {
    const { ids } = req.query;
    if (!ids) return res.status(400).send("Nenhum ID de nota fiscal fornecido.");

    const nfeBlingIds = ids.split(',').map(id => parseInt(id, 10)).filter(Number.isInteger);
    if (nfeBlingIds.length === 0) return res.status(400).send("IDs de notas fiscais inválidos.");

    const client = await pool.connect();
    try {
        const empresaEliane = { nome: "ELIANE TRIDAPALLI ANZAI ME", cnpj: "34.321.153/0001-52" };
        const empresaLucas = { nome: "INOVA MAGAZINE COMERCIOS DE MOVEIS LTDA", cnpj: "40.062.295/0001-45" };

        // Busca NFs
        const nfeQuery = `
            SELECT bling_id, nfe_numero, chave_acesso, transportador_nome, bling_account, fone,
                   etiqueta_nome, data_emissao, etiqueta_endereco, etiqueta_numero, etiqueta_complemento, 
                   etiqueta_municipio, etiqueta_uf, etiqueta_cep, etiqueta_bairro, product_ids_list
            FROM cached_nfe
            WHERE bling_id = ANY($1::bigint[])
        `;
        const nfeResult = await client.query(nfeQuery, [nfeBlingIds]);

        // Extrai todos os bling_id de produtos de todas as NFs
        const allProductIds = [];
        nfeResult.rows.forEach(nf => {
            const ids = (nf.product_ids_list || '')
                .split(';')
                .map(id => parseInt(id.trim(), 10))
                .filter(Number.isInteger);
            allProductIds.push(...ids);
        });

        const uniqueProductIds = [...new Set(allProductIds)];

        // Consulta quantidades por nfe_numero + produto_codigo
        const quantidadeMap = new Map();
        const allNfeNumeros = nfeResult.rows.map(nf => nf.nfe_numero);
        const quantQuery = `
            SELECT nfe_numero, produto_codigo, quantidade
            FROM nfe_quantidade_produto
            WHERE nfe_numero = ANY($1::text[])
        `;
        const quantResult = await client.query(quantQuery, [allNfeNumeros]);
        quantResult.rows.forEach(row => {
            quantidadeMap.set(`${row.nfe_numero}|${row.produto_codigo?.trim().toUpperCase()}`, parseFloat(row.quantidade));
        });

        console.log(`Encontradas ${quantResult.rowCount} quantidades de produtos para as NFs fornecidas.`);
        console.log(`Mapeadas ${quantidadeMap.size} quantidades de produtos por NF e SKU.`);
        console.log(quantidadeMap);

        // Consulta volumes e SKUs por bling_id
        const productVolumeMap = new Map();
        const prodQuery = `
            SELECT bling_id, sku, volumes, nome
            FROM cached_products
            WHERE bling_id = ANY($1::bigint[])
        `;
        const prodResult = await client.query(prodQuery, [uniqueProductIds]);
        console.log(`Encontrados ${prodResult.rowCount} produtos no cache para os IDs fornecidos.`);
        console.log(uniqueProductIds);
        prodResult.rows.forEach(p => {
            productVolumeMap.set(Number(p.bling_id), { 
                sku: p.sku, 
                volumes: parseFloat(p.volumes || 0),
                nome: p.nome || ''
            });
        });

        console.log(`Mapeados ${productVolumeMap.size} produtos com volumes e SKUs.`);
        console.log(productVolumeMap);

        // Consulta estruturas
        const estruturasQuery = `
            SELECT parent_product_bling_id, component_sku, component_location, structure_name, gtin, gtin_embalagem
            FROM cached_structures
            WHERE parent_product_bling_id = ANY($1::bigint[])
        `;
        const estruturasResult = await client.query(estruturasQuery, [uniqueProductIds]);
        console.log(`Encontradas ${estruturasResult.rowCount} estruturas para os produtos fornecidos.`);
        const estruturasMap = new Map();
        estruturasResult.rows.forEach(e => {
            if (!estruturasMap.has(e.parent_product_bling_id)) {
                estruturasMap.set(e.parent_product_bling_id, []);
            }
            estruturasMap.get(e.parent_product_bling_id).push(e);
        });

        console.log(`Mapeadas ${estruturasMap.size} estruturas de produtos.`);
        console.log(estruturasMap);

        // Gera etiquetas
        const labelsToPrint = [];
        for (const nf of nfeResult.rows) {
            const productIds = (nf.product_ids_list || '')
                .split(';')
                .map(id => parseInt(id.trim(), 10))
                .filter(Number.isInteger);

            let etiquetasGeradas = [];

            for (const productId of productIds) {
                const skuInfo = productVolumeMap.get(productId);
                console.log(productId);
                console.log('AQUIIIIIIIIIIIIIIIIIIIIIIIIII:');
                console.log(skuInfo);
                const sku = skuInfo?.sku?.trim().toUpperCase() || `__SKU_${productId}`;
                const volumeUnit = skuInfo?.volumes || 0;

                const key = `${nf.nfe_numero}|${sku}`;
                
                const quantidade = quantidadeMap.get(key) || 0;

                const totalEtiquetas = Math.round(quantidade * volumeUnit) || 1;

                const estruturas = estruturasMap.get(String(productId)) || [];
                console.log(`Gerando ${totalEtiquetas} etiquetas para NF ${nf.nfe_numero} - Produto SKU: ${sku} (${productId})`);
                console.log(`Estruturas encontradas: ${estruturas.length}`);
                console.log(estruturas);
                for (let i = 0; i < totalEtiquetas; i++) {
                    const estrutura = estruturas[i] || {};
                    etiquetasGeradas.push({
                        nome: nf.etiqueta_nome,
                        endereco: nf.etiqueta_endereco,
                        numero: nf.etiqueta_numero,
                        complemento: nf.etiqueta_complemento,
                        bairro: nf.etiqueta_bairro,
                        municipio: nf.etiqueta_municipio,
                        uf: nf.etiqueta_uf,
                        cep: nf.etiqueta_cep,
                        fone: nf.fone,
                        nfe_numero: nf.nfe_numero,
                        nfe_emissao: nf.data_emissao,
                        chave_acesso: nf.chave_acesso,
                        transportador_nome: nf.transportador_nome,
                        component_sku: estrutura.component_sku || 'N/D',
                        component_location: estrutura.component_location || 'N/D',
                        quantidade_produto: quantidade,
                        structure_name: estrutura.structure_name || 'N/D',
                        empresa: nf.bling_account === 'lucas' ? empresaLucas : empresaEliane,
                        product_name: skuInfo?.nome || 'Produto sem nome',
                        gtin: estrutura.gtin || estrutura.gtin_embalagem || 'N/D'
                    });
                }
            }

            const totalVolumes = etiquetasGeradas.length || 1;
            etiquetasGeradas = etiquetasGeradas.map((et, idx) => ({
                ...et,
                volume_atual: idx + 1,
                volume_total: totalVolumes
            }));

            labelsToPrint.push(...etiquetasGeradas);
        }

        const pdfBuffer = await generateLabelsPdf(labelsToPrint);
        const fileName = `Etiquetas_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Erro ao gerar etiquetas:", error);
        res.status(500).send("Erro interno ao preparar etiquetas para impressão.");
    } finally {
        client.release();
    }
};

exports.triggerManualNfeSync = (req, res) => {
    const status = getSyncStatus();

    if (status.isNFeRunning) {
        return res.status(409).json({ message: "A sincronização de notas fiscais já está em andamento." });
    }
    if (status.isProductSyncRunning) {
        return res.status(409).json({ message: "A sincronização de produtos está em andamento. Por favor, aguarde a finalização para iniciar a busca por novas notas." });
    }
    if (status.isEmissaoPageActive) {
        return res.status(409).json({ message: "A página de emissão de notas está sendo utilizada. A sincronização não pode ser iniciada para garantir a consistência dos dados." });
    }

    // Dispara as sincronizações em background e responde imediatamente
    syncNFeLucas();
    syncNFeEliane();

    res.status(202).json({ message: "Sincronização iniciada com sucesso! As novas notas aparecerão na lista em breve." });
};