// services/HubPedidosService.js
// Serviço que consome a API do Hub para ingerir pedidos na expedição (cached_etiquetas_ml, skus_pedido)
// Padrão de acesso: HTTP via API do Hub (igual ao HubOrderService.js), NÃO acesso direto ao banco.
const { Pool } = require('pg');
const axios = require('axios');
const { findAndCacheNfeByNumber, findAndCachePedidoByLojaNumber } = require('../blingSyncService');

// Pool do banco de Monitoramento (onde ficam cached_etiquetas_ml, cached_nfe, cached_pedido_venda, skus_pedido)
const poolMon = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// --- CONFIGURAÇÃO DO HUB (API HTTP) ---
const HUB_API_URL = process.env.HUB_API_URL;
const HUB_ACCOUNTS = [
    { email: process.env.HUB_CLIENTE_EMAIL_1, pass: process.env.HUB_CLIENTE_SENHA_1 },
    { email: process.env.HUB_CLIENTE_EMAIL_2, pass: process.env.HUB_CLIENTE_SENHA_2 }
].filter(acc => acc.email && acc.pass);

// Cache de tokens (mesmo padrão do HubOrderService)
const hubTokenCache = {};

/**
 * Autentica no Hub via API e cacheia o token por 24h.
 */
async function getHubToken(account) {
    const now = Date.now();
    const cached = hubTokenCache[account.email];

    // Se tem token válido (com margem de 5min), usa ele
    if (cached && cached.token && cached.expiresAt > now + 300000) {
        return cached.token;
    }

    try {
        const response = await axios.post(`${HUB_API_URL}/hub/api/login`, {
            email: account.email,
            password: account.pass
        });

        if (response.data && response.data.token) {
            hubTokenCache[account.email] = {
                token: response.data.token,
                expiresAt: now + (24 * 60 * 60 * 1000)
            };
            return response.data.token;
        }
    } catch (error) {
        console.error(`[HubPedidos] Falha ao logar no Hub com ${account.email}:`, error.message);
    }
    return null;
}

/**
 * Função principal de sincronização.
 * Busca pedidos via API do Hub e sincroniza com cached_etiquetas_ml para a expedição.
 */
async function sincronizar() {
    console.log('[HubPedidos] Iniciando sincronização Hub → Expedição...');

    if (HUB_ACCOUNTS.length === 0) {
        console.warn('[HubPedidos] Nenhuma conta do Hub configurada no .env. Abortando.');
        return;
    }

    let clientMon;

    try {
        clientMon = await poolMon.connect();

        let totalInseridos = 0;
        let totalAtualizados = 0;
        let totalCancelados = 0;
        let totalPromovidos = 0;
        let totalBlingEnriquecidos = 0;

        for (const account of HUB_ACCOUNTS) {
            try {
                const token = await getHubToken(account);
                if (!token) {
                    console.warn(`[HubPedidos] Token não obtido para ${account.email}. Pulando conta.`);
                    continue;
                }

                console.log(`[HubPedidos] Buscando pedidos na conta: ${account.email}`);

                let offset = 0;
                const limit = 1000;
                let continuarBuscando = true;
                let paginasProcessadas = 0;

                while (continuarBuscando) {
                    try {
                        const response = await axios.get(`${HUB_API_URL}/hub/api/pedidos`, {
                            params: { limit, offset },
                            headers: { 'Authorization': `Bearer ${token}` }
                        });

                        const pacotes = response.data.dados || [];

                        if (pacotes.length === 0) {
                            continuarBuscando = false;
                            break;
                        }

                        for (const pacote of pacotes) {
                            try {
                                const resultado = await processarPacote(clientMon, pacote);
                                if (resultado === 'inserido') totalInseridos++;
                                else if (resultado === 'cancelado') totalCancelados++;
                                else if (resultado === 'promovido') totalPromovidos++;
                                else if (resultado === 'bling') totalBlingEnriquecidos++;
                                else if (resultado === 'atualizado') totalAtualizados++;
                            } catch (pacoteError) {
                                console.error(`[HubPedidos] Erro ao processar pacote (envio ${pacote.id_envio_ml}):`, pacoteError.message);
                            }
                        }

                        offset += limit;
                        paginasProcessadas++;
                        console.log(`[HubPedidos] Conta ${account.email}: Pág ${paginasProcessadas} processada (${pacotes.length} pacotes).`);

                        if (pacotes.length < limit) continuarBuscando = false;

                    } catch (reqError) {
                        console.error(`[HubPedidos] Erro na requisição (offset ${offset}):`, reqError.message);
                        continuarBuscando = false;
                    }
                }
            } catch (accountError) {
                console.error(`[HubPedidos] Erro na conta ${account.email}:`, accountError.message);
            }
        }

        console.log(`[HubPedidos] Sincronização concluída. Inseridos: ${totalInseridos}, Atualizados: ${totalAtualizados}, Cancelados: ${totalCancelados}, Promovidos: ${totalPromovidos}, Bling enriquecidos: ${totalBlingEnriquecidos}`);

    } catch (error) {
        console.error('[HubPedidos] Erro crítico na sincronização:', error);
    } finally {
        if (clientMon) clientMon.release();
    }
}

