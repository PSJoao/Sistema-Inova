// controllers/rastreioController.js (VERSÃO CORRIGIDA E FINAL)

const { poolInova, poolMonitora } = require('../config/db');
const rastreioService = require('../services/rastreioService');
const gmailService = require('../services/gmailService');
const ExcelJS = require('exceljs');

const rastreioController = {
    /**
     * Renderiza a página principal de rastreio, buscando a primeira página de dados
     * e a lista de transportadoras para os filtros.
     */
    renderRastreioPage: async (req, res) => {
        try {
            const [precisaConferir, transportadoras, observacoes, plataformas] = await Promise.all([
                rastreioService.getConferenciaStatus(),
                rastreioService.getDistinctTransportadoras(),
                rastreioService.getDistinctObservacoes(),
                rastreioService.getDistinctPlataformas()
            ]);
            
            res.render('acompanhamentos/rastreio', {
                title: 'Rastreio de Pedidos',
                layout: 'main',
                precisaConferir: precisaConferir,
                transportadoras: transportadoras,
                observacoes: observacoes,
                plataformas: plataformas,
                helpers: {
                    eq: (v1, v2) => v1 === v2,
                }
            });
        } catch (error) {
            console.error("[Rastreio Controller] Erro ao carregar a página de rastreio:", error);
            res.status(500).send("Erro interno ao carregar a página.");
        }
    },

    /**
     * API que alimenta a lista de cards dinamicamente com base nos filtros.
     */
    getPedidosRastreioApi: async (req, res) => {
        try {
            const { page = 1, search = '', situacao, transportadora, observacao, plataforma, dataInicio, dataFim } = req.query;
            const limit = 100;
            const offset = (parseInt(page, 10) - 1) * limit;

            let whereClauses = [];
            const queryParams = [];
            let paramIndex = 1;

            if (dataInicio && dataFim) {
                whereClauses.push(`data_envio::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
                queryParams.push(dataInicio, dataFim);
                paramIndex += 2;
            }
            if (search) {
                whereClauses.push(`(numero_pedido ILIKE $${paramIndex} OR numero_nfe ILIKE $${paramIndex} OR situacao_atual ILIKE $${paramIndex})`);
                queryParams.push(`%${search}%`);
                paramIndex++;
            }
            if (transportadora) {
                if (transportadora === 'I AMORIN TRANSPORTES EIRELLI') {
                    whereClauses.push(`(transportadora = 'I AMORIN TRANSPORTES EIRELLI' OR transportadora = 'I. AMORIN TRANSPORTES EIRELI')`);
                } else {
                    whereClauses.push(`transportadora = $${paramIndex++}`);
                    queryParams.push(transportadora);
                }
            }
            if (plataforma) {
                whereClauses.push(`plataforma = $${paramIndex++}`);
                queryParams.push(plataforma);
            }
            if (situacao) {
                switch (situacao) {
                    case 'entregue_conferir':
                        whereClauses.push(`situacao_atual = 'Entregue - Conferir'`);
                        break;
                    case 'entregue_confirmado':
                        whereClauses.push(`situacao_atual = 'Entregue - Confirmado'`);
                        break;
                    case 'fora_prazo_conferir':
                        whereClauses.push(`situacao_atual = 'Fora do Prazo - Conferir'`);
                        break;
                    case 'fora_prazo_conferido':
                        whereClauses.push(`situacao_atual = 'Fora do Prazo - Conferido'`);
                        break;
                    case 'em_transito':
                        whereClauses.push(`situacao_atual = 'Em Trânsito'`);
                        break;
                    case 'fora_do_comum':
                        whereClauses.push(`situacao_atual = 'Fora do Comum'`);
                        break;
                    case 'email_em_andamento':
                        whereClauses.push(`email_status IN ('Email - Em Andamento', 'Email - Respondido')`);
                        break;
                    case 'email_resolvido':
                        whereClauses.push(`email_status = 'Email - Resolvido'`);
                        break;
                    case 'outros':
                        const statusPredefinidos = ['Entregue - Conferir', 'Entregue - Confirmado', 'Fora do Prazo - Conferir', 'Fora do Prazo - Conferido', 'Em Trânsito', 'Fora do Comum'];
                        whereClauses.push(`status_manual = true AND situacao_atual NOT IN (${statusPredefinidos.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
                        queryParams.push(...statusPredefinidos);
                        paramIndex += statusPredefinidos.length;
                        break;
                }
            }
            if (observacao) {
                if (observacao === 'Outros') {
                    const predefinidas = [
                        'Barrado', 'Indenização', 'Contato ativo', 
                        'Comprovante de entrega solicitado', 'Solicitar posição de entrega', 
                        'Posição de entrega solicitada', 'Sem produto', 'Solicitar contato ativo', 
                        'Reclamação', 'Mediação', 'Análise em Recobrança', 'Cancelada', 
                        'Devolução', 'Esperando Reposição'
                    ];
                     // Adiciona uma verificação para não buscar por "Nova Previsão..."
                    whereClauses.push(`observacao IS NOT NULL AND observacao NOT LIKE 'Nova Previsão de Entrega:%' AND observacao NOT IN (${predefinidas.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
                    queryParams.push(...predefinidas);
                    paramIndex += predefinidas.length;
                } else if (observacao === 'Nova Previsão de Entrega') {
                    // Busca especificamente por observações que começam com "Nova Previsão..."
                    whereClauses.push(`observacao LIKE 'Nova Previsão de Entrega:%'`);
                } else {
                    whereClauses.push(`observacao = $${paramIndex++}`);
                    queryParams.push(observacao);
                }
            }

            const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            
            const orderByClause = 'ORDER BY atualizado_em DESC';

            const dataQuery = `
                SELECT 
                    id, numero_pedido, numero_nfe, situacao_atual, data_envio, 
                    data_previsao_entrega, data_entrega, atualizado_em, transportadora, plataforma, 
                    conferencia_necessaria, observacao, status_manual, email_status, notificado_por_email, previsao_atu,
                    CASE
                        WHEN transportadora ILIKE '%RISSO%' THEN
                            (dados_rastreio_raw -> 'Ocorrencias' -> -1 ->> 'ds_Ocorrencia')
                        WHEN transportadora ILIKE '%JEW%' THEN
                            (dados_rastreio_raw -> 'listaResultados' -> -1 ->> 'descricaoOcorrencia')
                        ELSE
                            (dados_rastreio_raw -> 'documento' -> 'tracking' -> -1 ->> 'ocorrencia') || ' - ' || (dados_rastreio_raw -> 'documento' -> 'tracking' -> -1 ->> 'descricao')
                    END as ultima_ocorrencia
                FROM pedidos_em_rastreamento ${whereCondition} ORDER BY atualizado_em DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++};
            `;
            const nfeResult = await poolInova.query(dataQuery, [...queryParams, limit, offset]);
            const countQuery = `SELECT COUNT(*) FROM pedidos_em_rastreamento ${whereCondition};`;
            const totalResult = await poolInova.query(countQuery, queryParams);
            const totalItems = parseInt(totalResult.rows[0].count, 10);
            const totalPages = Math.ceil(totalItems / limit);

            res.status(200).json({
                pedidosData: nfeResult.rows,
                pagination: {
                    currentPage: parseInt(page, 10),
                    totalPages: totalPages,
                    totalItems: totalItems
                }
            });

        } catch (error) {
            console.error("[Rastreio Controller API] Erro ao buscar dados:", error);
            res.status(500).json({ message: "Erro ao buscar dados dos pedidos." });
        }
    },

    /**
     * Renderiza a página de detalhes de um pedido. (sem alterações)
     */
    renderDetalheRastreioPage: async (req, res) => {
        try {
            const { id } = req.params;
            const query = `SELECT * FROM pedidos_em_rastreamento WHERE id = $1`;
            const result = await poolInova.query(query, [id]);

            if (result.rows.length === 0) {
                return res.status(404).render('partials/404', { layout: 'main', title: 'Não Encontrado' });
            }

            const pedido = result.rows[0];

            // [NOVA LÓGICA]
            // Se o pedido estava marcado para conferência, atualiza o status para FALSE.
            if (pedido.conferencia_necessaria) {
                console.log(`[Rastreio Detalhes] Dando baixa de conferência para o pedido ID: ${id}`);
                await poolInova.query(
                    'UPDATE pedidos_em_rastreamento SET conferencia_necessaria = FALSE WHERE id = $1',
                    [id]
                );
            }

            const dadosRastreio = pedido.dados_rastreio_raw || {};
            let headerInfo = {};
            let historico = [];
            // Formato SSW
            if (dadosRastreio.documento?.tracking) {
                headerInfo = dadosRastreio.documento?.header || {};
                historico = Array.isArray(dadosRastreio.documento.tracking) ? dadosRastreio.documento.tracking : [dadosRastreio.documento.tracking];
            
            // Formato Risso
            } else if (dadosRastreio.Ocorrencias) {
                headerInfo = { remetente: dadosRastreio.cd_Remetente, destinatario: dadosRastreio.cd_Destinatario };
                const formatarDataRissoParaISO = (dataString) => {
                    if (!dataString || typeof dataString !== 'string') return null;
                    const [data, hora] = dataString.split('T');
                    if (!data || !hora) return null;
                    const [dia, mes, ano] = data.split('/');
                    if (!dia || !mes || !ano) return null;
                    const dateObj = new Date(`${ano}-${mes}-${dia}T${hora}:00`);
                    // Se a data for inválida (ex: parsing falhou), retorna nulo.
                    if (isNaN(dateObj.getTime())) return null;
                    return dateObj.toISOString();
                };
                
                historico = dadosRastreio.Ocorrencias.map(ocorrencia => ({
                    ocorrencia: ocorrencia.ds_Ocorrencia,
                    descricao: `Recebedor: ${ocorrencia.recebedor || 'Não informado'}`,
                    data_hora_efetiva: formatarDataRissoParaISO(ocorrencia.dt_Ocorrencia),
                    cidade: ''
                }));
            
            // Formato Jew
            } else if (dadosRastreio.listaResultados) {
                const primeiraOcorrencia = dadosRastreio.listaResultados[0] || {};
                headerInfo = { remetente: primeiraOcorrencia.cnpjRemetente, destinatario: 'N/A' };
                historico = dadosRastreio.listaResultados.map(ocorrencia => ({
                    ocorrencia: ocorrencia.descricaoOcorrencia,
                    descricao: `Unidade: ${ocorrencia.unidadeOcorrencia || 'N/A'}`,
                    data_hora_efetiva: new Date(ocorrencia.dtOcorrencia).toISOString(),
                    cidade: ocorrencia.nomeCidade || ''
                }));
            }
            
            res.render('acompanhamentos/rastreio-detalhe', {
                title: `Detalhes do Pedido ${pedido.numero_pedido || ''}`,
                layout: 'main',
                pedido: pedido,
                headerInfo: headerInfo,
                historico: historico.slice().reverse(),
                emailStatus: pedido.email_status
            });
        } catch (error) {
            console.error(`[Rastreio Controller] Erro ao carregar detalhes do pedido ${req.params.id}:`, error);
            res.status(500).send("Erro interno ao carregar detalhes do pedido.");
        }
    },


    /**
     * API para marcar todos os pedidos como conferidos. (sem alterações)
     */
    marcarComoConferidosApi: async (req, res) => {
        try {
            const result = await rastreioService.marcarTodosComoConferidos();
            res.status(200).json({ success: true, message: `${result.count} pedido(s) foram marcados como conferidos.` });
        } catch (error) {
            console.error("[Rastreio Controller] Erro ao marcar pedidos como conferidos:", error);
            res.status(500).json({ success: false, message: "Falha ao marcar pedidos como conferidos." });
        }
    },

    salvarObservacao: async (req, res) => {
        const { pedidoId, observacao, novaPrevisaoEntrega } = req.body;

        if (!pedidoId || !observacao) {
            return res.status(400).json({ success: false, message: "ID do pedido e observação são obrigatórios." });
        }

        try {
            let query;
            let queryParams;

            if (novaPrevisaoEntrega) {
                // Busca o status atual para verificar se é 'Fora do Prazo - Conferir'
                const statusResult = await poolInova.query('SELECT situacao_atual FROM pedidos_em_rastreamento WHERE id = $1', [pedidoId]);
                const statusAtual = statusResult.rows[0]?.situacao_atual;

                let novoStatus = statusAtual;
                // Se o status for o de conferir, muda para conferido
                if (statusAtual === 'Fora do Prazo - Conferir') {
                    novoStatus = 'Fora do Prazo - Conferido';
                }

                query = `
                    UPDATE pedidos_em_rastreamento
                    SET 
                        observacao = $1, 
                        data_previsao_entrega = $2, 
                        situacao_atual = $3, -- Atualiza o status
                        atualizado_em = NOW(), 
                        previsao_atu = TRUE,
                        status_manual = TRUE -- Define como manual para o service não sobrescrever
                    WHERE id = $4
                `;
                queryParams = [observacao, novaPrevisaoEntrega, novoStatus, pedidoId];

            } else {
                // Senão, atualiza apenas a coluna de observação e marca como manual
                query = `
                    UPDATE pedidos_em_rastreamento
                    SET observacao = $1, atualizado_em = NOW(), status_manual = TRUE
                    WHERE id = $2
                `;
                queryParams = [observacao, pedidoId];
            }

            await poolInova.query(query, queryParams);

            if (observacao === 'Comprovante de entrega solicitado') {
                // 1. Busca os dados primários do pedido no banco de rastreio (Inova)
                const pedidoRastreioResult = await poolInova.query(
                    `SELECT numero_nfe, transportadora, documento_cliente FROM pedidos_em_rastreamento WHERE id = $1`,
                    [pedidoId]
                );

                if (pedidoRastreioResult.rows.length > 0) {
                    const { numero_nfe, transportadora, documento_cliente } = pedidoRastreioResult.rows[0];

                    // 2. Com o numero_nfe, busca os dados do cliente no banco de monitoramento
                    const clienteResult = await poolMonitora.query(
                        `SELECT etiqueta_nome, etiqueta_municipio, etiqueta_uf FROM cached_nfe WHERE nfe_numero = $1 LIMIT 1`,
                        [numero_nfe]
                    );

                    if (clienteResult.rows.length > 0) {
                        // 3. Junta todas as informações necessárias
                        const dadosCompletos = {
                            nfe_numero: numero_nfe,
                            transportadora: transportadora,
                            documento_cliente: documento_cliente,
                            ...clienteResult.rows[0] // adiciona etiqueta_nome, etc.
                        };
                        
                        // 4. Envia o e-mail
                        await gmailService.enviarEmailComprovanteEntrega(dadosCompletos);

                        // Retorna uma mensagem específica para o frontend
                        return res.status(200).json({ success: true, message: "Observação salva e e-mail de solicitação de comprovante enviado!", emailSent: true });
                    }
                }
            }

            res.status(200).json({ success: true, message: "Observação salva com sucesso!" });

        } catch (error) {
            console.error("Erro ao salvar observação no rastreio:", error);
            res.status(500).json({ success: false, message: "Erro interno ao salvar a observação." });
        }
    },

    updateStatusManual: async (req, res) => {
        const { pedidoId, novoStatus, dataEntrega } = req.body;

        if (!pedidoId || !novoStatus) {
            return res.status(400).json({ success: false, message: "ID do pedido e novo status são obrigatórios." });
        }
        
        if (novoStatus === 'Entregue - Confirmado' && !dataEntrega) {
             return res.status(400).json({ success: false, message: "A data de entrega é obrigatória para confirmar a entrega." });
        }

        try {
            let query;
            let queryParams;

            if (novoStatus === 'Entregue - Confirmado') {
                query = `
                    UPDATE pedidos_em_rastreamento
                    SET situacao_atual = $1, 
                        data_entrega = $2, 
                        status_manual = TRUE,
                        atualizado_em = NOW()
                    WHERE id = $3
                `;
                queryParams = [novoStatus, dataEntrega, pedidoId];
            } else {
                query = `
                    UPDATE pedidos_em_rastreamento
                    SET situacao_atual = $1,
                        status_manual = TRUE,
                        status_fora_do_comum = FALSE, 
                        atualizado_em = NOW()
                    WHERE id = $2
                `;
                queryParams = [novoStatus, pedidoId];
            }

            await poolInova.query(query, queryParams);
            res.status(200).json({ success: true, message: "Status do pedido atualizado com sucesso!" });

        } catch (error) {
            console.error("Erro ao atualizar status manual do rastreio:", error);
            res.status(500).json({ success: false, message: "Erro interno ao atualizar o status." });
        }
    },

    gerarRelatorioRastreio: async (req, res) => {
        try {
            console.log('[Relatório Rastreio] Geração de relatório iniciada com os filtros:', req.query);

            // 1. Pega os filtros da requisição (lógica adaptada de sua getPedidosRastreioApi)
            const { search = '', situacao, transportadora, observacao, plataforma, dataInicio, dataFim } = req.query;

            // 2. Constrói a cláusula WHERE exatamente como na sua API
            let whereClauses = [];
            const queryParams = [];
            let paramIndex = 1;

            if (dataInicio && dataFim) {
                whereClauses.push(`data_envio::date BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
                queryParams.push(dataInicio, dataFim);
                paramIndex += 2;
            }
            if (search) {
                whereClauses.push(`(numero_pedido ILIKE $${paramIndex} OR numero_nfe ILIKE $${paramIndex} OR situacao_atual ILIKE $${paramIndex})`);
                queryParams.push(`%${search}%`);
                paramIndex++;
            }
            if (transportadora) {
                whereClauses.push(`transportadora = $${paramIndex++}`);
                queryParams.push(transportadora);
            }
            if (plataforma) {
                whereClauses.push(`plataforma = $${paramIndex++}`);
                queryParams.push(plataforma);
            }
            if (situacao) {
                switch (situacao) {
                    case 'entregue_conferir': whereClauses.push(`situacao_atual = 'Entregue - Conferir'`); break;
                    case 'entregue_confirmado': whereClauses.push(`situacao_atual = 'Entregue - Confirmado'`); break;
                    case 'atrasado': whereClauses.push(`(situacao_atual = 'Fora do Prazo' OR (data_previsao_entrega < CURRENT_DATE AND data_entrega IS NULL AND status_manual = false))`); break;
                    case 'em_transito': whereClauses.push(`(situacao_atual = 'Em Trânsito' OR (status_manual = false AND situacao_atual NOT IN ('Entregue - Conferir', 'Entregue - Confirmado', 'Fora do Prazo', 'Confirmar Entrega')))`); break;
                    case 'outros':
                        const statusPredefinidos = ['Entregue - Conferir', 'Entregue - Confirmado', 'Fora do Prazo', 'Em Trânsito'];
                        whereClauses.push(`status_manual = true AND situacao_atual NOT IN (${statusPredefinidos.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
                        queryParams.push(...statusPredefinidos);
                        paramIndex += statusPredefinidos.length;
                        break;
                    case 'conferencia_necessaria': whereClauses.push('conferencia_necessaria = TRUE'); break;
                }
            }
            if (observacao) {
                if (observacao === 'Outros') {
                    const predefinidas = ['Barrado', 'Indenização', 'Contato ativo', 'Comprovante de entrega solicitado', 'Solicitar posição de entrega', 'Posição de entrega solicitada', 'Sem produto', 'Solicitar contato ativo', 'Nova Previsão de Entrega', 'Reclamação', 'Mediação', 'Análise em Recobrança', 'Cancelada', 'Devolução', 'Esperando Reposição'];
                    whereClauses.push(`observacao IS NOT NULL AND observacao NOT IN (${predefinidas.map((_, i) => `$${paramIndex + i}`).join(', ')})`);
                    queryParams.push(...predefinidas);
                    paramIndex += predefinidas.length;
                } else {
                    whereClauses.push(`observacao = $${paramIndex++}`);
                    queryParams.push(observacao);
                }
            }
            const whereCondition = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

            // 3. Busca TODOS os dados filtrados, sem paginação
            const query = `
                SELECT 
                    numero_pedido, numero_nfe, situacao_atual, data_envio, 
                    data_previsao_entrega, data_entrega, transportadora, plataforma,
                    (dados_rastreio_raw -> 'documento' -> 'tracking' -> -1 ->> 'ocorrencia') || ' - ' || (dados_rastreio_raw -> 'documento' -> 'tracking' -> -1 ->> 'descricao') as ultima_ocorrencia,
                    observacao
                FROM pedidos_em_rastreamento
                ${whereCondition}
                ORDER BY atualizado_em DESC;
            `;
            
            const { rows } = await poolInova.query(query, queryParams);
            console.log(`[Relatório Rastreio] ${rows.length} registros encontrados para o relatório.`);

            if (rows.length === 0) {
                req.flash('info', 'Nenhum dado encontrado para os filtros selecionados. Nenhum relatório foi gerado.');
                return res.redirect('/rastreio');
            }

            // 4. Cria o arquivo Excel em memória
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Rastreio');

            worksheet.columns = [
                { header: 'Pedido', key: 'numero_pedido', width: 15 },
                { header: 'NFE', key: 'numero_nfe', width: 15 },
                { header: 'Status', key: 'situacao_atual', width: 25 },
                { header: 'Transportadora', key: 'transportadora', width: 30 },
                { header: 'Plataforma', key: 'plataforma', width: 20 },
                { header: 'Última Ocorrência', key: 'ultima_ocorrencia', width: 50 },
                { header: 'Observação Interna', key: 'observacao', width: 30 },
                { header: 'Data Envio', key: 'data_envio', width: 20 },
                { header: 'Previsão Entrega', key: 'data_previsao_entrega', width: 20 },
                { header: 'Data Entrega', key: 'data_entrega', width: 20 },
            ];
            
            worksheet.getRow(1).font = { bold: true };

            // 5. Adiciona os dados e formata as datas
            rows.forEach(row => {
                worksheet.addRow({
                    ...row,
                    data_envio: row.data_envio ? new Date(row.data_envio).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '',
                    data_previsao_entrega: row.data_previsao_entrega ? new Date(row.data_previsao_entrega).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '',
                    data_entrega: row.data_entrega ? new Date(row.data_entrega).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '',
                });
            });

            // 6. Envia o arquivo para o navegador
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="Relatorio_Rastreio.xlsx"');

            await workbook.xlsx.write(res);
            res.end();
            console.log('[Relatório Rastreio] Relatório enviado com sucesso.');

        } catch (error) {
            console.error("[Gerar Relatório Rastreio] Erro:", error);
            res.status(500).send("Erro ao gerar o relatório.");
        }
    },

    processarBoletimDominalog: async (req, res) => {
        if (!req.file) {
            req.flash('error', 'Nenhum arquivo foi enviado.');
            return res.redirect('/acompanhamento/pedidos'); // Redireciona para a página de uploads
        }

        try {
            const results = await rastreioService.atualizarPrevisaoComBoletimDominalog(req.file.buffer);
            req.flash('success', `Boletim da Dominalog processado! ${results.atualizados} previsões atualizadas, ${results.naoEncontrados} NF-e não encontradas, ${results.semAlteracao} já estavam corretas.`);
        } catch (error) {
            console.error("[Controller] Erro ao processar boletim Dominalog:", error);
            req.flash('error', `Erro ao processar o arquivo: ${error.message}`);
        }
        
        return res.redirect('/acompanhamento/pedidos');
    },

    enviarEmailCobranca: async (req, res) => {
        const { id } = req.params;
        try {
            // Passo 1: Busca os dados básicos do pedido de rastreio
            const rastreioResult = await poolInova.query('SELECT * FROM pedidos_em_rastreamento WHERE id = $1', [id]);
            if (rastreioResult.rows.length === 0) {
                return res.status(404).json({ message: 'Pedido não encontrado.' });
            }
            const pedido = rastreioResult.rows[0];

            // --- [NOVA LÓGICA] ---
            // Passo 2: Busca os dados complementares do cliente na tabela de acompanhamentos
            const acompanhamentoResult = await poolMonitora.query(
                'SELECT etiqueta_nome, etiqueta_municipio, etiqueta_uf FROM cached_nfe WHERE nfe_numero = $1 LIMIT 1',
                [pedido.numero_nfe]
            );
            
            // Passo 3: Junta todos os dados em um único objeto para enviar ao serviço de e-mail
            const dadosCompletosPedido = {
                ...pedido,
                ...acompanhamentoResult.rows[0] // Adiciona etiqueta_nome, etc. ao objeto pedido
            };
            // Renomeia nfe_numero para consistência com a função automática
            dadosCompletosPedido.nfe_numero = pedido.numero_nfe; 

            // Passo 4: Chama o serviço para enviar o e-mail com os dados completos
            const serviceResponse = await gmailService.enviarEmailCobrancaManual(dadosCompletosPedido);
            
            res.status(200).json({ success: true, message: serviceResponse.message });

        } catch (error) {
            console.error(`[Rastreio Controller] Erro ao enviar e-mail de cobrança para o pedido ${id}:`, error);
            res.status(500).json({ message: error.message || "Erro interno ao enviar o e-mail." });
        }
    },

    getEmailHistory: async (req, res) => {
        const { id } = req.params;
        try {
            // Busca o histórico de e-mails associado ao ID do pedido de rastreamento
            const query = `
                SELECT * FROM email_history 
                WHERE pedido_rastreamento_id = $1 
                ORDER BY sent_at DESC
            `;
            const result = await poolInova.query(query, [id]);
            res.status(200).json(result.rows);
        } catch (error) {
            console.error(`[Rastreio Controller] Erro ao buscar histórico de e-mail para o pedido ${id}:`, error);
            res.status(500).json({ message: "Erro ao buscar histórico de e-mail." });
        }
    },

    resolveEmailThread: async (req, res) => {
        const { id } = req.params;
        try {
            // Atualiza o status do e-mail para 'Resolvido'
            const query = `
                UPDATE pedidos_em_rastreamento 
                SET email_status = 'Email - Resolvido' 
                WHERE id = $1
            `;
            await poolInova.query(query, [id]);
            res.status(200).json({ success: true, message: 'Status do e-mail atualizado para Resolvido.' });
        } catch (error) {
            console.error(`[Rastreio Controller] Erro ao resolver thread de e-mail para o pedido ${id}:`, error);
            res.status(500).json({ message: "Erro ao atualizar status do e-mail." });
        }
    },

    markEmailAsNotified: async (req, res) => {
        const { id } = req.params;
        try {
            // Define a flag de notificação como TRUE, indicando que o usuário viu a atualização
            const query = `
                UPDATE pedidos_em_rastreamento 
                SET notificado_por_email = TRUE 
                WHERE id = $1
            `;
            await poolInova.query(query, [id]);
            res.status(200).json({ success: true, message: 'Notificação de e-mail marcada como visualizada.' });
        } catch (error) {
            console.error(`[Rastreio Controller] Erro ao marcar e-mail como notificado para o pedido ${id}:`, error);
            res.status(500).json({ message: "Erro ao marcar notificação." });
        }
    }
}; 

module.exports = rastreioController;