require('dotenv').config();
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const axios = require('axios');
const { PDFDocument } = require('pdf-lib');
const pedidosMlSyncService = require('../services/pedidosMlSyncService');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

/**
 * Renderiza a página principal de listagem e controle de pedidos ML.
 */
exports.renderPedidosPage = async (req, res) => {
    try {
        res.render('pedidos/lista-pedidos', {
            title: 'Controle de Pedidos Mercado Livre',
            layout: 'main',
            user: req.user
        });
    } catch (error) {
        console.error('[PedidosML] Erro ao renderizar a página de pedidos:', error);
        req.flash('error_msg', 'Não foi possível carregar a página de pedidos do Mercado Livre.');
        res.redirect('/');
    }
};

/**
 * Helper para construir filtros de data baseando-se no período selecionado
 */
function buildDateFilter(periodo, dataInicio, dataFim) {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    switch (periodo) {
        case 'hoje':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
            break;
        case 'ontem':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
            endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
            break;
        case '7dias':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
            break;
        case '15dias':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15, 0, 0, 0);
            break;
        case '30dias':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
            break;
        case 'mes_atual':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
            break;
        case 'personalizado':
            if (dataInicio) {
                const pStart = new Date(dataInicio);
                if (!isNaN(pStart.getTime())) startDate = pStart;
            }
            if (dataFim) {
                const pEnd = new Date(dataFim);
                if (!isNaN(pEnd.getTime())) {
                    pEnd.setHours(23, 59, 59, 999);
                    endDate = pEnd;
                }
            }
            break;
        case 'todos':
            startDate = null;
            endDate = null;
            break;
        default:
            // Padrão: últimos 30 dias se nada for especificado
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);
            break;
    }

    return { startDate, endDate };
}

/**
 * API para buscar os pedidos com paginação, filtros avançados, buscas e cálculo de KPIs
 */
