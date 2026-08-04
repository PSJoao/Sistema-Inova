// public/scripts/nfeHistoryManager.js

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Seleção de Elementos ---
    const elements = {
        tableBody: document.getElementById('table-body'),
        tableHeaders: document.querySelectorAll('#tabela-estoque th.sortable'),
        paginationContainer: document.getElementById('pagination-container'),
        emptyState: document.getElementById('empty-state'),
        situacaoFilter: document.getElementById('nfe-history-situacao-filter'),
        justificativaFilter: document.getElementById('nfe-history-justificativa-filter'),
        carrierFilter: document.getElementById('nfe-history-carrier-filter'),
        limiteFilter: document.getElementById('nfe-history-limite-filter'),
        searchInput: document.getElementById('nfe-history-search-input'),
        dataInicial: document.getElementById('nfe-history-data-inicial'),
        dataFinal: document.getElementById('nfe-history-data-final'),
        reportBtn: document.getElementById('nfe-history-report-btn'),
        reportJustificationsBtn: document.getElementById('nfe-history-justify-report-btn'),
        separationReportBtn: document.getElementById('nfe-history-separation-report-btn'),
        missingProductsContainer: document.getElementById('nfe-history-missing-products-container'),
        missingProductsList: document.getElementById('nfe-history-missing-products-list'),
        productsByCarrierBtn: document.getElementById('nfe-history-products-carrier-btn'),
        
        // Elementos de Seleção Manual
        normalActions: document.getElementById('normal-actions'),
        selectionActions: document.getElementById('selection-actions'),
        generateSelectedBtn: document.getElementById('nfe-generate-selected-btn'),
        cancelSelectionBtn: document.getElementById('nfe-cancel-selection-btn'),
        selectAllCheckbox: document.getElementById('nfe-select-all'),
        selectedCountSpan: document.getElementById('selected-count')
    };

    if (!elements.tableBody) {
        return; // Se não estiver na página certa, não faz nada
    }

    // Sobrescreve permanentemente o hide do ModalSystem nesta página para garantir que as labels
    // dos botões de Confirmação sejam sempre restauradas ao valor padrão
    const origHide = ModalSystem.hide;
    ModalSystem.hide = function() {
        const btnConfirm = document.getElementById('customModalBtnConfirm');
        const btnCancel = document.getElementById('customModalBtnCancel');
        if (btnConfirm) btnConfirm.textContent = 'Confirmar';
        if (btnCancel) btnCancel.textContent = 'Cancelar';
        return origHide.apply(this, arguments);
    };

    // --- 2. Estado da Aplicação ---
    let state = {
        currentPage: 1,
        pageLimit: 50,
        orderBy: 'data_emissao',
        orderDir: 'DESC',
        search: '',
        situacao: '',
        justificativa: '',
        transportadora: '',
        dataInicial: '',
        dataFinal: '',
        currentNfeNumbers: [],
        
        // Estado da Seleção Manual
        manualSelectionMode: false,
        selectedNfeNumbers: new Set()
    };

    let debounceTimer;

    // --- 3. Inicialização de Período (Padrão 1 Mês Atrás) ---
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setMonth(today.getMonth() - 1);

    const formatDateForInput = (date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };

    if (elements.dataInicial && !elements.dataInicial.value) {
        elements.dataInicial.value = formatDateForInput(lastMonth);
    }
    if (elements.dataFinal && !elements.dataFinal.value) {
        elements.dataFinal.value = formatDateForInput(today);
    }

    state.dataInicial = elements.dataInicial ? elements.dataInicial.value : '';
    state.dataFinal = elements.dataFinal ? elements.dataFinal.value : '';

    // --- 4. Funções Auxiliares ---
    const helpers = {
        formatDate: (dateString) => {
            if (!dateString) return 'N/A';
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Inválido';
            const day = String(date.getUTCDate()).padStart(2, '0');
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const year = date.getUTCFullYear();
            return `${day}/${month}/${year}`;
        },
        truncate: (str, len) => {
            if (!str || typeof str !== 'string') return '';
            return str.length > len ? str.substring(0, len) + '...' : str;
        },
        escapeHtml: (text) => {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // --- 5. Renderização ---

    const updateHeaderClasses = () => {
        elements.tableHeaders.forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === state.orderBy) {
                th.classList.add(state.orderDir.toLowerCase());
            }
        });
    };

    function renderTableRows(nfeData) {
        elements.tableBody.innerHTML = '';
        state.currentNfeNumbers = [];

        // Exibe ou oculta a coluna de checkboxes nos cabeçalhos e células
        document.querySelectorAll('.checkbox-col').forEach(el => {
            el.style.display = state.manualSelectionMode ? 'table-cell' : 'none';
        });

        if (!nfeData || nfeData.length === 0) {
            elements.emptyState.style.display = 'block';
            elements.paginationContainer.innerHTML = '';
            return;
        }

        elements.emptyState.style.display = 'none';

        nfeData.forEach(nfe => {
            state.currentNfeNumbers.push(nfe.nfe_numero);

            const isPendente = nfe.status_para_relacao === 'pendente';
            const hasJustificativa = nfe.justificativa && nfe.justificativa.trim() !== '';

            let actionOptions = '<option value="">Selecione...</option>';
            if (hasJustificativa) {
                actionOptions += '<option value="LIMPAR_JUSTIFICATIVA">Limpar Justificativa</option>';
            }
            actionOptions += `
                <option value="Não tem produto">Não tem produto</option>
                <option value="Não deu tempo de etiquetar">Não deu tempo de etiquetar</option>
                <option value="NF não localizada fisicamente">NF não localizada fisicamente</option>
                <option value="CANCELAR_NOTA">Cancelar Nota</option>
            `;

            let checkboxTd = '';
            if (state.manualSelectionMode) {
                const isChecked = state.selectedNfeNumbers.has(nfe.nfe_numero);
                checkboxTd = `
                    <td class="checkbox-col" style="text-align: center; width: 40px; vertical-align: middle;">
                        <input type="checkbox" class="nfe-row-checkbox" data-nfe-numero="${nfe.nfe_numero}" ${isChecked ? 'checked' : ''}>
                    </td>
                `;
            }

            const tr = document.createElement('tr');
            tr.dataset.nfeId = nfe.id;
            tr.className = 'nfe-history-card';

            tr.innerHTML = `
                ${checkboxTd}
                <td><strong class="nfe-number">${helpers.escapeHtml(nfe.nfe_numero || '')}</strong></td>
                <td>${helpers.formatDate(nfe.data_emissao)}</td>
                <td><span class="nfe-status status-${nfe.status_para_relacao}">${helpers.escapeHtml(nfe.status_para_relacao || 'N/A')}</span></td>
                <td>${helpers.escapeHtml(nfe.transportadora_apelido || '')}</td>
                <td style="max-width: 300px; word-break: break-word; white-space: normal;" title="${helpers.escapeHtml(nfe.product_descriptions_list || '')}">
                    ${helpers.escapeHtml(helpers.truncate(nfe.product_descriptions_list, 50))}
                </td>
                <td>${helpers.escapeHtml(nfe.justificativa || '-')}</td>
                <td>${helpers.formatDate(nfe.data_acao)}</td>
                <td>
                    <select class="nfe-action-select form-control form-control-sm" data-nfe-id-select="${nfe.id}" ${isPendente || hasJustificativa ? '' : 'disabled'} style="max-width: 160px; display: inline-block;">
                        ${actionOptions}
                    </select>
                </td>
            `;
            elements.tableBody.appendChild(tr);
        });

        // Atualizar estado do checkbox select-all do cabeçalho
        if (state.manualSelectionMode && elements.selectAllCheckbox) {
            const allCbs = elements.tableBody.querySelectorAll('.nfe-row-checkbox');
            const checkedCbs = elements.tableBody.querySelectorAll('.nfe-row-checkbox:checked');
            elements.selectAllCheckbox.checked = allCbs.length === checkedCbs.length && allCbs.length > 0;
        }
    }

    function renderPagination(pagination) {
        const { currentPage, totalPages, totalItems } = pagination;
        state.currentPage = parseInt(currentPage, 10);

        if (totalPages <= 1) {
            elements.paginationContainer.innerHTML = `<span class="pagination-info">${totalItems || 0} nota(s) encontrada(s)</span>`;
            return;
        }

        let html = '';

        // Botão anterior
        html += `<button ${state.currentPage <= 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">
                    <i class="fas fa-chevron-left"></i>
                 </button>`;

        // Páginas
        const maxVisible = 5;
        let startPage = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            html += `<button data-page="1">1</button>`;
            if (startPage > 2) html += `<span class="pagination-info">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button data-page="${i}" class="${i === state.currentPage ? 'active' : ''}">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${totalPages}">${totalPages}</button>`;
        }

        // Botão próximo
        html += `<button ${state.currentPage >= totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">
                    <i class="fas fa-chevron-right"></i>
                 </button>`;

        html += `<span class="pagination-info">${totalItems} nota(s)</span>`;

        elements.paginationContainer.innerHTML = html;

        // Event listeners para paginação
        elements.paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page !== state.currentPage && !btn.disabled) {
                    state.currentPage = page;
                    fetchData();
                }
            });
        });
    }

    function renderMissingProducts(structureCounts) {
        elements.missingProductsList.innerHTML = '';
        if (!structureCounts || structureCounts.length === 0) {
            elements.missingProductsList.innerHTML = '<li>Nenhuma estrutura faltante encontrada para as notas fiscais visíveis.</li>';
            return;
        }
        structureCounts.forEach(item => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `<span class="product-name">${helpers.escapeHtml(item.name)}</span><span class="product-count">${item.count}</span>`;
            elements.missingProductsList.appendChild(listItem);
        });
    }

    // --- 6. Lógica de API ---

    async function fetchData() {
        document.body.classList.add('loading');
        updateHeaderClasses();

        const params = new URLSearchParams({
            page: state.currentPage,
            limit: state.pageLimit,
            orderBy: state.orderBy,
            orderDir: state.orderDir,
            situacao: state.situacao,
            justificativa: state.justificativa,
            transportadora: state.transportadora,
            search: state.search,
            dataInicial: state.dataInicial,
            dataFinal: state.dataFinal
        });

        try {
            const response = await fetch(`/historico-nfe/api/history?${params.toString()}`);
            if (!response.ok) throw new Error('Falha ao buscar dados das NF-es.');

            const data = await response.json();

            renderTableRows(data.nfeData);
            renderPagination(data.pagination);

            if (state.justificativa === 'Não tem produto') {
                elements.missingProductsContainer.style.display = 'block';
                fetchMissingProducts();
            } else {
                elements.missingProductsContainer.style.display = 'none';
            }
        } catch (error) {
            console.error("Erro ao buscar dados:", error);
            elements.tableBody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Ocorreu um erro ao carregar os dados.</td></tr>';
            elements.emptyState.style.display = 'block';
        } finally {
            document.body.classList.remove('loading');
        }
    }

    async function fetchMissingProducts() {
        if (state.currentNfeNumbers.length === 0) {
            renderMissingProducts([]);
            return;
        }
        try {
            const response = await fetch('/historico-nfe/api/missing-product-count', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nfeNumeros: state.currentNfeNumbers })
            });
            if (!response.ok) throw new Error('Falha ao buscar contagem de produtos.');
            const data = await response.json();
            renderMissingProducts(data.structureCounts);
        } catch (error) {
            console.error(error);
        }
    }

    function handleFilterChange() {
        state.currentPage = 1;
        state.situacao = elements.situacaoFilter.value;
        state.justificativa = elements.justificativaFilter.value;
        state.transportadora = elements.carrierFilter.value;
        state.pageLimit = parseInt(elements.limiteFilter.value) || 50;
        state.search = elements.searchInput.value;
        state.dataInicial = elements.dataInicial.value;
        state.dataFinal = elements.dataFinal.value;
        fetchData();
    }

    const handleSort = (column) => {
        if (state.orderBy === column) {
            state.orderDir = state.orderDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            state.orderBy = column;
            state.orderDir = 'DESC'; // Padrão mais recentes/decrescente
        }
        state.currentPage = 1;
        fetchData();
    };

    // --- 7. Seleção Manual ---

    function startManualSelectionMode() {
        state.manualSelectionMode = true;
        state.selectedNfeNumbers.clear();
        
        elements.normalActions.style.display = 'none';
        elements.selectionActions.style.display = 'flex';
        updateSelectedCount();
        
        // Re-renderiza a tabela atual para exibir as caixas de seleção
        fetchData();
    }

    function stopManualSelectionMode() {
        state.manualSelectionMode = false;
        state.selectedNfeNumbers.clear();
        
        elements.normalActions.style.display = 'flex';
        elements.selectionActions.style.display = 'none';
        
        if (elements.selectAllCheckbox) {
            elements.selectAllCheckbox.checked = false;
        }
        
        // Re-renderiza para remover a coluna de checkboxes
        fetchData();
    }

    function updateSelectedCount() {
        if (elements.selectedCountSpan) {
            elements.selectedCountSpan.textContent = state.selectedNfeNumbers.size;
        }
    }

    // --- 8. Event Listeners ---

    // Filtros e Ordenação
    elements.situacaoFilter.addEventListener('change', handleFilterChange);
    elements.justificativaFilter.addEventListener('change', handleFilterChange);
    elements.carrierFilter.addEventListener('change', handleFilterChange);
    elements.limiteFilter.addEventListener('change', handleFilterChange);
    if (elements.dataInicial) elements.dataInicial.addEventListener('change', handleFilterChange);
    if (elements.dataFinal) elements.dataFinal.addEventListener('change', handleFilterChange);

    elements.tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;
            handleSort(column);
        });
    });

    elements.searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(handleFilterChange, 400);
    });

    // Checkboxes individual e Select-all
    if (elements.selectAllCheckbox) {
        elements.selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            elements.tableBody.querySelectorAll('.nfe-row-checkbox').forEach(cb => {
                cb.checked = isChecked;
                const nfeNum = cb.dataset.nfeNumero;
                if (isChecked) {
                    state.selectedNfeNumbers.add(nfeNum);
                } else {
                    state.selectedNfeNumbers.delete(nfeNum);
                }
            });
            updateSelectedCount();
        });
    }

    elements.tableBody.addEventListener('change', (e) => {
        if (e.target.classList.contains('nfe-row-checkbox')) {
            const nfeNum = e.target.dataset.nfeNumero;
            if (e.target.checked) {
                state.selectedNfeNumbers.add(nfeNum);
            } else {
                state.selectedNfeNumbers.delete(nfeNum);
            }
            
            // Atualiza select-all
            if (elements.selectAllCheckbox) {
                const allCbs = elements.tableBody.querySelectorAll('.nfe-row-checkbox');
                const checkedCbs = elements.tableBody.querySelectorAll('.nfe-row-checkbox:checked');
                elements.selectAllCheckbox.checked = allCbs.length === checkedCbs.length && allCbs.length > 0;
            }
            
            updateSelectedCount();
        }
    });

    // Cancelar Seleção
    if (elements.cancelSelectionBtn) {
        elements.cancelSelectionBtn.addEventListener('click', () => {
            stopManualSelectionMode();
        });
    }

    // Gerar Relatório de Notas Selecionadas
    if (elements.generateSelectedBtn) {
        elements.generateSelectedBtn.addEventListener('click', async () => {
            if (state.selectedNfeNumbers.size === 0) {
                ModalSystem.alert('Por favor, selecione ao menos uma nota fiscal para gerar o relatório.', 'Atenção');
                return;
            }

            const originalButtonText = elements.generateSelectedBtn.innerHTML;
            elements.generateSelectedBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
            elements.generateSelectedBtn.disabled = true;

            const nfeNumerosStr = Array.from(state.selectedNfeNumbers).join(',');
            const reportParams = new URLSearchParams({
                nfe_numeros: nfeNumerosStr,
                orderBy: state.orderBy,
                orderDir: state.orderDir
            });

            const reportUrl = `/historico-nfe/api/report/separation?${reportParams.toString()}`;

            try {
                const response = await fetch(reportUrl);
                if (!response.ok) {
                    const errorMessage = await response.text();
                    throw new Error(errorMessage || 'Erro ao baixar o relatório.');
                }
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'Relatorio_Separacao.pdf';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
                
                // Sai do modo de seleção após gerar com sucesso
                stopManualSelectionMode();
            } catch (error) {
                ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
            } finally {
                elements.generateSelectedBtn.innerHTML = originalButtonText;
                elements.generateSelectedBtn.disabled = false;
            }
        });
    }

    // Listener de Ações com Delegação
    elements.tableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('nfe-action-select')) {
            const nfeId = e.target.dataset.nfeIdSelect;
            const newAction = e.target.value;
            if (!nfeId || !newAction) return;

            const nfeNumero = e.target.closest('.nfe-history-card').querySelector('.nfe-number').textContent;

            const handleAction = async (url, body, successMessage) => {
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    ModalSystem.alert(successMessage || result.message, 'Sucesso');
                    fetchData(); // Recarrega a tabela
                } catch (error) {
                    ModalSystem.alert(`Erro: ${error.message}`, 'Falha na Operação');
                }
            };

            if (newAction === 'LIMPAR_JUSTIFICATIVA') {
                ModalSystem.confirm(`Deseja realmente limpar a justificativa da NF Nº ${nfeNumero}?`, "Confirmar Limpeza", () => {
                    handleAction('/historico-nfe/api/nfe/clear-justification', { nfeId });
                }, () => { e.target.selectedIndex = 0; });
            } else if (newAction === 'CANCELAR_NOTA') {
                ModalSystem.confirm(`ATENÇÃO: Deseja realmente CANCELAR a NF Nº ${nfeNumero}? Esta ação não pode ser desfeita.`, "Confirmar Cancelamento", () => {
                    handleAction('/historico-nfe/api/nfe/cancel', { nfeId });
                }, () => { e.target.selectedIndex = 0; });
            } else { // Justificativas
                let confirmationMessage = `Deseja definir a justificativa da NF Nº ${nfeNumero} como "${newAction}"?`;
                ModalSystem.confirm(confirmationMessage, "Confirmar Ação", () => {
                    handleAction('/historico-nfe/api/nfe/update-justification', { nfeId, justification: newAction });
                }, () => { e.target.selectedIndex = 0; });
            }
        }
    });

    // Relatórios downloads
    const getReportParams = () => {
        return new URLSearchParams({
            situacao: state.situacao,
            justificativa: state.justificativa,
            transportadora: state.transportadora,
            search: state.search,
            dataInicial: state.dataInicial,
            dataFinal: state.dataFinal,
            orderBy: state.orderBy,
            orderDir: state.orderDir
        });
    };

    elements.reportBtn.addEventListener('click', async () => {
        const originalButtonText = elements.reportBtn.innerHTML;
        elements.reportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportBtn.disabled = true;

        const reportUrl = `/historico-nfe/api/report/missing-products?${getReportParams().toString()}`;

        try {
            const response = await fetch(reportUrl);
            if (!response.ok) {
                const errorMessage = await response.text();
                throw new Error(errorMessage);
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'Relatorio_Estruturas_Faltantes.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (error) {
            ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
        } finally {
            elements.reportBtn.innerHTML = originalButtonText;
            elements.reportBtn.disabled = false;
        }
    });

    if (elements.productsByCarrierBtn) {
        elements.productsByCarrierBtn.addEventListener('click', async () => {
            const originalText = elements.productsByCarrierBtn.innerHTML;
            elements.productsByCarrierBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
            elements.productsByCarrierBtn.disabled = true;

            try {
                const response = await fetch('/historico-nfe/api/report/pending-products-by-carrier');
                if (!response.ok) {
                    const errorMsg = await response.text();
                    throw new Error(errorMsg || "Erro ao baixar relatório");
                }
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'Produtos_Pendentes_Por_Transportadora.xlsx';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            } catch (error) {
                console.error(error);
                if (typeof ModalSystem !== 'undefined') {
                    ModalSystem.alert(error.message, 'Erro');
                } else {
                    alert(error.message);
                }
            } finally {
                elements.productsByCarrierBtn.innerHTML = originalText;
                elements.productsByCarrierBtn.disabled = false;
            }
        });
    }

    elements.reportJustificationsBtn.addEventListener('click', async () => {
        const originalButtonText = elements.reportJustificationsBtn.innerHTML;
        elements.reportJustificationsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportJustificationsBtn.disabled = true;

        const reportUrl = `/historico-nfe/api/nfe/generate-report-justifications?${getReportParams().toString()}`;

        try {
            const response = await fetch(reportUrl);
            if (!response.ok) {
                const errorMessage = await response.text();
                throw new Error(errorMessage);
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'Relatorio_Notas.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } catch (error) {
            ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
        } finally {
            elements.reportJustificationsBtn.innerHTML = originalButtonText;
            elements.reportJustificationsBtn.disabled = false;
        }
    });

    if (elements.separationReportBtn) {
        elements.separationReportBtn.addEventListener('click', async () => {
            const btnConfirm = document.getElementById('customModalBtnConfirm');
            const btnCancel = document.getElementById('customModalBtnCancel');

            if (btnConfirm) btnConfirm.textContent = 'Selecionar Manualmente';
            if (btnCancel) btnCancel.textContent = 'Usar Filtros';

            ModalSystem.confirm(
                "Como deseja gerar o relatório de separação de produtos?",
                "Relatório de Separação",
                () => {
                    // Manual selection mode
                    startManualSelectionMode();
                },
                async () => {
                    // Filter-based generation
                    const originalButtonText = elements.separationReportBtn.innerHTML;
                    elements.separationReportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
                    elements.separationReportBtn.disabled = true;

                    const reportUrl = `/historico-nfe/api/report/separation?${getReportParams().toString()}`;

                    try {
                        const response = await fetch(reportUrl);
                        if (!response.ok) {
                            const errorMessage = await response.text();
                            throw new Error(errorMessage || 'Erro ao baixar o relatório.');
                        }
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        a.download = 'Relatorio_Separacao.pdf';
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        a.remove();
                    } catch (error) {
                        ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
                    } finally {
                        elements.separationReportBtn.innerHTML = originalButtonText;
                        elements.separationReportBtn.disabled = false;
                    }
                }
            );
        });
    }

    // --- 9. Carga Inicial ---
    fetchData();
});