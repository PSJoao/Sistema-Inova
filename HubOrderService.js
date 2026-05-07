// services/HubOrderService.js
// Responsável pela sincronização de PEDIDOS (Mercado Livre) entre o ERP Citel e o Sistema.
const CitelGateway = require('./CitelGateway');
const axios = require('axios');
const MercadoLivreOrder = require('../models/MercadoLivreOrder');
const OrderItem = require('../models/OrderItem');
const db = require('../config/database');
const syncPackid = require('../sync-packid');
const syncDates = require('../sync-dates');

const HUB_API_URL = process.env.HUB_API_URL;
const HUB_ACCOUNTS = [
    { email: process.env.HUB_EMAIL_1, pass: process.env.HUB_PASS_1 },
    { email: process.env.HUB_EMAIL_2, pass: process.env.HUB_PASS_2 },
    { email: process.env.HUB_EMAIL_3, pass: process.env.HUB_PASS_3 },
    { email: process.env.HUB_EMAIL_4, pass: process.env.HUB_PASS_4 },
    { email: process.env.HUB_EMAIL_5, pass: process.env.HUB_PASS_5 }
].filter(acc => acc.email && acc.pass);

const hubTokenCache = {};

let isSyncing = false;     // Indica se a busca agendada está a rodar
let stopSignal = false;    // Bandeira para pedir interrupção da busca agendada

// Helper para extrair número da NFe do XML via Regex 
function extractNfeNumberFromXml(xmlString) {
    if (!xmlString) return null;
    // Procura pela tag <nNF>número</nNF>
    const match = xmlString.match(/<nNF>(\d+)<\/nNF>/);
    return match ? match[1] : null;
}

// Define o status inicial baseado na resposta da API
function resolveStatusBucket(pedidoApi) {
    // Garante acesso aos dados internos do pedido (se vier dentro de um wrapper .pedido ou não)
    const p = pedidoApi.pedido || pedidoApi;

    // 1. Verifica flag explícita de cancelamento
    if (pedidoApi.cancelado === true || p.cancelado === true) {
        return 'cancelado';
    }

    // 2. NOVA REGRA: Detecção de Cancelamento por falta de datas logísticas
    // Se não tem data limite de envio E não tem data de coleta, o Mercado Livre considera cancelado/inválido.
    /*if (!p.dataEnvioLimite && !p.dataColetaAgendada) {
        return 'cancelado';
    }*/

    // Retorna pendente para novos pedidos ou atualizações normais.
    // O Model MercadoLivreOrder protege status avançados (separado, etc) de serem sobrescritos por 'pendente'.
    return 'pendente';
}

// --- FUNÇÃO DE CORREÇÃO INTELIGENTE DE OCR ---
function generateOcrVariations(originalId) {
    if (!originalId || !originalId.startsWith('SHP_')) return [];

    // Remove o prefixo para não tentar variar o 'S' do 'SHP_'
    const prefix = 'SHP_';
    const cleanId = originalId.replace(prefix, '');

    // Mapa de confusões comuns (Caractere Lido -> Alternativa Possível)
    const confusions = [
        { char: 'S', alt: '5' },
        { char: '5', alt: 'S' },
        { char: 'O', alt: '0' },
        { char: '0', alt: 'O' },
        { char: 'Z', alt: '2' },
        { char: '2', alt: 'Z' },
        { char: 'B', alt: '8' },
        { char: '8', alt: 'B' }
    ];

    // Encontra índices onde ocorrem caracteres confusos
    let ambiguousIndices = [];
    for (let i = 0; i < cleanId.length; i++) {
        const char = cleanId[i];
        const confusion = confusions.find(c => c.char === char);
        if (confusion) {
            ambiguousIndices.push({ index: i, ...confusion });
        }
    }

    // Se tiver muitas ambiguidades, limita a 4 para não explodir a API (2^4 = 16 tentativas)
    if (ambiguousIndices.length === 0 || ambiguousIndices.length > 4) return [];

    const variations = [];
    const totalCombinations = 1 << ambiguousIndices.length; // 2^N

    // Gera todas as combinações binárias
    for (let i = 1; i < totalCombinations; i++) { // Começa do 1 pois o 0 é o original
        let chars = cleanId.split('');

        for (let j = 0; j < ambiguousIndices.length; j++) {
            // Se o bit j estiver ativo, aplica a troca
            if ((i >> j) & 1) {
                const { index, alt } = ambiguousIndices[j];
                chars[index] = alt;
            }
        }
        variations.push(prefix + chars.join(''));
    }

    return variations;
}
// ---------------------------------------------

function safeDate(val) {
    if (!val) return null;

    // Cria o objeto Date (que vai nascer como 00:00 UTC se a string for só data)
    const date = new Date(val);

    // Validação básica para não quebrar com datas inválidas
    if (isNaN(date.getTime())) return null;

    // A MÁGICA ACONTECE AQUI:
    // Se a hora for detectada como madrugada em UTC (00h a 05h), significa que 
    // provavelmente veio sem hora ou é muito cedo.
    // O fuso do Brasil (-3h) jogaria isso para o dia anterior.
    // Então, forçamos para 12:00 (Meio-dia) UTC.
    const utcHours = date.getUTCHours();
    if (utcHours < 5) {
        date.setUTCHours(12);
    }

    return date;
}

// --- HELPERS DO HUB ML ---

async function getHubToken(account) {
    const now = Date.now();
    const cached = hubTokenCache[account.email];

    // Se tem token válido (com margem de 5min), usa ele
    if (cached && cached.token && cached.expiresAt > now + 300000) {
        return cached.token;
    }

    try {
        const response = await axios.post(`${HUB_API_URL}/login`, {
            email: account.email,
            password: account.pass
        });

        if (response.data && response.data.token) {
            // Salva no cache (validade simulada de 24h para evitar login excessivo)
            hubTokenCache[account.email] = {
                token: response.data.token,
                expiresAt: now + (24 * 60 * 60 * 1000)
            };
            return response.data.token;
        }
    } catch (error) {
        console.error(`[HubOrderService] Falha ao logar no Hub com ${account.email}:`, error.message);
    }
    return null;
}