exports.getPedidosApi = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            all = false,
            search = '',
            busca = '',
            campo_busca = 'geral',
            searchField = '',
            periodo = '30dias',
            data_inicio = '',
            data_fim = '',
            empresa = '',
            situacao_prazo = '',
            situacao_operacional = '',
            status_impressao = '',
            tipo_envio = '',
            status_pedido = '',
            status_envio = '',
            tem_nfe = '',
            tem_etiqueta = '',
            tem_pos_venda = '',
            pos_venda = '',
            orderBy = 'data_pedido',
            orderDir = 'DESC'
        } = req.query;

        const fetchAll = all === 'true' || all === true;
        const limitNum = Math.max(1, Math.min(10000, parseInt(limit, 10) || 50));
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const offset = (pageNum - 1) * limitNum;

        const whereClauses = [];
        const queryParams = [];
        let pIndex = 1;

        // 1. Filtro de Período
        const { startDate, endDate } = buildDateFilter(periodo, data_inicio, data_fim);
        if (startDate) {
            whereClauses.push(`data_pedido >= $${pIndex++}`);
            queryParams.push(startDate.toISOString());
        }
        if (endDate) {
            whereClauses.push(`data_pedido <= $${pIndex++}`);
            queryParams.push(endDate.toISOString());
        }

        // 2. Busca Rápida
        if (search) {
            const searchTerm = `%${search.trim()}%`;
            if (campo_busca && campo_busca !== 'geral') {
                switch (campo_busca) {
                    case 'id_pedido_ml':
                        whereClauses.push(`id_pedido_ml ILIKE $${pIndex++}`);
                        queryParams.push(searchTerm);
                        break;
                    case 'id_envio_ml':
                        whereClauses.push(`id_envio_ml ILIKE $${pIndex++}`);
                        queryParams.push(searchTerm);
                        break;
                    case 'sku':
                        whereClauses.push(`(sku_principal ILIKE $${pIndex} OR skus_resumo ILIKE $${pIndex})`);
                        pIndex++;
                        queryParams.push(searchTerm);
                        break;
                    case 'comprador':
                        whereClauses.push(`(comprador_nickname ILIKE $${pIndex} OR comprador_nome ILIKE $${pIndex})`);
                        pIndex++;
                        queryParams.push(searchTerm);
                        break;
                    case 'nfe':
                        whereClauses.push(`nfe_numero ILIKE $${pIndex++}`);
                        queryParams.push(searchTerm);
                        break;
                    default:
                        whereClauses.push(`(id_pedido_ml ILIKE $${pIndex} OR comprador_nickname ILIKE $${pIndex} OR sku_principal ILIKE $${pIndex})`);
                        pIndex++;
                        queryParams.push(searchTerm);
                        break;
                }
            } else {
                whereClauses.push(`(
                    id_pedido_ml ILIKE $${pIndex} OR 
                    id_envio_ml ILIKE $${pIndex} OR 
                    comprador_nickname ILIKE $${pIndex} OR 
                    comprador_nome ILIKE $${pIndex} OR 
                    sku_principal ILIKE $${pIndex} OR 
                    skus_resumo ILIKE $${pIndex} OR 
                    nfe_numero ILIKE $${pIndex}
                )`);
                pIndex++;
                queryParams.push(searchTerm);
            }
        }

        // 3. Filtros Específicos
        if (empresa) {
            if (empresa.includes(',')) {
                const emps = empresa.split(',').map(e => e.trim()).filter(Boolean);
                whereClauses.push(`empresa = ANY($${pIndex++}::text[])`);
                queryParams.push(emps);
            } else {
                whereClauses.push(`empresa ILIKE $${pIndex++}`);
                queryParams.push(empresa);
            }
        }

        if (situacao_prazo && situacao_prazo !== 'todos' && situacao_prazo !== '') {
            whereClauses.push(`situacao_prazo = $${pIndex++}`);
            queryParams.push(situacao_prazo);
        }

        if (situacao_operacional && situacao_operacional !== 'todas' && situacao_operacional !== '') {
            whereClauses.push(`situacao_operacional = $${pIndex++}`);
            queryParams.push(situacao_operacional);
        }

        if (status_impressao && status_impressao !== 'todos' && status_impressao !== '') {
            whereClauses.push(`status_impressao = $${pIndex++}`);
            queryParams.push(status_impressao);
        }

        if (tipo_envio && tipo_envio !== 'todos' && tipo_envio !== '') {
            whereClauses.push(`tipo_envio = $${pIndex++}`);
            queryParams.push(tipo_envio);
        }

        if (status_pedido && status_pedido !== 'todos' && status_pedido !== '') {
            whereClauses.push(`status_pedido = $${pIndex++}`);
            queryParams.push(status_pedido);
        }

        if (status_envio && status_envio !== 'todos' && status_envio !== '') {
            whereClauses.push(`status_envio = $${pIndex++}`);
            queryParams.push(status_envio);
        }

        if (tem_nfe === 'com_nf') {
            whereClauses.push(`tem_nfe = TRUE`);
        } else if (tem_nfe === 'sem_nf') {
            whereClauses.push(`tem_nfe = FALSE`);
        }

        if (tem_etiqueta === 'com_etiqueta') {
            whereClauses.push(`tem_etiqueta = TRUE`);
        } else if (tem_etiqueta === 'sem_etiqueta') {
            whereClauses.push(`tem_etiqueta = FALSE`);
        }

        if (tem_pos_venda === 'sim' || pos_venda === 'true') {
            whereClauses.push(`(tem_dev = TRUE OR tem_med = TRUE)`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Validação da coluna de ordenação
        const validOrderCols = {
            'id_pedido_ml': 'id_pedido_ml',
            'id_envio_ml': 'id_envio_ml',
            'data_pedido': 'data_pedido',
            'empresa': 'empresa',
            'situacao_prazo': 'situacao_prazo',
            'situacao_operacional': 'situacao_operacional',
            'status_impressao': 'status_impressao',
            'status_pedido': 'status_pedido',
            'status_envio': 'status_envio',
            'tipo_envio': 'tipo_envio',
            'comprador_nickname': 'comprador_nickname',
            'skus_resumo': 'skus_resumo',
            'quantidade_total_itens': 'quantidade_total_itens',
            'valor_total': 'valor_total',
            'frete_envio': 'frete_envio',
            'nfe_numero': 'nfe_numero',
            'data_limite_envio': 'data_limite_envio',
            'data_envio_agendado': 'data_envio_agendado',
            'data_previsao_entrega': 'data_previsao_entrega'
        };

        const safeOrderBy = validOrderCols[orderBy] || 'data_pedido';
        const safeOrderDir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // 4. Executa contagem total e consulta
        const countQuery = `SELECT COUNT(*)::int AS total FROM pedidos_ml ${whereSql};`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalItems = countResult.rows[0]?.total || 0;

        let listResult;
        if (fetchAll) {
            const mainQuery = `
                SELECT 
                    id, id_pedido_ml, pack_id, id_envio_ml, conta_id, empresa,
                    date_created, data_pedido, status_pedido, status_envio, tipo_envio,
                    data_limite_envio, data_envio_disponivel, data_envio_agendado, data_previsao_entrega,
                    comprador_nickname, comprador_nome,
                    valor_total, frete_envio, nfe_numero, chave_acesso,
                    tem_nfe, tem_etiqueta, etiqueta_status,
                    itens_json, sku_principal, skus_resumo, quantidade_total_itens,
                    tem_dev, status_dev, id_envio_dev, status_envio_dev,
                    tem_med, status_med, situacao_prazo, situacao_operacional,
                    substatus_envio, manufacturing_ending_date,
                    status_impressao, justificativa_erro,
                    last_synced_at
                FROM pedidos_ml
                ${whereSql}
                ORDER BY ${safeOrderBy} ${safeOrderDir} NULLS LAST;
            `;
            listResult = await pool.query(mainQuery, queryParams);
        } else {
            const mainQuery = `
                SELECT 
                    id, id_pedido_ml, pack_id, id_envio_ml, conta_id, empresa,
                    date_created, data_pedido, status_pedido, status_envio, tipo_envio,
                    data_limite_envio, data_envio_disponivel, data_envio_agendado, data_previsao_entrega,
                    comprador_nickname, comprador_nome,
                    valor_total, frete_envio, nfe_numero, chave_acesso,
                    tem_nfe, tem_etiqueta, etiqueta_status,
                    itens_json, sku_principal, skus_resumo, quantidade_total_itens,
                    tem_dev, status_dev, id_envio_dev, status_envio_dev,
                    tem_med, status_med, situacao_prazo, situacao_operacional,
                    substatus_envio, manufacturing_ending_date,
                    status_impressao, justificativa_erro,
                    last_synced_at
                FROM pedidos_ml
                ${whereSql}
                ORDER BY ${safeOrderBy} ${safeOrderDir} NULLS LAST
                LIMIT $${pIndex++} OFFSET $${pIndex++};
            `;
            const listParams = [...queryParams, limitNum, offset];
            listResult = await pool.query(mainQuery, listParams);
        }

        // 5. KPIs Agregados para a barra de resumo de topo
        const kpiWhereClauses = [];
        const kpiParams = [];
        let kpiIndex = 1;

        if (startDate) {
            kpiWhereClauses.push(`data_pedido >= $${kpiIndex++}`);
            kpiParams.push(startDate.toISOString());
        }
        if (endDate) {
            kpiWhereClauses.push(`data_pedido <= $${kpiIndex++}`);
            kpiParams.push(endDate.toISOString());
        }
        if (empresa && empresa !== 'todas' && empresa !== '') {
            if (empresa.includes(',')) {
                const emps = empresa.split(',').map(e => e.trim()).filter(Boolean);
                kpiWhereClauses.push(`empresa = ANY($${kpiIndex++}::text[])`);
                kpiParams.push(emps);
            } else {
                kpiWhereClauses.push(`empresa ILIKE $${kpiIndex++}`);
                kpiParams.push(empresa);
            }
        }

        const kpiWhereSql = kpiWhereClauses.length > 0 ? `WHERE ${kpiWhereClauses.join(' AND ')}` : '';

        const kpiQuery = `
            SELECT 
                COUNT(*)::int AS total_pedidos,
                COUNT(*) FILTER (WHERE situacao_prazo = 'atrasado')::int AS atrasados,
                COUNT(*) FILTER (WHERE situacao_prazo = 'para_hoje')::int AS para_hoje,
                COUNT(*) FILTER (WHERE situacao_prazo = 'futuro_agendado')::int AS futuros,
                COUNT(*) FILTER (WHERE situacao_operacional = 'aguardando_disponibilidade')::int AS aguardando_disponibilidade,
                COUNT(*) FILTER (WHERE situacao_operacional = 'nf_a_gerenciar')::int AS sem_nf,
                COUNT(*) FILTER (WHERE situacao_operacional = 'com_nota_sem_etiqueta')::int AS com_nota_sem_etiqueta,
                COUNT(*) FILTER (WHERE situacao_operacional = 'etiquetas_para_imprimir')::int AS pronto_imprimir,
                COUNT(*) FILTER (WHERE situacao_operacional = 'a_caminho')::int AS em_transito,
                COUNT(*) FILTER (WHERE tem_dev = TRUE OR tem_med = TRUE)::int AS pos_venda,
                COALESCE(SUM(valor_total), 0)::numeric AS valor_total
            FROM pedidos_ml
            ${kpiWhereSql};
        `;
        const kpiResult = await pool.query(kpiQuery, kpiParams);
        const kpis = kpiResult.rows[0] || {
            total_pedidos: 0,
            atrasados: 0,
            para_hoje: 0,
            futuros: 0,
            aguardando_disponibilidade: 0,
            sem_nf: 0,
            com_nota_sem_etiqueta: 0,
            pronto_imprimir: 0,
            em_transito: 0,
            pos_venda: 0,
            valor_total: 0
        };

        // 6. Lista de Empresas / Lojas disponíveis para o select
        const empresasResult = await pool.query(`
            SELECT DISTINCT empresa 
            FROM pedidos_ml 
            WHERE empresa IS NOT NULL AND TRIM(empresa) != '' 
            ORDER BY empresa ASC;
        `);
        const empresas = empresasResult.rows.map(r => r.empresa);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            data: listResult.rows,
            pedidos: listResult.rows,
            total: totalItems,
            pagination: {
                total_items: totalItems,
                totalItems: totalItems,
                page: pageNum,
                currentPage: pageNum,
                limit: limitNum,
                totalPages: totalPages
            },
            kpis,
            empresas
        });

    } catch (error) {
        console.error('[PedidosML] Erro ao buscar listagem de pedidos:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar os pedidos do Mercado Livre.',
            details: error.message
        });
    }
};