/**
 * Processa um pacote individual retornado pela API do Hub.
 * Um pacote pode conter múltiplos pedidos (agrupados por id_envio_ml).
 * 
 * DEDUPLICAÇÃO HIERÁRQUICA (evita clones entre Hub e upload manual):
 * 1. nfe_numero  — prioridade máxima (se ambos têm NF, é o mesmo pedido)
 * 2. numero_loja — o ids_pedidos_originais[0] do Hub É o numero_loja do manual
 * 3. pack_id     — fallback se numero_loja não bater
 */
async function processarPacote(clientMon, pacote) {
    // Ignorar pacotes sem etiqueta ZPL
    if (!pacote.etiqueta_zpl) return null;

    // Ignorar pacotes cancelados/entregues/enviados
    if (pacote.status_envio === 'cancelled' || pacote.status_envio === 'delivered' || pacote.status_envio === 'shipped' ||
        pacote.status_pedido_geral === 'cancelled') {
        if (pacote.status_envio === 'cancelled' || pacote.status_pedido_geral === 'cancelled') {
            return await marcarCanceladoSeExiste(clientMon, pacote);
        }
        if (pacote.status_envio === 'shipped' || pacote.status_pedido_geral === 'shipped' || pacote.status_envio === 'delivered') {
            return await marcarEnviadoSeExiste(clientMon, pacote);
        }
        return null;
    }

    // O id_pedido_ml do Hub é, na prática, o numero_loja do sistema manual
    const numeroLoja = pacote.ids_pedidos_originais?.[0] ? String(pacote.ids_pedidos_originais[0]) : null;
    const idEnvio = pacote.id_envio_ml ? String(pacote.id_envio_ml) : null;

    if (!numeroLoja && !idEnvio) return null;

    // Dados de NF vindos do Hub
    const nfeNumeroPacote = pacote.nfe_numero || null;
    const chaveAcessoPacote = pacote.chave_acesso || null;

    // =============================================================
    // DEDUPLICAÇÃO HIERÁRQUICA
    // Busca 1: pelo nfe_numero (prioridade máxima)
    // Busca 2: pelo numero_loja (id_pedido_ml do Hub = numero_loja do manual)
    // Busca 3: pelo pack_id (fallback)
    // =============================================================
    let registroExistente = null;

    // Busca 1: pelo nfe_numero (definitivo quando ambos têm NF)
    if (nfeNumeroPacote) {
        const res1 = await clientMon.query(
            'SELECT id, status, nfe_numero, chave_acesso, numero_loja, pack_id FROM cached_etiquetas_ml WHERE nfe_numero = $1 LIMIT 1',
            [nfeNumeroPacote]
        );
        registroExistente = res1.rows[0] || null;
    }

    // Busca 2: pelo numero_loja (Hub's id_pedido_ml = manual's numero_loja)
    if (!registroExistente && numeroLoja) {
        const res2 = await clientMon.query(
            'SELECT id, status, nfe_numero, chave_acesso, numero_loja, pack_id FROM cached_etiquetas_ml WHERE numero_loja = $1 LIMIT 1',
            [numeroLoja]
        );
        registroExistente = res2.rows[0] || null;
    }

    // Busca 3: pelo pack_id (fallback se numero_loja não bateu)
    if (!registroExistente && numeroLoja) {
        const res3 = await clientMon.query(
            'SELECT id, status, nfe_numero, chave_acesso, numero_loja, pack_id FROM cached_etiquetas_ml WHERE pack_id = $1 LIMIT 1',
            [numeroLoja]
        );
        registroExistente = res3.rows[0] || null;
    }

    if (!registroExistente) {
        // ===========================
        // INSERIR NOVO REGISTRO
        // ===========================
        await inserirNovoPedido(clientMon, pacote, numeroLoja);
        return 'inserido';

    } else {
        // ===========================
        // REGISTRO EXISTENTE — ENRIQUECER E MONITORAR
        // ===========================

        // Não mexer em pedidos já expedidos ou cancelados
        if (registroExistente.status === 'impresso' || registroExistente.status === 'cancelado') return null;

        // Preencher campos que o upload manual pode não ter tido
        const updateFields = [];
        const updateValues = [];
        let paramIdx = 1;

        // Preencher numero_loja se estava vazio
        if (numeroLoja && !registroExistente.numero_loja) {
            updateFields.push(`numero_loja = $${paramIdx++}`);
            updateValues.push(numeroLoja);
        }

        // Preencher pack_id se estava vazio
        if (numeroLoja && !registroExistente.pack_id) {
            updateFields.push(`pack_id = $${paramIdx++}`);
            updateValues.push(numeroLoja);
        }

        // Preencher id_envio_ml
        if (idEnvio) {
            updateFields.push(`id_envio_ml = COALESCE(id_envio_ml, $${paramIdx++})`);
            updateValues.push(idEnvio);
        }

        // Preencher etiqueta_zpl se não tinha
        if (pacote.etiqueta_zpl) {
            updateFields.push(`etiqueta_zpl = COALESCE(etiqueta_zpl, $${paramIdx++})`);
            updateValues.push(pacote.etiqueta_zpl);
        }

        // Preencher origem
        updateFields.push(`origem = COALESCE(origem, 'hub')`);

        // Se o Hub agora tem NF mas o registro ainda não tem
        if (nfeNumeroPacote && !registroExistente.nfe_numero) {
            updateFields.push(`nfe_numero = $${paramIdx++}`);
            updateValues.push(nfeNumeroPacote);
            updateFields.push(`chave_acesso = $${paramIdx++}`);
            updateValues.push(chaveAcessoPacote);
            console.log(`[HubPedidos] NF atualizada para pedido ${numeroLoja}: NF ${nfeNumeroPacote}`);
        }

        // Sempre atualizar last_processed_at
        updateFields.push(`last_processed_at = timestamp_virtual_expedicao()`);

        if (updateFields.length > 0) {
            updateValues.push(registroExistente.id);
            await clientMon.query(
                `UPDATE cached_etiquetas_ml SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`,
                updateValues
            );
        }

        // Determinar NF efetiva
        const nfeAtual = nfeNumeroPacote || registroExistente.nfe_numero;

        // Se o Hub trouxe itens, atualizamos os SKUs usando o formato JSON seguro
        if (pacote.itens && pacote.itens.length > 0) {
            const skusOriginaisJSON = JSON.stringify(pacote.itens.map(i => ({ original: i.sku })));
            updateFields.push(`skus = $${paramIdx++}`);
            updateValues.push(skusOriginaisJSON);
            const qtdTotal = pacote.itens.reduce((sum, i) => sum + (i.quantidade || 1), 0);
            updateFields.push(`quantidade_total = $${paramIdx++}`);
            updateValues.push(qtdTotal);
        }

        // Se tem NF e está como 'sem_nota', promover para 'pendente'
        if (nfeAtual && registroExistente.status === 'sem_nota') {
            await clientMon.query(
                `UPDATE cached_etiquetas_ml SET status = 'pendente', last_processed_at = timestamp_virtual_expedicao() WHERE id = $1`,
                [registroExistente.id]
            );
            console.log(`[HubPedidos] Pedido ${numeroLoja} promovido: sem_nota → pendente (NF ${nfeAtual})`);
            return 'promovido';
        }

        return 'atualizado';
    }
}

