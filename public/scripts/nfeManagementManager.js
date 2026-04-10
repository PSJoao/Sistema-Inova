document.addEventListener('DOMContentLoaded', function() {
    console.log("nfeManagementManager.js: Iniciado.");

    // --- 1. Seleção de Elementos DOM ---
    const accountFilter = document.getElementById('accountFilter');
    const sortFilter = document.getElementById('sortFilter');
    const searchFilter = document.getElementById('searchFilter');
    const situationFilter = document.getElementById('situationFilter');
    const nfeCardListContainer = document.getElementById('nfeCardListContainer');
    const paginationControlsContainer = document.getElementById('paginationControlsContainer');
    const platformFilter = document.getElementById('platformFilter');
    const btnGerarEtiquetas = document.getElementById('btnGerarEtiquetas');
    const btnSyncNfe = document.getElementById('btnSyncNfe');
    const selectionInfoBar = document.getElementById('selectionInfoBar');
    const selectionCountEl = document.getElementById('selectionCount');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    // --- 2. Estado da Aplicação ---
    let state = {
        currentPage: 1,
        account: '',
        sortBy: 'data_desc',
        situation: '',
        plataforma: '',
        search: '',
        selectedNfeIds: new Set() // Usamos um Set para guardar os IDs únicos selecionados
    };

    // --- 3. Funções de Lógica Principal ---

    /**
     * Busca os dados na API do backend com base no estado atual dos filtros.
     */
    async function fetchNfeData() {
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
        
        nfeCardListContainer.innerHTML = '<div class="loading-spinner"></div>'; // Mostra o spinner de carregamento

        const params = new URLSearchParams({
            page: state.currentPage,
            account: state.account,
            sortBy: state.sortBy,
            status: state.situation,
            plataforma: state.plataforma,
            search: state.search
        });

        try {
            const response = await fetch(`/api/emissao/nfe-cache?${params.toString()}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Erro ao buscar dados.');
            }
            const data = await response.json();
            renderNfeCards(data.nfeData);
            renderPagination(data.pagination);
            updateSelectionInfo();

        } catch (error) {
            console.error("Erro ao buscar dados de NF-e:", error);
            nfeCardListContainer.innerHTML = `<p class="error-message">Falha ao carregar notas: ${error.message}</p>`;
        }
    }

    /**
     * Renderiza os cards das notas fiscais na tela.
     */
    function renderNfeCards(nfeData) {
        nfeCardListContainer.innerHTML = ''; // Limpa a lista
        if (nfeData.length === 0) {
            nfeCardListContainer.innerHTML = '<p class="no-results-message">Nenhuma nota fiscal encontrada para os filtros selecionados.</p>';
            return;
        }

        nfeData.forEach(nf => {
            const card = document.createElement('div');
            card.className = 'nfe-card';
            card.dataset.nfeId = nf.bling_id;

            const isSelected = state.selectedNfeIds.has(String(nf.bling_id));
            if (isSelected) {
                card.classList.add('selected');
            }

            card.innerHTML = `
                <div class="nfe-card-selection">
                    <input type="checkbox" class="nfe-select-checkbox" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="nfe-card-info">
                    <div class="info-line-1">
                        <strong class="nfe-numero">NF: ${nf.nfe_numero}</strong>
                        <span class="transportadora">${nf.transportador_nome || 'N/D'}</span>
                    </div>
                    <div class="info-line-2">
                        <span class="volumes">Volumes: ${nf.total_volumes || 0}</span>
                        <span class="data-emissao">${nf.data_emissao ? new Date(nf.data_emissao).toLocaleString('pt-BR') : 'N/A'}</span>
                    </div>
                </div>
            `;
            nfeCardListContainer.appendChild(card);
        });
    }

    /**
     * Renderiza os controles de paginação.
     */
    function renderPagination({ currentPage, totalPages }) {
        if (!paginationControlsContainer) return;
        paginationControlsContainer.innerHTML = '';
        if (totalPages <= 1) return;

        // Botão "Anterior"
        const prev = document.createElement('button');
        prev.innerHTML = '<i class="fas fa-chevron-left"></i> Ant';
        prev.className = 'btn';
        prev.disabled = currentPage === 1;
        prev.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                fetchNfeData();
            }
        });
        paginationControlsContainer.appendChild(prev);

        // --- INÍCIO DA NOVA LÓGICA DO DROPDOWN ---

        // Label "Ir para:"
        const pageSelectLabel = document.createElement('span');
        pageSelectLabel.className = 'page-info';
        pageSelectLabel.textContent = 'Pular para:';
        paginationControlsContainer.appendChild(pageSelectLabel);
        
        // O dropdown <select>
        const pageSelect = document.createElement('select');
        pageSelect.className = 'form-control page-select-dropdown';

        // Cria uma <option> para cada página
        for (let i = 1; i <= totalPages; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            if (i === currentPage) {
                option.selected = true; // Deixa a página atual selecionada
            }
            pageSelect.appendChild(option);
        }
        
        // Adiciona o listener que busca os dados quando uma nova página é selecionada
        pageSelect.addEventListener('change', (event) => {
            state.currentPage = parseInt(event.target.value, 10);
            fetchNfeData();
        });
        paginationControlsContainer.appendChild(pageSelect);
        
        // --- FIM DA NOVA LÓGICA DO DROPDOWN ---

        // Informação "de X páginas"
        const totalInfo = document.createElement('span');
        totalInfo.className = 'page-info';
        totalInfo.textContent = `de ${totalPages} páginas`;
        paginationControlsContainer.appendChild(totalInfo);

        // Botão "Próxima"
        const next = document.createElement('button');
        next.innerHTML = 'Próx <i class="fas fa-chevron-right"></i>';
        next.className = 'btn';
        next.disabled = currentPage === totalPages;
        next.addEventListener('click', () => {
            if (state.currentPage < totalPages) {
                state.currentPage++;
                fetchNfeData();
            }
        });
        paginationControlsContainer.appendChild(next);
    }
    
    /**
     * Atualiza a barra de informações de seleção (contador e visibilidade).
     */
    function updateSelectionInfo() {
        const count = state.selectedNfeIds.size;
        if (count > 0) {
            selectionCountEl.textContent = count;
            selectionInfoBar.style.display = 'flex';
            btnGerarEtiquetas.disabled = false;
        } else {
            selectionInfoBar.style.display = 'none';
            btnGerarEtiquetas.disabled = true;
        }

        // Lógica para o estado do "Selecionar Todos"
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function() {
                const checkboxesNaPagina = document.querySelectorAll('.nfe-select-checkbox');
                
                checkboxesNaPagina.forEach(checkbox => {
                    const card = checkbox.closest('.nfe-card');
                    const nfeId = String(card.dataset.nfeId);
                    
                    // Marca ou desmarca com base no estado do "Selecionar Todos"
                    if (this.checked) {
                        state.selectedNfeIds.add(nfeId);
                        card.classList.add('selected');
                        checkbox.checked = true;
                    } else {
                        state.selectedNfeIds.delete(nfeId);
                        card.classList.remove('selected');
                        checkbox.checked = false;
                    }
                });
                // Atualiza o contador de seleção
                updateSelectionInfo();
            });
        }
    }

    // --- 4. Listeners de Eventos ---

    // Filtros
    accountFilter.addEventListener('change', () => { state.account = accountFilter.value; state.currentPage = 1; state.selectedNfeIds.clear(); fetchNfeData(); });
    sortFilter.addEventListener('change', () => { state.sortBy = sortFilter.value; state.currentPage = 1; fetchNfeData(); });
    situationFilter.addEventListener('change', () => { state.situation = situationFilter.value; state.currentPage = 1; fetchNfeData(); });
    searchFilter.addEventListener('input', () => { state.search = searchFilter.value; state.currentPage = 1; fetchNfeData(); });
    platformFilter.addEventListener('change', () => { state.plataforma = platformFilter.value; state.currentPage = 1; fetchNfeData(); });

    btnSyncNfe.addEventListener('click', async () => {
        btnSyncNfe.disabled = true;
        btnSyncNfe.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Sincronizando...';

        try {
            const response = await fetch('/emissao/api/nfe-sync/trigger', {
                method: 'POST'
            });

            const result = await response.json();

            if (response.ok) { // Status 202 Accepted
                ModalSystem.alert(result.message, "Sucesso");
                // Atualiza a tabela após um tempo para dar chance de as notas aparecerem
                setTimeout(() => {
                    fetchNfeData();
                }, 25000); // 25 segundos
            } else { // Status 409 Conflict ou outro erro
                ModalSystem.alert(result.message, "Aviso");
            }
        } catch (error) {
            console.error("Erro ao iniciar sincronização:", error);
            ModalSystem.alert("Ocorreu um erro de comunicação com o servidor. Tente novamente.", "Erro");
        } finally {
            // Reabilita o botão após um delay para evitar cliques repetidos
            setTimeout(() => {
                btnSyncNfe.disabled = false;
                btnSyncNfe.innerHTML = '<i class="fas fa-sync-alt"></i> Sincronizar Novas NF-e';
            }, 5000); // 5 segundos
        }
    });
    
    // Seleção de Notas (usando delegação de evento)
    nfeCardListContainer.addEventListener('click', (event) => {
        const card = event.target.closest('.nfe-card');
        if (!card) return;

        const nfeId = String(card.dataset.nfeId);
        const checkbox = card.querySelector('.nfe-select-checkbox');

        if (state.selectedNfeIds.has(nfeId)) {
            state.selectedNfeIds.delete(nfeId);
            card.classList.remove('selected');
            checkbox.checked = false;
        } else {
            state.selectedNfeIds.add(nfeId);
            card.classList.add('selected');
            checkbox.checked = true;
        }
        updateSelectionInfo();
    });

    // Botão para limpar seleção
    clearSelectionBtn.addEventListener('click', () => {
        state.selectedNfeIds.clear();
        fetchNfeData(); // Recarrega para desmarcar visualmente
    });
    
    // Botão para Gerar Etiquetas
    btnGerarEtiquetas.addEventListener('click', function() {
        const selectedIds = [...state.selectedNfeIds]; // Converte o Set para um Array
        if (selectedIds.length > 0) {
            ModalSystem.confirm(`Gerar etiquetas para ${selectedIds.length} nota(s) selecionada(s)?`, "Confirmar Geração", () => {
                const url = `/emissao/print-labels?ids=${selectedIds.join(',')}`;
                window.open(url, '_blank');
            });
        }
    });

    // --- 5. Carga Inicial ---
    fetchNfeData();
});