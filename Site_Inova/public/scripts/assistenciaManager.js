document.addEventListener('DOMContentLoaded', () => {
    // Mapeamento de todos os elementos da UI para fácil acesso
    const elements = {
        tableContainer: document.getElementById('table-container'),
        paginationContainer: document.getElementById('pagination-container'),
        buscaInput: document.getElementById('buscaGeral'),
        situacaoSelect: document.getElementById('filtroSituacao'),
        fabricaSelect: document.getElementById('filtroFabrica'),
        dataInicioInput: document.getElementById('dataInicio'),
        dataFimInput: document.getElementById('dataFim'),
        tabs: document.querySelectorAll('#assistenciaTabs .nav-link'),
        notificationContainer: document.getElementById('notification-container'),
        bulkResolveBtn: document.getElementById('bulk-resolve-btn'),
        filtroVolumeStatusContainer: document.getElementById('filtro-volume-status-container'),
        filtroVolumeStatus: document.getElementById('filtroVolumeStatus'),
        btnResolucaoMassa: document.getElementById('btn-resolucao-massa'),
        filtroSolicitante: document.getElementById('filtroSolicitante'),
        btnExportarExcel: document.getElementById('btnExportarExcel')
    };

    // Objeto para manter o estado atual dos filtros e da página
    let state = {
        currentPage: 1,
        limit: 20,
        busca: '',
        situacao: 'Pendente', // Alterado para 'Pendente' como padrão
        fabrica: '',
        dataInicio: '',
        dataFim: '',
        activeAba: 'aba1',
        debounceTimer: null,
        totalPages: 1,
        selectedIds: new Set(),
        volumeStatus: 'Todos',
        solicitanteId: ''
    };

    /**
     * Formata uma string de data (YYYY-MM-DD) para o formato DD/MM/YYYY.
     * @param {string} dateString - A data do banco de dados.
     * @returns {string} - A data formatada.
     */
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const userTimezoneOffset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() + userTimezoneOffset).toLocaleDateString('pt-BR');
    };

    const setCookie = (name, value, days) => {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/";
    };

    const getCookie = (name) => {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    };

    const updateActiveTabVisuals = (activeAbaId) => {
        elements.tabs.forEach(tab => {
            if (tab.dataset.aba === activeAbaId) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    };

    const saveFiltersToSession = () => {
        const filtersToSave = {
            currentPage: state.currentPage,
            busca: state.busca,
            situacao: state.situacao,
            fabrica: state.fabrica,
            dataInicio: state.dataInicio,
            dataFim: state.dataFim,
            activeAba: state.activeAba,
            volumeStatus: state.volumeStatus,
            solicitanteId: state.solicitanteId
        };
        sessionStorage.setItem('assistenciaFilters', JSON.stringify(filtersToSave));
    };

    const loadFiltersFromSession = () => {
        const savedFilters = sessionStorage.getItem('assistenciaFilters');
        if (savedFilters) {
            const parsedFilters = JSON.parse(savedFilters);
            // Atualiza o estado com os valores salvos
            Object.assign(state, parsedFilters);

            // Atualiza os campos do formulário na tela
            elements.buscaInput.value = state.busca;
            elements.situacaoSelect.value = state.situacao;
            elements.fabricaSelect.value = state.fabrica;
            elements.dataInicioInput.value = state.dataInicio;
            elements.dataFimInput.value = state.dataFim;
            elements.filtroVolumeStatus.value = state.volumeStatus;
            elements.filtroSolicitante.value = state.solicitanteId;
        }
    };

    const createActionsCell = (assist) => {
        // Se estiver na aba "Reposição / Estoque" (aba2), renderiza a combobox de status
        if (state.activeAba === 'aba2') {
            // Se o status for "Múltiplo", a combobox fica desativada
            if (assist.situacao === 'Múltiplo') {
                return `
                    <select class="form-select form-select-sm" disabled title="Gerencie os volumes na página de detalhes">
                        <option>Múltiplo</option>
                    </select>
                `;
            }
            
            // Caso contrário, renderiza a combobox normalmente
            const isSelected = (optionValue) => assist.situacao === optionValue ? 'selected' : '';
            return `
                <select class="form-select form-select-sm status-combobox" data-id="${assist.id}" data-current-status="${assist.situacao}">
                    <option value="Pendente" ${isSelected('Pendente')}>Pendente</option>
                    <option value="Para Vistoriar" ${isSelected('Para Vistoriar')}>Para Vistoriar</option>
                    <option value="Pronta para Embalar" ${isSelected('Pronta para Embalar')}>Pronta para Embalar</option>
                    <option value="Descarte" ${isSelected('Descarte')}>Descarte</option>
                    <option value="Resolvida" ${isSelected('Resolvida')}>Resolvida</option>
                </select>
            `;
        }
        
        // Para as outras abas, renderiza os botões padrão de sempre
        return `
            ${assist.situacao !== 'Resolvida' ? `
                <form action="/assistencias/resolver/${assist.id}" method="POST" class="d-inline resolve-form">
                    <button type="submit" class="btn btn-icon" title="Marcar como Resolvida">
                        <i class="fas fa-check-circle text-success"></i>
                    </button>
                </form>
            ` : ''}
            <a href="/assistencias/${assist.id}" class="btn btn-icon" title="Ver Detalhes">
                <i class="fas fa-eye text-info"></i>
            </a>
        `;
    };

    /**
     * Cria o HTML para uma única linha da tabela.
     * @param {object} assist - O objeto da assistência.
     * @returns {string} - O HTML da linha.
     */
    const createTableRow = (assist) => {
        const isChecked = state.selectedIds.has(assist.id.toString());
        // [MODIFICAÇÃO] Adiciona a célula do produto condicionalmente
        const produtoCell = state.activeAba === 'aba2' ? `<div>${assist.primeiro_produto || ''}</div>` : '';

        return `
        <div class="assist-table-row" data-id="${assist.id}" title="Clique para ver os detalhes">
            <div>
                <input type="checkbox" class="form-check-input row-checkbox" data-id="${assist.id}" ${isChecked ? 'checked' : ''}>
            </div>
            <div class="status-cell"><span class="status-badge status-${assist.situacao.toLowerCase().replace(/\s+/g, '-')}">${assist.situacao}</span></div>
            <div>${assist.data_acao_fmt || 'N/A'}</div>
            <div>${assist.nf_origem || 'N/A'}</div>
            <div>${assist.nome_pedido}</div>
            <div class="col-obs ${assist.marcar_como_alerta ? 'alert-cell' : ''}">
                ${assist.marcar_como_alerta ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
                ${assist.observacoes || ''}
            </div>
            ${produtoCell}
            <div>${assist.coluna || 'N/A'}</div>
            <div>${assist.linha || 'N/A'}</div>
            <div>${assist.fabrica}</div>
            <div>${formatDate(assist.data_solicitacao)}</div>
            <div class="actions-cell">
                ${createActionsCell(assist)}
            </div>
        </div>
    `};

    /**
     * Renderiza a tabela completa com os dados recebidos da API.
     * @param {Array} assistencias - A lista de assistências.
     */
    const renderTable = (assistencias) => {
        // [MODIFICAÇÃO] Cria o cabeçalho e ajusta o grid dinamicamente
        let headerHTML = '<div class="assist-table-header">';
        headerHTML += '<div><input type="checkbox" class="form-check-input" id="select-all-checkbox"></div>';
        headerHTML += '<div>Situação</div><div>Data Ação</div><div>NF Origem</div><div>Cliente</div><div>Observações</div>';

        // Adiciona a coluna "Produto" e ajusta o layout do grid apenas para a aba 2
        if (state.activeAba === 'aba2') {
            headerHTML += '<div>Produto</div>';
            elements.tableContainer.style.gridTemplateColumns = "auto 140px 140px 90px 1fr 1fr 1.5fr 80px 80px 120px 110px 100px";
        } else {
            // Layout padrão para as outras abas
            elements.tableContainer.style.gridTemplateColumns = "auto 140px 140px 90px 1fr 1.5fr 80px 80px 120px 110px 100px";
        }

        headerHTML += '<div>Coluna</div><div>Linha</div><div>Fábrica</div><div>Data Solic.</div><div>Ações</div>';
        headerHTML += '</div>';

        if (assistencias.length === 0) {
            elements.tableContainer.innerHTML = headerHTML + '<div class="no-results-message">Nenhuma assistência encontrada para os filtros selecionados.</div>';
            return;
        }
        const rowsHTML = assistencias.map(createTableRow).join('');
        elements.tableContainer.innerHTML = headerHTML + rowsHTML;

        updateSelectAllCheckboxState();
    };

    /**
     * Renderiza os controles de paginação.
     */
    const renderPagination = () => {
        if (state.totalPages <= 1) {
            elements.paginationContainer.innerHTML = '';
            return;
        }
        elements.paginationContainer.innerHTML = `
            <button class="btn btn-outline-secondary" ${state.currentPage === 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">Anterior</button>
            <span class="page-info">Página ${state.currentPage} de ${state.totalPages}</span>
            <button class="btn btn-outline-secondary" ${state.currentPage === state.totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">Próxima</button>
        `;
    };
    
    /**
     * Exibe um spinner de carregamento enquanto os dados são buscados.
     */
    const showLoading = () => {
        elements.tableContainer.innerHTML = `<div class="loading-spinner-container"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Carregando...</span></div></div>`;
        elements.paginationContainer.innerHTML = '';
    };

    const loadSolicitantes = async () => {
        try {
            const response = await fetch('/assistencias/api/solicitantes');
            if (!response.ok) throw new Error('Falha ao carregar solicitantes.');
            
            const solicitantes = await response.json();
            elements.filtroSolicitante.innerHTML = '<option value="">Todos</option>'; // Limpa e adiciona a opção padrão
            solicitantes.forEach(s => {
                const option = new Option(s.nome, s.id);
                elements.filtroSolicitante.add(option);
            });

            if (state.solicitanteId) {
                elements.filtroSolicitante.value = state.solicitanteId;
            }

        } catch (error) {
            console.error(error);
            elements.filtroSolicitante.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    };

    /**
     * Função principal que busca os dados da API e chama as funções de renderização.
     */
    const fetchAndRenderAssistencias = async () => {
        saveFiltersToSession();
        showLoading();
        const params = new URLSearchParams({
            page: state.currentPage, limit: state.limit, busca: state.busca,
            situacao: state.situacao, fabrica: state.fabrica, dataInicio: state.dataInicio,
            dataFim: state.dataFim, aba: state.activeAba, volumeStatus: state.volumeStatus,
            solicitanteId: state.solicitanteId
        });

        try {
            const response = await fetch(`/assistencias/api/assistencias?${params}`);
            if (!response.ok) throw new Error(`Erro na resposta da rede: ${response.statusText}`);
            
            const data = await response.json();
            state.totalPages = data.totalPages;
            
            renderTable(data.assistencias);
            renderPagination();
        } catch (error) {
            console.error("Erro ao buscar assistências:", error);
            ModalSystem.alert('Erro ao carregar dados. Tente atualizar a página.', 'Erro de Rede');
            elements.tableContainer.innerHTML = '<div class="no-results-message">Ocorreu um erro ao buscar as assistências.</div>';
        }
    };

    const toggleBulkButton = () => {
        const selectedCount = state.selectedIds.size;
        if (selectedCount > 0) {
            elements.bulkResolveBtn.style.display = 'inline-block';
            elements.bulkResolveBtn.innerHTML = `<i class="fas fa-check-double me-2"></i>Resolver Selecionadas (${selectedCount})`;
        } else {
            elements.bulkResolveBtn.style.display = 'none';
        }
    };

    const updateSelectAllCheckboxState = () => {
        const selectAll = document.getElementById('select-all-checkbox');
        if (!selectAll) return;

        const rowCheckboxes = document.querySelectorAll('.row-checkbox');
        const allVisibleChecked = rowCheckboxes.length > 0 && Array.from(rowCheckboxes).every(cb => cb.checked);
        selectAll.checked = allVisibleChecked;
    };

    const clearSelection = () => {
        state.selectedIds.clear();
        toggleBulkButton();
    };

    /**
     * Configura todos os listeners de eventos da página.
     */
    const setupEventListeners = () => {
        elements.buscaInput.addEventListener('keyup', (e) => {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                state.busca = e.target.value;
                state.currentPage = 1;
                fetchAndRenderAssistencias();
            }, 500);
        });

        [elements.situacaoSelect, elements.fabricaSelect].forEach(el => {
            el.addEventListener('change', (e) => {
                const key = e.target.id.replace('filtro', '');
                state[key.charAt(0).toLowerCase() + key.slice(1)] = e.target.value;
                state.currentPage = 1;
                fetchAndRenderAssistencias();
            });
        });

        elements.filtroSolicitante.addEventListener('change', (e) => {
            state.solicitanteId = e.target.value; // AQUI ESTAVA O ERRO
            state.currentPage = 1;
            fetchAndRenderAssistencias();
        });

        [elements.dataInicioInput, elements.dataFimInput].forEach(el => {
            el.addEventListener('change', (e) => {
                state[e.target.id] = e.target.value;
                state.currentPage = 1;
                fetchAndRenderAssistencias();
            });
        });

        elements.btnExportarExcel.addEventListener('click', () => {
            // Constrói a URL com os filtros atuais do estado da página
            const params = new URLSearchParams({
                busca: state.busca,
                situacao: state.situacao,
                fabrica: state.fabrica,
                dataInicio: state.dataInicio,
                dataFim: state.dataFim,
                aba: state.activeAba,
                volumeStatus: state.volumeStatus,
                solicitanteId: state.solicitanteId
            });

            // Redireciona o navegador para a URL da API de exportação, o que iniciará o download
            window.location.href = `/assistencias/api/exportar-assistencias?${params.toString()}`;
        });

        elements.tableContainer.addEventListener('change', async (e) => {
            if (e.target.classList.contains('status-combobox')) {
                const selectEl = e.target;
                const assistenciaId = selectEl.dataset.id;
                const newStatus = selectEl.value;
                const currentStatus = selectEl.dataset.currentStatus;

                if (newStatus === currentStatus) return; // Não faz nada se o status não mudou

                ModalSystem.confirm(
                    `Tem certeza que deseja alterar o status da assistência #${assistenciaId} para "${newStatus}"?`,
                    'Confirmar Alteração de Status',
                    async () => { // onConfirm
                        try {
                            const response = await fetch(`/assistencias/api/update-status/${assistenciaId}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: newStatus })
                            });

                            const result = await response.json();
                            if (!response.ok) throw new Error(result.message || 'Falha na comunicação com o servidor.');

                            // Atualiza a UI da linha sem recarregar a página
                            const row = selectEl.closest('.assist-table-row');
                            const statusBadge = row.querySelector('.status-badge');
                            statusBadge.textContent = newStatus;
                            statusBadge.className = `status-badge status-${newStatus.toLowerCase().replace(/\s+/g, '-')}`;
                            selectEl.dataset.currentStatus = newStatus; // Atualiza o status atual no elemento

                        } catch (error) {
                            console.error('Erro ao atualizar status:', error);
                            ModalSystem.alert(`Não foi possível atualizar o status. Erro: ${error.message}`, 'Erro');
                            selectEl.value = currentStatus; // Reverte a combobox para o valor original
                        }
                    },
                    () => { // onCancel
                        selectEl.value = currentStatus; // Reverte a combobox se o usuário cancelar
                    }
                );
            }
        });

        elements.tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const newAba = e.target.dataset.aba;
                state.activeAba = newAba;
                state.currentPage = 1;

                // Atualiza o visual e salva no cookie
                updateActiveTabVisuals(newAba);
                setCookie('assistenciaActiveAba', newAba, 1); // Salva por 1 dia

                if (state.activeAba === 'aba2') {
                    elements.filtroVolumeStatusContainer.style.display = 'block';
                    elements.btnResolucaoMassa.style.display = 'inline-block'; // MOSTRA O BOTÃO
                } else {
                    elements.filtroVolumeStatusContainer.style.display = 'none';
                    elements.btnResolucaoMassa.style.display = 'none'; // ESCONDE O BOTÃO
                    state.volumeStatus = 'Todos'; // Reseta o filtro ao sair da aba
                    elements.filtroVolumeStatus.value = 'Todos';
                }

                fetchAndRenderAssistencias();
            });
        });

        elements.filtroVolumeStatus.addEventListener('change', (e) => {
            state.volumeStatus = e.target.value;
            state.currentPage = 1;
            fetchAndRenderAssistencias();
        });

        elements.paginationContainer.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' && e.target.dataset.page) {
                state.currentPage = parseInt(e.target.dataset.page, 10);
                fetchAndRenderAssistencias(); // A seleção persiste aqui!
            }
        });

        elements.tableContainer.addEventListener('click', e => {
            const row = e.target.closest('.assist-table-row');
            
            if (e.target.closest('.actions-cell')) {
                const resolveForm = e.target.closest('.resolve-form');
                if (resolveForm) {
                    e.preventDefault();
                    ModalSystem.confirm(
                        'Tem certeza que deseja marcar esta assistência como resolvida? Esta ação não pode ser desfeita.',
                        'Confirmar Resolução',
                        () => { // onConfirm
                            resolveForm.submit();
                        }
                    );
                }
                return; 
            }
            
            if (e.target.matches('.row-checkbox')) {
                const id = e.target.dataset.id;
                if (e.target.checked) {
                    state.selectedIds.add(id);
                } else {
                    state.selectedIds.delete(id);
                }
                toggleBulkButton();
                updateSelectAllCheckboxState();
                return; 
            } 
            
            if (e.target.matches('#select-all-checkbox')) {
                const isChecked = e.target.checked;
                const checkboxesOnPage = document.querySelectorAll('.row-checkbox');
                checkboxesOnPage.forEach(cb => {
                    cb.checked = isChecked;
                    const id = cb.dataset.id;
                    if (isChecked) {
                        state.selectedIds.add(id);
                    } else {
                        state.selectedIds.delete(id);
                    }
                });
                toggleBulkButton();
                return; 
            }
            
            if (row) {
                window.location.href = `/assistencias/${row.dataset.id}`;
            }
        });

        elements.bulkResolveBtn.addEventListener('click', async () => {
            const selectedIds = Array.from(state.selectedIds); 
            if (selectedIds.length === 0) return;

            ModalSystem.confirm(
                `Tem certeza que deseja marcar ${selectedIds.length} assistência(s) como 'Resolvida'?`,
                'Confirmar Ação em Massa',
                async () => {
                    try {
                        const response = await fetch('/assistencias/api/bulk-update-status', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ids: selectedIds, status: 'Resolvida' })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`O servidor respondeu com um erro: ${response.status} ${response.statusText}`);
                        }

                        const result = await response.json(); 

                        if (result.success) {
                            clearSelection(); 
                            fetchAndRenderAssistencias(); 
                        } else {
                            throw new Error(result.message || 'Falha ao atualizar.');
                        }
                    } catch (error) {
                        console.error("Erro na ação em massa:", error);
                        ModalSystem.alert(`Erro: ${error.message}`, 'Falha na Operação');
                    }
                }
            );
        });
    };

    const initializePage = () => {
        loadFiltersFromSession(); 

        const savedAba = state.activeAba || getCookie('assistenciaActiveAba');
        if (savedAba && document.querySelector(`[data-aba="${savedAba}"]`)) {
            state.activeAba = savedAba;
        }

        updateActiveTabVisuals(state.activeAba);

        if (state.activeAba === 'aba2') {
            elements.filtroVolumeStatusContainer.style.display = 'block';
            elements.btnResolucaoMassa.style.display = 'inline-block';
        } else {
            elements.filtroVolumeStatusContainer.style.display = 'none';
            // [CORREÇÃO] Corrigido o erro de digitação de 'btnResolucMassa' para 'btnResolucaoMassa'
            elements.btnResolucaoMassa.style.display = 'none';
        }

        // Se não houver filtros de data salvos, aplica o padrão
        if (!state.dataInicio && !state.dataFim) {
            initializeFilters();
        }
        
        loadSolicitantes();
        setupEventListeners();
        fetchAndRenderAssistencias(); 
    };

    /**
     * Define o filtro de data padrão para o último mês.
     */
    const setDefaultDateFilters = () => {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);

        state.dataFim = endDate.toISOString().split('T')[0];
        state.dataInicio = startDate.toISOString().split('T')[0];
        
        elements.dataFimInput.value = state.dataFim;
        elements.dataInicioInput.value = state.dataInicio;
    };
    
    /**
     * Define o estado inicial dos filtros.
     */
    const initializeFilters = () => {
        elements.situacaoSelect.value = state.situacao;
        setDefaultDateFilters();
    };

    // --- Inicialização ---
    initializePage();
});