/**
 * Verifica se um pacote cancelado já existe na expedição e marca como cancelado.
 * Busca pela mesma hierarquia: nfe_numero > numero_loja > pack_id.
 */
async function marcarCanceladoSeExiste(clientMon, pacote) {
    const numeroLoja = pacote.ids_pedidos_originais?.[0] ? String(pacote.ids_pedidos_originais[0]) : null;
    const nfeNumero = pacote.nfe_numero || null;
    if (!numeroLoja && !nfeNumero) return null;

    let res = { rows: [] };

    // Busca hierárquica
    if (nfeNumero) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE nfe_numero = $1 LIMIT 1', [nfeNumero]);
    }
    if (res.rows.length === 0 && numeroLoja) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE numero_loja = $1 LIMIT 1', [numeroLoja]);
    }
    if (res.rows.length === 0 && numeroLoja) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE pack_id = $1 LIMIT 1', [numeroLoja]);
    }

    if (res.rows.length > 0 && res.rows[0].status !== 'cancelado') {
        await clientMon.query(
            `UPDATE cached_etiquetas_ml SET status = 'cancelado', last_processed_at = timestamp_virtual_expedicao() WHERE id = $1`,
            [res.rows[0].id]
        );
        console.log(`[HubPedidos] Pedido ${numeroLoja || nfeNumero} cancelado.`);
        return 'cancelado';
    }
    return null;
}