/**
 * API para disparar a sincronização dos pedidos com o Hub
 */
exports.sincronizarPedidosApi = async (req, res) => {
    try {
        const { dias = 30 } = req.body;
        console.log(`[PedidosML] Requisição manual de sincronização recebida (dias: ${dias}).`);

        const resultado = await pedidosMlSyncService.sincronizarPedidos({
            diasAtras: parseInt(dias, 10) || 30
        });

        res.status(200).json({
            sucesso: true,
            success: true,
            mensagem: `Sincronização concluída com sucesso! ${resultado.total_processados} pedido(s) atualizados.`,
            metricas: { novos_inseridos: resultado.total_processados },
            ...resultado
        });
    } catch (error) {
        console.error('[PedidosML] Erro ao sincronizar pedidos:', error);
        res.status(500).json({
            sucesso: false,
            success: false,
            error: 'Erro ao sincronizar pedidos com o Hub.',
            details: error.message
        });
    }
};

/**
 * API para buscar os detalhes completos de um pedido específico
 */
exports.getDetalhesPedidoApi = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'ID do pedido é obrigatório.' });
        }

        const query = `
            SELECT * 
            FROM pedidos_ml 
            WHERE id_pedido_ml = $1 OR id::text = $1
            LIMIT 1;
        `;
        const result = await pool.query(query, [String(id).trim()]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido não encontrado.' });
        }

        res.status(200).json({
            success: true,
            pedido: result.rows[0]
        });
    } catch (error) {
        console.error('[PedidosML] Erro ao buscar detalhes do pedido:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao obter detalhes do pedido.',
            details: error.message
        });
    }
};

