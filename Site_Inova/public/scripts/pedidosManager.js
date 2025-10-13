// ✍️ /public/scripts/pedidosManager.js (VERSÃO COM TABELA CUSTOMIZADA)

$(document).ready(function () {
    // --- 1. Seleção de Elementos DOM ---
    const elements = {
        table: $('#acmp-pedidos-table'),
        tableBody: $('#acmp-pedidos-table tbody'),
        tableHeader: $('#acmp-pedidos-table thead'),
        loadingOverlay: $('#acmp-loading-overlay'),
        selectAllCheckbox: $('#acmp-select-all-checkbox'),
        selectionInfoBar: $('#acmp-selection-info-bar'),
        selectionCount: $('#acmp-selection-count'),
        clearSelectionBtn: $('#acmp-clear-selection-btn'),
        bulkActionContainer: $('#acmp-bulk-action-container'),
        btnApplyBulkComissao: $('#acmp-btn-apply-bulk-comissao'),
        comissaoPercentualInput: $('#acmp-comissao-percentual-input'),
        minDate: $('#acmp-min-date'),
        maxDate: $('#acmp-max-date'),
        platformFilter: $('#acmp-platform-filter'),
        searchInput: $('#acmp-search-input'),
        pageLengthSelect: $('#acmp-page-length'),
        paginationNav: $('#acmp-pagination-nav'),
        paginationSummary: $('#acmp-pagination-summary')
    };

    // --- 2. Estado da Aplicação ---
    const state = {
        data: [],
        totalRecords: 0,
        filteredRecords: 0,
        currentPage: 1,
        pageLength: 10,
        searchTerm: '',
        sortBy: 'data_aprovacao',
        sortDir: 'desc',
        selection: new Set()
    };

    // --- 3. Funções de Renderização ---

    /** Formata um valor monetário */
    const formatCurrency = (value) => {
        if (value === null || value === undefined) return '';
        return parseFloat(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
    
    /** Formata uma data */
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    };

    /** Renderiza uma única linha da tabela */
    function renderRow(pedido) {
        const isSelected = state.selection.has(pedido.id);
        const produtoNome = pedido.nome_produto || '';
        // [ALTERADO] Removida a classe 'acmp-selected' do <tr>
        return `
            <tr data-id="${pedido.id}">
                <td class="acmp-col-checkbox"><input type="checkbox" class="acmp-row-checkbox" ${isSelected ? 'checked' : ''}></td>
                <td>${formatDate(pedido.data_aprovacao)}</td>
                <td>${pedido.plataforma || ''}</td>
                <td>${pedido.numero_pedido || ''}</td>
                <td>${pedido.numero_nfe || ''}</td>
                <td>${pedido.nome_cliente || ''}</td>
                <td>${pedido.estado_uf || ''}</td>
                <td><span title="${produtoNome}">${produtoNome.length > 40 ? produtoNome.substr(0, 40) + '...' : produtoNome}</span></td>
                <td>${pedido.sku_loja || ''}</td>
                <td class="acmp-col-currency">${formatCurrency(pedido.valor_produto)}</td>
                <td class="acmp-col-currency">${formatCurrency(pedido.valor_frete)}</td>
                <td class="acmp-col-currency">${formatCurrency(pedido.desconto_produto)}</td>
                <td class="acmp-col-currency">${formatCurrency(pedido.custo_produto)}</td>
                <td class="acmp-col-currency">${formatCurrency(pedido.comissao)}</td>
                <td>${pedido.comissao_percentual ? parseFloat(pedido.comissao_percentual).toFixed(2) + '%' : 'N/A'}</td>
                <td class="acmp-col-acoes">
                    <button class="btn btn-icon btn-danger-alt btn-sm btn-delete-pedido" data-id="${pedido.id}" data-nfe="${pedido.numero_nfe || ''}" title="Apagar Pedido"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }

    /** Renderiza a paginação */
    function renderPagination() {
        const totalPages = Math.ceil(state.filteredRecords / state.pageLength);
        const current = state.currentPage;
        const pageWindow = 2; // Quantas páginas mostrar antes e depois da atual
        
        if (totalPages <= 1) {
            elements.paginationNav.html('');
            return;
        }

        let html = '<ul>';

        // Botão "Anterior"
        html += `<li class="${current === 1 ? 'acmp-disabled' : ''}"><a href="#" data-page="${current - 1}">&laquo;</a></li>`;

        // Lógica de renderização dos números e elipses
        let lastPageRendered = 0;
        for (let i = 1; i <= totalPages; i++) {
            if (
                i === 1 || // Sempre mostra a primeira página
                i === totalPages || // Sempre mostra a última página
                (i >= current - pageWindow && i <= current + pageWindow) // Mostra a janela de páginas ao redor da atual
            ) {
                if (lastPageRendered && i - lastPageRendered > 1) {
                    html += `<li class="acmp-ellipsis"><span>...</span></li>`;
                }
                html += `<li class="${current === i ? 'acmp-active' : ''}"><a href="#" data-page="${i}">${i}</a></li>`;
                lastPageRendered = i;
            }
        }

        // Botão "Próximo"
        html += `<li class="${current === totalPages ? 'acmp-disabled' : ''}"><a href="#" data-page="${current + 1}">&raquo;</a></li>`;
        html += '</ul>';
        elements.paginationNav.html(html);
    }
    
    /** Atualiza o sumário da paginação */
    function updatePaginationSummary() {
        const start = state.filteredRecords > 0 ? (state.currentPage - 1) * state.pageLength + 1 : 0;
        const end = Math.min(start + state.pageLength - 1, state.filteredRecords);
        elements.paginationSummary.text(`Mostrando ${start} a ${end} de ${state.filteredRecords} registros`);
    }

    /** Atualiza o estado visual dos cabeçalhos de ordenação */
    function updateSortHeaders() {
        elements.tableHeader.find('.acmp-sortable').removeClass('sorting_asc sorting_desc');
        elements.tableHeader.find('.acmp-sortable i').attr('class', 'fas fa-sort');

        const activeHeader = elements.tableHeader.find(`.acmp-sortable[data-column="${state.sortBy}"]`);
        if (activeHeader.length) {
            activeHeader.addClass(state.sortDir === 'asc' ? 'sorting_asc' : 'sorting_desc');
            activeHeader.find('i').attr('class', `fas fa-sort-${state.sortDir === 'asc' ? 'up' : 'down'}`);
        }
    }

    // --- 4. Busca e Atualização de Dados ---

    /** Busca os dados da API e atualiza a tabela */
    async function fetchData() {
        elements.loadingOverlay.show();
        
        const params = new URLSearchParams({
            draw: Date.now(),
            start: (state.currentPage - 1) * state.pageLength,
            length: state.pageLength,
            'search[value]': state.searchTerm,
            'order[0][column]': getColumnIndex(state.sortBy),
            'order[0][dir]': state.sortDir,
            startDate: elements.minDate.val(),
            endDate: elements.maxDate.val(),
            plataforma: elements.platformFilter.val()
        });

        try {
            const response = await fetch(`/api/acompanhamento/pedidos?${params.toString()}`);
            if (!response.ok) throw new Error('Falha na resposta da rede');
            
            const json = await response.json();
            
            state.data = json.data;
            state.totalRecords = json.recordsTotal;
            state.filteredRecords = json.recordsFiltered;
            
            // Renderiza o corpo da tabela
            elements.tableBody.html(state.data.map(renderRow).join(''));
            
            renderPagination();
            updatePaginationSummary();
            updateSelectionUI();
            updateSortHeaders();

        } catch (error) {
            console.error("Erro ao buscar dados:", error);
            elements.tableBody.html('<tr><td colspan="16" class="text-center text-danger">Falha ao carregar dados.</td></tr>');
        } finally {
            elements.loadingOverlay.hide();
        }
    }
    
    // Helper para obter o índice da coluna para a API do DataTables
    function getColumnIndex(columnName) {
        const columnMap = { data_aprovacao: 1, plataforma: 2, numero_pedido: 3, numero_nfe: 4, nome_cliente: 5, valor_produto: 9 };
        return columnMap[columnName] || 1;
    }


    // --- 5. Lógica de Seleção ---

    function updateSelectionUI() {
        const count = state.selection.size;
        elements.selectionCount.text(count);
        elements.selectionInfoBar.toggle(count > 0);
        elements.bulkActionContainer.toggle(count > 0);
        
        let allOnPageSelected = true;
        let anyOnPageSelected = false;

        elements.tableBody.find('.acmp-row-checkbox').each(function() {
            const rowId = $(this).closest('tr').data('id');
            if (state.selection.has(rowId)) {
                anyOnPageSelected = true;
            } else {
                allOnPageSelected = false;
            }
        });
        
        if (state.data.length > 0 && allOnPageSelected) {
            elements.selectAllCheckbox.prop('checked', true).prop('indeterminate', false);
        } else if (anyOnPageSelected) {
            elements.selectAllCheckbox.prop('checked', false).prop('indeterminate', true);
        } else {
            elements.selectAllCheckbox.prop('checked', false).prop('indeterminate', false);
        }
    }
    
    // --- 6. Manipuladores de Eventos ---

    // Filtros e busca
    elements.minDate.on('change', fetchData);
    elements.maxDate.on('change', fetchData);
    elements.platformFilter.on('change', fetchData);
    elements.pageLengthSelect.on('change', function() {
        state.pageLength = parseInt($(this).val(), 10);
        state.currentPage = 1;
        fetchData();
    });
    
    let searchTimeout;
    elements.searchInput.on('keyup', function() {
        clearTimeout(searchTimeout);
        const value = $(this).val();
        searchTimeout = setTimeout(() => {
            state.searchTerm = value;
            state.currentPage = 1;
            fetchData();
        }, 300); // Debounce de 300ms
    });
    
    // Ordenação
    elements.tableHeader.on('click', '.acmp-sortable', function() {
        const newSortBy = $(this).data('column');
        if (state.sortBy === newSortBy) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            state.sortBy = newSortBy;
            state.sortDir = 'desc';
        }
        state.currentPage = 1;
        fetchData();
    });

    // Paginação
    elements.paginationNav.on('click', 'a', function(e) {
        e.preventDefault();
        const page = parseInt($(this).data('page'), 10);
        if (page && page !== state.currentPage && !$(this).parent().hasClass('acmp-disabled')) {
            state.currentPage = page;
            fetchData();
        }
    });

    // Seleção
    elements.selectAllCheckbox.on('click', function() {
        const isChecked = this.checked;
        elements.tableBody.find('.acmp-row-checkbox').each(function() {
            const row = $(this).closest('tr');
            const id = row.data('id');
            if (isChecked) {
                state.selection.add(id);
            } else {
                state.selection.delete(id);
            }
            // [ALTERADO] Apenas o checkbox é alterado, não a classe da linha
            $(this).prop('checked', isChecked);
        });
        updateSelectionUI();
    });
    
    elements.tableBody.on('click', '.acmp-row-checkbox', function(e) {
        const row = $(this).closest('tr');
        const id = row.data('id');
        if (this.checked) {
            state.selection.add(id);
        } else {
            state.selection.delete(id);
        }
        updateSelectionUI();
        e.stopPropagation();
    });

    elements.clearSelectionBtn.on('click', function() {
        state.selection.clear();
        // [ALTERADO] Apenas desmarca os checkboxes
        elements.tableBody.find('.acmp-row-checkbox').prop('checked', false);
        updateSelectionUI();
    });

    // Ações (Apagar e Comissão em Massa)
    elements.tableBody.on('click', '.btn-delete-pedido', async function(e) {
        e.stopPropagation();
        const pedidoId = $(this).data('id');
        const nfe = $(this).data('nfe');

        ModalSystem.confirm(`Tem certeza que deseja apagar o pedido (NF ${nfe || 'N/A'})?`, "Confirmar Exclusão", async () => {
             try {
                const response = await fetch(`/api/acompanhamento/pedido/${pedidoId}`, { method: 'DELETE' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                
                ModalSystem.alert(result.message, "Sucesso");
                fetchData(); // Recarrega os dados
            } catch (error) {
                ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação");
            }
        });
    });

    elements.btnApplyBulkComissao.on('click', function() {
        const percentual = elements.comissaoPercentualInput.val();
        const pedidoIds = Array.from(state.selection);

        if (pedidoIds.length === 0 || !percentual || parseFloat(percentual) < 0) {
            ModalSystem.alert("Selecione pelo menos um pedido e insira uma comissão válida.", "Atenção");
            return;
        }

        ModalSystem.confirm(`Aplicar ${percentual}% de comissão a ${pedidoIds.length} pedido(s)?`, "Confirmar Ação", async () => {
            ModalSystem.showLoading("Aplicando comissão...");
            try {
                const response = await fetch('/api/acompanhamento/bulk-update-comissao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pedidoIds, comissaoPercentual: percentual })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                
                ModalSystem.hideLoading();
                ModalSystem.alert(result.message, "Sucesso");
                elements.clearSelectionBtn.click();
                fetchData();
            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação");
            }
        });
    });

    // --- 7. Inicialização ---

    function setDefaultDateFilter() {
        const hoje = new Date();
        const umMesAtras = new Date();
        umMesAtras.setMonth(hoje.getMonth() - 1);

        // Formata a data para o formato YYYY-MM-DD que o input[type="date"] aceita
        const formatarData = (data) => {
            const ano = data.getFullYear();
            const mes = String(data.getMonth() + 1).padStart(2, '0');
            const dia = String(data.getDate()).padStart(2, '0');
            return `${ano}-${mes}-${dia}`;
        };

        elements.maxDate.val(formatarData(hoje));
        elements.minDate.val(formatarData(umMesAtras));
    }

    setDefaultDateFilter();
    
    fetchData();
});