async function marcarEnviadoSeExiste(clientMon, pacote) {
    const numeroLoja = pacote.ids_pedidos_originais?.[0] ? String(pacote.ids_pedidos_originais[0]) : null;
    const nfeNumero = pacote.nfe_numero || null;
    if (!numeroLoja && !nfeNumero) return null;

    let res = { rows: [] };

    // Busca hierárquica
    if (nfeNumero) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE nfe_numero = $1 LIMIT 1', [nfeNumero]);
    }
    if (res.rows.length === 0 && numeroLoja) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE numero_loja = $1 LIMIT 1', [numeroLoja]);
    }
    if (res.rows.length === 0 && numeroLoja) {
        res = await clientMon.query('SELECT id, status FROM cached_etiquetas_ml WHERE pack_id = $1 LIMIT 1', [numeroLoja]);
    }

    if (res.rows.length > 0 && res.rows[0].status !== 'impresso') {
        await clientMon.query(
            `UPDATE cached_etiquetas_ml SET status = 'impresso', last_processed_at = timestamp_virtual_expedicao() WHERE id = $1`,
            [res.rows[0].id]
        );
        console.log(`[HubPedidos] Pedido ${numeroLoja || nfeNumero} impresso.`);
        return 'impresso';
    }
    return null;
}

/**
 * Insere um novo pedido do Hub na cached_etiquetas_ml e na skus_pedido.
 * Usa numero_loja e pack_id (que são o id_pedido_ml do Hub).
 */