/**
 * API para obter a etiqueta ZPL de um pedido individual
 */
exports.getEtiquetaZplApi = async (req, res) => {
    try {
        const { id } = req.params;
        const query = `
            SELECT id_pedido_ml, id_envio_ml, etiqueta_zpl, tem_etiqueta 
            FROM pedidos_ml 
            WHERE id_pedido_ml = $1 OR id::text = $1
            LIMIT 1;
        `;
        const result = await pool.query(query, [String(id).trim()]);
        if (result.rows.length > 0 && result.rows[0].etiqueta_zpl) {
            return res.status(200).json({
                sucesso: true,
                success: true,
                id_pedido_ml: result.rows[0].id_pedido_ml,
                id_envio_ml: result.rows[0].id_envio_ml,
                etiqueta_zpl: result.rows[0].etiqueta_zpl,
                zpl_consolidado: result.rows[0].etiqueta_zpl
            });
        }

        // Se não tiver ZPL salvo no banco, tenta buscar no Hub sob demanda
        req.body = { pedidos: [id], formato: 'zpl2', consolidar: true };
        return exports.obterEtiquetasApi(req, res);

    } catch (error) {
        console.error('[PedidosML] Erro ao obter etiqueta ZPL:', error);
        res.status(500).json({ error: 'Erro ao obter etiqueta ZPL.' });
    }
};

/**
 * API para obter/gerar etiquetas de envio (em lote ou unitária) via Hub com autenticação de todas as contas clientes
 * Gera e consolida um único PDF com todas as etiquetas selecionadas.
 */
