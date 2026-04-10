// public/scripts/rastreioManager.js

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. Seleção de Elementos ---
    const elements = {
        mainContent: document.querySelector('.content-card'),
        listContainer: document.getElementById('rastreio-list-container'),
        searchInput: document.getElementById('search-input'),
        transportadoraFilter: document.getElementById('transportadora-filter'),
        plataformaFilter: document.getElementById('plataforma-filter'),
        situacaoFilter: document.getElementById('situacao-filter'),
        observacaoFilter: document.getElementById('observacao-filter'),
        dataInicioFilter: document.getElementById('data-inicio-filter'),
        dataFimFilter: document.getElementById('data-fim-filter'),
        paginationControls: document.getElementById('pagination-controls'),
        btnGerarRelatorio: document.getElementById('btn-gerar-relatorio'),
        massSearchToggle: document.getElementById('mass-search-toggle'),
        normalFiltersContainer: document.querySelector('.normal-filters-container'),
        massSearchContainer: document.querySelector('.mass-search-container'),
        nfeListTextarea: document.getElementById('nfe-list-textarea'),
        btnMassSearch: document.getElementById('btn-mass-search'),
        massConfirmToggle: document.getElementById('mass-confirm-toggle'),
        massConfirmContainer: document.querySelector('.mass-confirm-container'),
        nfeConfirmListTextarea: document.getElementById('nfe-confirm-list-textarea'),
        btnMassConfirm: document.getElementById('btn-mass-confirm')
    };

    if (!elements.listContainer) {
        return;
    }
    
    const headerHTML = elements.listContainer.querySelector('.list-header').outerHTML;

    const RASTREIO_STATE_KEY = 'rastreioState';

    // --- 2. Estado da Aplicação ---
    let state = JSON.parse(localStorage.getItem(RASTREIO_STATE_KEY)) || { 
        currentPage: 1, 
        search: '', 
        transportadora: '', 
        plataforma: '', 
        situacao: '', 
        observacao: '',
        dataInicio: '',
        dataFim: ''
    };
    let debounceTimer;

    // --- 3. Funções Auxiliares e de Renderização ---

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        // Adiciona o fuso horário para corrigir a data
        const userTimezoneOffset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() + userTimezoneOffset).toLocaleDateString('pt-BR');
    };

    const helpers = {
        normalizeStatusClass: (status) => {
            if (!status) return 'outros';
            // Simplifica a normalização para classes CSS
            const s = status.toLowerCase();
            if (s.startsWith('entregue')) return 'entregue-confirmado';
            if (s.startsWith('confirmar')) return 'confirmar-entrega';
            if (s.startsWith('fora do prazo')) return 'fora-do-prazo';
            if (s === 'em trânsito') return 'em-trânsito';
            if (s === 'fora do comum') return 'fora-do-comum'; // Adicionado para estilização
            return 'outros';
        },
        // [LÓGICA SIMPLIFICADA]
        // Esta função agora é muito mais simples. Apenas retorna o status do banco,
        // com uma pequena alteração de texto para a ação de confirmação.
        getSimplifiedStatus: (pedido) => {
            const status = pedido.situacao_atual;

            if (status === 'Entregue - Conferir' || (pedido.data_entrega && status !== 'Entregue - Confirmado')) {
                return 'Confirmar Entrega';
            }
            
            return status;
        }
    };

    function createRowHTML(pedido) {
        const simplifiedStatus = helpers.getSimplifiedStatus(pedido);
        const statusClass = helpers.normalizeStatusClass(simplifiedStatus);
        const notifiedClass = pedido.notificado_por_email === false ? 'email-notified' : '';
        
        let selectOptions = '';
        const standardOptions = [
            'Em Trânsito', 'Fora do Prazo - Conferir', 'Fora do Prazo - Conferido', 
            'Fora do Comum', 'Entregue - Confirmado'
        ];

        if (simplifiedStatus === 'Confirmar Entrega') {
            selectOptions = `
                <option value="Confirmar Entrega" selected>Confirmar Entrega</option>
                <option value="Confirmar">» Confirmar Agora</option>
                <option value="Outros">Outros...</option>
            `;
        } else {
            // Adiciona a opção "Outros..." no final
            standardOptions.push('Outros');
            
            let isStandard = false;
            standardOptions.forEach(opt => {
                // Verifica se o status atual é uma das opções padrão
                if (opt === simplifiedStatus) isStandard = true;
                const selected = opt === simplifiedStatus ? 'selected' : '';
                selectOptions += `<option value="${opt}" ${selected}>${opt}</option>`;
            });

            // Se o status atual NÃO for padrão (ex: "Acidente"),
            // ele é adicionado como a primeira opção selecionada.
            if (!isStandard && simplifiedStatus) {
                selectOptions = `<option value="${simplifiedStatus}" selected>${simplifiedStatus}</option>` + selectOptions;
            }
        }

        return `
            <div class="list-row ${notifiedClass}" data-href="/rastreio/detalhe/${pedido.id}" data-pedido-id="${pedido.id}" data-notified="${pedido.notificado_por_email}">
                <div class="list-item item-status">
                    <div class="status-select-wrapper">
                        <select class="status-select status-${statusClass}" data-pedido-id="${pedido.id}">
                            ${selectOptions}
                        </select>
                    </div>
                </div>
                <div class="list-item item-previsao-atual">${formatDate(pedido.data_previsao_entrega)}</div>
                <div class="list-item item-pedido">${pedido.numero_pedido || ''}</div>
                <div class="list-item item-nfe">${pedido.numero_nfe || ''}</div>
                <div class="list-item item-transportadora">${pedido.transportadora || ''}</div>
                <div class="list-item item-ocorrencia" title="${pedido.ultima_ocorrencia || ''}">${pedido.ultima_ocorrencia || ''}</div>
                <div class="list-item item-observacao obs-value">${pedido.observacao || ''}</div>
            </div>
        `;
    }
    
    function renderRows(pedidos) {
        elements.listContainer.innerHTML = headerHTML; // Reseta a lista mantendo o cabeçalho
        if (pedidos.length > 0) {
            const rowsHTML = pedidos.map(createRowHTML).join('');
            elements.listContainer.insertAdjacentHTML('beforeend', rowsHTML);
        } else {
            elements.listContainer.insertAdjacentHTML('beforeend', '<div class="no-results-message">Nenhum pedido encontrado.</div>');
        }
    }
    
    function updatePagination({ currentPage, totalPages }) {
        state.currentPage = parseInt(currentPage, 10);
        state.totalPages = parseInt(totalPages, 10);
        if (totalPages <= 1) {
            elements.paginationControls.innerHTML = '';
            return;
        }
        let optionsHtml = '';
        for (let i = 1; i <= totalPages; i++) {
            optionsHtml += `<option value="${i}" ${i === state.currentPage ? 'selected' : ''}>Página ${i}</option>`;
        }
        elements.paginationControls.innerHTML = `
            <button id="prev-page" class="btn btn-secondary" ${state.currentPage === 1 ? 'disabled' : ''}>&laquo; Anterior</button>
            <select id="page-select" class="page-select-dropdown">${optionsHtml}</select>
            <button id="next-page" class="btn btn-secondary" ${state.currentPage >= state.totalPages ? 'disabled' : ''}>Próxima &raquo;</button>
        `;
    }

    async function fetchData() {
        document.body.classList.add('loading');

        localStorage.setItem(RASTREIO_STATE_KEY, JSON.stringify(state));

        const isAtrasado = state.situacao === 'fora_prazo_conferir' || state.situacao === 'fora_prazo_conferido';
        elements.listContainer.classList.toggle('show-previsao-column', isAtrasado);

        const params = new URLSearchParams({
            page: state.currentPage,
            search: state.search,
            transportadora: state.transportadora,
            plataforma: state.plataforma,
            situacao: state.situacao,
            observacao: state.observacao,
            dataInicio: state.dataInicio,
            dataFim: state.dataFim
        });
        try {
            const response = await fetch(`/rastreio/api?${params.toString()}`);
            if (!response.ok) throw new Error('Falha ao buscar dados');
            const data = await response.json();
            renderRows(data.pedidosData);
            updatePagination(data.pagination);
        } catch (error) {
            console.error("Erro ao buscar dados de rastreio:", error);
            elements.listContainer.innerHTML = `${headerHTML}<p class="no-results-message" style="color: var(--color-danger);">Ocorreu um erro ao carregar os dados.</p>`;
        } finally {
            document.body.classList.remove('loading');
        }
    }

    async function fetchDataMassSearch(nfeList) {
        if (!nfeList || nfeList.length === 0) {
            ModalSystem.alert('A lista de NFEs está vazia. Cole as NFEs, uma por linha.', 'Atenção');
            return;
        }

        document.body.classList.add('loading');
        // Limpa o localStorage e o state da busca normal
        localStorage.removeItem(RASTREIO_STATE_KEY);
        state.currentPage = 1; 
        
        try {
            const response = await fetch('/rastreio/api/mass-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nfeList })
            });
            
            if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Falha ao buscar dados em massa');
            }
            
            const data = await response.json();
            
            renderRows(data.pedidosData);
            updatePagination(data.pagination); // Atualiza para mostrar 1 de 1 ou limpar

            // [IMPORTANTE] Feedback de NFEs não encontradas
            if (data.missingNfes && data.missingNfes.length > 0) {
                const missingList = data.missingNfes.join(', ');
                ModalSystem.alert(`<strong>Busca concluída.</strong><br>As seguintes NFEs não foram encontradas no sistema de rastreio:<br><br><strong>${missingList}</strong>`, 'Aviso de Busca');
            }

        } catch (error) {
            console.error("Erro ao buscar dados em massa:", error);
            elements.listContainer.innerHTML = `${headerHTML}<p class="no-results-message" style="color: var(--color-danger);">Ocorreu um erro ao carregar os dados.</p>`;
        } finally {
            document.body.classList.remove('loading');
        }
    }

    function handleFilterChange(resetPage = true) {
        if (resetPage) {
            state.currentPage = 1;
        }
        state.search = elements.searchInput.value;
        state.transportadora = elements.transportadoraFilter.value;
        state.plataforma = elements.plataformaFilter.value;
        state.situacao = elements.situacaoFilter.value;
        state.observacao = elements.observacaoFilter.value;
        state.dataInicio = elements.dataInicioFilter.value;
        state.dataFim = elements.dataFimFilter.value;
        fetchData();
    }

    // --- 4. Manipuladores de Eventos ---

    elements.searchInput.addEventListener('keyup', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => handleFilterChange(), 500); });
    elements.transportadoraFilter.addEventListener('change', () => handleFilterChange());
    elements.plataformaFilter.addEventListener('change', () => handleFilterChange());
    elements.situacaoFilter.addEventListener('change', () => handleFilterChange());
    elements.observacaoFilter.addEventListener('change', () => handleFilterChange());
    elements.dataInicioFilter.addEventListener('change', () => handleFilterChange());
    elements.dataFimFilter.addEventListener('change', () => handleFilterChange());

    elements.paginationControls.addEventListener('click', (e) => {
        if (e.target.id === 'prev-page' && state.currentPage > 1) { state.currentPage--; handleFilterChange(false); }
        if (e.target.id === 'next-page' && state.currentPage < state.totalPages) { state.currentPage++; handleFilterChange(false); }
    });
    elements.paginationControls.addEventListener('change', (e) => {
        if (e.target.id === 'page-select') { state.currentPage = parseInt(e.target.value, 10); handleFilterChange(false); }
    });

    if (elements.massSearchToggle) {
        elements.massSearchToggle.addEventListener('change', (e) => {
            if (e.target.checked && elements.massConfirmToggle) {
                elements.massConfirmToggle.checked = false;
                elements.massConfirmContainer.style.display = 'none';
            }

            if (elements.massSearchToggle.checked) {
                // Ativou pesquisa em massa
                elements.normalFiltersContainer.style.display = 'none';
                elements.massSearchContainer.style.display = 'block';
                elements.listContainer.innerHTML = headerHTML; // Limpa a lista
                elements.paginationControls.innerHTML = ''; // Limpa a paginação
            } else {
                // Desativou pesquisa em massa
                elements.normalFiltersContainer.style.display = 'flex';
                elements.massSearchContainer.style.display = 'none';
                elements.nfeListTextarea.value = ''; // Limpa o textarea
                
                // Recarrega os dados com os filtros normais
                initialize();
            }
        });
    }

    if (elements.massConfirmToggle) {
        elements.massConfirmToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Mostra o container de confirmação
                elements.massConfirmContainer.style.display = 'block';
                
                // Esconde os outros para não poluir
                elements.normalFiltersContainer.style.display = 'none';
                if(elements.massSearchContainer) elements.massSearchContainer.style.display = 'none';
                if(elements.massSearchToggle) elements.massSearchToggle.checked = false;
            } else {
                elements.massConfirmContainer.style.display = 'none';
                elements.normalFiltersContainer.style.display = 'flex';
            }
        });
    }

    if (elements.btnMassSearch) {
        elements.btnMassSearch.addEventListener('click', () => {
            const text = elements.nfeListTextarea.value;
            // Cria a lista:
            // 1. Divide por linha
            // 2. Remove espaços em branco (trim)
            // 3. Filtra linhas vazias
            const nfeList = text.split('\n')
                                .map(nfe => nfe.trim())
                                .filter(nfe => nfe.length > 0);
            
            fetchDataMassSearch(nfeList);
        });
    }

    if (elements.btnMassConfirm) {
        elements.btnMassConfirm.addEventListener('click', async () => {
            const rawText = elements.nfeConfirmListTextarea.value;
            if (!rawText.trim()) {
                ModalSystem.alert('Por favor, insira pelo menos uma NFe.', 'Atenção');
                return;
            }

            const nfeList = rawText.split(/\r?\n/)
                                   .map(line => line.trim())
                                   .filter(line => line !== '');

            if (nfeList.length === 0) return;

            ModalSystem.confirm(
                `Deseja tentar confirmar a entrega de ${nfeList.length} notas fiscais?`,
                'Confirmação em Massa',
                async () => {
                    ModalSystem.showLoading('Processando confirmações...');
                    
                    try {
                        const response = await fetch('/rastreio/api/mass-confirm-delivery', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ nfeList })
                        });

                        const result = await response.json();
                        ModalSystem.hideLoading();

                        if (!response.ok) throw new Error(result.message || 'Erro ao processar.');

                        // Montar mensagem de resultado
                        let msg = `Total Processado: <b>${result.summary.totalProcessed}</b><br>`;
                        msg += `Atualizados com Sucesso: <b style="color:green">${result.summary.updatedCount}</b><br>`;
                        msg += `Falhas/Ignorados: <b style="color:red">${result.summary.errorCount}</b><br><br>`;

                        if (result.errors && result.errors.length > 0) {
                            msg += '<strong>Detalhes das Falhas:</strong><br><div style="max-height: 200px; overflow-y: auto; text-align: left; background: #f8f9fa; padding: 10px; border: 1px solid #dee2e6;">';
                            result.errors.forEach(err => {
                                msg += `NFE <b>${err.nfe}</b>: ${err.reason}<br>`;
                            });
                            msg += '</div>';
                        }

                        ModalSystem.alert(msg, 'Relatório de Processamento', () => {
                            // Recarrega a página para atualizar os status na tela
                            window.location.reload();
                        });

                    } catch (error) {
                        ModalSystem.hideLoading();
                        console.error(error);
                        ModalSystem.alert(`Erro: ${error.message}`, 'Falha');
                    }
                }
            );
        });
    }

    if (elements.listContainer) {
        elements.listContainer.addEventListener('click', async (event) => { // 1. TORNAMOS ASYNC
            // Pega o elemento exato que foi clicado
            const target = event.target;

            // 1. VERIFICAÇÃO IMPORTANTE:
            // Se o que o usuário clicou foi o <select> ou algo dentro dele,
            // não faça nada (permita que o dropdown abra).
            if (target.closest('.status-select-wrapper') || target.closest('.obs-value')) {
                // Usando '.status-select-wrapper' para consistência
                return; 
            }

            // 2. ACHAR A LINHA:
            // A partir do que foi clicado, "sobe" até encontrar a linha principal
            const listRow = target.closest('.list-row');

            // 3. ABRIR A NOVA ABA E MARCAR COMO LIDO:
            // Se encontrou a linha E ela tem o atributo 'data-href'
            if (listRow && listRow.dataset.href) {
                
                // --- INÍCIO DA LÓGICA MOVIDA (DO SEGUNDO LISTENER) ---
                // Lógica para marcar notificação como lida
                if (listRow.dataset.notified === 'false') {
                    const pedidoId = listRow.dataset.pedidoId;
                    try {
                        // Agora o 'await' aqui é válido
                        await fetch(`/rastreio/api/mark-email-notified/${pedidoId}`, { method: 'POST' });
                        // Remove a classe visualmente
                        listRow.classList.remove('email-notified');
                        listRow.dataset.notified = 'true';
                    } catch (error) {
                        console.error('Falha ao marcar e-mail como notificado:', error);
                        // Não impede a abertura da aba
                    }
                }
                // --- FIM DA LÓGICA MOVIDA ---

                const url = listRow.dataset.href;
                
                // Abre a URL em uma nova aba
                window.open(url, '_blank');

                event.stopPropagation(); 
            }
        });
    }

    elements.listContainer.addEventListener('change', async (e) => {
        const select = e.target;
        if (select.classList.contains('status-select')) {
            const novoStatusBase = select.value;
            const pedidoId = select.dataset.pedidoId;
            let dataEntrega = null;
            let novoStatusFinal = novoStatusBase;

            const handleUpdate = async () => {
                try {
                    const response = await fetch('/rastreio/api/update-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pedidoId, novoStatus: novoStatusFinal, dataEntrega })
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message);
                    ModalSystem.alert(result.message, 'Sucesso');
                    fetchData();
                } catch (error) { ModalSystem.alert(`Erro: ${error.message}`, 'Falha na Operação'); fetchData(); }
            };

            if (novoStatusBase === 'Confirmar') {
                const today = new Date().toISOString().split('T')[0];
                ModalSystem.prompt('Por favor, informe a data de entrega:', 'Confirmar Entrega', (dateInput) => {
                    if (dateInput) {
                        dataEntrega = dateInput; novoStatusFinal = 'Entregue - Confirmado'; handleUpdate();
                    } else { fetchData(); }
                }, 'date', today);
            } else if (novoStatusBase === 'Outros') {
                ModalSystem.prompt('Descreva a situação (máx 20 caracteres):', 'Outra Situação', (textInput) => {
                    if (textInput && textInput.trim()) {
                        novoStatusFinal = textInput.trim().substring(0, 20); handleUpdate();
                    } else { fetchData(); }
                }, 'text', '', { maxLength: 20 });
            } else if (novoStatusBase !== 'Confirmar Entrega') {
                ModalSystem.confirm(`Deseja alterar o status para "${novoStatusFinal}"?`, "Confirmar Alteração", () => {
                    handleUpdate();
                }, () => { fetchData(); });
            }
        }
    });

    if (elements.btnGerarRelatorio) {
        elements.btnGerarRelatorio.addEventListener('click', () => {
            // Constrói os parâmetros da URL com base no estado atual dos filtros
            const params = new URLSearchParams({
                search: state.search,
                situacao: state.situacao,
                transportadora: state.transportadora,
                observacao: state.observacao,
                plataforma: state.plataforma,
                dataInicio: state.dataInicio,
                dataFim: state.dataFim
            });

            // Cria a URL completa para a rota do relatório
            const reportUrl = `/rastreio/api/gerar-relatorio?${params.toString()}`;

            // Abre a URL em uma nova aba, o que iniciará o download
            window.open(reportUrl, '_blank');
        });
    }

    // --- 5. Lógica de Inicialização ---
    function initialize() {
        if (elements.massSearchToggle && elements.massSearchToggle.checked) {
                elements.massSearchToggle.checked = false;
                elements.normalFiltersContainer.style.display = 'flex';
                elements.massSearchContainer.style.display = 'none';
        }
        
        elements.searchInput.value = state.search || '';
        elements.transportadoraFilter.value = state.transportadora || '';
        elements.plataformaFilter.value = state.plataforma || '';
        elements.situacaoFilter.value = state.situacao || '';
        elements.observacaoFilter.value = state.observacao || '';
        elements.dataInicioFilter.value = state.dataInicio || '';
        elements.dataFimFilter.value = state.dataFim || '';

        // Se não houver datas, define um período padrão
        if (!state.dataInicio || !state.dataFim) {
            const today = new Date();
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(today.getMonth() - 1);
            elements.dataInicioFilter.value = oneMonthAgo.toISOString().split('T')[0];
            elements.dataFimFilter.value = today.toISOString().split('T')[0];
        }

        handleFilterChange(false); // Inicia a busca sem resetar a página
    }

    initialize();
});