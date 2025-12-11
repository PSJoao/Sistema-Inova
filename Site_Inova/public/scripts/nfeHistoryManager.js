// public/scripts/nfeHistoryManager.js

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Seleção de Elementos ---
    const elements = {
        gridContainer: document.getElementById('nfe-history-grid'),
        paginationContainer: document.getElementById('nfe-history-pagination'),
        situacaoFilter: document.getElementById('nfe-history-situacao-filter'),
        justificativaFilter: document.getElementById('nfe-history-justificativa-filter'),
        searchInput: document.getElementById('nfe-history-search-input'),
        reportBtn: document.getElementById('nfe-history-report-btn'),
        reportJustificationsBtn: document.getElementById('nfe-history-justify-report-btn'),
        cardTemplate: document.getElementById('nfe-history-card-template'),
        missingProductsContainer: document.getElementById('nfe-history-missing-products-container'),
        missingProductsList: document.getElementById('nfe-history-missing-products-list'),
        productsByCarrierBtn: document.getElementById('nfe-history-products-carrier-btn'),
    };

    if (!elements.gridContainer) {
        return; // Se não estiver na página certa, não faz nada
    }

    // --- 2. Estado da Aplicação ---
    let state = {
        currentPage: 1,
        totalPages: 1,
        search: '',
        situacao: '',
        justificativa: '',
        currentNfeNumbers: []
    };

    let debounceTimer;

    // --- 3. Funções de Renderização e API ---

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
        }
    };

    function createTableRowHTML(nfe, allJustifications) {
        const isPendente = nfe.status_para_relacao === 'pendente';
        const hasJustificativa = nfe.justificativa && nfe.justificativa.trim() !== '';

        let actionOptions = '<option value="">Selecione uma ação...</option>';
        if (hasJustificativa) {
            actionOptions += '<option value="LIMPAR_JUSTIFICATIVA">Limpar Justificativa</option>';
        }
        actionOptions += `
            <option value="Não tem produto">Não tem produto</option>
            <option value="Não deu tempo de etiquetar">Não deu tempo de etiquetar</option>
            <option value="NF não localizada fisicamente">NF não localizada fisicamente</option>
            <option value="CANCELAR_NOTA">Cancelar Nota</option>
        `;

        return `
            <div class="nfe-history-card" data-nfe-id="${nfe.id}">
                <div class="nfe-info nfe-number">${nfe.nfe_numero || ''}</div>
                <div class="nfe-info nfe-date">${helpers.formatDate(nfe.data_emissao)}</div>
                <div class="nfe-info nfe-status-container">
                    <span class="nfe-status status-${nfe.status_para_relacao}">${nfe.status_para_relacao || 'N/A'}</span>
                </div>
                <div class="nfe-info nfe-transportadora">${nfe.transportadora_apelido || ''}</div>
                <div class="nfe-info product-list" title="${nfe.product_descriptions_list || ''}">${helpers.truncate(nfe.product_descriptions_list, 50)}</div>
                <div class="nfe-info nfe-justification">${nfe.justificativa || ''}</div>
                <div class="nfe-info nfe-date">${helpers.formatDate(nfe.data_acao)}</div>
                <div class="nfe-info nfe-action">
                    <select class="nfe-action-select" data-nfe-id-select="${nfe.id}" ${isPendente || hasJustificativa ? '' : 'disabled'}>
                        ${actionOptions}
                    </select>
                </div>
            </div>
        `;
    }

    function renderTableRows(nfeData) {
        elements.gridContainer.innerHTML = '';
        state.currentNfeNumbers = [];
        if (!nfeData || nfeData.length === 0) {
            elements.gridContainer.innerHTML = '<p class="no-results-message" style="grid-column: 1 / -1; padding: 2rem; text-align: center;">Nenhuma nota fiscal encontrada.</p>';
            return;
        }
        // [CORREÇÃO] Pega a lista de justificativas do filtro para passar para a função de renderização
        const allJustifications = Array.from(elements.justificativaFilter.options)
            .map(opt => opt.value)
            .filter(val => val && val !== 'SEM_JUSTIFICATIVA' && val !== 'LIMPAR_JUSTIFICATIVA' && val !== 'CANCELAR_NOTA');

        const allRowsHTML = nfeData.map(nfe => {
            state.currentNfeNumbers.push(nfe.nfe_numero);
            return createTableRowHTML(nfe, allJustifications);
        }).join('');
        
        elements.gridContainer.innerHTML = allRowsHTML;
    }
    
    function renderPagination({ currentPage, totalPages }) {
        state.currentPage = parseInt(currentPage, 10);
        state.totalPages = parseInt(totalPages, 10);
        if (totalPages <= 1) {
            elements.paginationContainer.innerHTML = '';
            return;
        }
        let optionsHtml = '';
        for (let i = 1; i <= totalPages; i++) {
            optionsHtml += `<option value="${i}" ${i === state.currentPage ? 'selected' : ''}>Página ${i}</option>`;
        }
        elements.paginationContainer.innerHTML = `
            <button id="nfe-history-prev-page" class="btn btn-secondary" ${state.currentPage === 1 ? 'disabled' : ''}>&laquo; Anterior</button>
            <select id="nfe-history-page-select" class="page-select-dropdown">${optionsHtml}</select>
            <button id="nfe-history-next-page" class="btn btn-secondary" ${state.currentPage >= state.totalPages ? 'disabled' : ''}>Próxima &raquo;</button>
        `;
    }
    
    function renderMissingProducts(structureCounts) {
        elements.missingProductsList.innerHTML = '';
        if (!structureCounts || structureCounts.length === 0) {
            elements.missingProductsList.innerHTML = '<li>Nenhuma estrutura faltante encontrada para as notas fiscais visíveis.</li>';
            return;
        }
        structureCounts.forEach(item => {
            const listItem = document.createElement('li');
            listItem.innerHTML = `<span class="product-name">${item.name}</span><span class="product-count">${item.count}</span>`;
            elements.missingProductsList.appendChild(listItem);
        });
    }

    async function fetchData() {
        document.body.classList.add('loading');
        const params = new URLSearchParams({
            page: state.currentPage,
            situacao: state.situacao,
            justificativa: state.justificativa,
            search: state.search
        });
        try {
            const response = await fetch(`/historico-nfe/api/history?${params.toString()}`);
            if (!response.ok) throw new Error('Falha ao buscar dados das NF-es.');
            
            const data = await response.json();
            
            // [CORREÇÃO] As duas funções são chamadas aqui, garantindo que a paginação sempre atualize
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
            elements.gridContainer.innerHTML = '<p class="no-results-message" style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--color-danger);">Ocorreu um erro ao carregar os dados.</p>';
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
        state.search = elements.searchInput.value;
        fetchData();
    }
    
    elements.situacaoFilter.addEventListener('change', handleFilterChange);
    elements.justificativaFilter.addEventListener('change', handleFilterChange);
    elements.searchInput.addEventListener('keyup', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(handleFilterChange, 500);
    });
    
    elements.paginationContainer.addEventListener('click', (e) => {
        if (e.target.id === 'nfe-history-prev-page' && state.currentPage > 1) {
            state.currentPage--;
            fetchData();
        }
        if (e.target.id === 'nfe-history-next-page' && state.currentPage < state.totalPages) {
            state.currentPage++;
            fetchData();
        }
    });
    elements.paginationContainer.addEventListener('change', (e) => {
        if (e.target.id === 'nfe-history-page-select') {
            state.currentPage = parseInt(e.target.value, 10);
            fetchData();
        }
    });
        
    // [NOVO] Listener de Ações com a nova lógica
    elements.gridContainer.addEventListener('change', async (e) => {
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
                    // [CORREÇÃO APLICADA AQUI] A URL agora aponta para a rota correta e dedicada.
                    handleAction('/historico-nfe/api/nfe/update-justification', { nfeId, justification: newAction });
                }, () => { e.target.selectedIndex = 0; });
            }
        }
    });

    elements.reportBtn.addEventListener('click', async () => {
        // Mostra um feedback visual para o usuário
        const originalButtonText = elements.reportBtn.innerHTML;
        elements.reportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportBtn.disabled = true;

        const params = new URLSearchParams({
            situacao: state.situacao,
            justificativa: state.justificativa,
            search: state.search
        });
        const reportUrl = `/historico-nfe/api/report/missing-products?${params.toString()}`;

        try {
            const response = await fetch(reportUrl);

            // Se a resposta NÃO for um sucesso (ex: erro 500)
            if (!response.ok) {
                const errorMessage = await response.text(); // Pega a mensagem de erro que o controller enviou
                throw new Error(errorMessage);
            }

            // Se a resposta for um sucesso, processa o download
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
            // Exibe o erro no seu ModalSystem
            ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
        } finally {
            // Restaura o botão ao estado original
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
                // Chama a rota que criamos (lembre-se de criar a rota no arquivo de rotas)
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
                // Assume que você tem o ModalSystem disponível como nos outros scripts
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
        // Mostra um feedback visual para o usuário
        const originalButtonText = elements.reportJustificationsBtn.innerHTML;
        elements.reportJustificationsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportJustificationsBtn.disabled = true;

        const params = new URLSearchParams({
            situacao: state.situacao,
            justificativa: state.justificativa,
            search: state.search
        });
        const reportUrl = `/historico-nfe/api/nfe/generate-report-justifications?${params.toString()}`;

        try {
            const response = await fetch(reportUrl);

            // Se a resposta NÃO for um sucesso (ex: erro 500)
            if (!response.ok) {
                const errorMessage = await response.text(); // Pega a mensagem de erro que o controller enviou
                throw new Error(errorMessage);
            }

            // Se a resposta for um sucesso, processa o download
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
            // Exibe o erro no seu ModalSystem
            ModalSystem.alert(error.message, 'Erro ao Gerar Relatório');
        } finally {
            // Restaura o botão ao estado original
            elements.reportJustificationsBtn.innerHTML = originalButtonText;
            elements.reportJustificationsBtn.disabled = false;
        }
    });

    // Carga inicial dos dados
    fetchData();
});