exports.obterEtiquetasApi = async (req, res) => {
    try {
        const body = req.body || {};
        const query = req.query || {};
        const pedidos = body.pedidos || body.pedido_ids || query.pedidos || query.pedido_ids || query.ids;
        const formato = body.formato || query.formato || 'pdf'; // Padrão PDF
        const consolidar = body.consolidar !== undefined ? body.consolidar : true;
        const streamPdf = query.stream === 'true' || query.download === 'true' || body.stream === true;

        const listaSolicitada = Array.isArray(pedidos) && pedidos.length > 0
            ? pedidos
            : (typeof pedidos === 'string'
                ? pedidos.split(',').map(s => s.trim()).filter(Boolean)
                : [pedidos].filter(Boolean));

        if (listaSolicitada.length === 0) {
            return res.status(400).json({
                sucesso: false,
                error: 'Nenhum pedido selecionado para impressão de etiquetas.'
            });
        }

        const accounts = pedidosMlSyncService.getHubAccounts();
        if (accounts.length === 0) {
            return res.status(500).json({
                sucesso: false,
                error: 'Nenhuma conta do Hub configurada no servidor (.env).'
            });
        }

        let todasEtiquetas = [];
        let zplConsolidadoArray = [];
        let pdfBuffersToMerge = [];
        let totalGerado = 0;
        const HUB_API_URL = pedidosMlSyncService.HUB_API_URL || `http://localhost:${process.env.PORT || 3000}`;

        // Itera sobre todas as contas do Hub cadastradas para cobrir pedidos de todos os sellers/lojas
        for (const acc of accounts) {
            try {
                const token = await pedidosMlSyncService.getHubToken(acc);
                if (!token) {
                    console.warn(`[PedidosML Etiquetas] Não foi possível autenticar na conta ${acc.email}`);
                    continue;
                }

                const response = await axios.post(`${HUB_API_URL}/hub/api/pedidos/etiquetas/obter`, {
                    pedidos: listaSolicitada,
                    formato,
                    consolidar: true,
                    salvar_banco: true
                }, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    timeout: 60000
                });

                if (response.data && (response.data.sucesso || Array.isArray(response.data.etiquetas))) {
                    const ets = response.data.etiquetas || [];
                    todasEtiquetas = todasEtiquetas.concat(ets);

                    if (formato === 'pdf') {
                        if (response.data.pdf_consolidado) {
                            try {
                                pdfBuffersToMerge.push(Buffer.from(response.data.pdf_consolidado, 'base64'));
                            } catch (e) {
                                console.warn('[PedidosML] Erro ao decodificar pdf_consolidado base64:', e.message);
                            }
                        } else {
                            ets.forEach(e => {
                                if (e.sucesso && e.conteudo && e.formato === 'pdf') {
                                    try {
                                        pdfBuffersToMerge.push(Buffer.from(e.conteudo, 'base64'));
                                    } catch (errDec) {
                                        console.warn('[PedidosML] Erro ao decodificar conteudo PDF:', errDec.message);
                                    }
                                }
                            });
                        }
                    } else if (response.data.zpl_consolidado) {
                        zplConsolidadoArray.push(response.data.zpl_consolidado);
                    }

                    totalGerado += (response.data.total_gerado || ets.filter(e => e.sucesso).length || 0);
                }
            } catch (hubErr) {
                const errMsg = hubErr.response?.data?.error || hubErr.response?.data?.message || hubErr.message;
                console.warn(`[PedidosML Etiquetas] Resposta da conta ${acc.email}:`, errMsg);
            }
        }

        // Atualiza a tabela local pedidos_ml para refletir o status de impressão de cada pedido solicitado
        const statusPorPedido = [];

        for (const pedidoId of listaSolicitada) {
            const strId = String(pedidoId).trim();
            const et = todasEtiquetas.find(e => 
                String(e.id_pedido_ml) === strId || 
                String(e.id_envio_ml) === strId || 
                String(e.pack_id) === strId
            );

            if (et && et.sucesso) {
                statusPorPedido.push({
                    id: strId,
                    id_envio_ml: et.id_envio_ml || null,
                    status_impressao: 'sucesso',
                    justificativa_erro: null,
                    conta: et.conta || null
                });

                try {
                    const params = [strId, String(et.id_envio_ml || strId)];
                    let setSql = `tem_etiqueta = TRUE, etiqueta_status = 'pronta_para_imprimir', status_impressao = 'sucesso', justificativa_erro = NULL, updated_at = NOW()`;
                    if (et.formato !== 'pdf' && et.conteudo) {
                        setSql = `etiqueta_zpl = $3, tem_etiqueta = TRUE, etiqueta_status = 'pronta_para_imprimir', status_impressao = 'sucesso', justificativa_erro = NULL, updated_at = NOW()`;
                        params.push(et.conteudo.replace(/\u0000/g, ''));
                    }
                    await pool.query(`
                        UPDATE pedidos_ml 
                        SET ${setSql},
                            situacao_operacional = CASE 
                                WHEN situacao_operacional = 'com_nota_sem_etiqueta' THEN 'etiquetas_para_imprimir' 
                                ELSE situacao_operacional 
                            END
                        WHERE id_pedido_ml = $1 OR id_envio_ml = $2
                    `, params);
                } catch (dbErr) {
                    console.error(`[PedidosML Etiquetas] Erro ao atualizar status de sucesso do pedido ${strId}:`, dbErr.message);
                }
            } else {
                const motivoErro = et?.erro || 'Etiqueta não liberada pelo Mercado Livre ou pedido sem envio elegível.';
                statusPorPedido.push({
                    id: strId,
                    id_envio_ml: et?.id_envio_ml || null,
                    status_impressao: 'erro',
                    justificativa_erro: motivoErro,
                    conta: et?.conta || null
                });

                try {
                    await pool.query(`
                        UPDATE pedidos_ml 
                        SET status_impressao = 'erro',
                            justificativa_erro = $2,
                            updated_at = NOW()
                        WHERE id_pedido_ml = $1 OR id_envio_ml = $1
                    `, [strId, motivoErro]);
                } catch (dbErr) {
                    console.error(`[PedidosML Etiquetas] Erro ao atualizar status de erro do pedido ${strId}:`, dbErr.message);
                }
            }
        }

        // Se o formato for PDF, mescla todas as páginas usando pdf-lib com separação de Etiquetas e Relatórios
        let finalPdfBuffer = null;
        let finalPdfBase64 = null;

        if (formato === 'pdf' && pdfBuffersToMerge.length > 0) {
            try {
                const mergedPdfDoc = await PDFDocument.create();
                const labelPages = [];
                const reportPages = [];

                for (const pdfBuf of pdfBuffersToMerge) {
                    if (!pdfBuf || pdfBuf.length === 0) continue;
                    try {
                        const loadedDoc = await PDFDocument.load(pdfBuf);
                        const totalPages = loadedDoc.getPageCount();
                        for (let pIdx = 0; pIdx < totalPages; pIdx++) {
                            const page = loadedDoc.getPage(pIdx);
                            const { width, height } = page.getSize();
                            const isReport = Math.min(width, height) > 450 || Math.max(width, height) > 650;
                            if (isReport) {
                                reportPages.push({ doc: loadedDoc, index: pIdx });
                            } else {
                                labelPages.push({ doc: loadedDoc, index: pIdx });
                            }
                        }
                    } catch (loadErr) {
                        console.warn('[PedidosML PDF Consolidação] Erro ao carregar página de PDF individual:', loadErr.message);
                    }
                }

                // 1. Adiciona primeiro todas as páginas de etiqueta (térmicas)
                for (const item of labelPages) {
                    const [copiedPage] = await mergedPdfDoc.copyPages(item.doc, [item.index]);
                    mergedPdfDoc.addPage(copiedPage);
                }

                // 2. Adiciona depois todos os relatórios / listas de postagem (A4) ao final do documento
                for (const item of reportPages) {
                    const [copiedPage] = await mergedPdfDoc.copyPages(item.doc, [item.index]);
                    mergedPdfDoc.addPage(copiedPage);
                }

                const mergedPdfBytes = await mergedPdfDoc.save();
                finalPdfBuffer = Buffer.from(mergedPdfBytes);
                finalPdfBase64 = finalPdfBuffer.toString('base64');
            } catch (mergeError) {
                console.error('[PedidosML PDF Consolidação] Erro geral ao mesclar PDFs:', mergeError);
            }
        }

        const finalZpl = zplConsolidadoArray.join('\n');

        if (todasEtiquetas.length === 0 && !finalPdfBuffer && !finalZpl) {
            return res.status(404).json({
                sucesso: false,
                error: 'Nenhuma etiqueta pôde ser obtida para os pedidos selecionados. Verifique se os envios já estão liberados para impressão / com nota fiscal no Mercado Livre.',
                status_impressao: statusPorPedido
            });
        }

        if (streamPdf && finalPdfBuffer) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="etiquetas_pedidos_ml.pdf"');
            return res.send(finalPdfBuffer);
        }

        res.status(200).json({
            sucesso: true,
            formato: formato,
            total_gerado: totalGerado || todasEtiquetas.filter(e => e.sucesso).length,
            pdf_base64: finalPdfBase64,
            zpl_consolidado: finalZpl,
            etiquetas: todasEtiquetas,
            status_impressao: statusPorPedido
        });

    } catch (error) {
        console.error('[PedidosML] Erro ao obter etiquetas:', error);
        res.status(500).json({
            sucesso: false,
            error: error.message || 'Erro ao processar etiquetas de envio com o Hub.'
        });
    }
};