async function inserirNovoPedido(clientMon, pacote, numeroLoja) {
    const nfeNumero = pacote.nfe_numero || null;
    const chaveAcesso = pacote.chave_acesso || null;
    const statusInicial = 'hub';

    // Limpar etiqueta ZPL de null bytes
    const etiquetaLimpa = pacote.etiqueta_zpl
        ? pacote.etiqueta_zpl.replace(/\u0000/g, '')
        : null;

    // Extrair SKUs do array de itens e salvar como JSON seguro
    const itens = pacote.itens || [];
    const skusOriginais = JSON.stringify(itens.map(i => ({ original: i.sku })));
    const quantidadeTotal = itens.reduce((sum, i) => sum + (i.quantidade || 1), 0);

    // INSERT na cached_etiquetas_ml
    // numero_loja e pack_id recebem o mesmo valor (ids_pedidos_originais[0])
    const insertQuery = `
        INSERT INTO cached_etiquetas_ml (
            nfe_numero, chave_acesso, skus, quantidade_total,
            etiqueta_zpl, numero_loja, pack_id, id_envio_ml, origem,
            status, situacao, created_at, last_processed_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, 'hub',
            $9, 'pendente', timestamp_virtual_expedicao(), timestamp_virtual_expedicao()
        )
    `;

    await clientMon.query(insertQuery, [
        nfeNumero,
        chaveAcesso,
        skusOriginais,
        quantidadeTotal,
        etiquetaLimpa,
        numeroLoja,
        numeroLoja,
        pacote.id_envio_ml ? String(pacote.id_envio_ml) : null,
        statusInicial
    ]);

    // INSERT na skus_pedido (relação NF → SKU)
    if (nfeNumero && itens.length > 0) {
        for (const item of itens) {
            if (!item.sku) continue;
            try {
                await clientMon.query(`
                    INSERT INTO skus_pedido (nfe_numero, sku, quantidade)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (nfe_numero, sku) DO UPDATE SET quantidade = EXCLUDED.quantidade
                `, [nfeNumero, item.sku, item.quantidade || 1]);
            } catch (skuError) {
                console.warn(`[HubPedidos] Erro ao inserir SKU ${item.sku} para NF ${nfeNumero}:`, skuError.message);
            }
        }
    }

    // Hub já traz NF, chave de acesso e SKUs, então não há necessidade de forçar chamada ao Bling aqui.

    console.log(`[HubPedidos] Novo pedido inserido: ${numeroLoja} | Envio: ${pacote.id_envio_ml || 'N/A'} | NF: ${nfeNumero || 'sem_nota'} | Status: ${statusInicial} | SKUs: ${skusOriginais || 'N/A'}`);
}

/**
 * Verifica se a NF já existe em cached_nfe e cached_pedido_venda.
 * Se não existir, aciona o BlingSyncService para puxar do Bling.
 */
async function enriquecerViaBling(clientMon, nfeNumero) {
    if (!nfeNumero) return false;

    let enriqueceu = false;

    try {
        // 1. Verificar se a NF existe na cached_nfe
        const nfeCheck = await clientMon.query(
            'SELECT 1 FROM cached_nfe WHERE nfe_numero = $1 LIMIT 1',
            [nfeNumero]
        );

        if (nfeCheck.rows.length === 0) {
            console.log(`[HubPedidos Bling] NF ${nfeNumero} não encontrada em cached_nfe. Buscando no Bling...`);
            try {
                await findAndCacheNfeByNumber(nfeNumero, 'lucas');
                enriqueceu = true;
                console.log(`[HubPedidos Bling] NF ${nfeNumero} enriquecida via Bling com sucesso.`);
            } catch (blingError) {
                console.warn(`[HubPedidos Bling] Falha ao buscar NF ${nfeNumero} no Bling:`, blingError.message);
            }
        }

        // 2. Verificar se o pedido de venda existe na cached_pedido_venda
        const pedidoCheck = await clientMon.query(
            'SELECT 1 FROM cached_pedido_venda WHERE nfe_parent_numero = $1 LIMIT 1',
            [nfeNumero]
        );

        if (pedidoCheck.rows.length === 0) {
            // O processSingleNfe do blingSyncService já insere o pedido associado quando busca a NF,
            // então se chegou aqui sem pedido, é porque o pedido de venda pode ter outro numero_loja.
            console.log(`[HubPedidos Bling] Pedido de venda para NF ${nfeNumero} não encontrado em cached_pedido_venda.`);
        }
    } catch (error) {
        console.error(`[HubPedidos Bling] Erro ao enriquecer NF ${nfeNumero}:`, error.message);
    }

    return enriqueceu;
}

module.exports = {
    sincronizar
};
