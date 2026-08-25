/**
 * pedidosMlListaManager.js
 * Gerenciador da listagem de pedidos do Mercado Livre.
 * Estrutura, comportamento e estilo idênticos ao anunciosListaManager.js e promocoesListaManager.js.
 */
document.addEventListener('DOMContentLoaded', function () {
    // === ELEMENTOS DA DOM ===
    const tableBody = document.getElementById('table-body');
    const table = document.getElementById('tabela-estoque');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const buscaInput = document.getElementById('buscaGeral');
    const campoBuscaSelect = document.getElementById('campoBusca');
    const filtroPeriodo = document.getElementById('filtroPeriodo');
    const customDateRange = document.getElementById('customDateRange');
    const dataInicio = document.getElementById('dataInicio');
    const dataFim = document.getElementById('dataFim');
    const filtroEmpresa = document.getElementById('filtroEmpresa');
    const filtroSituacaoPrazo = document.getElementById('filtroSituacaoPrazo');
    const filtroSituacaoOperacional = document.getElementById('filtroSituacaoOperacional');
    const filtroTipoEnvio = document.getElementById('filtroTipoEnvio');
    const filtroLimite = document.getElementById('filtroLimite');
    const btnSincronizarPedidos = document.getElementById('btnSincronizarPedidos');
    const btnExportarPedidos = document.getElementById('btnExportarPedidos');
    const btnImprimirSelecionados = document.getElementById('btnImprimirSelecionados');
    const countSelecionados = document.getElementById('countSelecionados');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    // KPIs
    const kpiTotalPedidos = document.getElementById('kpi-total-pedidos');
    const kpiValorTotal = document.getElementById('kpi-valor-total');
    const kpiAtrasados = document.getElementById('kpi-atrasados');
    const kpiParaHoje = document.getElementById('kpi-para-hoje');
    const kpiFuturos = document.getElementById('kpi-futuros');
    const kpiSemNf = document.getElementById('kpi-sem-nf');
    const kpiProntoImprimir = document.getElementById('kpi-pronto-imprimir');
    const kpiEmTransito = document.getElementById('kpi-em-transito');
    const kpiPosVenda = document.getElementById('kpi-pos-venda');

    // Modais
    const modalDetalhesOverlay = document.getElementById('modalDetalhesOverlay');
    const modalDetalhes = document.getElementById('modalDetalhesPedido');
    const btnCloseDetalhes = document.getElementById('btnCloseDetalhesModal');
    const btnFecharDetalhes = document.getElementById('btnFecharDetalhesModal');
    const btnModalImprimirZpl = document.getElementById('btnModalImprimirZpl');

    const modalZplOverlay = document.getElementById('modalZplOverlay');
    const modalZpl = document.getElementById('modalEtiquetaZpl');
    const btnCloseZpl = document.getElementById('btnCloseZplModal');
    const btnFecharZpl = document.getElementById('btnFecharZplModal');
    const btnCopiarZpl = document.getElementById('btnCopiarZpl');
    const modalZplContent = document.getElementById('modalZplContent');

    // === ESTADO ===
    let currentPage = 1;
    let pageLimit = 50;
    let orderBy = 'data_pedido';
    let orderDir = 'DESC';
    let debounceTimer = null;
    let rawPedidosList = [];
    let columnExcelFilters = {}; // { colKey: Set([val1, val2...]) }
    let activeDropdownMenu = null;
    let clickTimer = null;
    let selectedOrderIds = new Set();
    let currentActiveKpi = null;

    // Ordem Padrão das Colunas
    const DEFAULT_COLUMN_ORDER = [
        'checkbox',
        'empresa',
        'id_pedido_ml',
        'id_envio_ml',
        'data_pedido',
        'situacao_prazo',
        'situacao_operacional',
        'status_pedido',
        'status_envio',
        'tipo_envio',
        'comprador_nickname',
        'skus_resumo',
        'quantidade_total_itens',
        'valor_total',
        'frete_envio',
        'nfe_numero',
        'status_dev',
        'status_med',
        'data_limite_envio',
        'data_envio_agendado',
        'data_previsao_entrega'
    ];

    const COLUMN_LABELS = {
        'checkbox': 'Seleção',
        'empresa': 'Empresa / Loja',
        'id_pedido_ml': 'ID Pedido',
        'id_envio_ml': 'ID Envio',
        'data_pedido': 'Data Venda',
        'situacao_prazo': 'Prazo Coleta',
        'situacao_operacional': 'Situação Operacional',
        'status_pedido': 'Status Pedido',
        'status_envio': 'Status Envio',
        'tipo_envio': 'Tipo Logística',
        'comprador_nickname': 'Comprador',
        'skus_resumo': 'Produtos / SKUs',
        'quantidade_total_itens': 'Qtd Itens',
        'valor_total': 'Valor Total',
        'frete_envio': 'Frete',
        'nfe_numero': 'NF-e',
        'status_dev': 'Devolução',
        'status_med': 'Mediação',
        'data_limite_envio': 'Limite Coleta',
        'data_envio_agendado': 'Agendado',
        'data_previsao_entrega': 'Previsão Entrega'
    };

    const DEFAULT_COLUMN_WIDTHS = {
        'checkbox': 45,
        'empresa': 140,
        'id_pedido_ml': 165,
        'id_envio_ml': 150,
        'data_pedido': 140,
        'situacao_prazo': 155,
        'situacao_operacional': 175,
        'status_pedido': 110,
        'status_envio': 120,
        'tipo_envio': 125,
        'comprador_nickname': 155,
        'skus_resumo': 250,
        'quantidade_total_itens': 75,
        'valor_total': 120,
        'frete_envio': 100,
        'nfe_numero': 135,
        'status_dev': 130,
        'status_med': 130,
        'data_limite_envio': 140,
        'data_envio_agendado': 140,
        'data_previsao_entrega': 140
    };

    let currentColumnOrder = [...DEFAULT_COLUMN_ORDER];
    let currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS };

    // === HELPERS DE FORMATAÇÃO E ESCAPE ===
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatNumberPtBr(val) {
        const num = Number(val) || 0;
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatRelativeOrAbsoluteDate(dateObj) {
        if (!dateObj || isNaN(dateObj.getTime())) return '-';
        return dateObj.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function formatTipoEnvio(type) {
        if (!type) return 'Padrão';
        switch (String(type).toLowerCase()) {
            case 'cross_docking': return 'Cross Docking';
            case 'fulfillment': return 'Full';
            case 'self_service': return 'Flex';
            case 'drop_off': return 'Drop Off';
            case 'xd_drop_off': return 'XD Drop Off';
            case 'me2': return 'ME2';
            default: return type;
        }
    }

    function renderPrazoBadge(p) {
        const situacao = p.situacao_prazo || 'para_hoje';
        switch (situacao) {
            case 'atrasado':
                return `<span class="badge-prazo-pedido atrasado"><i class="fas fa-exclamation-triangle"></i> Atrasado</span>`;
            case 'para_hoje':
                return `<span class="badge-prazo-pedido para_hoje"><i class="fas fa-clock"></i> Enviar Hoje</span>`;
            case 'futuro_agendado':
                let diasRestantes = '';
                if (p.data_limite_envio) {
                    const diffDays = Math.ceil((new Date(p.data_limite_envio) - new Date()) / (1000 * 60 * 60 * 24));
                    if (diffDays > 0) diasRestantes = ` (${diffDays}d)`;
                }
                return `<span class="badge-prazo-pedido futuro_agendado"><i class="fas fa-calendar-check"></i> Futuro${diasRestantes}</span>`;
            case 'despachado':
                return `<span class="badge-prazo-pedido despachado"><i class="fas fa-truck"></i> Despachado</span>`;
            case 'entregue':
                return `<span class="badge-prazo-pedido entregue"><i class="fas fa-check-circle"></i> Entregue</span>`;
            case 'cancelado':
                return `<span class="badge-prazo-pedido cancelado"><i class="fas fa-ban"></i> Cancelado</span>`;
            default:
                return `<span class="badge bg-secondary">${escapeHtml(situacao)}</span>`;
        }
    }

    function renderOperacionalBadge(p) {
        const op = p.situacao_operacional || 'nf_a_gerenciar';
        switch (op) {
            case 'nf_a_gerenciar':
                return `<span class="badge-operacional-pedido nf_a_gerenciar"><i class="fas fa-file-invoice"></i> NF a Gerenciar</span>`;
            case 'com_nota_sem_etiqueta':
                return `<span class="badge-operacional-pedido com_nota_sem_etiqueta"><i class="fas fa-tag"></i> Com NF s/ Etiqueta</span>`;
            case 'etiquetas_para_imprimir':
                return `<span class="badge-operacional-pedido etiquetas_para_imprimir"><i class="fas fa-print"></i> Pronto p/ Imprimir</span>`;
            case 'pronto_para_envio':
                return `<span class="badge-operacional-pedido pronto_para_envio"><i class="fas fa-box"></i> Pronto p/ Despacho</span>`;
            case 'a_caminho':
                return `<span class="badge-operacional-pedido a_caminho"><i class="fas fa-truck"></i> Em Trânsito</span>`;
            case 'entregue':
                return `<span class="badge-operacional-pedido entregue"><i class="fas fa-check"></i> Entregue</span>`;
            case 'devolucao':
                return `<span class="badge-operacional-pedido devolucao"><i class="fas fa-undo"></i> Em Devolução</span>`;
            case 'reclamacao':
                return `<span class="badge-operacional-pedido reclamacao"><i class="fas fa-exclamation-circle"></i> Em Mediação</span>`;
            case 'cancelado':
                return `<span class="badge-operacional-pedido cancelado"><i class="fas fa-times"></i> Cancelado</span>`;
            default:
                return `<span class="badge bg-secondary">${escapeHtml(op)}</span>`;
        }
    }

    // === RENDERIZADORES DE CÉLULAS POR COLUNA ===
    const COLUMN_RENDERERS = {
        'checkbox': (p) => {
            if (p.tem_etiqueta) {
                return `<input type="checkbox" class="form-check-input pedido-row-cb" data-id="${p.id_pedido_ml}" ${selectedOrderIds.has(String(p.id_pedido_ml)) ? 'checked' : ''}>`;
            }
            return '';
        },
        'empresa': (p) => {
            const emp = p.empresa || 'Loja ML';
            const empClass = emp.toLowerCase().includes('lucas') ? 'lucas' : (emp.toLowerCase().includes('eliane') ? 'eliane' : '');
            return `<span class="badge-loja ${empClass}">${escapeHtml(emp)}</span>`;
        },
        'id_pedido_ml': (p) => `
            <span class="font-monospace text-primary fw-bold">${escapeHtml(p.id_pedido_ml)}</span>
            <button type="button" class="btn-copy-quick" data-copy="${escapeHtml(p.id_pedido_ml)}" title="Copiar ID do pedido">
                <i class="far fa-copy"></i>
            </button>
        `,
        'id_envio_ml': (p) => {
            if (!p.id_envio_ml) return '<span class="text-muted">-</span>';
            return `
                <span class="font-monospace">${escapeHtml(p.id_envio_ml)}</span>
                <button type="button" class="btn-copy-quick" data-copy="${escapeHtml(p.id_envio_ml)}" title="Copiar ID de envio">
                    <i class="far fa-copy"></i>
                </button>
            `;
        },
        'data_pedido': (p) => {
            if (!p.data_pedido) return '<span class="text-muted">-</span>';
            const d = new Date(p.data_pedido);
            return `<span title="${d.toLocaleString('pt-BR')}">${formatRelativeOrAbsoluteDate(d)}</span>`;
        },
        'situacao_prazo': (p) => renderPrazoBadge(p),
        'situacao_operacional': (p) => renderOperacionalBadge(p),
        'status_pedido': (p) => `<span class="badge bg-dark border">${escapeHtml(p.status_pedido || '-')}</span>`,
        'status_envio': (p) => `<span class="badge bg-dark border">${escapeHtml(p.status_envio || '-')}</span>`,
        'tipo_envio': (p) => `<span class="text-muted small">${escapeHtml(formatTipoEnvio(p.tipo_envio))}</span>`,
        'comprador_nickname': (p) => `<span title="${escapeHtml(p.comprador_nome || p.comprador_nickname)}">${escapeHtml(p.comprador_nickname || '-')}</span>`,
        'skus_resumo': (p) => {
            const rawTxt = p.skus_resumo || p.sku_principal || '-';
            const txt = rawTxt.replace(/(^|,\s*)\d+x\s+/g, '$1'); // Remove quantities like "2x "
            return `<span class="sku-summary-chip" title="${escapeHtml(txt)}">${escapeHtml(txt)}</span>`;
        },
        'quantidade_total_itens': (p) => `<span class="badge bg-secondary">${Number(p.quantidade_total_itens) || 1}</span>`,
        'valor_total': (p) => `<strong class="text-success">R$ ${formatNumberPtBr(p.valor_total)}</strong>`,
        'frete_envio': (p) => `<span>R$ ${formatNumberPtBr(p.frete_envio)}</span>`,
        'nfe_numero': (p) => {
            if (!p.nfe_numero) return '<span class="text-muted small">Sem NF</span>';
            return `
                <span class="font-monospace fw-bold">${escapeHtml(p.nfe_numero)}</span>
                <button type="button" class="btn-copy-quick" data-copy="${escapeHtml(p.nfe_numero)}" title="Copiar NF">
                    <i class="far fa-copy"></i>
                </button>
            `;
        },
        'status_dev': (p) => {
            if (!p.tem_dev) return '<span class="text-muted small">-</span>';
            const status = p.status_dev || 'Em Aberto';
            return `<span class="badge bg-warning text-dark border">${escapeHtml(status)}</span>`;
        },
        'status_med': (p) => {
            if (!p.tem_med) return '<span class="text-muted small">-</span>';
            const status = p.status_med || 'Em Aberto';
            return `<span class="badge bg-danger border">${escapeHtml(status)}</span>`;
        },
        'data_limite_envio': (p) => {
            if (!p.data_limite_envio) return '<span class="text-muted">-</span>';
            const d = new Date(p.data_limite_envio);
            return `<span title="${d.toLocaleString('pt-BR')}">${d.toLocaleDateString('pt-BR')}</span>`;
        },
        'data_envio_agendado': (p) => {
            if (!p.data_envio_agendado) return '<span class="text-muted">-</span>';
            const d = new Date(p.data_envio_agendado);
            return `<span title="${d.toLocaleString('pt-BR')}">${d.toLocaleDateString('pt-BR')}</span>`;
        },
        'data_previsao_entrega': (p) => {
            if (!p.data_previsao_entrega) return '<span class="text-muted">-</span>';
            const d = new Date(p.data_previsao_entrega);
            return `<span title="${d.toLocaleString('pt-BR')}">${d.toLocaleDateString('pt-BR')}</span>`;
        }
    };

    function getColumnTextValue(p, colKey) {
        switch (colKey) {
            case 'empresa': return p.empresa || 'Loja ML';
            case 'id_pedido_ml': return String(p.id_pedido_ml || '');
            case 'id_envio_ml': return String(p.id_envio_ml || '');
            case 'data_pedido': return p.data_pedido ? new Date(p.data_pedido).toLocaleDateString('pt-BR') : '';
            case 'situacao_prazo': return p.situacao_prazo || '';
            case 'situacao_operacional': return p.situacao_operacional || '';
            case 'status_pedido': return p.status_pedido || '';
            case 'status_envio': return p.status_envio || '';
            case 'tipo_envio': return formatTipoEnvio(p.tipo_envio);
            case 'comprador_nickname': return p.comprador_nickname || '';
            case 'skus_resumo': return p.skus_resumo || p.sku_principal || '';
            case 'quantidade_total_itens': return String(p.quantidade_total_itens || '1');
            case 'valor_total': return String(p.valor_total || '0');
            case 'frete_envio': return String(p.frete_envio || '0');
            case 'nfe_numero': return p.nfe_numero || 'Sem NF';
            case 'etiqueta_status': return p.tem_etiqueta ? 'Com Etiqueta' : (p.tem_nfe ? 'Aguardando' : 'Sem Etiqueta');
            default: return String(p[colKey] || '');
        }
    }

    // === NOTIFICAÇÃO TOAST ===
    const showToast = (message) => {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    };

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================
    const loadPedidos = async () => {
        if (!tableBody) return;
        tableBody.innerHTML = `
            <tr>
                <td colspan="21" class="text-center py-5">
                    <div class="loading-spinner-container">
                        <i class="fas fa-spinner fa-spin fa-2x text-accent mb-2"></i>
                        <div class="text-muted">Carregando pedidos do Mercado Livre...</div>
                    </div>
                </td>
            </tr>
        `;

        try {
            const params = new URLSearchParams({
                all: 'true',
                orderBy: orderBy,
                orderDir: orderDir
            });

            const periodo = filtroPeriodo ? filtroPeriodo.value : '30dias';
            if (periodo === 'personalizado') {
                if (dataInicio && dataInicio.value) params.set('data_inicio', dataInicio.value);
                if (dataFim && dataFim.value) params.set('data_fim', dataFim.value);
            } else {
                params.set('periodo', periodo);
            }

            const busca = buscaInput ? buscaInput.value.trim() : '';
            if (busca) {
                params.set('busca', busca);
                params.set('campo_busca', campoBuscaSelect ? campoBuscaSelect.value : 'geral');
            }

            if (filtroEmpresa && filtroEmpresa.value) params.set('empresa', filtroEmpresa.value);
            if (filtroSituacaoPrazo && filtroSituacaoPrazo.value) params.set('situacao_prazo', filtroSituacaoPrazo.value);
            if (filtroSituacaoOperacional && filtroSituacaoOperacional.value) params.set('situacao_operacional', filtroSituacaoOperacional.value);
            if (filtroTipoEnvio && filtroTipoEnvio.value) params.set('tipo_envio', filtroTipoEnvio.value);

            if (currentActiveKpi) {
                if (currentActiveKpi.filterPrazo) params.set('situacao_prazo', currentActiveKpi.filterPrazo);
                if (currentActiveKpi.filterOp) params.set('situacao_operacional', currentActiveKpi.filterOp);
                if (currentActiveKpi.filterPos) params.set('pos_venda', 'true');
            }

            const response = await fetch(`/api/pedidos-ml?${params.toString()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            rawPedidosList = data.data || data.pedidos || [];

            if (filtroEmpresa && filtroEmpresa.options.length <= 1 && Array.isArray(data.empresas)) {
                data.empresas.forEach(emp => {
                    const opt = document.createElement('option');
                    opt.value = emp;
                    opt.textContent = emp;
                    filtroEmpresa.appendChild(opt);
                });
            }

            updateKpis(data.kpis || {});
            applyExcelFiltersAndRender();

        } catch (error) {
            console.error('[PedidosML] Erro ao carregar pedidos:', error);
            tableBody.innerHTML = `
                <tr>
                    <td colspan="21" class="text-center py-5 text-danger">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                        <div>Erro ao carregar pedidos. Verifique sua conexão e tente novamente.</div>
                    </td>
                </tr>
            `;
        }
    };

    const updateKpis = (kpis) => {
        if (kpiTotalPedidos) kpiTotalPedidos.textContent = kpis.total_pedidos || 0;
        if (kpiValorTotal) kpiValorTotal.textContent = `R$ ${formatNumberPtBr(kpis.valor_total || 0)}`;
        if (kpiAtrasados) kpiAtrasados.textContent = kpis.atrasados || 0;
        if (kpiParaHoje) kpiParaHoje.textContent = kpis.para_hoje || 0;
        if (kpiFuturos) kpiFuturos.textContent = kpis.futuros || 0;
        if (kpiSemNf) kpiSemNf.textContent = kpis.sem_nf || 0;
        if (kpiProntoImprimir) kpiProntoImprimir.textContent = kpis.pronto_imprimir || 0;
        if (kpiEmTransito) kpiEmTransito.textContent = kpis.em_transito || 0;
        if (kpiPosVenda) kpiPosVenda.textContent = kpis.pos_venda || 0;
    };

    // =============================================
    // === FILTRAGEM EXCEL EM MEMÓRIA & RENDER ===
    // =============================================
    const applyExcelFiltersAndRender = () => {
        let filtered = [...rawPedidosList];

        const activeCols = Object.keys(columnExcelFilters);
        if (activeCols.length > 0) {
            filtered = filtered.filter(item => {
                return activeCols.every(colKey => {
                    const allowedSet = columnExcelFilters[colKey];
                    if (!allowedSet || allowedSet.size === 0) return true;
                    const val = getColumnTextValue(item, colKey);
                    return allowedSet.has(val);
                });
            });
        }

        filtered.sort((a, b) => {
            let valA = a[orderBy];
            let valB = b[orderBy];

            if (valA == null) return 1;
            if (valB == null) return -1;

            if (typeof valA === 'number' && typeof valB === 'number') {
                return orderDir === 'ASC' ? valA - valB : valB - valA;
            }

            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return orderDir === 'ASC' ? -1 : 1;
            if (valA > valB) return orderDir === 'ASC' ? 1 : -1;
            return 0;
        });

        const total = filtered.length;
        const totalPages = Math.ceil(total / pageLimit) || 1;
        if (currentPage > totalPages) currentPage = 1;

        const startIndex = (currentPage - 1) * pageLimit;
        const pageItems = filtered.slice(startIndex, startIndex + pageLimit);

        renderTableBody(pageItems);
        renderPagination(total, totalPages);
        updateBatchActionBar();
    };

    const renderTableBody = (items) => {
        if (!tableBody) return;

        if (items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="21" class="text-center py-5 text-muted">
                        <i class="fas fa-box-open fa-2x mb-2"></i>
                        <div>Nenhum pedido encontrado.</div>
                    </td>
                </tr>
            `;
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const rowsHtml = items.map(p => {
            const isSelected = selectedOrderIds.has(String(p.id_pedido_ml));
            const rowClass = isSelected ? 'row-selected' : '';

            const cellsHtml = currentColumnOrder.map(colKey => {
                const renderer = COLUMN_RENDERERS[colKey] || ((item) => escapeHtml(item[colKey] || '-'));
                const cellContent = renderer(p);
                const alignClass = ['valor_total', 'frete_envio'].includes(colKey) ? 'text-end' :
                    (['situacao_prazo', 'situacao_operacional', 'status_pedido', 'status_envio', 'tipo_envio', 'quantidade_total_itens', 'etiqueta_status', 'data_limite_envio', 'data_envio_agendado', 'data_previsao_entrega', 'checkbox', 'acoes'].includes(colKey) ? 'text-center' : '');

                return `<td class="${alignClass}" data-col="${colKey}">${cellContent}</td>`;
            }).join('');

            return `<tr class="${rowClass}" data-id="${p.id_pedido_ml}">${cellsHtml}</tr>`;
        }).join('');

        tableBody.innerHTML = rowsHtml;
        applyColumnWidthsDOM();
    };

    const renderPagination = (totalItems, totalPages) => {
        if (!paginationContainer) return;
        
        if (totalPages <= 1) {
            paginationContainer.innerHTML = totalItems > 0
                ? `<span class="pagination-info">${totalItems} pedido(s) encontrado(s)</span>`
                : '';
            return;
        }

        let html = '';

        // Botão anterior
        html += `<button ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
                    <i class="fas fa-chevron-left"></i>
                 </button>`;

        // Páginas
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            html += `<button data-page="1">1</button>`;
            if (startPage > 2) html += `<span class="pagination-info">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${totalPages}">${totalPages}</button>`;
        }

        // Botão próximo
        html += `<button ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
                    <i class="fas fa-chevron-right"></i>
                 </button>`;

        paginationContainer.innerHTML = html;
    };

    // =============================================
    // === FILTRO COMBOBOX EXCEL NO CABEÇALHO <th> ===
    // =============================================
    const openColumnFilterMenu = (thElement) => {
        const colKey = thElement.dataset.column;
        if (!colKey || colKey === 'checkbox' || colKey === 'acoes') return;

        if (activeDropdownMenu) {
            activeDropdownMenu.remove();
            activeDropdownMenu = null;
        }

        const valueCounts = {};
        rawPedidosList.forEach(item => {
            const val = getColumnTextValue(item, colKey) || '(Vazio)';
            valueCounts[val] = (valueCounts[val] || 0) + 1;
        });

        const uniqueValues = Object.keys(valueCounts).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        const currentSelected = columnExcelFilters[colKey] || new Set(uniqueValues);

        const dropdown = document.createElement('div');
        dropdown.className = 'excel-filter-dropdown';
        dropdown.innerHTML = `
            <div style="font-weight: 600; font-size: 0.82rem; margin-bottom: 6px; color: var(--accent-orange, #f07c00);">
                Filtrar: ${COLUMN_LABELS[colKey] || colKey}
            </div>
            <input type="text" class="excel-filter-search" placeholder="Pesquisar..." />
            <div class="excel-filter-quick-actions">
                <button type="button" class="excel-filter-quick-btn btn-select-all">Marcar Tudo</button>
                <button type="button" class="excel-filter-quick-btn btn-clear-all">Desmarcar Tudo</button>
            </div>
            <div class="excel-filter-list">
                ${uniqueValues.map((val, idx) => {
                    const isChecked = currentSelected.has(val);
                    const safeId = `filter_opt_${colKey}_${idx}`;
                    return `
                        <div class="excel-filter-item">
                            <input type="checkbox" id="${safeId}" value="${escapeHtml(val)}" ${isChecked ? 'checked' : ''} />
                            <label for="${safeId}" class="excel-filter-item-label" title="${escapeHtml(val)}">${escapeHtml(val)}</label>
                            <span class="excel-filter-item-count">(${valueCounts[val]})</span>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="excel-filter-footer">
                <button type="button" class="excel-filter-btn excel-filter-btn-clear">Limpar</button>
                <button type="button" class="excel-filter-btn excel-filter-btn-apply">Aplicar</button>
            </div>
        `;

        document.body.appendChild(dropdown);
        activeDropdownMenu = dropdown;

        const rect = thElement.getBoundingClientRect();
        let top = rect.bottom + window.scrollY + 4;
        let left = rect.left + window.scrollX;

        if (left + 270 > window.innerWidth) {
            left = window.innerWidth - 280;
        }

        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;

        const searchInput = dropdown.querySelector('.excel-filter-search');
        const filterList = dropdown.querySelector('.excel-filter-list');
        const items = filterList.querySelectorAll('.excel-filter-item');
        const btnSelectAll = dropdown.querySelector('.btn-select-all');
        const btnClearAll = dropdown.querySelector('.btn-clear-all');
        const btnApply = dropdown.querySelector('.excel-filter-btn-apply');
        const btnClear = dropdown.querySelector('.excel-filter-btn-clear');

        searchInput.focus();

        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase().trim();
            items.forEach(item => {
                const label = item.querySelector('.excel-filter-item-label').textContent.toLowerCase();
                item.style.display = label.includes(term) ? 'flex' : 'none';
            });
        });

        btnSelectAll.addEventListener('click', () => {
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input[type="checkbox"]').checked = true;
                }
            });
        });

        btnClearAll.addEventListener('click', () => {
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input[type="checkbox"]').checked = false;
                }
            });
        });

        btnApply.addEventListener('click', () => {
            const checkedBoxes = filterList.querySelectorAll('input[type="checkbox"]:checked');
            const newSelectedSet = new Set();
            checkedBoxes.forEach(box => newSelectedSet.add(box.value));

            if (newSelectedSet.size === uniqueValues.length) {
                delete columnExcelFilters[colKey];
            } else {
                columnExcelFilters[colKey] = newSelectedSet;
            }

            updateTableHeaderFilterIcons();
            currentPage = 1;
            applyExcelFiltersAndRender();
            closeDropdown();
        });

        btnClear.addEventListener('click', () => {
            delete columnExcelFilters[colKey];
            updateTableHeaderFilterIcons();
            currentPage = 1;
            applyExcelFiltersAndRender();
            closeDropdown();
        });

        const closeDropdown = () => {
            if (activeDropdownMenu) {
                activeDropdownMenu.remove();
                activeDropdownMenu = null;
            }
        };

        setTimeout(() => {
            const clickOutsideHandler = (e) => {
                if (activeDropdownMenu && !activeDropdownMenu.contains(e.target) && !thElement.contains(e.target)) {
                    closeDropdown();
                    document.removeEventListener('click', clickOutsideHandler);
                }
            };
            document.addEventListener('click', clickOutsideHandler);
        }, 50);
    };

    const updateTableHeaderFilterIcons = () => {
        const ths = document.querySelectorAll('#tabela-estoque thead th');
        ths.forEach(th => {
            const colKey = th.dataset.column;
            if (colKey && columnExcelFilters[colKey] && columnExcelFilters[colKey].size > 0) {
                th.classList.add('filter-active');
            } else {
                th.classList.remove('filter-active');
            }
        });
    };

    // =============================================
    // === REORDENAÇÃO & REDIMENSIONAMENTO DE COLUNAS ===
    // =============================================
    const applyColumnWidthsDOM = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr || !table) return;

        table.style.tableLayout = 'fixed';

        const allThs = Array.from(theadTr.querySelectorAll('th'));
        allThs.forEach((th, thIdx) => {
            const colKey = th.dataset.column;
            if (!colKey) return;

            const widthVal = currentColumnWidths[colKey] !== undefined ? currentColumnWidths[colKey] : DEFAULT_COLUMN_WIDTHS[colKey];
            const isCollapsed = widthVal != null && widthVal <= 16;

            if (isCollapsed) {
                th.classList.add('is-col-collapsed');
                th.style.width = '6px';
                th.style.minWidth = '6px';
                th.style.maxWidth = '6px';
                th.title = `Coluna "${COLUMN_LABELS[colKey] || colKey}" oculta. Dê duplo clique no separador para restaurar.`;
            } else {
                th.classList.remove('is-col-collapsed');
                const finalW = Math.max(30, widthVal || DEFAULT_COLUMN_WIDTHS[colKey] || 100);
                th.style.width = finalW + 'px';
                th.style.minWidth = finalW + 'px';
                th.style.maxWidth = finalW + 'px';
                th.title = '';
            }

            const colTds = document.querySelectorAll(`#tabela-estoque tbody tr td:nth-child(${thIdx + 1})`);
            colTds.forEach(td => {
                if (isCollapsed) {
                    td.classList.add('is-col-collapsed');
                    td.style.width = '6px';
                    td.style.maxWidth = '6px';
                } else {
                    td.classList.remove('is-col-collapsed');
                    td.style.width = '';
                    td.style.maxWidth = '';
                }
            });
        });
    };

    const fetchColumnPreferences = async () => {
        try {
            const res = await fetch('/api/pedidos-ml/column-preferences');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.column_order) && data.column_order.length > 0) {
                    const defaultSet = new Set(DEFAULT_COLUMN_ORDER);
                    const validLoadedCols = data.column_order.filter(col => defaultSet.has(col));
                    const loadedSet = new Set(validLoadedCols);
                    const missing = DEFAULT_COLUMN_ORDER.filter(col => !loadedSet.has(col));
                    currentColumnOrder = [...validLoadedCols, ...missing];
                }
                if (data.column_widths && typeof data.column_widths === 'object') {
                    currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS, ...data.column_widths };
                }
            }
        } catch (err) {
            console.warn('[PedidosML] Falha ao carregar preferências de colunas:', err);
        }
        reorderTableHeaderDOM();
        applyColumnWidthsDOM();
        setupColumnResize();
        setupColumnDragAndDrop();
    };

    let savePreferencesTimer = null;
    const saveColumnPreferencesToServer = (showToastMsg = false) => {
        if (savePreferencesTimer) clearTimeout(savePreferencesTimer);
        savePreferencesTimer = setTimeout(async () => {
            try {
                await fetch('/api/pedidos-ml/column-preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        column_order: currentColumnOrder,
                        column_widths: currentColumnWidths
                    })
                });
                if (showToastMsg) {
                    showToast('Personalização da tabela salva!');
                }
            } catch (err) {
                console.error('[PedidosML] Erro ao salvar preferências de colunas:', err);
            }
        }, 300);
    };

    const reorderTableHeaderDOM = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const thMap = {};
        const allThs = Array.from(theadTr.querySelectorAll('th'));
        allThs.forEach(th => {
            const colKey = th.dataset.column;
            if (colKey) thMap[colKey] = th;
        });

        currentColumnOrder.forEach(colKey => {
            if (thMap[colKey]) {
                theadTr.appendChild(thMap[colKey]);
            }
        });
    };

    // Redimensionamento de colunas
    const setupColumnResize = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const allThs = theadTr.querySelectorAll('th');
        allThs.forEach((th, thIdx) => {
            const colKey = th.dataset.column;
            if (!colKey || colKey === 'checkbox') return;

            const existingResizer = th.querySelector('.col-resizer');
            if (existingResizer) existingResizer.remove();

            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            resizer.title = 'Arraste para redimensionar. Dê duplo clique para restaurar tamanho padrão.';
            th.appendChild(resizer);

            resizer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const defaultW = DEFAULT_COLUMN_WIDTHS[colKey] || 130;
                currentColumnWidths[colKey] = defaultW;
                applyColumnWidthsDOM();
                saveColumnPreferencesToServer(true);
                showToast(`Coluna "${COLUMN_LABELS[colKey] || colKey}" restaurada!`);
            });

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const startX = e.pageX;
                const startWidth = th.offsetWidth;
                document.body.classList.add('is-column-resizing');
                resizer.classList.add('is-resizing');

                const onMouseMove = (moveEvent) => {
                    const diff = moveEvent.pageX - startX;
                    const calculatedWidth = startWidth + diff;

                    if (calculatedWidth <= 16) {
                        th.classList.add('is-col-collapsed');
                        th.style.width = '6px';
                        th.style.minWidth = '6px';
                        th.style.maxWidth = '6px';
                        currentColumnWidths[colKey] = 6;
                    } else {
                        th.classList.remove('is-col-collapsed');
                        const finalW = Math.max(25, calculatedWidth);
                        th.style.width = finalW + 'px';
                        th.style.minWidth = finalW + 'px';
                        th.style.maxWidth = finalW + 'px';
                        currentColumnWidths[colKey] = finalW;
                    }

                    const colIndex = Array.from(theadTr.children).indexOf(th);
                    if (colIndex !== -1) {
                        const colTds = document.querySelectorAll(`#tabela-estoque tbody tr td:nth-child(${colIndex + 1})`);
                        colTds.forEach(td => {
                            if (calculatedWidth <= 16) {
                                td.classList.add('is-col-collapsed');
                                td.style.width = '6px';
                                td.style.maxWidth = '6px';
                            } else {
                                td.classList.remove('is-col-collapsed');
                                td.style.width = '';
                                td.style.maxWidth = '';
                            }
                        });
                    }
                };

                const onMouseUp = () => {
                    document.body.classList.remove('is-column-resizing');
                    resizer.classList.remove('is-resizing');
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);

                    applyColumnWidthsDOM();
                    saveColumnPreferencesToServer(true);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        });
    };

    // =============================================
    // === REORDENAÇÃO DE COLUNAS VIA DRAG & DROP ===
    // =============================================
    let draggedTh = null;
    let dragSourceColKey = null;

    const setupColumnDragAndDrop = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const allThs = theadTr.querySelectorAll('th');
        allThs.forEach(th => {
            const colKey = th.dataset.column;
            if (!colKey || colKey === 'checkbox') return;

            // Suporte a cliques de ordenação e duplo clique para filtro
            th.onclick = (e) => {
                if (e.target.closest('.col-resizer')) return;
                if (clickTimer) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    handleSort(colKey);
                }, 220);
            };

            th.ondblclick = (e) => {
                if (e.target.closest('.col-resizer')) return;
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }
                e.preventDefault();
                e.stopPropagation();
                openColumnFilterMenu(th);
            };

            // HTML5 Drag & Drop Nativo
            th.setAttribute('draggable', 'true');

            th.ondragstart = (e) => {
                if (e.target.closest('.col-resizer')) {
                    e.preventDefault();
                    return;
                }
                draggedTh = th;
                dragSourceColKey = colKey;
                th.classList.add('column-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', colKey);
            };

            th.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedTh && th !== draggedTh) {
                    th.classList.add('column-drag-over');
                }
            };

            th.ondragleave = () => {
                th.classList.remove('column-drag-over');
            };

            th.ondrop = (e) => {
                e.preventDefault();
                th.classList.remove('column-drag-over');
                if (draggedTh && th !== draggedTh) {
                    const targetColKey = th.dataset.column;
                    if (!targetColKey || !dragSourceColKey) return;

                    const fromIdx = currentColumnOrder.indexOf(dragSourceColKey);
                    const toIdx = currentColumnOrder.indexOf(targetColKey);

                    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                        currentColumnOrder.splice(fromIdx, 1);
                        currentColumnOrder.splice(toIdx, 0, dragSourceColKey);

                        reorderTableHeaderDOM();
                        setupColumnResize();
                        setupColumnDragAndDrop();
                        applyColumnWidthsDOM();
                        applyExcelFiltersAndRender();
                        saveColumnPreferencesToServer(true);
                    }
                }
            };

            th.ondragend = () => {
                if (draggedTh) {
                    draggedTh.classList.remove('column-dragging');
                }
                allThs.forEach(t => t.classList.remove('column-drag-over'));
                draggedTh = null;
                dragSourceColKey = null;
            };
        });
    };

    const handleSort = (colKey) => {
        if (orderBy === colKey) {
            orderDir = orderDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            orderBy = colKey;
            orderDir = 'ASC';
        }
        currentPage = 1;
        applyExcelFiltersAndRender();
    };

    // =============================================
    // === MULTI-SELEÇÃO & IMPRESSÃO DE ETIQUETAS ===
    // =============================================
    let isPrintMode = false;
    const btnCancelarImpressao = document.getElementById('btnCancelarImpressao');

    const togglePrintMode = (active) => {
        isPrintMode = active;
        const table = document.getElementById('tabela-estoque');
        if (active) {
            if (table) table.classList.add('print-mode-active');
            if (btnCancelarImpressao) btnCancelarImpressao.style.display = 'inline-flex';
            updateBatchActionBar();
        } else {
            if (table) table.classList.remove('print-mode-active');
            if (btnCancelarImpressao) btnCancelarImpressao.style.display = 'none';
            selectedOrderIds.clear();
            document.querySelectorAll('.pedido-row-cb').forEach(cb => cb.checked = false);
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            document.querySelectorAll('#tabela-estoque tbody tr').forEach(tr => tr.classList.remove('row-selected'));
            if (btnImprimirSelecionados) {
                btnImprimirSelecionados.innerHTML = `<i class="fas fa-print me-2"></i>Imprimir Etiquetas`;
                btnImprimirSelecionados.classList.remove('btn-accent');
                btnImprimirSelecionados.classList.add('btn-outline-accent');
                btnImprimirSelecionados.disabled = false;
            }
        }
    };

    if (btnCancelarImpressao) {
        btnCancelarImpressao.addEventListener('click', () => togglePrintMode(false));
    }

    const updateBatchActionBar = () => {
        if (!isPrintMode) return;
        const count = selectedOrderIds.size;
        
        if (btnImprimirSelecionados) {
            btnImprimirSelecionados.disabled = count === 0;
            btnImprimirSelecionados.innerHTML = `<i class="fas fa-check me-2"></i>Confirmar Impressão (<span id="countSelecionados">${count}</span>)`;
            if (count > 0) {
                btnImprimirSelecionados.classList.add('btn-accent');
                btnImprimirSelecionados.classList.remove('btn-outline-accent');
            } else {
                btnImprimirSelecionados.classList.remove('btn-accent');
                btnImprimirSelecionados.classList.add('btn-outline-accent');
            }
        }

        if (selectAllCheckbox) {
            const rowCbs = document.querySelectorAll('.pedido-row-cb');
            if (rowCbs.length > 0) {
                const allChecked = Array.from(rowCbs).every(cb => cb.checked);
                selectAllCheckbox.checked = allChecked;
            }
        }
    };

    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', () => {
            const isChecked = selectAllCheckbox.checked;
            document.querySelectorAll('.pedido-row-cb').forEach(cb => {
                cb.checked = isChecked;
                const id = String(cb.dataset.id);
                const tr = cb.closest('tr');
                if (isChecked) {
                    selectedOrderIds.add(id);
                    if (tr) tr.classList.add('row-selected');
                } else {
                    selectedOrderIds.delete(id);
                    if (tr) tr.classList.remove('row-selected');
                }
            });
            updateBatchActionBar();
        });
    }

    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('pedido-row-cb')) {
            const id = String(e.target.dataset.id);
            const tr = e.target.closest('tr');
            if (e.target.checked) {
                selectedOrderIds.add(id);
                if (tr) tr.classList.add('row-selected');
            } else {
                selectedOrderIds.delete(id);
                if (tr) tr.classList.remove('row-selected');
            }
            updateBatchActionBar();
        }
    });

    const abrirOuBaixarPdfBase64 = (pdfBase64, filename = 'etiquetas_pedidos_ml.pdf') => {
        if (!pdfBase64) return;
        try {
            const binaryString = atob(pdfBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob);

            const pdfWindow = window.open(blobUrl, '_blank');
            if (!pdfWindow || pdfWindow.closed || typeof pdfWindow.closed === 'undefined') {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.target = '_blank';
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    a.remove();
                    URL.revokeObjectURL(blobUrl);
                }, 15000);
            }
        } catch (e) {
            console.error('[PedidosML] Erro ao processar PDF da etiqueta:', e);
            alert('Não foi possível renderizar o PDF da etiqueta.');
        }
    };

    if (btnImprimirSelecionados) {
        btnImprimirSelecionados.addEventListener('click', async () => {
            if (!isPrintMode) {
                togglePrintMode(true);
                return;
            }

            if (selectedOrderIds.size === 0) {
                showToast('Selecione pelo menos um pedido para gerar as etiquetas.');
                return;
            }
            const pedidosArray = Array.from(selectedOrderIds);

            btnImprimirSelecionados.disabled = true;
            btnImprimirSelecionados.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>Montando PDF das Etiquetas...`;

            try {
                const res = await fetch('/api/pedidos-ml/etiquetas/obter', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pedidos: pedidosArray,
                        formato: 'pdf',
                        consolidar: true
                    })
                });

                const data = await res.json();
                if (!res.ok || !data.sucesso) {
                    throw new Error(data.mensagem || data.error || 'Falha ao obter etiquetas no Mercado Livre.');
                }

                if (data.pdf_base64) {
                    abrirOuBaixarPdfBase64(data.pdf_base64, `etiquetas_pedidos_ml_${new Date().toISOString().slice(0, 10)}.pdf`);
                    showToast(`${data.total_gerado || pedidosArray.length} etiqueta(s) montada(s) em PDF com sucesso!`);
                } else if (data.zpl_consolidado) {
                    abrirModalZpl(data.zpl_consolidado);
                    showToast(`${data.total_gerado || pedidosArray.length} etiqueta(s) gerada(s) com sucesso!`);
                } else {
                    showToast('Etiquetas geradas com sucesso!');
                }

                togglePrintMode(false);
                loadPedidos();

            } catch (err) {
                console.error('[PedidosML] Erro na geração de etiquetas:', err);
                alert(`Erro ao obter etiquetas: ${err.message}`);
            } finally {
                if (isPrintMode) {
                    btnImprimirSelecionados.disabled = false;
                    btnImprimirSelecionados.innerHTML = `<i class="fas fa-check me-2"></i>Confirmar Impressão (<span id="countSelecionados">${selectedOrderIds.size}</span>)`;
                }
            }
        });
    }

    // =============================================
    // === MODAL DE DETALHES DO PEDIDO ===
    // =============================================
    const abrirModalDetalhes = (pedidoId) => {
        const ped = rawPedidosList.find(p => String(p.id_pedido_ml) === String(pedidoId));
        if (!ped) return;

        document.getElementById('modalDetalhesTitulo').textContent = `Pedido #${ped.id_pedido_ml}`;
        document.getElementById('modalDetalhesSubtitulo').textContent = ped.empresa || 'Mercado Livre';
        document.getElementById('modalStatusMl').textContent = ped.status_pedido || '-';
        document.getElementById('modalStatusEnvio').textContent = ped.status_envio || '-';
        document.getElementById('modalPrazoColeta').innerHTML = renderPrazoBadge(ped);
        document.getElementById('modalSituacaoOperacional').innerHTML = renderOperacionalBadge(ped);

        document.getElementById('modalCompradorNick').textContent = ped.comprador_nickname || '-';
        document.getElementById('modalCompradorNome').textContent = ped.comprador_nome || '-';

        document.getElementById('modalNfeNumero').textContent = ped.nfe_numero || 'Sem NF';
        document.getElementById('modalChaveAcesso').textContent = ped.nfe_chave_acesso || '-';
        document.getElementById('modalIdEnvio').textContent = ped.id_envio_ml || '-';

        document.getElementById('modalValorTotal').textContent = `R$ ${formatNumberPtBr(ped.valor_total)}`;
        document.getElementById('modalFreteValor').textContent = `R$ ${formatNumberPtBr(ped.frete_envio)}`;
        document.getElementById('modalTipoEnvio').textContent = formatTipoEnvio(ped.tipo_envio);

        let itens = [];
        if (ped.itens_json) {
            try {
                itens = typeof ped.itens_json === 'string' ? JSON.parse(ped.itens_json) : ped.itens_json;
            } catch (e) { itens = []; }
        }
        itens = Array.isArray(itens) ? itens : [];

        document.getElementById('modalQtdItensTotal').textContent = itens.length || (ped.quantidade_total_itens || 1);
        const tbodyItens = document.getElementById('modalItensTableBody');

        if (itens.length > 0) {
            tbodyItens.innerHTML = itens.map((it, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(it.sku || it.seller_sku || '-')}</strong></td>
                    <td>${escapeHtml(it.title || it.descricao || '-')}</td>
                    <td class="text-center">${it.quantity || 1}</td>
                    <td class="text-end">R$ ${formatNumberPtBr(it.unit_price || it.preco)}</td>
                    <td class="text-end fw-bold">R$ ${formatNumberPtBr((it.quantity || 1) * (it.unit_price || it.preco || 0))}</td>
                </tr>
            `).join('');
        } else {
            tbodyItens.innerHTML = `
                <tr>
                    <td>1</td>
                    <td><strong>${escapeHtml(ped.sku_principal || '-')}</strong></td>
                    <td>${escapeHtml(ped.titulo_anuncio || '-')}</td>
                    <td class="text-center">${ped.quantidade_total_itens || 1}</td>
                    <td class="text-end">R$ ${formatNumberPtBr(ped.valor_total)}</td>
                    <td class="text-end fw-bold">R$ ${formatNumberPtBr(ped.valor_total)}</td>
                </tr>
            `;
        }

        const posVendaSection = document.getElementById('modalPosVendaSection');
        if (ped.tem_reclamacao || ped.tem_devolucao || ped.situacao_operacional === 'devolucao' || ped.situacao_operacional === 'reclamacao') {
            posVendaSection.style.display = 'block';
            document.getElementById('modalPosVendaContent').textContent = ped.devolucao_motivo || ped.reclamacao_motivo || 'Pedido em processo de pós-venda / devolução ativa no Mercado Livre.';
        } else {
            posVendaSection.style.display = 'none';
        }

        if (btnModalImprimirZpl) {
            btnModalImprimirZpl.style.display = 'inline-flex';
            btnModalImprimirZpl.onclick = () => {
                fecharModalDetalhes();
                imprimirEtiquetaUnica(ped.id_pedido_ml);
            };
        }

        if (modalDetalhesOverlay) modalDetalhesOverlay.style.display = 'block';
        if (modalDetalhes) modalDetalhes.style.display = 'block';
    };

    const fecharModalDetalhes = () => {
        if (modalDetalhesOverlay) modalDetalhesOverlay.style.display = 'none';
        if (modalDetalhes) modalDetalhes.style.display = 'none';
    };

    if (btnCloseDetalhes) btnCloseDetalhes.addEventListener('click', fecharModalDetalhes);
    if (btnFecharDetalhes) btnFecharDetalhes.addEventListener('click', fecharModalDetalhes);
    if (modalDetalhesOverlay) modalDetalhesOverlay.addEventListener('click', fecharModalDetalhes);

    // =============================================
    // === MODAL DE VISUALIZAÇÃO DE ZPL ===
    // =============================================
    const abrirModalZpl = (zplText) => {
        if (modalZplContent) modalZplContent.value = zplText || '';
        if (modalZplOverlay) modalZplOverlay.style.display = 'block';
        if (modalZpl) modalZpl.style.display = 'block';
    };

    const fecharModalZpl = () => {
        if (modalZplOverlay) modalZplOverlay.style.display = 'none';
        if (modalZpl) modalZpl.style.display = 'none';
    };

    if (btnCloseZpl) btnCloseZpl.addEventListener('click', fecharModalZpl);
    if (btnFecharZpl) btnFecharZpl.addEventListener('click', fecharModalZpl);
    if (modalZplOverlay) modalZplOverlay.addEventListener('click', fecharModalZpl);

    if (btnCopiarZpl) {
        btnCopiarZpl.addEventListener('click', () => {
            if (!modalZplContent) return;
            navigator.clipboard.writeText(modalZplContent.value)
                .then(() => showToast('Código ZPL copiado com sucesso!'))
                .catch(() => alert('Não foi possível copiar o ZPL.'));
        });
    }

    const imprimirEtiquetaUnica = async (pedidoId) => {
        try {
            showToast('Obtendo etiqueta em PDF...');
            const res = await fetch('/api/pedidos-ml/etiquetas/obter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pedidos: [pedidoId],
                    formato: 'pdf',
                    consolidar: true
                })
            });
            const data = await res.json();
            if (!res.ok || !data.sucesso) {
                throw new Error(data.mensagem || data.error || 'Falha ao buscar etiqueta.');
            }
            if (data.pdf_base64) {
                abrirOuBaixarPdfBase64(data.pdf_base64, `etiqueta_${pedidoId}.pdf`);
                showToast('Etiqueta PDF montada com sucesso!');
            } else if (data.zpl_consolidado || data.etiquetas?.[0]?.conteudo) {
                abrirModalZpl(data.zpl_consolidado || data.etiquetas[0].conteudo);
            } else {
                showToast('Etiqueta gerada!');
            }
            loadPedidos();
        } catch (err) {
            console.error('[PedidosML] Erro ao obter etiqueta única:', err);
            alert(`Erro ao obter etiqueta: ${err.message}`);
        }
    };

    // =============================================
    // === DELEGAÇÃO DE CLIQUES GLOBAIS ===
    // =============================================
    document.addEventListener('click', (e) => {
        const btnDet = e.target.closest('.btn-ver-detalhes');
        if (btnDet) {
            e.preventDefault();
            abrirModalDetalhes(btnDet.dataset.id);
            return;
        }

        const btnImp = e.target.closest('.btn-imprimir-unico');
        if (btnImp) {
            e.preventDefault();
            imprimirEtiquetaUnica(btnImp.dataset.id);
            return;
        }

        const btnZpl = e.target.closest('.btn-ver-zpl');
        if (btnZpl) {
            e.preventDefault();
            imprimirEtiquetaUnica(btnZpl.dataset.id);
            return;
        }

        const btnCopy = e.target.closest('.btn-copy-quick');
        if (btnCopy) {
            e.preventDefault();
            const textToCopy = btnCopy.dataset.copy;
            if (textToCopy) {
                navigator.clipboard.writeText(textToCopy)
                    .then(() => showToast(`Copiado: ${textToCopy}`))
                    .catch(() => {});
            }
            return;
        }
    });

    // =============================================
    // === FILTROS DA INTERFACE ===
    // =============================================
    if (filtroPeriodo) {
        filtroPeriodo.addEventListener('change', () => {
            if (customDateRange) {
                customDateRange.style.display = filtroPeriodo.value === 'personalizado' ? 'block' : 'none';
            }
            currentPage = 1;
            loadPedidos();
        });
    }

    if (dataInicio) dataInicio.addEventListener('change', () => { currentPage = 1; loadPedidos(); });
    if (dataFim) dataFim.addEventListener('change', () => { currentPage = 1; loadPedidos(); });

    if (buscaInput) {
        buscaInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentPage = 1;
                loadPedidos();
            }, 400);
        });
    }

    if (campoBuscaSelect) {
        campoBuscaSelect.addEventListener('change', () => {
            if (buscaInput && buscaInput.value.trim() !== '') {
                currentPage = 1;
                loadPedidos();
            }
        });
    }

    if (filtroEmpresa) filtroEmpresa.addEventListener('change', () => { currentPage = 1; loadPedidos(); });
    if (filtroSituacaoPrazo) filtroSituacaoPrazo.addEventListener('change', () => { currentPage = 1; loadPedidos(); });
    if (filtroSituacaoOperacional) filtroSituacaoOperacional.addEventListener('change', () => { currentPage = 1; loadPedidos(); });
    if (filtroTipoEnvio) filtroTipoEnvio.addEventListener('change', () => { currentPage = 1; loadPedidos(); });

    if (paginationContainer) {
        paginationContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-page]');
            if (btn && !btn.disabled) {
                currentPage = parseInt(btn.dataset.page);
                applyExcelFiltersAndRender();
            }
        });
    }

    if (filtroLimite) {
        filtroLimite.addEventListener('change', () => {
            pageLimit = parseInt(filtroLimite.value) || 50;
            currentPage = 1;
            applyExcelFiltersAndRender();
        });
    }

    // Clique nos KPIs de topo
    document.querySelectorAll('.kpi-card').forEach(card => {
        card.addEventListener('click', () => {
            const filterPrazo = card.dataset.filterPrazo;
            const filterOp = card.dataset.filterOp;
            const filterPos = card.dataset.filterPos;

            if (card.classList.contains('active')) {
                card.classList.remove('active');
                currentActiveKpi = null;
            } else {
                document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                currentActiveKpi = { filterPrazo, filterOp, filterPos };
            }

            currentPage = 1;
            loadPedidos();
        });
    });

    // Sincronizar Pedidos
    if (btnSincronizarPedidos) {
        btnSincronizarPedidos.addEventListener('click', async () => {
            btnSincronizarPedidos.disabled = true;
            btnSincronizarPedidos.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>Sincronizando...`;

            try {
                const res = await fetch('/api/pedidos-ml/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dias: 30 })
                });
                const data = await res.json();
                if (!res.ok || (!data.sucesso && !data.success)) {
                    throw new Error(data.error || data.mensagem || 'Falha na sincronização.');
                }
                showToast(`Sincronização concluída! ${data.metricas?.novos_inseridos || data.total_processados || 0} pedido(s) processados.`);
                loadPedidos();
            } catch (err) {
                console.error('[PedidosML] Falha na sincronização:', err);
                alert(`Erro ao sincronizar pedidos com o Hub: ${err.message}`);
            } finally {
                btnSincronizarPedidos.disabled = false;
                btnSincronizarPedidos.innerHTML = `<i class="fas fa-sync me-2"></i>Sincronizar Pedidos`;
            }
        });
    }

    // Exportar Excel
    if (btnExportarPedidos) {
        btnExportarPedidos.addEventListener('click', () => {
            const params = new URLSearchParams({
                periodo: filtroPeriodo ? filtroPeriodo.value : '30dias'
            });
            if (buscaInput && buscaInput.value) params.set('busca', buscaInput.value);
            window.location.href = `/api/pedidos-ml/exportar?${params.toString()}`;
        });
    }

    // === INICIALIZAÇÃO ===
    fetchColumnPreferences();
    loadPedidos();
});