/**
 * GET /api/pedidos-ml/etiquetas/pdf
 * Rota direta para baixar/abrir o PDF com todas as etiquetas consolidadas dos pedidos passados em query (?pedidos=id1,id2)
 */
exports.baixarEtiquetasPdfApi = async (req, res) => {
    try {
        const { pedidos, pedido_ids, ids } = req.query;
        const rawList = pedidos || pedido_ids || ids || '';
        const listArray = String(rawList).split(',').map(s => s.trim()).filter(Boolean);

        req.body = { pedidos: listArray, formato: 'pdf', consolidar: true };
        req.query.stream = 'true';
        return exports.obterEtiquetasApi(req, res);
    } catch (error) {
        console.error('[PedidosML] Erro ao baixar PDF de etiquetas:', error);
        res.status(500).send('Erro ao gerar PDF de etiquetas.');
    }
};

/**
 * Exportar pedidos filtrados para planilha Excel (.xlsx)
 */
exports.exportarPedidosExcel = async (req, res) => {
    try {
        const {
            search = '',
            campo_busca = 'geral',
            periodo = '30dias',
            data_inicio = '',
            data_fim = '',
            empresa = '',
            situacao_prazo = '',
            situacao_operacional = '',
            tipo_envio = '',
            status_pedido = '',
            status_envio = '',
            tem_nfe = '',
            tem_etiqueta = '',
            tem_pos_venda = ''
        } = req.query;

        const whereClauses = [];
        const queryParams = [];
        let pIndex = 1;

        const { startDate, endDate } = buildDateFilter(periodo, data_inicio, data_fim);
        if (startDate) {
            whereClauses.push(`data_pedido >= $${pIndex++}`);
            queryParams.push(startDate.toISOString());
        }
        if (endDate) {
            whereClauses.push(`data_pedido <= $${pIndex++}`);
            queryParams.push(endDate.toISOString());
        }

        const searchTrim = String(search || '').trim();
        if (searchTrim) {
            const searchPattern = `%${searchTrim}%`;
            whereClauses.push(`(
                id_pedido_ml ILIKE $${pIndex} OR 
                id_envio_ml ILIKE $${pIndex} OR 
                sku_principal ILIKE $${pIndex} OR 
                skus_resumo ILIKE $${pIndex} OR 
                comprador_nickname ILIKE $${pIndex} OR 
                nfe_numero ILIKE $${pIndex}
            )`);
            queryParams.push(searchPattern);
            pIndex++;
        }

        if (empresa && empresa !== 'todas') {
            whereClauses.push(`empresa ILIKE $${pIndex++}`);
            queryParams.push(empresa);
        }
        if (situacao_prazo && situacao_prazo !== 'todas') {
            whereClauses.push(`situacao_prazo = $${pIndex++}`);
            queryParams.push(situacao_prazo);
        }
        if (situacao_operacional && situacao_operacional !== 'todas') {
            whereClauses.push(`situacao_operacional = $${pIndex++}`);
            queryParams.push(situacao_operacional);
        }
        if (tipo_envio && tipo_envio !== 'todos') {
            whereClauses.push(`tipo_envio = $${pIndex++}`);
            queryParams.push(tipo_envio);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const query = `
            SELECT 
                empresa, id_pedido_ml, pack_id, id_envio_ml, data_pedido,
                situacao_prazo, situacao_operacional, status_pedido, status_envio, tipo_envio,
                data_limite_envio, comprador_nickname,
                sku_principal, skus_resumo, quantidade_total_itens,
                valor_total, frete_envio, nfe_numero, chave_acesso,
                tem_dev, tem_med, status_impressao, justificativa_erro
            FROM pedidos_ml
            ${whereSql}
            ORDER BY data_pedido DESC
            LIMIT 5000;
        `;

        const result = await pool.query(query, queryParams);
        const rows = result.rows;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Sistema Inova';
        workbook.created = new Date();
        const worksheet = workbook.addWorksheet('Pedidos Mercado Livre');

        worksheet.columns = [
            { header: 'Empresa / Loja', key: 'empresa', width: 16 },
            { header: 'ID Pedido ML', key: 'id_pedido_ml', width: 22 },
            { header: 'Pack ID', key: 'pack_id', width: 20 },
            { header: 'ID Envio ML', key: 'id_envio_ml', width: 18 },
            { header: 'Data do Pedido', key: 'data_pedido', width: 20 },
            { header: 'Status Impressão', key: 'status_impressao', width: 18 },
            { header: 'Justificativa Erro', key: 'justificativa_erro', width: 35 },
            { header: 'Situação do Prazo', key: 'situacao_prazo', width: 18 },
            { header: 'Situação Operacional', key: 'situacao_operacional', width: 24 },
            { header: 'Status Pedido', key: 'status_pedido', width: 14 },
            { header: 'Status Envio', key: 'status_envio', width: 16 },
            { header: 'Tipo Envio', key: 'tipo_envio', width: 16 },
            { header: 'Prazo Limite Envio', key: 'data_limite_envio', width: 20 },
            { header: 'Comprador', key: 'comprador_nickname', width: 22 },
            { header: 'SKU Principal', key: 'sku_principal', width: 20 },
            { header: 'SKUs do Pedido', key: 'skus_resumo', width: 35 },
            { header: 'Qtd Itens', key: 'quantidade_total_itens', width: 12 },
            { header: 'Valor Total (R$)', key: 'valor_total', width: 16 },
            { header: 'Frete (R$)', key: 'frete_envio', width: 14 },
            { header: 'Número NF-e', key: 'nfe_numero', width: 16 },
            { header: 'Chave de Acesso', key: 'chave_acesso', width: 46 },
            { header: 'Devolução?', key: 'tem_dev', width: 12 },
            { header: 'Mediação?', key: 'tem_med', width: 12 }
        ];

        // Formatação do Header
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E1E24' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        headerRow.height = 28;

        rows.forEach(r => {
            const dataPed = r.data_pedido ? new Date(r.data_pedido).toLocaleString('pt-BR') : '-';
            const dataLim = r.data_limite_envio ? new Date(r.data_limite_envio).toLocaleString('pt-BR') : '-';

            let statusImpTxt = 'Não Impresso';
            if (r.status_impressao === 'sucesso' || r.status_impressao === 'impresso') statusImpTxt = 'Impresso (Sucesso)';
            else if (r.status_impressao === 'erro') statusImpTxt = 'Erro na Impressão';

            worksheet.addRow({
                empresa: r.empresa || '-',
                id_pedido_ml: r.id_pedido_ml || '-',
                pack_id: r.pack_id || '-',
                id_envio_ml: r.id_envio_ml || '-',
                data_pedido: dataPed,
                status_impressao: statusImpTxt,
                justificativa_erro: r.justificativa_erro || '-',
                situacao_prazo: r.situacao_prazo || '-',
                situacao_operacional: r.situacao_operacional || '-',
                status_pedido: r.status_pedido || '-',
                status_envio: r.status_envio || '-',
                tipo_envio: r.tipo_envio || '-',
                data_limite_envio: dataLim,
                comprador_nickname: r.comprador_nickname || '-',
                sku_principal: r.sku_principal || '-',
                skus_resumo: r.skus_resumo || '-',
                quantidade_total_itens: Number(r.quantidade_total_itens) || 1,
                valor_total: Number(r.valor_total) || 0,
                frete_envio: Number(r.frete_envio) || 0,
                nfe_numero: r.nfe_numero || '-',
                chave_acesso: r.chave_acesso || '-',
                tem_dev: r.tem_dev ? 'Sim' : 'Não',
                tem_med: r.tem_med ? 'Sim' : 'Não'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=pedidos_mercado_livre_${Date.now()}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('[PedidosML] Erro ao exportar Excel:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório Excel de pedidos.' });
    }
};

/**
 * Obter preferências de colunas (ordem e larguras) salvas para o usuário
 */
exports.getColumnPreferences = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        const viewName = 'pedidos_ml';

        const result = await pool.query(
            'SELECT column_order, column_widths FROM user_column_preferences WHERE user_id = $1 AND view_name = $2',
            [userId, viewName]
        );

        if (result.rows.length > 0) {
            res.status(200).json({
                success: true,
                column_order: result.rows[0].column_order || null,
                column_widths: result.rows[0].column_widths || null
            });
        } else {
            res.status(200).json({
                success: true,
                column_order: null,
                column_widths: null
            });
        }
    } catch (error) {
        console.error('[PedidosML] Erro ao buscar preferências de colunas:', error);
        res.status(500).json({ error: 'Erro ao obter preferências de colunas.' });
    }
};

/**
 * Salvar preferências de colunas (ordem e larguras) do usuário
 */
exports.saveColumnPreferences = async (req, res) => {
    try {
        const userId = req.user?.id || 1;
        const viewName = 'pedidos_ml';
        const { column_order, column_widths } = req.body;

        await pool.query(`
            INSERT INTO user_column_preferences (user_id, view_name, column_order, column_widths, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id, view_name) DO UPDATE SET
                column_order = COALESCE(EXCLUDED.column_order, user_column_preferences.column_order),
                column_widths = COALESCE(EXCLUDED.column_widths, user_column_preferences.column_widths),
                updated_at = NOW()
        `, [
            userId,
            viewName,
            column_order ? JSON.stringify(column_order) : null,
            column_widths ? JSON.stringify(column_widths) : null
        ]);

        res.status(200).json({ success: true, message: 'Preferências salvas com sucesso!' });
    } catch (error) {
        console.error('[PedidosML] Erro ao salvar preferências de colunas:', error);
        res.status(500).json({ error: 'Erro ao salvar preferências de colunas.' });
    }
};
