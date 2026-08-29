/**
 * analiseComprasManager.js
 * Gerenciador completo da Análise de Compras:
 * - Filtros estilo Excel (Combobox com busca, contagem e checkboxes) por coluna
 * - Reordenação de colunas por Drag & Drop persistente no LocalStorage
 * - Redimensionamento e colapso de colunas estilo Excel com persistência
 * - Botões de copiar SKU e Nome do Produto com feedback visual
 * - Heatmap dinâmico em tons de azul para Vendas Estimadas
 * - Agrupamento inteligente de fornecedores (evitando colisões como J. J. e J. D.)
 * - Suporte a Estoque Físico e Estoque Plataforma com Duração de Estoque independente
 * - Modo Configuração de Pedido diretamente na tabela com seleção e quantidade customizável
 * - Geração de PDF no backend e download via stream
 * - Paginação (.estoque-pagination)
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Elementos DOM Principais ===
    const table = document.getElementById('tabela-estoque');
    const tableBody = document.getElementById('table-body');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const inputDiasEstoque = document.getElementById('inputDiasEstoque');
    const buscaInput = document.getElementById('buscaGeral');
    const campoBuscaSelect = document.getElementById('campoBusca');
    const filtroLimite = document.getElementById('filtroLimite');

    // Filtro Fábrica Pesquisável (Página Principal)
    const fornecedorDropdownContainer = document.getElementById('fornecedorDropdownContainer');
    const inputFiltroFornecedor = document.getElementById('inputFiltroFornecedor');
    const filtroFornecedorHidden = document.getElementById('filtroFornecedor');
    const menuFiltroFornecedor = document.getElementById('menuFiltroFornecedor');
    const buscaMenuFornecedor = document.getElementById('buscaMenuFornecedor');
    const optionsFiltroFornecedor = document.getElementById('optionsFiltroFornecedor');

    // Barras de Ações (Normal vs Modo Pedido)
    const normalHeaderActions = document.getElementById('normalHeaderActions');
    const orderModeActionsBar = document.getElementById('orderModeActionsBar');
    const orderModeFabricaNome = document.getElementById('orderModeFabricaNome');
    const btnGeracaoPedidos = document.getElementById('btnGeracaoPedidos');
    const btnBaixarPdfPedido = document.getElementById('btnBaixarPdfPedido');
    const btnBaixarPdfTexto = document.getElementById('btnBaixarPdfTexto');
    const btnSairModoPedido = document.getElementById('btnSairModoPedido');

    // === Configurações de Colunas ===
    const DEFAULT_COLUMN_ORDER = [
        'sku',
        'sku_ml',
        'produto_nome',
        'estoque_atual',
        'estoque_plataforma',
        'chegando',
        'vendas_3d',
        'vendas_7d',
        'vendas_15d',
        'vendas_30d',
        'est_3d',
        'est_7d',
        'est_15d',
        'media_venda',
        'sugestao',
        'tempo_est',
        'tempo_est_plataforma'
    ];

    const DEFAULT_COLUMN_WIDTHS = {
        'sku': 130,
        'sku_ml': 130,
        'produto_nome': 340,
        'estoque_atual': 95,
        'estoque_plataforma': 115,
        'chegando': 95,
        'vendas_3d': 85,
        'vendas_7d': 85,
        'vendas_15d': 90,
        'vendas_30d': 90,
        'est_3d': 85,
        'est_7d': 85,
        'est_15d': 85,
        'media_venda': 110,
        'sugestao': 120,
        'tempo_est': 115,
        'tempo_est_plataforma': 125
    };

    const COLUMN_LABELS = {
        'sku': 'SKU',
        'sku_ml': 'SKU ML',
        'produto_nome': 'Produto',
        'estoque_atual': 'Estoque',
        'estoque_plataforma': 'Est. Plataforma',
        'chegando': 'Chegando',
        'vendas_3d': 'Venda 3d',
        'vendas_7d': 'Venda 7d',
        'vendas_15d': 'Venda 15d',
        'vendas_30d': 'Venda 30d',
        'est_3d': 'Est. 3d',
        'est_7d': 'Est. 7d',
        'est_15d': 'Est. 15d',
        'media_venda': 'Média Mensal',
        'sugestao': 'Sugestão Compra',
        'tempo_est': 'Duração Estoque',
        'tempo_est_plataforma': 'Duração Est. Plat.'
    };

    // === Estado Global ===
    let rawProductsList = [];
    let processedProductsList = [];
    let currentPage = 1;
    let pageLimit = 50;
    let sortColumn = 'sku';
    let sortDirection = 'ASC';
    let debounceTimer = null;
    let clickTimer = null;
    let columnExcelFilters = {}; // { colKey: Set([val1, val2...]) }
    let activeDropdownMenu = null;

    // Estado do Modo de Pedidos na Tabela
    let isModoPedido = false;
    let pedidoItensMap = new Map(); // blingId -> { checked: boolean, quantidade: number, nome: string }

    // Carregar preferências salvas no LocalStorage
    let currentColumnOrder = [...DEFAULT_COLUMN_ORDER];
    let currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS };

    try {
        const savedOrder = localStorage.getItem('analise_compras_column_order');
        if (savedOrder) {
            const parsed = JSON.parse(savedOrder);
            if (Array.isArray(parsed)) {
                // Mescla mantendo novas colunas que possam ter sido adicionadas
                const validOrder = parsed.filter(col => DEFAULT_COLUMN_ORDER.includes(col));
                DEFAULT_COLUMN_ORDER.forEach(col => {
                    if (!validOrder.includes(col)) {
                        if (col === 'sku_ml') {
                            const skuIdx = validOrder.indexOf('sku');
                            if (skuIdx !== -1) {
                                validOrder.splice(skuIdx + 1, 0, col);
                            } else {
                                validOrder.push(col);
                            }
                        } else {
                            validOrder.push(col);
                        }
                    }
                });
                currentColumnOrder = validOrder;
            }
        }
        const savedWidths = localStorage.getItem('analise_compras_column_widths');
        if (savedWidths) {
            currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(savedWidths) };
        }
    } catch (e) {
        console.warn('Erro ao carregar preferências de colunas:', e);
    }

    init();

    function init() {
        carregarDados();
        initSearchableFornecedorDropdown();
        initHeaderEvents();
        initColumnDragAndDrop();
        initColumnResizing();
        initCopyDelegation();

        // Eventos de Filtro e Busca
        if (inputDiasEstoque) {
            inputDiasEstoque.addEventListener('input', () => {
                recalcularDados();
                aplicarFiltrosEOrdenar();
            });
        }

        if (buscaInput) {
            buscaInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    currentPage = 1;
                    aplicarFiltrosEOrdenar();
                }, 250);
            });
        }

        if (campoBuscaSelect) {
            campoBuscaSelect.addEventListener('change', () => {
                currentPage = 1;
                aplicarFiltrosEOrdenar();
            });
        }

        if (filtroLimite) {
            filtroLimite.addEventListener('change', (e) => {
                pageLimit = parseInt(e.target.value, 10) || 50;
                currentPage = 1;
                aplicarFiltrosEOrdenar();
            });
        }

        // Botões do Modo de Configuração de Pedidos
        if (btnGeracaoPedidos) {
            btnGeracaoPedidos.addEventListener('click', ativarModoPedido);
        }

        if (btnBaixarPdfPedido) {
            btnBaixarPdfPedido.addEventListener('click', handleGerarPedidoPdfTabela);
        }

        if (btnSairModoPedido) {
            btnSairModoPedido.addEventListener('click', desativarModoPedido);
        }
    }

    // =============================================
    // === AGRUPAMENTO INTELIGENTE DE FORNECEDORES ===
    // =============================================

    function extrairChaveFornecedor(nome) {
        if (!nome) return '';
        let limpo = String(nome).trim().replace(/\s+/g, ' ');
        const palavras = limpo.split(' ').map(p => p.trim()).filter(Boolean);
        if (palavras.length === 0) return '';

        const palavrasIgnoraveis = new Set([
            'IND', 'IND.', 'INDUSTRIA', 'INDÚSTRIA',
            'COMERCIO', 'COMÉRCIO', 'COMERCIAL',
            'DISTRIBUIDORA', 'FABRICA', 'FÁBRICA',
            'CIA', 'CIA.', 'COMPANHIA', 'MANUFATURA',
            'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'EM', 'P/',
            'MOVEIS', 'MÓVEIS', 'ESTOFADOS', 'COLCHOES', 'COLCHÕES'
        ]);

        // Encontra a primeira palavra significativa
        let palavrasSignificativas = [];
        for (let i = 0; i < palavras.length; i++) {
            const pUpper = palavras[i].toUpperCase().replace(/[.,\-_/]/g, '');
            if (!palavrasIgnoraveis.has(pUpper)) {
                palavrasSignificativas = palavras.slice(i);
                break;
            }
        }

        if (palavrasSignificativas.length === 0) {
            palavrasSignificativas = palavras;
        }

        const p1 = palavrasSignificativas[0];
        const p1Clean = p1.toUpperCase().replace(/[.,\-_/]/g, '');

        if ((p1Clean.length <= 2 || p1.includes('.')) && palavrasSignificativas.length > 1) {
            const p2 = palavrasSignificativas[1];
            return `${p1Clean} ${p2.toUpperCase().replace(/[.,\-_/]/g, '')}`;
        }

        return p1Clean;
    }

    // =============================================
    // === CARREGAMENTO DE DADOS (API) ===
    // =============================================

    async function carregarDados() {
        try {
            const res = await fetch('/analise-compras/api/produtos');
            const json = await res.json();

            if (json.success && Array.isArray(json.data)) {
                rawProductsList = json.data.map(p => {
                    return {
                        ...p,
                        fornecedor_chave: extrairChaveFornecedor(p.fornecedor_nome)
                    };
                });

                recalcularDados();
                rebuildTableHeader();
                aplicarFiltrosEOrdenar();
            } else {
                tableBody.innerHTML = `<tr><td colspan="${currentColumnOrder.length + (isModoPedido ? 1 : 0)}" class="text-center py-4 text-danger">Falha ao carregar dados.</td></tr>`;
            }
        } catch (error) {
            console.error('Erro ao buscar dados de análise de compras:', error);
            tableBody.innerHTML = `<tr><td colspan="${currentColumnOrder.length + (isModoPedido ? 1 : 0)}" class="text-center py-4 text-danger">Erro de conexão ao carregar produtos.</td></tr>`;
        }
    }

    // =============================================
    // === CÁLCULOS MATEMÁTICOS DAS PROJEÇÕES ===
    // =============================================

    function recalcularDados() {
        const diasEstoque = parseInt(inputDiasEstoque.value, 10) || 0;

        processedProductsList = rawProductsList.map(p => {
            const estoque = parseInt(p.estoque_atual) || 0;
            const estoquePlat = parseInt(p.estoque_plataforma) || 0;
            const chegando = parseInt(p.chegando) || 0;
            const v3 = parseInt(p.vendas_3d) || 0;
            const v7 = parseInt(p.vendas_7d) || 0;
            const v15 = parseInt(p.vendas_15d) || 0;
            const v30 = parseInt(p.vendas_30d) || 0;

            const est15 = v15 * 2;
            const est7 = Math.round((v7 / 7) * 30);
            const est3 = v3 * 10;

            const mediaVenda = Math.round((v30 + est15 + est7 + est3) / 4);
            const mediaDiaria = mediaVenda / 30;

            let sugestao = null;
            if (diasEstoque > 0 && mediaVenda > 0) {
                const calculoSugestao = Math.round((mediaDiaria * diasEstoque) - estoque - chegando);
                sugestao = Math.max(0, calculoSugestao);
            }

            // Duração Estimada do Estoque Físico (Dias)
            let tempoEst = null;
            if (mediaDiaria > 0) {
                tempoEst = Math.round((estoque + chegando) / mediaDiaria);
            }

            // Duração Estimada do Estoque Plataforma (Dias)
            let tempoEstPlat = null;
            if (mediaDiaria > 0) {
                tempoEstPlat = Math.round((estoquePlat + chegando) / mediaDiaria);
            }

            return {
                ...p,
                estoque_atual: estoque,
                estoque_plataforma: estoquePlat,
                chegando: chegando,
                vendas_3d: v3,
                vendas_7d: v7,
                vendas_15d: v15,
                vendas_30d: v30,
                est_3d: est3,
                est_7d: est7,
                est_15d: est15,
                media_venda: mediaVenda,
                media_diaria: mediaDiaria,
                sugestao: sugestao,
                tempo_est: tempoEst,
                tempo_est_plataforma: tempoEstPlat
            };
        });
    }

    // =============================================
    // === FILTRAGEM, ORDENAÇÃO E PAGINAÇÃO ===
    // =============================================

    function aplicarFiltrosEOrdenar() {
        const termo = buscaInput ? normalizarTextoBusca(buscaInput.value) : '';
        const campo = campoBuscaSelect ? campoBuscaSelect.value : 'geral';
        const fornecedorFiltro = filtroFornecedorHidden ? filtroFornecedorHidden.value.trim().toUpperCase() : '';
        const fornecedorIds = filtroFornecedorHidden ? (filtroFornecedorHidden.dataset.ids || '').split(',').filter(Boolean) : [];

        // 1. Filtrar
        let filtrados = processedProductsList.filter(p => {
            if (fornecedorFiltro) {
                const matchChave = p.fornecedor_chave === fornecedorFiltro;
                const matchId = p.fornecedor_id && fornecedorIds.includes(String(p.fornecedor_id));
                const matchNome = p.fornecedor_nome && extrairChaveFornecedor(p.fornecedor_nome) === fornecedorFiltro;
                if (!matchChave && !matchId && !matchNome) {
                    return false;
                }
            }

            if (termo) {
                const nome = normalizarTextoBusca(p.produto_nome || '');
                const sku = normalizarTextoBusca(p.sku || '');
                const skuMl = normalizarTextoBusca(p.sku_ml || '');
                if (campo === 'nome') {
                    if (!nome.includes(termo)) return false;
                } else if (campo === 'sku') {
                    if (!sku.includes(termo)) return false;
                } else if (campo === 'sku_ml') {
                    if (!skuMl.includes(termo)) return false;
                } else {
                    if (!nome.includes(termo) && !sku.includes(termo) && !skuMl.includes(termo)) return false;
                }
            }

            for (let colKey in columnExcelFilters) {
                const selectedSet = columnExcelFilters[colKey];
                if (selectedSet) {
                    const displayVal = getColumnDisplayValue(p, colKey);
                    if (!selectedSet.has(displayVal)) {
                        return false;
                    }
                }
            }
            return true;
        });

        // 2. Ordenar
        filtrados.sort((a, b) => {
            let valA = a[sortColumn];
            let valB = b[sortColumn];
            if (valA === null || valA === undefined) valA = sortDirection === 'ASC' ? Infinity : -Infinity;
            if (valB === null || valB === undefined) valB = sortDirection === 'ASC' ? Infinity : -Infinity;

            if (typeof valA === 'string') {
                const cmp = valA.localeCompare(String(valB), 'pt-BR', { sensitivity: 'base' });
                return sortDirection === 'ASC' ? cmp : -cmp;
            } else {
                return sortDirection === 'ASC' ? (valA - valB) : (valB - valA);
            }
        });

        // 3. Paginar
        const totalItems = filtrados.length;
        const totalPages = Math.ceil(totalItems / pageLimit) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * pageLimit;
        const pageItems = filtrados.slice(startIndex, startIndex + pageLimit);

        // 4. Renderizar Tabela e Paginação
        renderTable(pageItems, totalItems);
        renderPagination({ currentPage, totalPages, totalItems });
        atualizarIndicadoresHeader();
        if (isModoPedido) {
            atualizarContadorModoPedido();
        }
    }

    // =============================================
    // === RECONSTRUÇÃO E EVENTOS DO HEADER ===
    // =============================================

    function rebuildTableHeader() {
        const theadTr = table.querySelector('thead tr');
        if (!theadTr) return;

        theadTr.innerHTML = '';

        // Se estiver no Modo Pedido, adiciona apenas a coluna Qtd Pedida no início
        if (isModoPedido) {
            const thQtd = document.createElement('th');
            thQtd.className = 'th-order-qtd text-center';
            thQtd.style.color = 'var(--accent-orange, #f07c00)';
            thQtd.style.width = '110px';
            thQtd.style.minWidth = '110px';
            thQtd.textContent = 'Qtd a Pedir';
            theadTr.appendChild(thQtd);
        }

        currentColumnOrder.forEach(colKey => {
            const th = document.createElement('th');
            th.className = 'sortable';
            th.dataset.column = colKey;
            th.draggable = true;

            if (colKey !== 'produto_nome') th.classList.add('text-center');
            th.textContent = COLUMN_LABELS[colKey] || colKey;
            theadTr.appendChild(th);
        });

        initHeaderEvents();
        initColumnDragAndDrop();
        initColumnResizing();
    }

    function initHeaderEvents() {
        const theadThs = table.querySelectorAll('thead th.sortable');
        theadThs.forEach(th => {
            th.addEventListener('click', (e) => {
                if (e.target.closest('.col-resizer')) return;
                if (th.classList.contains('is-col-collapsed')) return;
                const col = th.dataset.column;
                if (!col) return;
                if (sortColumn === col) {
                    sortDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
                } else {
                    sortColumn = col;
                    sortDirection = 'ASC';
                }
                aplicarFiltrosEOrdenar();
            });
            th.addEventListener('dblclick', (e) => {
                if (e.target.closest('.col-resizer')) return;
                const col = th.dataset.column;
                if (th.classList.contains('is-col-collapsed')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const defaultW = DEFAULT_COLUMN_WIDTHS[col] || 100;
                    currentColumnWidths[col] = defaultW;
                    applyColumnWidthsDOM();
                    try { localStorage.setItem('analise_compras_column_widths', JSON.stringify(currentColumnWidths)); } catch (err) { }
                    showToast(`Coluna "${COLUMN_LABELS[col] || col}" restaurada!`);
                    return;
                }
                e.preventDefault();
                openColumnFilterMenu(th);
            });
        });
    }

    function atualizarIndicadoresHeader() {
        const theadThs = table.querySelectorAll('thead th.sortable');
        theadThs.forEach(th => {
            const col = th.dataset.column;
            th.classList.remove('sorted-asc', 'sorted-desc', 'filter-active');
            if (col === sortColumn) th.classList.add(sortDirection === 'ASC' ? 'sorted-asc' : 'sorted-desc');
            if (columnExcelFilters[col] && columnExcelFilters[col].size > 0) th.classList.add('filter-active');
        });
    }

    // =============================================
    // === FILTRO COMBOBOX ESTILO EXCEL ===
    // =============================================

    function getColumnDisplayValue(p, colKey) {
        if (!p) return '-';
        switch (colKey) {
            case 'sku': return p.sku || '-';
            case 'sku_ml': return p.sku_ml || '-';
            case 'produto_nome': return p.produto_nome || '-';
            case 'estoque_atual': return String(p.estoque_atual != null ? p.estoque_atual : 0);
            case 'estoque_plataforma': return String(p.estoque_plataforma != null ? p.estoque_plataforma : 0);
            case 'chegando': return String(p.chegando != null ? p.chegando : 0);
            case 'vendas_3d': return String(p.vendas_3d != null ? p.vendas_3d : 0);
            case 'vendas_7d': return String(p.vendas_7d != null ? p.vendas_7d : 0);
            case 'vendas_15d': return String(p.vendas_15d != null ? p.vendas_15d : 0);
            case 'vendas_30d': return String(p.vendas_30d != null ? p.vendas_30d : 0);
            case 'est_3d': return String(p.est_3d != null ? p.est_3d : 0);
            case 'est_7d': return String(p.est_7d != null ? p.est_7d : 0);
            case 'est_15d': return String(p.est_15d != null ? p.est_15d : 0);
            case 'media_venda': return String(p.media_venda != null ? p.media_venda : 0);
            case 'sugestao': return p.sugestao !== null ? String(p.sugestao) : '-';
            case 'tempo_est': return p.tempo_est !== null ? `${p.tempo_est} d` : '-';
            case 'tempo_est_plataforma': return p.tempo_est_plataforma !== null ? `${p.tempo_est_plataforma} d` : '-';
            default: return String(p[colKey] || '-');
        }
    }

    function openColumnFilterMenu(thElement) {
        const colKey = thElement.dataset.column;
        if (!colKey) return;
        if (activeDropdownMenu) activeDropdownMenu.remove();

        const valueCounts = {};
        processedProductsList.forEach(p => {
            const val = getColumnDisplayValue(p, colKey);
            valueCounts[val] = (valueCounts[val] || 0) + 1;
        });

        const uniqueValues = Object.keys(valueCounts).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
        const currentSelected = columnExcelFilters[colKey] ? new Set(columnExcelFilters[colKey]) : new Set(uniqueValues);
        const colLabel = COLUMN_LABELS[colKey] || colKey;

        const menu = document.createElement('div');
        menu.className = 'excel-filter-dropdown';
        menu.innerHTML = `
            <div class="excel-filter-header">
                <span class="excel-filter-title">Filtro: ${colLabel}</span>
                <button type="button" class="excel-filter-close" aria-label="Fechar">&times;</button>
            </div>
            <div class="excel-filter-search-box">
                <input type="text" class="excel-filter-search-input" placeholder="Pesquisar nesta coluna..." />
            </div>
            <div class="excel-filter-select-all">
                <input type="checkbox" id="chk_select_all_${colKey}" ${currentSelected.size === uniqueValues.length ? 'checked' : ''} />
                <label for="chk_select_all_${colKey}" style="cursor: pointer; user-select: none;">(Selecionar Tudo)</label>
            </div>
            <div class="excel-filter-list">
                ${uniqueValues.map((val, idx) => {
            const checked = currentSelected.has(val) ? 'checked' : '';
            const safeId = `chk_excel_${colKey}_${idx}`;
            return `
                        <div class="excel-filter-item">
                            <input type="checkbox" id="${safeId}" ${checked} value="${escapeHtml(val)}" />
                            <label for="${safeId}" class="excel-filter-item-label" title="${escapeHtml(val)}">${escapeHtml(val)}</label>
                            <span class="excel-filter-count">${valueCounts[val]}</span>
                        </div>
                    `;
        }).join('')}
            </div>
            <div class="excel-filter-footer">
                <button type="button" class="excel-filter-btn excel-filter-btn-clear">Limpar Filtro</button>
                <button type="button" class="excel-filter-btn excel-filter-btn-apply">Aplicar</button>
            </div>
        `;

        document.body.appendChild(menu);
        activeDropdownMenu = menu;

        const rect = thElement.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
        menu.style.left = `${Math.max(10, Math.min(window.innerWidth - 300, rect.left + window.scrollX))}px`;

        const searchInput = menu.querySelector('.excel-filter-search-input');
        const selectAllChk = menu.querySelector(`#chk_select_all_${colKey}`);
        const listItems = menu.querySelectorAll('.excel-filter-item');
        const applyBtn = menu.querySelector('.excel-filter-btn-apply');
        const clearBtn = menu.querySelector('.excel-filter-btn-clear');
        const closeBtn = menu.querySelector('.excel-filter-close');

        setTimeout(() => searchInput.focus(), 50);

        searchInput.addEventListener('input', () => {
            const term = searchInput.value.trim().toLowerCase();
            listItems.forEach(item => {
                const label = item.querySelector('.excel-filter-item-label').textContent.toLowerCase();
                item.style.display = label.includes(term) ? 'flex' : 'none';
            });
        });

        selectAllChk.addEventListener('change', () => {
            const isChecked = selectAllChk.checked;
            listItems.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input[type="checkbox"]').checked = isChecked;
                }
            });
        });

        applyBtn.addEventListener('click', () => {
            const selected = new Set();
            listItems.forEach(item => {
                const chk = item.querySelector('input[type="checkbox"]');
                if (chk.checked) selected.add(chk.value);
            });
            if (selected.size === uniqueValues.length) delete columnExcelFilters[colKey];
            else columnExcelFilters[colKey] = selected;

            menu.remove();
            activeDropdownMenu = null;
            currentPage = 1;
            aplicarFiltrosEOrdenar();
        });

        clearBtn.addEventListener('click', () => {
            delete columnExcelFilters[colKey];
            menu.remove();
            activeDropdownMenu = null;
            currentPage = 1;
            aplicarFiltrosEOrdenar();
        });

        closeBtn.addEventListener('click', () => {
            menu.remove();
            activeDropdownMenu = null;
        });

        const outsideClickListener = (e) => {
            if (!menu.contains(e.target) && e.target !== thElement && !thElement.contains(e.target)) {
                menu.remove();
                activeDropdownMenu = null;
                document.removeEventListener('click', outsideClickListener);
            }
        };
        setTimeout(() => { document.addEventListener('click', outsideClickListener); }, 10);
    }

    // =============================================
    // === REDIMENSIONAMENTO DE COLUNAS ===
    // =============================================

    function initColumnResizing() {
        const theadTr = table.querySelector('thead tr');
        if (!theadTr) return;

        const theadThs = table.querySelectorAll('thead th.sortable');
        theadThs.forEach(th => {
            th.querySelectorAll('.col-resizer').forEach(r => r.remove());
            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            resizer.title = 'Arraste para redimensionar. Dê duplo clique para restaurar.';
            th.appendChild(resizer);

            let startX, startWidth, colKey;

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                colKey = th.dataset.column;
                startX = e.pageX;
                startWidth = th.offsetWidth;
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
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    applyColumnWidthsDOM();
                    try { localStorage.setItem('analise_compras_column_widths', JSON.stringify(currentColumnWidths)); } catch (err) { }
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            resizer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                colKey = th.dataset.column;
                const defaultW = DEFAULT_COLUMN_WIDTHS[colKey] || 100;
                currentColumnWidths[colKey] = defaultW;
                applyColumnWidthsDOM();
                try { localStorage.setItem('analise_compras_column_widths', JSON.stringify(currentColumnWidths)); } catch (err) { }
                showToast(`Coluna "${COLUMN_LABELS[colKey] || colKey}" restaurada!`);
            });
        });
        applyColumnWidthsDOM();
    }

    function applyColumnWidthsDOM() {
        const theadTr = table.querySelector('thead tr');
        if (!theadTr) return;

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
                const finalW = Math.max(25, widthVal || DEFAULT_COLUMN_WIDTHS[colKey] || 100);
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
    }

    // =============================================
    // === REORDENAÇÃO DE COLUNAS (DRAG & DROP) ===
    // =============================================

    function initColumnDragAndDrop() {
        const theadThs = table.querySelectorAll('thead th.sortable');
        let draggedColKey = null;

        theadThs.forEach(th => {
            th.addEventListener('dragstart', (e) => {
                draggedColKey = th.dataset.column;
                th.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedColKey);
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                th.classList.add('drag-over');
            });

            th.addEventListener('dragleave', () => { th.classList.remove('drag-over'); });

            th.addEventListener('drop', (e) => {
                e.preventDefault();
                th.classList.remove('drag-over');
                const targetColKey = th.dataset.column;

                if (draggedColKey && targetColKey && draggedColKey !== targetColKey) {
                    const fromIdx = currentColumnOrder.indexOf(draggedColKey);
                    const toIdx = currentColumnOrder.indexOf(targetColKey);

                    if (fromIdx !== -1 && toIdx !== -1) {
                        currentColumnOrder.splice(fromIdx, 1);
                        currentColumnOrder.splice(toIdx, 0, draggedColKey);
                        try { localStorage.setItem('analise_compras_column_order', JSON.stringify(currentColumnOrder)); } catch (err) { }
                        rebuildTableHeader();
                        aplicarFiltrosEOrdenar();
                        showToast(`Coluna reordenada.`);
                    }
                }
            });

            th.addEventListener('dragend', () => {
                th.classList.remove('dragging');
                theadThs.forEach(t => t.classList.remove('drag-over'));
            });
        });
    }

    // =============================================
    // === DELEGAÇÃO DE EVENTOS DE CÓPIA ===
    // =============================================

    function initCopyDelegation() {
        tableBody.addEventListener('click', (e) => {
            const copySkuBtn = e.target.closest('.btn-copy-sku');
            if (copySkuBtn) {
                e.stopPropagation();
                const skuToCopy = copySkuBtn.dataset.sku;
                if (skuToCopy) {
                    navigator.clipboard.writeText(skuToCopy).then(() => {
                        showToast(`SKU copiado: ${skuToCopy}`);
                        const icon = copySkuBtn.querySelector('i');
                        if (icon) {
                            icon.className = 'fas fa-check';
                            icon.style.color = '#2e7d32';
                            setTimeout(() => {
                                icon.className = 'far fa-copy';
                                icon.style.color = '#888';
                            }, 1500);
                        }
                    }).catch(err => console.error('Erro ao copiar SKU:', err));
                }
                return;
            }

            const copyProdBtn = e.target.closest('.btn-copy-prod');
            if (copyProdBtn) {
                e.stopPropagation();
                const nomeToCopy = copyProdBtn.dataset.nome;
                if (nomeToCopy) {
                    navigator.clipboard.writeText(nomeToCopy).then(() => {
                        showToast(`Nome do produto copiado!`);
                        const icon = copyProdBtn.querySelector('i');
                        if (icon) {
                            icon.className = 'fas fa-check';
                            icon.style.color = '#2e7d32';
                            setTimeout(() => {
                                icon.className = 'far fa-copy';
                                icon.style.color = '#888';
                            }, 1500);
                        }
                    }).catch(err => console.error('Erro ao copiar produto:', err));
                }
                return;
            }
        });
    }

    function showToast(message) {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // =============================================
    // === RENDERIZAÇÃO DA TABELA & HEATMAP ===
    // =============================================

    /**
     * Renderiza a célula de Venda Estimada com dinâmica de calor (azul translúcido inteligente)
     */
    function renderEstimadaCell(valor, p) {
        const media = p.media_venda || 1;
        const ratio = valor / media;

        let bgStyle = 'rgba(33, 150, 243, 0.04)';
        let textColor = '#93c5fd';

        if (valor === 0) {
            bgStyle = 'transparent';
            textColor = '#6b7280';
        } else if (ratio >= 1.6) {
            bgStyle = 'rgba(14, 165, 233, 0.38)';
            textColor = '#ffffff';
        } else if (ratio >= 1.25) {
            bgStyle = 'rgba(14, 165, 233, 0.25)';
            textColor = '#e0f2fe';
        } else if (ratio >= 0.85) {
            bgStyle = 'rgba(33, 150, 243, 0.12)';
            textColor = '#bae6fd';
        } else if (ratio >= 0.45) {
            bgStyle = 'rgba(33, 150, 243, 0.05)';
            textColor = '#93c5fd';
        } else {
            bgStyle = 'rgba(33, 150, 243, 0.02)';
            textColor = '#7dd3fc';
        }

        return `<td class="text-center align-middle col-venda-estimada" style="background: ${bgStyle} !important; color: ${textColor} !important; font-weight: ${ratio >= 1.25 ? '700' : '600'};">
            ${valor}
        </td>`;
    }

    function renderTable(items, totalCount) {
        tableBody.innerHTML = '';

        if (totalCount === 0) {
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const diasEstoque = parseInt(inputDiasEstoque.value, 10) || 0;

        items.forEach(p => {
            const idStr = String(p.sku || p.parent_product_bling_id);
            const tr = document.createElement('tr');

            let itemPedido = null;
            if (isModoPedido) {
                if (!pedidoItensMap.has(idStr)) {
                    pedidoItensMap.set(idStr, {
                        quantidade: 0,
                        nome: p.produto_nome
                    });
                }
                itemPedido = pedidoItensMap.get(idStr);
                tr.className = 'tr-modo-pedido' + (itemPedido && itemPedido.quantidade > 0 ? ' tr-pedido-selecionado' : '');
            }

            // Badge de Sugestão - NUNCA NEGATIVA!
            let sugestaoBadge = '-';
            if (diasEstoque > 0 && p.sugestao !== null) {
                if (p.sugestao > 0) {
                    sugestaoBadge = `<span class="sugestao-badge sugestao-positiva">+${p.sugestao}</span>`;
                } else {
                    sugestaoBadge = `<span class="sugestao-badge sugestao-neutra">0</span>`;
                }
            }

            // Duração do Estoque Físico
            let tempoEstHtml = '-';
            if (p.tempo_est !== null) {
                if (p.tempo_est <= 5) {
                    tempoEstHtml = `<span class="tempo-est-badge tempo-est-critico">${p.tempo_est} d</span>`;
                } else if (p.tempo_est <= 15) {
                    tempoEstHtml = `<span class="tempo-est-badge tempo-est-alerta">${p.tempo_est} d</span>`;
                } else {
                    tempoEstHtml = `<span class="tempo-est-badge">${p.tempo_est} d</span>`;
                }
            } else if (p.media_diaria === 0 && (p.estoque_atual + p.chegando > 0)) {
                tempoEstHtml = `<span class="tempo-est-badge text-muted">Sem saídas</span>`;
            }

            // Duração do Estoque Plataforma
            let tempoEstPlatHtml = '-';
            if (p.tempo_est_plataforma !== null) {
                if (p.tempo_est_plataforma <= 5) {
                    tempoEstPlatHtml = `<span class="tempo-est-badge tempo-est-critico">${p.tempo_est_plataforma} d</span>`;
                } else if (p.tempo_est_plataforma <= 15) {
                    tempoEstPlatHtml = `<span class="tempo-est-badge tempo-est-alerta">${p.tempo_est_plataforma} d</span>`;
                } else {
                    tempoEstPlatHtml = `<span class="tempo-est-badge">${p.tempo_est_plataforma} d</span>`;
                }
            } else if (p.media_diaria === 0 && (p.estoque_plataforma + p.chegando > 0)) {
                tempoEstPlatHtml = `<span class="tempo-est-badge text-muted">Sem saídas</span>`;
            }

            // Botões de copiar
            const copySkuBtnHtml = p.sku
                ? `<button class="btn-copy-sku" data-sku="${escapeHtml(p.sku)}" title="Copiar SKU"><i class="far fa-copy"></i></button>`
                : '';
            const copyProdBtnHtml = p.produto_nome
                ? `<button class="btn-copy-prod" data-nome="${escapeHtml(p.produto_nome)}" title="Copiar Nome do Produto"><i class="far fa-copy"></i></button>`
                : '';

            let rowHtml = '';

            // Se estiver no Modo Pedido, insere apenas a coluna de quantidade
            if (isModoPedido && itemPedido) {
                rowHtml += `
                    <td class="text-center align-middle td-order-qtd">
                        <input type="number" class="form-control form-control-sm input-qtd-tabela-pedido" data-id="${escapeHtml(idStr)}" value="${itemPedido.quantidade > 0 ? itemPedido.quantidade : ''}" placeholder="0" min="0">
                    </td>
                `;
            }

            // Monta as células conforme currentColumnOrder dinâmico
            currentColumnOrder.forEach(colKey => {
                switch (colKey) {
                    case 'sku':
                        rowHtml += `<td class="text-center align-middle" style="font-weight: 700; color: #fff; font-family: monospace; font-size: 0.9rem;">
                            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                                <span>${escapeHtml(p.sku || '-')}</span>
                                ${copySkuBtnHtml}
                            </div>
                        </td>`;
                        break;
                    case 'sku_ml':
                        const copySkuMlBtnHtml = p.sku_ml
                            ? `<button class="btn-copy-sku" data-sku="${escapeHtml(p.sku_ml)}" title="Copiar SKU ML"><i class="far fa-copy"></i></button>`
                            : '';
                        rowHtml += `<td class="text-center align-middle" style="font-weight: 700; color: #ffd54f; font-family: monospace; font-size: 0.9rem;">
                            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                                <span>${escapeHtml(p.sku_ml || '-')}</span>
                                ${copySkuMlBtnHtml}
                            </div>
                        </td>`;
                        break;
                    case 'produto_nome':
                        rowHtml += `<td style="max-width: 340px; white-space: normal; line-height: 1.35;">
                            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;">
                                <div style="font-weight: 500; color: #e5e7eb; flex-grow: 1;">${escapeHtml(p.produto_nome || '-')}</div>
                                ${copyProdBtnHtml}
                            </div>
                        </td>`;
                        break;
                    case 'estoque_atual':
                        rowHtml += `<td class="text-center align-middle"><strong>${p.estoque_atual}</strong></td>`;
                        break;
                    case 'estoque_plataforma':
                        rowHtml += `<td class="text-center align-middle" style="color: #cbd5e1;">${p.estoque_plataforma}</td>`;
                        break;
                    case 'chegando':
                        rowHtml += `<td class="text-center align-middle"><input type="number" class="input-chegando" data-id="${escapeHtml(idStr)}" data-parent-id="${p.parent_product_bling_id || ''}" value="${p.chegando}" min="0" step="1"></td>`;
                        break;
                    case 'vendas_3d':
                        rowHtml += `<td class="text-center align-middle">${p.vendas_3d}</td>`;
                        break;
                    case 'vendas_7d':
                        rowHtml += `<td class="text-center align-middle">${p.vendas_7d}</td>`;
                        break;
                    case 'vendas_15d':
                        rowHtml += `<td class="text-center align-middle">${p.vendas_15d}</td>`;
                        break;
                    case 'vendas_30d':
                        rowHtml += renderEstimadaCell(p.vendas_30d, p);
                        break;
                    case 'est_3d':
                        rowHtml += renderEstimadaCell(p.est_3d, p);
                        break;
                    case 'est_7d':
                        rowHtml += renderEstimadaCell(p.est_7d, p);
                        break;
                    case 'est_15d':
                        rowHtml += renderEstimadaCell(p.est_15d, p);
                        break;
                    case 'media_venda':
                        rowHtml += `<td class="text-center align-middle" style="font-weight: 700; color: var(--accent-orange, #f07c00);">${p.media_venda}</td>`;
                        break;
                    case 'sugestao':
                        rowHtml += `<td class="text-center align-middle">${sugestaoBadge}</td>`;
                        break;
                    case 'tempo_est':
                        rowHtml += `<td class="text-center align-middle">${tempoEstHtml}</td>`;
                        break;
                    case 'tempo_est_plataforma':
                        rowHtml += `<td class="text-center align-middle">${tempoEstPlatHtml}</td>`;
                        break;
                    default:
                        rowHtml += `<td>-</td>`;
                }
            });

            tr.innerHTML = rowHtml;
            tableBody.appendChild(tr);
        });

        // Eventos nos inputs Chegando
        document.querySelectorAll('.input-chegando').forEach(input => {
            input.addEventListener('change', handleChegandoChange);
        });

        // Eventos do Modo Pedido na Tabela
        if (isModoPedido) {
            document.querySelectorAll('.input-qtd-tabela-pedido').forEach(inp => {
                inp.addEventListener('input', (e) => {
                    const idStr = e.target.getAttribute('data-id');
                    const val = parseInt(e.target.value, 10) || 0;
                    const item = pedidoItensMap.get(idStr);
                    if (item) {
                        item.quantidade = val;
                    }
                    const row = e.target.closest('tr');
                    if (row) row.classList.toggle('tr-pedido-selecionado', val > 0);
                    atualizarContadorModoPedido();
                });
            });
        }

        applyColumnWidthsDOM();
    }

    // =============================================
    // === ATUALIZAÇÃO DO CAMPO CHEGANDO ===
    // =============================================

    async function handleChegandoChange(e) {
        const id = e.target.getAttribute('data-id');
        const parentId = e.target.getAttribute('data-parent-id');
        const novoValor = parseInt(e.target.value, 10) || 0;

        const itemRaw = rawProductsList.find(p => String(p.sku) === String(id) || String(p.parent_product_bling_id) === String(id));
        if (itemRaw) {
            itemRaw.chegando = novoValor;
        }

        recalcularDados();
        if (isModoPedido) {
            sincronizarSugestoesNoModoPedido();
        }
        aplicarFiltrosEOrdenar();

        try {
            const res = await fetch('/analise-compras/atualizar-chegando', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku: id, parent_product_bling_id: parentId || itemRaw?.parent_product_bling_id, chegando: novoValor })
            });
            const json = await res.json();
            if (!json.success) {
                console.error('Falha ao salvar chegando no banco:', json.message);
            }
        } catch (err) {
            console.error('Erro de conexão ao salvar campo chegando:', err);
        }
    }

    // =============================================
    // === MODO CONFIGURAÇÃO DE PEDIDO NA TABELA ===
    // =============================================

    function ativarModoPedido() {
        const chaveFornecedor = filtroFornecedorHidden ? filtroFornecedorHidden.value.trim().toUpperCase() : '';
        const nomeFabrica = inputFiltroFornecedor ? inputFiltroFornecedor.value : '';

        if (!chaveFornecedor) {
            ModalSystem.alert(
                'Por favor, selecione uma <strong>Fábrica / Fornecedor</strong> no filtro antes de iniciar a configuração do pedido.',
                'Filtro por Fábrica Obrigatório'
            );
            return;
        }

        isModoPedido = true;
        pedidoItensMap.clear();

        // Inicializa o mapa com valores zerados (sem pré-preenchimento automático)
        processedProductsList.forEach(p => {
            if (p.fornecedor_chave === chaveFornecedor) {
                pedidoItensMap.set(String(p.sku || p.parent_product_bling_id), {
                    quantidade: 0,
                    nome: p.produto_nome
                });
            }
        });

        // Alterna os botões do cabeçalho
        if (normalHeaderActions) normalHeaderActions.style.display = 'none';
        if (orderModeActionsBar) orderModeActionsBar.style.display = 'flex';
        if (orderModeFabricaNome) orderModeFabricaNome.textContent = nomeFabrica;

        rebuildTableHeader();
        aplicarFiltrosEOrdenar();
        atualizarContadorModoPedido();
    }

    function desativarModoPedido() {
        isModoPedido = false;
        pedidoItensMap.clear();

        if (orderModeActionsBar) orderModeActionsBar.style.display = 'none';
        if (normalHeaderActions) normalHeaderActions.style.display = 'flex';

        rebuildTableHeader();
        aplicarFiltrosEOrdenar();
    }

    function sincronizarSugestoesNoModoPedido() {
        // Mantido vazio para não sobreescrever as quantidades digitadas manualmente pelo usuário
    }

    function atualizarContadorModoPedido() {
        let totalChecked = 0;
        let totalPecas = 0;

        pedidoItensMap.forEach(item => {
            if (item.quantidade > 0) {
                totalChecked++;
                totalPecas += item.quantidade;
            }
        });

        if (btnBaixarPdfTexto) {
            btnBaixarPdfTexto.textContent = `Baixar PDF do Pedido (${totalChecked} itens / ${totalPecas} un)`;
        }

        if (btnBaixarPdfPedido) {
            btnBaixarPdfPedido.disabled = totalChecked === 0;
        }
    }

    async function handleGerarPedidoPdfTabela() {
        const chaveFornecedor = filtroFornecedorHidden ? filtroFornecedorHidden.value.trim().toUpperCase() : '';
        const nomeFabrica = inputFiltroFornecedor ? inputFiltroFornecedor.value : '';

        if (!chaveFornecedor || !nomeFabrica) {
            ModalSystem.alert('Selecione uma fábrica no filtro para gerar o pedido.', 'Atenção');
            return;
        }

        // Coletar itens selecionados com quantidade > 0
        const itens = [];
        pedidoItensMap.forEach((item, idStr) => {
            if (item.quantidade > 0) {
                const prod = rawProductsList.find(p => String(p.sku) === idStr || String(p.parent_product_bling_id) === idStr);
                itens.push({
                    id: idStr,
                    sku: prod?.sku || (isNaN(idStr) ? idStr : null),
                    parent_product_bling_id: prod?.parent_product_bling_id || (!isNaN(idStr) ? parseInt(idStr, 10) : null),
                    nome: item.nome,
                    quantidade: item.quantidade
                });
            }
        });

        if (itens.length === 0) {
            ModalSystem.alert('Selecione pelo menos um produto com quantidade maior que zero para o pedido.', 'Atenção');
            return;
        }

        ModalSystem.showLoading('Gerando PDF do pedido no servidor...', 'Processando');

        try {
            const res = await fetch('/analise-compras/gerar-pedido', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nomeFabrica: nomeFabrica,
                    fornecedor_id: filtroFornecedorHidden ? filtroFornecedorHidden.value : null,
                    items: itens
                })
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.message || 'Falha ao processar o PDF no servidor.');
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeFabrica = nomeFabrica.replace(/[^a-zA-Z0-9]/g, '_');
            const dataStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
            const filename = `Pedido_${safeFabrica}_${dataStr}.pdf`;

            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            // Atualiza o campo 'chegando' na memória local para cada produto comprado
            itens.forEach(it => {
                const itemRaw = rawProductsList.find(p =>
                    (it.sku && String(p.sku) === String(it.sku)) ||
                    (it.parent_product_bling_id && String(p.parent_product_bling_id) === String(it.parent_product_bling_id)) ||
                    (it.id && (String(p.sku) === String(it.id) || String(p.parent_product_bling_id) === String(it.id)))
                );
                if (itemRaw) {
                    itemRaw.chegando = (itemRaw.chegando || 0) + it.quantidade;
                }
            });

            recalcularDados();
            desativarModoPedido();

            const totalQtd = itens.reduce((acc, i) => acc + i.quantidade, 0);

            ModalSystem.hideLoading();
            ModalSystem.alert(
                `<div style="text-align: center;">
                    <i class="fas fa-check-circle" style="font-size: 2.5rem; color: #4caf50; margin-bottom: 10px;"></i>
                    <p style="font-size: 1rem; font-weight: 600; color: #e5e7eb;">Pedido registrado e PDF gerado com sucesso!</p>
                    <p style="font-size: 0.82rem; color: #9ca3af;">Arquivo: <strong>${escapeHtml(filename)}</strong></p>
                    <p style="font-size: 0.82rem; color: #9ca3af;">${itens.length} produto(s) — ${totalQtd} unidade(s)</p>
                    <p style="font-size: 0.82rem; color: #22c55e; margin-top: 8px;"><i class="fas fa-arrow-down me-1"></i>As quantidades foram adicionadas ao campo <strong>Chegando</strong>.</p>
                    <div style="margin-top: 14px;">
                        <a href="/analise-compras/pedidos" class="btn btn-sm btn-outline-accent" style="display: inline-flex; align-items: center;">
                            <i class="fas fa-clipboard-list me-2"></i>Ir para Controle de Pedidos
                        </a>
                    </div>
                </div>`,
                'Pedido Concluído'
            );
        } catch (err) {
            console.error('[Análise de Compras] Erro ao gerar PDF:', err);
            ModalSystem.hideLoading();
            ModalSystem.alert('Erro ao gerar o PDF do pedido: ' + err.message, 'Erro');
        }
    }

    // =============================================
    // === FILTRO PESQUISÁVEL DE FORNECEDORES ===
    // =============================================

    function initSearchableFornecedorDropdown() {
        if (!fornecedorDropdownContainer || !inputFiltroFornecedor || !menuFiltroFornecedor) return;

        inputFiltroFornecedor.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menuFiltroFornecedor.style.display === 'block';
            menuFiltroFornecedor.style.display = isOpen ? 'none' : 'block';
            fornecedorDropdownContainer.classList.toggle('open', !isOpen);

            if (!isOpen && buscaMenuFornecedor) {
                buscaMenuFornecedor.value = '';
                filtrarOpcoesMenuFornecedor('');
                setTimeout(() => buscaMenuFornecedor.focus(), 50);
            }
        });

        if (buscaMenuFornecedor) {
            buscaMenuFornecedor.addEventListener('input', () => {
                filtrarOpcoesMenuFornecedor(buscaMenuFornecedor.value.trim().toLowerCase());
            });
            buscaMenuFornecedor.addEventListener('click', (e) => e.stopPropagation());
        }

        if (optionsFiltroFornecedor) {
            optionsFiltroFornecedor.querySelectorAll('.searchable-select-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = opt.getAttribute('data-value');
                    const ids = opt.getAttribute('data-ids') || '';
                    const name = opt.getAttribute('data-name');

                    optionsFiltroFornecedor.querySelectorAll('.searchable-select-option').forEach(o => o.classList.remove('selected'));
                    opt.classList.add('selected');

                    inputFiltroFornecedor.value = name;
                    filtroFornecedorHidden.value = val;
                    filtroFornecedorHidden.dataset.ids = ids;

                    menuFiltroFornecedor.style.display = 'none';
                    fornecedorDropdownContainer.classList.remove('open');

                    currentPage = 1;

                    // Se estiver no Modo Pedido e trocar de fornecedor
                    if (isModoPedido) {
                        if (val) {
                            if (orderModeFabricaNome) orderModeFabricaNome.textContent = name;
                            pedidoItensMap.clear();
                            processedProductsList.forEach(p => {
                                if (p.fornecedor_chave === val.trim().toUpperCase()) {
                                    pedidoItensMap.set(String(p.sku || p.parent_product_bling_id), {
                                        quantidade: 0,
                                        nome: p.produto_nome
                                    });
                                }
                            });
                        } else {
                            // Se selecionou "Todas as Fábricas", desativa o modo pedido
                            desativarModoPedido();
                        }
                    }

                    aplicarFiltrosEOrdenar();
                });
            });
        }

        document.addEventListener('click', (e) => {
            if (!fornecedorDropdownContainer.contains(e.target)) {
                menuFiltroFornecedor.style.display = 'none';
                fornecedorDropdownContainer.classList.remove('open');
            }
        });
    }

    function normalizarTextoBusca(txt) {
        if (!txt) return '';
        return String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    function filtrarOpcoesMenuFornecedor(term) {
        if (!optionsFiltroFornecedor) return;
        const normTerm = normalizarTextoBusca(term);
        const options = optionsFiltroFornecedor.querySelectorAll('.searchable-select-option');
        options.forEach(opt => {
            const name = normalizarTextoBusca(opt.getAttribute('data-name') || '');
            const aliases = normalizarTextoBusca(opt.getAttribute('data-aliases') || '');
            const val = normalizarTextoBusca(opt.getAttribute('data-value') || '');

            const matches = !normTerm ||
                name.includes(normTerm) ||
                aliases.includes(normTerm) ||
                val.includes(normTerm);
            opt.style.display = matches ? 'block' : 'none';
        });
    }

    // =============================================
    // === RENDERIZAÇÃO DOS CONTROLES DE PAGINAÇÃO ===
    // =============================================

    function renderPagination(pagination) {
        if (!paginationContainer) return;

        if (!pagination || pagination.totalItems === 0) {
            paginationContainer.innerHTML = '';
            return;
        }

        const { currentPage: curr, totalPages: total, totalItems: itemsCount } = pagination;

        if (total <= 1) {
            paginationContainer.innerHTML = `<span class="pagination-info">${itemsCount} produto(s) encontrado(s)</span>`;
            return;
        }

        let html = '';

        // Botão Anterior
        html += `<button ${curr <= 1 ? 'disabled' : ''} data-page="${curr - 1}" title="Página Anterior">
                    <i class="fas fa-chevron-left"></i>
                 </button>`;

        // Janela de páginas
        const maxVisible = 5;
        let startPage = Math.max(1, curr - Math.floor(maxVisible / 2));
        let endPage = Math.min(total, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            html += `<button data-page="1">1</button>`;
            if (startPage > 2) html += `<span class="pagination-info">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button data-page="${i}" class="${i === curr ? 'active' : ''}">${i}</button>`;
        }

        if (endPage < total) {
            if (endPage < total - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${total}">${total}</button>`;
        }

        // Botão Próximo
        html += `<button ${curr >= total ? 'disabled' : ''} data-page="${curr + 1}" title="Próxima Página">
                    <i class="fas fa-chevron-right"></i>
                 </button>`;

        html += `<span class="pagination-info">${itemsCount} produto(s) — Página ${curr} de ${total}</span>`;

        paginationContainer.innerHTML = html;

        paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetPage = parseInt(btn.dataset.page, 10);
                if (targetPage && targetPage !== currentPage && !btn.disabled) {
                    currentPage = targetPage;
                    aplicarFiltrosEOrdenar();
                }
            });
        });
    }

    // =============================================
    // === FUNÇÕES UTILITÁRIAS ===
    // =============================================

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