// Helper replicado para extrair data da etiqueta (Necessário para a lógica de datas)
function extractShippingDateFromZplInternal(zplContent) {
    if (!zplContent) return null;
    let match = zplContent.match(/Despachar:[\s\S]*?(\d{1,2})\/([a-zç]{3})/i);
    if (!match) match = zplContent.match(/\^FD(\d{1,2})-([a-zç]{3})\^FS/i); // Padrão Flex

    if (!match) return null;

    const day = parseInt(match[1]);
    const monthStr = match[2].toLowerCase();
    const months = {
        'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
        'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11,
        'feb': 1, 'apr': 3, 'may': 4, 'aug': 7, 'sep': 8, 'oct': 9, 'dec': 11
    };

    if (months[monthStr] === undefined) return null;
    const now = new Date();
    let year = now.getFullYear();
    const currentMonth = now.getMonth();
    const labelMonth = months[monthStr];

    if (currentMonth === 11 && labelMonth === 0) year++; // Virada de ano

    return new Date(Date.UTC(year, labelMonth, day, 12, 0, 0));
}

const HubOrderService = {

    // --- NOVO: Captura ativa de etiquetas do Hub (Modo Seguro: Não Sobrescreve) ---
    async syncLabelsFromHub() {
        console.log('[HubOrderService] Iniciando ingestão COMPLETA de etiquetas do Hub ML...');
        let totalImportado = 0;
        let totalAtualizado = 0;

        for (const account of HUB_ACCOUNTS) {
            try {
                const token = await getHubToken(account);
                if (!token) continue;

                console.log(`[HubOrderService] Buscando etiquetas na conta: ${account.email}`);

                let offset = 0;
                const limit = 1000;
                let continuarBuscando = true;
                let paginasProcessadas = 0;

                while (continuarBuscando) {
                    try {
                        const response = await axios.get(`${HUB_API_URL}/pedidos`, {
                            params: { limit: limit, offset: offset },
                            headers: { 'Authorization': `Bearer ${token}` }
                        });

                        const pacotes = response.data.dados || [];

                        if (pacotes.length === 0) {
                            continuarBuscando = false;
                            break;
                        }

                        for (const pacote of pacotes) {
                            let semEtiqueta = false;
                            let etiquetaZpl = null;

                            if (!pacote.etiqueta_zpl && (pacote.status_envio === 'cancelled' || pacote.status_envio === 'shipped' || pacote.status_envio === 'delivered' || pacote.status_pedido_geral === 'cancelled')) {
                                continue;
                            } else if (!pacote.etiqueta_zpl) {
                                // REGRA: Pedidos sem data limite de envio não entram como sem etiqueta
                                if (!pacote.data_limite_envio) {
                                    continue;
                                }

                                const hoje = new Date();
                                hoje.setHours(0, 0, 0, 0);
                                const dataLimiteObj = new Date(pacote.data_limite_envio);
                                dataLimiteObj.setHours(dataLimiteObj.getHours() - 3); // Corrige UTC -> BRT
                                const dataLimiteDia = new Date(dataLimiteObj);
                                dataLimiteDia.setHours(0, 0, 0, 0);

                                // REGRA: Se data limite tem mais de 1 mês, ignora (pedido antigo)
                                const umMesAtras = new Date();
                                umMesAtras.setMonth(umMesAtras.getMonth() - 1);
                                umMesAtras.setHours(0, 0, 0, 0);
                                if (dataLimiteDia < umMesAtras) {
                                    continue;
                                }

                                // REGRA: Só marca como sem etiqueta se a data limite de envio for HOJE ou já passou.
                                // Se ainda é futuro, o pedido ainda tem tempo de receber a etiqueta normalmente.
                                if (dataLimiteDia > hoje) {
                                    continue;
                                }

                                semEtiqueta = true;
                                etiquetaZpl = 'Sem Etiqueta';
                            } else {
                                etiquetaZpl = pacote.etiqueta_zpl;
                            }

                            let orderNumber = null;

                            if (!semEtiqueta) {
                                orderNumber = pacote.id_envio_ml ? `MLB_SHML${pacote.id_envio_ml}` : `MLB_PEDIDO${pacote.ids_pedidos_originais[0]}`;
                            } else {
                                orderNumber = pacote.id_envio_ml ? `MLB_SHML#${pacote.id_envio_ml}` : `MLB_PEDIDO#${pacote.ids_pedidos_originais[0]}`;
                            }

                            //const dataEnvioLimite = extractShippingDateFromZplInternal(pacote.etiqueta_zpl);

                            let dataOriginal = pacote.data_limite_envio;
                            let dataCorrigidaObj = new Date(dataOriginal);
                            dataCorrigidaObj.setHours(dataCorrigidaObj.getHours() - 3);
                            let dataEnvioCorrigida = dataCorrigidaObj.toISOString();

                            let mlbItem = null;
                            // Prevenção: busca em 'itens_pedido' ou faz fallback para 'itens' caso a API mude
                            const itensDoPedido = pacote.itens_pedido || pacote.itens || [];

                            if (itensDoPedido.length === 1) {
                                mlbItem = itensDoPedido[0].id_item || null;
                            }

                            //console.log(`PEDIDO: ${pacote.id_envio_ml}`);
                            //console.log(`Data Original (UTC): ${dataOriginal} | Data Corrigida (UTC-3): ${dataEnvioCorrigida}`);

                            // PREVENÇÃO: Se é sem etiqueta, verifica se já existe uma etiqueta REAL para este pedido.
                            // Isso evita reinserir registros que seriam limpos logo depois (flickering na contagem).
                            if (semEtiqueta) {
                                const realOrderNumber = orderNumber.replace('#', '');
                                const { rows: existingReal } = await db.query(
                                    `SELECT 1 FROM shipping_labels WHERE order_number = $1 AND (sem_etiqueta = false OR sem_etiqueta IS NULL)`,
                                    [realOrderNumber]
                                );
                                if (existingReal.length > 0) {
                                    continue; // Já tem etiqueta real, não precisa inserir como sem etiqueta
                                }
                            }

                            const res = await db.query(
                                `INSERT INTO shipping_labels (
                                    order_number,
                                    zpl_content,
                                    plataforma,
                                    data_envio_limite,
                                    mlb_item,
                                    sem_etiqueta,
                                    loja,
                                    created_at
                                )
                                VALUES ($1, $2, 'mercado_livre', $3, $4, $5, $6, NOW())
                                ON CONFLICT (order_number)
                                DO UPDATE
                                SET
                                    data_envio_limite = EXCLUDED.data_envio_limite,
                                    mlb_item = EXCLUDED.mlb_item,
                                    sem_etiqueta = EXCLUDED.sem_etiqueta,
                                    loja = EXCLUDED.loja,
                                    zpl_content = CASE
                                        WHEN shipping_labels.zpl_content IS NULL 
                                            OR shipping_labels.zpl_content = 'Sem Etiqueta'
                                        THEN EXCLUDED.zpl_content
                                        ELSE shipping_labels.zpl_content
                                    END
                                WHERE
                                    shipping_labels.data_envio_limite IS DISTINCT FROM EXCLUDED.data_envio_limite
                                    OR shipping_labels.mlb_item IS DISTINCT FROM EXCLUDED.mlb_item
                                    OR shipping_labels.sem_etiqueta IS DISTINCT FROM EXCLUDED.sem_etiqueta
                                    OR shipping_labels.loja IS DISTINCT FROM EXCLUDED.loja
                                    OR (shipping_labels.zpl_content IS NULL OR shipping_labels.zpl_content = 'Sem Etiqueta')
                                RETURNING xmax;
                                `,
                                [orderNumber, etiquetaZpl, dataEnvioCorrigida, mlbItem, semEtiqueta, pacote.nome_loja]
                            );

                            if (res.rowCount > 0) {
                                // 'xmax' é 0 para INSERTs e maior que 0 para UPDATEs no Postgres
                                if (res.rows[0].xmax == 0) {
                                    totalImportado++;
                                } else {
                                    totalAtualizado++;
                                }
                            }
                        }

                        offset += limit;
                        paginasProcessadas++;
                        console.log(`[HubOrderService] Conta ${account.email}: Pág ${paginasProcessadas} verificada.`);

                        //if (pacotes.length < limit) continuarBuscando = false;

                    } catch (errLoop) {
                        console.error(`[HubOrderService] Erro pág ${paginasProcessadas + 1} (${account.email}):`, errLoop.message);
                        continuarBuscando = false;
                    }
                }

            } catch (err) {
                console.error(`[HubOrderService] Erro conta ${account.email}:`, err.message);
            }
        }
        console.log(`[HubOrderService] Ingestão concluída. ${totalImportado} novas etiquetas importadas, ${totalAtualizado} datas corrigidas.`);

        try {
            const deleteResult = await db.query(`
                DELETE FROM shipping_labels 
                WHERE sem_etiqueta = true
                AND data_envio_limite < NOW() - INTERVAL '1 month'
            `);
            console.log(`[HubOrderService] Limpeza concluída: ${deleteResult.rowCount} registros antigos (mais de 1 mês) deletados.`);
        } catch (error) {
            console.error('[HubOrderService] Erro ao deletar registros antigos:', error.message);
        }
    },

    async processHubOrder(hubData, labelData) {
        // Mapeamento inteligente Hub -> Sistema

        // 1. Identificação
        // O Hub agrupa por envio. O numero_venda principal será o ID do Envio (se houver) com prefixo.
        const numeroVenda = hubData.id_envio_ml ? `MLB_SHML${hubData.id_envio_ml}` : `MLB_PEDIDO${hubData.ids_pedidos_originais[0]}`;

        // 2. Status
        // Se envio cancelado -> cancelado. Senão -> pendente (pois tem etiqueta e não achamos na Citel)
        let statusBucket = 'pendente';
        /*if (hubData.status_envio === 'cancelled' || hubData.status_pedido_geral === 'cancelled') {
            statusBucket = 'cancelado';
        }*/

        // 3. Datas (Regra Específica Solicitada)
        // Data Limite: Vem da Etiqueta (shipping_labels)
        const dataLimite = labelData.data_envio_limite ? new Date(labelData.data_envio_limite) : null;

        // Data Disponível: Data Limite - 2 dias
        let dataDisponivel = null;
        if (dataLimite) {
            dataDisponivel = new Date(dataLimite);
            dataDisponivel.setDate(dataDisponivel.getDate() - 2);
        }

        // Data Previsão: Vem do Hub
        const dataPrevisao = hubData.data_previsao_entrega ? new Date(hubData.data_previsao_entrega) : null;

        // 4. Itens
        const itensMap = [];
        let unidadesTotal = 0;
        let titulos = [];

        if (hubData.itens && Array.isArray(hubData.itens)) {
            for (const item of hubData.itens) {
                const skuLimpo = item.sku ? item.sku.trim() : 'SEM_SKU';

                // 4.1. Alimenta os totalizadores do pedido usando o item pai (mantém integridade financeira e visual)
                unidadesTotal += item.quantidade;
                titulos.push(item.titulo);

                // 4.2. Consulta no banco se este SKU é um Kit (item_principal) e traz o multiplicador
                const { rows: subitens } = await db.query(
                    `SELECT subitem, qtd_subitem, descri_subitem FROM produtos_estrutura WHERE item_principal = $1`,
                    [skuLimpo]
                );

                if (subitens && subitens.length > 0) {
                    // É UM KIT: Desmembra criando uma linha para cada produto real (subitem)
                    for (const linha of subitens) {
                        const subSku = linha.subitem ? String(linha.subitem).trim() : 'SEM_SKU';
                        const subCodigoProduto = parseInt(subSku.replace(/\D/g, '')) || 0;
                        const descItem = String(linha.descri_subitem) || item.titulo;
                        // ParseFloat garante que valores decimais do BD (ex: 0.1000) sejam lidos corretamente
                        const multiplicador = parseFloat(linha.qtd_subitem) || 1;
                        const quantidadeFinal = item.quantidade * multiplicador;

                        itensMap.push({
                            produto_codigo: subCodigoProduto,
                            sku: subSku,
                            descricao_produto: `${descItem} (Item de Kit)`,
                            quantidade_total: quantidadeFinal,
                            quantidade_separada: 0,
                            status: 'pendente'
                        });
                    }
                } else {
                    // PRODUTO SIMPLES: Segue o fluxo normal (não encontrou na produtos_estrutura)
                    const codigoProduto = parseInt(skuLimpo.replace(/\D/g, '')) || 0;

                    itensMap.push({
                        produto_codigo: codigoProduto,
                        sku: skuLimpo,
                        descricao_produto: item.titulo,
                        quantidade_total: item.quantidade,
                        quantidade_separada: 0,
                        status: 'pendente'
                    });
                }
            }
        }

        // 5. Cabeçalho do Pedido
        const orderData = {
            numero_venda: numeroVenda,
            data_venda: safeDate(hubData.data_criacao),

            // Dados Fiscais (Hub não tem NFe ainda, deixa null)
            chave_acesso: null,
            nfe_numero: null,
            codigo_empresa: hubData.nome_loja,

            status_bucket: statusBucket,
            total: 0, // Hub retorna preço unitário nos itens, poderia somar, mas opcional

            comprador: hubData.comprador_nickname || 'Cliente ML',
            cpf: null,

            // Endereço (Hub atual não retorna full address no endpoint de listagem, deixa genérico)
            endereco_entrega: 'Endereço via Etiqueta',
            cidade: 'N/A',
            estado_entrega: 'BR',
            cep: '00000-000',
            pais: 'BR',

            data_envio_limite: dataLimite,
            data_envio_disponivel: dataDisponivel,
            data_previsao_entrega: dataPrevisao,
            data_coleta_agendada: null, // Forçado NULL conforme solicitado

            unidades: unidadesTotal,
            titulo_anuncio: titulos.slice(0, 3).join(' | '),
            pertence_kit: hubData.ids_pedidos_originais.length > 1,

            plataforma: 'mercado_livre', // Forçado pois vem do Hub ML

            uploaded_at: new Date()
        };

        // --- PERSISTÊNCIA ---
        // Salva Cabeçalho
        await MercadoLivreOrder.bulkUpsert([orderData]);

        // Recupera ID para salvar Itens
        const savedOrders = await MercadoLivreOrder.findByNumeroVendas([numeroVenda]);
        if (savedOrders.length > 0 && itensMap.length > 0) {
            const orderId = savedOrders[0].id;

            // --- TRAVA DE SEGURANÇA ---
            const temItensProcessados = await OrderItem.hasProcessedItems(orderId);

            if (!temItensProcessados) {
                // Totalmente seguro: Limpa os itens antigos antes de gravar os novos do Hub
                await OrderItem.deleteByOrderId(orderId);
                const itemsWithId = itensMap.map(i => ({ ...i, order_id: orderId }));
                await OrderItem.bulkUpsert(itemsWithId);
            } else {
                //console.log(`[HubOrderService] ⚠️ Itens do pedido ${numeroVenda} (Hub) ignorados. O pedido já está em separação/expedição.`);
            }
        }

        console.log(`[HubOrderService] Pedido ${numeroVenda} recuperado via Hub ML (Fallback).`);
    },

    async syncPriorityList(orderNumbers) {
        console.log(`[HubOrderService] Prioridade solicitada para ${orderNumbers.length} pedidos.`);

        // 1. Se a busca agendada estiver a rodar, levanta a bandeira para parar
        if (isSyncing) {
            console.log('[HubOrderService] Parando busca agendada para dar prioridade...');
            stopSignal = true;

            // 2. Espera ativa (polling) até a busca agendada libertar o recurso
            while (isSyncing) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            console.log('[HubOrderService] Busca agendada parada. Iniciando prioritária.');
        }

        // 3. Garante que o sinal está desligado e bloqueia nova execução agendada
        stopSignal = false;
        isSyncing = true; // <--- Bloqueia o agendador enquanto a prioridade roda

        try {
            for (const numeroVenda of orderNumbers) {
                try {
                    console.log(`[HubOrderService] Processando prioritário: ${numeroVenda}`);

                    // --- 1. Buscar dados da etiqueta previamente salvos ---
                    const { rows: labelRows } = await db.query(
                        'SELECT data_envio_limite, plataforma FROM shipping_labels WHERE order_number = $1',
                        [numeroVenda]
                    );
                    const labelSalva = labelRows.length > 0 ? labelRows[0] : null;

                    // 2. PREPARAÇÃO DO ID (Ajuste se a Citel não usar o prefixo SHP_)
                    let numeroBuscaCitel = numeroVenda;

                    const dadosCitel = await CitelGateway.getPedidoPorNumero(numeroBuscaCitel);

                    if (dadosCitel) {
                        // --- 3. Passar a plataforma e a data limite correta ---
                        let plataformaPrioridade = labelSalva ? labelSalva.plataforma : 'mercado_livre';
                        if (!labelSalva && numeroVenda.startsWith('SHP_')) plataformaPrioridade = 'shopee';

                        let dataLimite = labelSalva ? labelSalva.data_envio_limite : null;

                        await this.processSingleOrder(dadosCitel, plataformaPrioridade, null, dataLimite);
                    } else {
                        console.warn(`[HubOrderService] Pedido ${numeroVenda} não retornado pela API da Citel.`);
                    }

                } catch (err) {
                    console.error(`[HubOrderService] Erro no prioritário ${numeroVenda}:`, err.message);
                }
            }
            console.log('[HubOrderService] Lista prioritária concluída.');

        } catch (error) {
            console.error('[HubOrderService] Erro fatal na lista prioritária:', error);
        } finally {
            isSyncing = false; // <--- Libera para o agendador voltar a trabalhar
        }
    },

    /**
     * Executa o ciclo de sincronização de pedidos de forma inteligente.
     * AGORA SUPORTA MULTIPLAS PLATAFORMAS (ML, Amazon, Shopee).
     */
    /**
     * Executa o ciclo de sincronização de pedidos de forma inteligente e BLINDADA.
     * Tenta Citel -> Se falhar ou não achar -> Tenta Hub ML.
     */
    /**
     * Executa o ciclo de sincronização.
     * MODO SEGURO: Fallback do Hub apenas loga, NÃO SALVA no banco.
     */
    async syncOrders() {
        if (isSyncing) {
            console.log('[HubOrders] Sincronização em andamento. Pulando ciclo.');
            return;
        }

        console.log(`[HubOrders] Iniciando sincronização...`);

        try {
            isSyncing = true;
            stopSignal = false;

            // 1. Baixa etiquetas (sem sobrescrever as existentes)
            await this.syncLabelsFromHub();

            // 2. Busca pedidos pendentes no sistema
            const queryLabels = `
                SELECT DISTINCT sl.order_number, sl.plataforma, sl.zpl_content, sl.data_envio_limite
                FROM shipping_labels sl
                LEFT JOIN mercado_livre_orders mlo ON sl.order_number = mlo.numero_venda
                WHERE sl.order_number IS NOT NULL
                  AND sl.sem_etiqueta = FALSE 
                  AND (
                      mlo.status_bucket IS NULL 
                      OR 
                      mlo.status_bucket NOT IN ('cancelado', 'entregue')
                  )
            `;

            const { rows: labels } = await db.query(queryLabels);

            if (labels.length === 0) {
                console.log('[HubOrders] Nenhum pedido pendente.');
                await this.runMaintenanceTasks();
                return;
            }

            console.log(`[HubOrders] Processando ${labels.length} pedidos pendentes...`);
            let totalProcessados = 0;

            for (const label of labels) {
                if (stopSignal) break;

                const numeroPedido = label.order_number;
                const plataforma = label.plataforma || 'mercado_livre';
                const zplContent = label.zpl_content;
                let processadoNaCitel = false;

                // --- TENTATIVA 1: Citel (Oficial) ---
                try {
                    const pedidoApi = await CitelGateway.getPedidoPorNumero(numeroPedido);
                    if (pedidoApi) {
                        //console.log(`PEDIDO: ${numeroPedido}`);
                        await this.processSingleOrder(pedidoApi, plataforma, zplContent, label.data_envio_limite);
                        totalProcessados++;
                        processadoNaCitel = true;
                    }
                } catch (citelErr) {
                    console.warn(`[HubOrders] Erro Citel (${numeroPedido}): ${citelErr.message}.`);
                }

                // --- TENTATIVA 2: Fallback Hub ML ---
                if (!processadoNaCitel && plataforma === 'mercado_livre') {

                    try {
                        const cleanId = numeroPedido.replace('MLB_SHML', '').replace('MLB_PEDIDO', '');
                        let foundInHub = false;

                        for (const account of HUB_ACCOUNTS) {
                            const token = await getHubToken(account);
                            if (!token) continue;

                            try {
                                const hubResponse = await axios.get(`${HUB_API_URL}/envios/${cleanId}`, {
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });

                                if (hubResponse.data) {
                                    // ACHOU NO HUB!
                                    await this.processHubOrder(hubResponse.data, label);
                                    totalProcessados++;

                                    foundInHub = true;
                                    //console.log(`[HubFallback] Encontrado na conta ${account.email}, mas importação de itens DESATIVADA.`);
                                    break;
                                }
                            } catch (e) {
                                // Ignora erro na busca
                            }
                        }

                        if (!foundInHub) {
                            // console.warn(`[HubOrders] Não encontrado nem na Citel nem no Hub.`);
                        }

                    } catch (hubErr) {
                        console.error(`[HubOrders] Erro no check do Hub:`, hubErr.message);
                    }
                }
            }

            if (!stopSignal) {
                console.log(`[HubOrders] Ciclo finalizado. ${totalProcessados} atualizados via Citel.`);
                await this.runMaintenanceTasks();
            }

        } catch (error) {
            console.error('[HubOrders] Erro fatal:', error);
        } finally {
            isSyncing = false;
        }
    },

    /**
     * Processa um único objeto de pedido vindo da API e atualiza o banco.
     * @param {object} apiResponse Objeto raiz retornado pelo endpoint
     * @param {string} plataformaOrigem Identificador da plataforma (ex: amazon, shopee)
     */
    async processSingleOrder(apiResponse, plataformaOrigem = 'mercado_livre', zplContent = null, dataEnvioLimiteEtiqueta = null) {

        //console.log(`DATA LABEL: ${dataEnvioLimiteEtiqueta}`);
        // 1. Acessa o objeto "pedido" dentro do wrapper
        const p = apiResponse.pedido;
        if (!p) return;

        // 2. Identifica o ID da venda
        const numeroVenda = p.numeroPocket;
        if (!numeroVenda) {
            console.warn('[HubOrders] Pedido sem numeroPocket (numero_venda). Ignorando.');
            return;
        }

        const statusBucket = resolveStatusBucket(apiResponse);

        // Extração segura de sub-objetos
        const cliente = p.cliente || {};
        const enderecoObj = p.enderecoEntrega || {};
        const cidadeObj = enderecoObj.cidade || {};
        const itens = p.itens || [];

        // 3. Captura a Chave de Acesso
        let chaveAcesso = null;
        if (itens.length > 0 && itens[0].chaveAcesso) {
            chaveAcesso = itens[0].chaveAcesso;
        }

        // Busca de NFe e Código Empresa
        const codigoEmpresa = p.codigoEmpresa || null;
        let nfeNumero = null;

        if (chaveAcesso) {
            try {
                const xmlResponse = await CitelGateway.getXmlNfe(chaveAcesso);
                if (xmlResponse) {
                    const xmlString = typeof xmlResponse === 'string' ? xmlResponse : (xmlResponse.xml || '');
                    nfeNumero = extractNfeNumberFromXml(xmlString);
                }
            } catch (err) {
                // Silencioso
            }
        }

        // --- PREPARAÇÃO DOS ITENS ---
        const itemsMap = new Map();
        let unidadesTotal = 0;
        let nomesProdutos = [];

        for (const item of itens) {
            const produtoCodigo = item.codigoProduto ? parseInt(item.codigoProduto) : null;
            const descricao = item.descricaoProduto || 'Produto sem descrição';
            const quantidade = parseFloat(item.quantidade) || 0;
            const sku = String(produtoCodigo || 'SEM_SKU');

            unidadesTotal += quantidade;
            nomesProdutos.push(descricao);

            if (produtoCodigo) {
                const uniqueKey = `${produtoCodigo}`;
                if (itemsMap.has(uniqueKey)) {
                    const existingItem = itemsMap.get(uniqueKey);
                    existingItem.quantidade_total += quantidade;
                } else {
                    itemsMap.set(uniqueKey, {
                        produto_codigo: produtoCodigo,
                        sku: sku,
                        descricao_produto: descricao,
                        quantidade_total: quantidade,
                        quantidade_separada: 0,
                        status: 'pendente'
                    });
                }
            }
        }

        const orderItemsData = Array.from(itemsMap.values());

        // --- PREPARAÇÃO DO CABEÇALHO ---
        const orderData = {
            numero_venda: numeroVenda,
            data_venda: safeDate(p.dataHoraImportacao || p.dataEntrada),

            chave_acesso: chaveAcesso,
            nfe_numero: nfeNumero,
            codigo_empresa: codigoEmpresa,

            status_bucket: statusBucket,
            total: p.totalProdutos || p.valorTotal || 0,

            comprador: cliente.nome || p.nomeConsumidorOuCliente || 'Cliente Desconhecido',
            cpf: cliente.numeroDocumento,

            endereco_entrega: `${enderecoObj.endereco || ''}, ${enderecoObj.numero || ''} - ${enderecoObj.bairro || ''}`,
            cidade: cidadeObj.nomeCidade,
            estado_entrega: cidadeObj.siglaEstado,
            cep: enderecoObj.cep,
            pais: 'BR',

            data_envio_limite: dataEnvioLimiteEtiqueta ? new Date(dataEnvioLimiteEtiqueta) : safeDate(p.dataEnvioLimite),
            data_envio_disponivel: safeDate(p.dataEnvioDisponivel),
            data_previsao_entrega: safeDate(p.dataPrevisaoEntrega),
            data_coleta_agendada: safeDate(p.dataColetaAgendada),

            unidades: unidadesTotal,
            titulo_anuncio: nomesProdutos.slice(0, 3).join(' | ') + (nomesProdutos.length > 3 ? '...' : ''),
            pertence_kit: itens.length > 1,

            plataforma: plataformaOrigem,

            uploaded_at: new Date()
        };

        // --- PERSISTÊNCIA ---
        await MercadoLivreOrder.bulkUpsert([orderData]);

        if (plataformaOrigem === 'shopee') {
            await db.query(`UPDATE mercado_livre_orders 
                SET data_envio_limite = $1
                WHERE numero_venda = $2
                `, [new Date(dataEnvioLimiteEtiqueta), numeroVenda]);
        }

        const savedOrders = await MercadoLivreOrder.findByNumeroVendas([numeroVenda]);
        if (savedOrders.length > 0 && orderItemsData.length > 0) {
            const orderId = savedOrders[0].id;

            // --- TRAVA DE SEGURANÇA ---
            const temItensProcessados = await OrderItem.hasProcessedItems(orderId);

            if (!temItensProcessados) {
                // Totalmente seguro: Limpa os itens antigos
                await OrderItem.deleteByOrderId(orderId);
                const itemsWithId = orderItemsData.map(i => ({ ...i, order_id: orderId }));
                await OrderItem.bulkUpsert(itemsWithId);
            } else {
                //console.log(`[HubOrderService] ⚠️ Itens do pedido ${numeroVenda} (Citel) ignorados. O pedido já está em separação/expedição.`);
            }
        }

    },

    /**
     * Sincronização Independente de Status, Devoluções e Mediações
     * Varre os pedidos ativos no banco e consulta o Hub para preencher dados que a Citel não possui
     * e atualiza o status_bucket baseado na resposta da plataforma.
     */
    async syncReturnsAndMediations() {
        console.log('[HubOrderService] Verificando Status, Devoluções/Mediações para pedidos ativos...');

        const { rows: activeOrders } = await db.query(`
            SELECT numero_venda, status_bucket, dev_historico, medicao, frete_envio, data_venda
            FROM mercado_livre_orders 
            WHERE status_bucket NOT IN ('cancelado', 'entregue', 'devolucao_concluida', 'nao_entregue')
        `);

        if (activeOrders.length === 0) return;

        for (const order of activeOrders) {
            const cleanId = order.numero_venda.replace('MLB_SHML', '').replace('MLB_PEDIDO', '');

            // Procura esse pedido nas contas do Hub
            for (const account of HUB_ACCOUNTS) {
                const token = await getHubToken(account);
                if (!token) continue;

                try {
                    const hubResponse = await axios.get(`${HUB_API_URL}/envios/${cleanId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    const hubData = hubResponse.data;

                    if (hubData) {
                        // ESTADO ATUAL
                        let novoStatusBucket = order.status_bucket;
                        let novoDevHistorico = order.dev_historico;
                        let medicaoVal = order.medicao;
                        let frete_envio = String(order.frete_envio);
                        let date_created = new Date(order.data_venda);

                        //LÓGICA DE DATA
                        if ((hubData.data_criacao !== null || hubData.data_criacao !== '') && date_created !== new Date(hubData.data_criacao)) {
                            date_created = new Date(hubData.data_criacao);
                        }

                        //LÓGICA DE FRETE
                        if ((hubData.frete_envio !== null || hubData.frete_envio !== '') && frete_envio !== String(hubData.frete_envio)) {
                            frete_envio = String(hubData.frete_envio);
                        }

                        // LÓGICA DE MEDIAÇÃO
                        if (hubData.tem_med === true) {
                            if (hubData.status_med === 'opened') medicaoVal = 'aberta';
                            else if (hubData.status_med === 'closed') medicaoVal = 'fechada';
                        }

                        // LÓGICA DE DEVOLUÇÃO E GERENCIAMENTO DE STATUS
                        if (hubData.tem_dev === true) {
                            if (hubData.status_envio_dev === 'delivered') {
                                novoStatusBucket = 'devolucao_concluida';
                                if (!novoDevHistorico) {
                                    novoDevHistorico = 'nao_resolvido';
                                }
                            } else {
                                novoStatusBucket = 'devolucao_analise';
                            }
                        } else {
                            // Regra de Status (Sem Devolução)
                            if (hubData.status_envio === 'not_delivered' || hubData.status_pedido === 'not_delivered') {
                                novoStatusBucket = 'nao_entregue';
                            } else if (hubData.status_envio === 'cancelled') {
                                novoStatusBucket = 'cancelado';
                            } else if (hubData.status_envio === 'delivered') {
                                novoStatusBucket = 'entregue';
                            } else if (hubData.status_envio === 'shipped') {
                                novoStatusBucket = 'enviado';
                            }
                        }

                        // CHECAGEM DE ALTERAÇÃO
                        if (novoStatusBucket !== order.status_bucket || novoDevHistorico !== order.dev_historico || medicaoVal !== order.medicao || frete_envio !== String(order.frete_envio) || date_created.getTime() !== new Date(order.date_created).getTime()) {
                            await db.query(`
                                UPDATE mercado_livre_orders 
                                SET 
                                    medicao = $1,
                                    id_envio_dev = $2,
                                    status_dev_api = $3,
                                    status_envio_dev_api = $4,
                                    status_bucket = COALESCE($5, status_bucket),
                                    dev_historico = $6,
                                    frete_envio = $8,
                                    data_venda = COALESCE($9, data_venda),
                                    updated_at = NOW()
                                WHERE numero_venda = $7
                            `, [
                                medicaoVal,
                                hubData.id_envio_dev ? String(hubData.id_envio_dev) : null,
                                hubData.status_dev ? String(hubData.status_dev) : null,
                                hubData.status_envio_dev ? String(hubData.status_envio_dev) : null,
                                novoStatusBucket !== order.status_bucket ? novoStatusBucket : null,
                                novoDevHistorico,
                                String(order.numero_venda),
                                frete_envio,
                                date_created
                            ]);
                        }

                        break;
                    }
                } catch (e) {
                    if (!e.response) {
                        console.error(`[HubOrderService] ERRO FATAL NO BANCO para o pedido ${cleanId}:`, e.message);
                    }
                }
            }
        }
        console.log('[HubOrderService] Sincronização de Status, Devoluções e Mediações concluída.');
    },

    //Função de limpeza de pedidos que não tinham etiquetas e agora têm
    async syncNotLabels() {
        console.log('[HubOrderService] Verificando e limpando pedidos que passaram a ter etiquetas...');

        try {
            const deleteResult = await db.query(`
                DELETE FROM shipping_labels 
                WHERE sem_etiqueta = true
                AND data_envio_limite < NOW() - INTERVAL '1 month'
            `);
            if (deleteResult.rowCount > 0) console.log(`[HubOrderService] Limpeza: ${deleteResult.rowCount} registros antigos (mais de 1 mês) deletados.`);
        } catch (error) {
            console.error('[HubOrderService] Erro ao deletar registros antigos:', error.message);
        }

        // LIMPEZA POR DATA LIMITE NULA: Remove sem_etiqueta sem data de envio limite
        try {
            const deleteNulo = await db.query(`
                DELETE FROM shipping_labels
                WHERE sem_etiqueta = true
                AND data_envio_limite IS NULL
            `);
            if (deleteNulo.rowCount > 0) console.log(`[HubOrderService] Limpeza: ${deleteNulo.rowCount} sem etiqueta com data limite nula removidos.`);
        } catch (error) {
            console.error('[HubOrderService] Erro ao limpar sem_etiqueta com data nula:', error.message);
        }

        // LIMPEZA POR DATA LIMITE FUTURA: Remove sem_etiqueta cujo prazo de envio ainda está no futuro
        try {
            const deleteFuturo = await db.query(`
                DELETE FROM shipping_labels
                WHERE sem_etiqueta = true
                AND data_envio_limite::date > CURRENT_DATE
            `);
            if (deleteFuturo.rowCount > 0) console.log(`[HubOrderService] Limpeza: ${deleteFuturo.rowCount} sem etiqueta com prazo futuro removidos.`);
        } catch (error) {
            console.error('[HubOrderService] Erro ao limpar sem_etiqueta futuro:', error.message);
        }

        const { rows: noLabelOrders } = await db.query(`
            SELECT order_number
            FROM shipping_labels 
            WHERE sem_etiqueta = true
        `);

        if (noLabelOrders.length === 0) return;

        let limpezaEtiqueta = 0;
        let limpezaStatus = 0;

        for (const order of noLabelOrders) {
            // --- LIMPEZA 1: Pedidos sem etiqueta que já possuem etiqueta real ---
            if (!order.order_number.includes('MLB_PEDIDO')) {
                const cleanId = order.order_number.replace('MLB_SHML#', 'MLB_SHML');

                // PROTEÇÃO 1: Se o ID não tinha '#' e não mudou, pula para evitar que ele ache a si mesmo
                if (cleanId !== order.order_number) {
                    // PROTEÇÃO 2: Garante que está buscando a etiqueta REAL (sem_etiqueta deve ser falso ou nulo na real)
                    const { rows: rightOrder } = await db.query(`
                        SELECT order_number
                        FROM shipping_labels 
                        WHERE order_number = $1 AND (sem_etiqueta = false OR sem_etiqueta IS NULL)
                    `, [cleanId]);

                    if (rightOrder.length > 0) {
                        await db.query(`
                            DELETE FROM shipping_labels
                            WHERE order_number = $1
                        `, [order.order_number]);
                        limpezaEtiqueta++;
                        continue; // Já deletou, não precisa verificar status no Hub
                    }
                }
            }

            // --- LIMPEZA 2: Pedidos sem etiqueta cujo status no Hub é cancelado/enviado/entregue ---
            // Extrai o ID limpo para consulta no Hub
            const hubCleanId = order.order_number
                .replace('MLB_SHML#', '')
                .replace('MLB_SHML', '')
                .replace('MLB_PEDIDO#', '')
                .replace('MLB_PEDIDO', '');

            let deveDeletar = false;

            for (const account of HUB_ACCOUNTS) {
                const token = await getHubToken(account);
                if (!token) continue;

                try {
                    const hubResponse = await axios.get(`${HUB_API_URL}/envios/${hubCleanId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (hubResponse.data) {
                        const statusEnvio = hubResponse.data.status_envio;
                        const statusGeral = hubResponse.data.status_pedido_geral;

                        // Se o pedido foi cancelado, enviado ou entregue, não faz sentido manter como "sem etiqueta"
                        if (
                            statusEnvio === 'cancelled' ||
                            statusEnvio === 'shipped' ||
                            statusEnvio === 'delivered' ||
                            statusGeral === 'cancelled'
                        ) {
                            deveDeletar = true;
                        }
                        break; // Achou no Hub, não precisa tentar outras contas
                    }
                } catch (e) {
                    // Ignora erro na busca (404, timeout, etc)
                }
            }

            if (deveDeletar) {
                await db.query(`
                    DELETE FROM shipping_labels
                    WHERE order_number = $1
                `, [order.order_number]);
                limpezaStatus++;
            }
        }
        console.log(`[HubOrderService] Limpeza de sem etiquetas concluída. ${limpezaEtiqueta} removidos (já tinham etiqueta), ${limpezaStatus} removidos (cancelado/enviado/entregue).`);
    },

    /**
     * Rotinas auxiliares de manutenção do banco.
     * Executadas ao final de cada ciclo para garantir sanidade dos dados.
     */
    async runMaintenanceTasks() {
        // 1. Marcar como ENTREGUE pedidos antigos (baseado na data prevista < hoje)
        // Isso limpa o dashboard de pedidos muito antigos que não foram baixados manualmente
        const queryEntregues = `
            UPDATE mercado_livre_orders
            SET status_bucket = 'entregue', updated_at = NOW()
            WHERE status_bucket NOT IN ('entregue', 'enviado', 'cancelado')
              AND data_previsao_entrega IS NOT NULL 
              AND data_previsao_entrega < CURRENT_DATE
        `;

        // 2. Liberar Agendados (caso use a funcionalidade de agendamento futuro)
        const queryLiberar = `
            UPDATE mercado_livre_orders
            SET status_bucket = 'pendente', updated_at = NOW()
            WHERE status_bucket = 'agendado'
              AND (
                (data_coleta_agendada IS NOT NULL AND data_coleta_agendada <= CURRENT_DATE + INTERVAL '1 day')
                OR
                (data_coleta_agendada IS NULL AND data_envio_disponivel IS NOT NULL AND data_envio_disponivel <= CURRENT_DATE)
              )
        `;

        try {
            //const resEntregues = await db.query(queryEntregues);
            //if (resEntregues.rowCount > 0) console.log(`[HubOrders] ${resEntregues.rowCount} pedidos antigos marcados como ENTREGUE.`);

            const resLiberados = await db.query(queryLiberar);
            if (resLiberados.rowCount > 0) console.log(`[HubOrders] ${resLiberados.rowCount} pedidos AGENDADOS liberados.`);

            await this.syncReturnsAndMediations();
            await this.syncNotLabels();
            await syncDates();
            await syncPackid();

        } catch (error) {
            console.error('[HubOrders] Erro nas tarefas de manutenção:', error.message);
        }
    }
};

module.exports = HubOrderService;