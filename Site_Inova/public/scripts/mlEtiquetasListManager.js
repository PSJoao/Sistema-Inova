// public/scripts/mlEtiquetasListManager.js

document.addEventListener('DOMContentLoaded', async () => { // Manter async

    // --- Funções Auxiliares (Helpers Locais) ---
    // (Definidas aqui para serem usadas na construção do HTML)
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            // Adiciona verificação extra para datas inválidas que podem vir do DB
            if (isNaN(date.getTime())) return 'Data Inválida';
            // Usa UTC para evitar problemas de fuso horário apenas na formatação de exibição
            const day = String(date.getUTCDate()).padStart(2, '0');
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const year = date.getUTCFullYear();
            return `${day}/${month}/${year}`;
        } catch (e) { return 'Erro Data'; }
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Inválido';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    };

    const truncate = (str, len) => {
        if (!str) return '';
        const cleanStr = String(str);
        if (cleanStr.length > len) {
            return cleanStr.substring(0, len) + '...';
        }
        return cleanStr;
    };

    const nullToStr = (val) => (val === null || val === undefined) ? '' : String(val);

    const sum = (a, b) => (Number(a) || 0) + (Number(b) || 0);

    const toLowerCase = (str) => (typeof str === 'string') ? str.toLowerCase() : '';

    // --- 1. Seleção de Elementos ---
    const elements = {
        tableBody: document.getElementById('ml-etiquetas-table-body'),
        paginationContainer: document.getElementById('ml-etiquetas-pagination'),
        situacaoFilter: document.getElementById('ml-etiquetas-situacao-filter'),
        searchInput: document.getElementById('ml-etiquetas-search-input'),
        startDateInput: document.getElementById('ml-etiquetas-start-date'),
        endDateInput: document.getElementById('ml-etiquetas-end-date'),
        filterBtn: document.getElementById('ml-etiquetas-filter-btn'),
        reportBtn: document.getElementById('ml-etiquetas-report-btn'),
        skuQtdReportBtn: document.getElementById('ml-etiquetas-sku-qtd-report-btn')
        // REMOVIDO: rowTemplateElement
    };

    // Verificação essencial
    if (!elements.tableBody) {
        console.error("ERRO: Elemento <tbody> 'ml-etiquetas-table-body' não encontrado no DOM.");
        return;
    }

    // --- 2. Estado da Aplicação ---
    let state = {
        currentPage: 1,
        totalPages: 1,
        limit: 50,
        search: '',
        situacao: '',
        startDate: '',
        endDate: '',
        sortBy: 'last_processed_at',
        sortOrder: 'DESC'
    };

    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const formatDateForInput = (date) => {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    state.startDate = formatDateForInput(thirtyDaysAgo);
    state.endDate = formatDateForInput(today);

    // Define os valores nos inputs
    if (elements.startDateInput) elements.startDateInput.value = state.startDate;
    if (elements.endDateInput) elements.endDateInput.value = state.endDate;

    let debounceTimer;

    // --- 3. Funções ---

    /** Busca dados da API e renderiza a tabela */
    async function fetchData() {
        console.log("Fetching data with state:", state);
        ModalSystem.showLoading('Buscando etiquetas...');
        const params = new URLSearchParams({
            page: state.currentPage,
            limit: state.limit,
            search: state.search,
            situacao: state.situacao,
            startDate: state.startDate,
            endDate: state.endDate,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder
        });

        for (let [key, value] of params.entries()) {
            if (!value) {
                params.delete(key);
            }
        }

        try {
            const response = await fetch(`/api/etiquetas/listagem?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Erro ${response.status}: ${await response.text()}`);
            }
            const data = await response.json();
            console.log("Data received:", data);

            // --- LÓGICA DE RENDERIZAÇÃO DIRETA (ESTILO nfeHistoryManager) ---
            const etiquetas = data.etiquetasData;

            if (!etiquetas || etiquetas.length === 0) {
                elements.tableBody.innerHTML = '<tr><td colspan="10" class="text-center p-5">Nenhuma etiqueta encontrada para os filtros aplicados.</td></tr>';
            } else {
                let tableHtml = ''; // Acumulador para o HTML

                etiquetas.forEach(etiqueta => {
                    // Prepara os valores formatados ANTES de construir o HTML
                    const skus = nullToStr(etiqueta.skus);
                    const locations = nullToStr(etiqueta.locations);
                    const pdfArquivoOrigem = nullToStr(etiqueta.pdf_arquivo_origem);
                    const situacao = nullToStr(etiqueta.situacao);

                    // Constrói a string HTML da linha (<tr>...</tr>) usando template literals
                    tableHtml += `
                        <tr style="border-bottom: 1px solid #535353e5;">
                            <td style="text-align: center;">${nullToStr(etiqueta.nfe_numero)}</td>
                            <td style="text-align: center;">${nullToStr(etiqueta.numero_loja)}</td>
                            <td class="sku-list" title="${skus}">${truncate(skus, 40)}</td>
                            <td style="text-align: center;">${nullToStr(etiqueta.quantidade_total)}</td>
                            <td class="location-list" title="${locations}">${truncate(locations, 30)}</td>
                            <td style="text-align: center;"><span class="nfe-status status-${toLowerCase(situacao)}">${situacao}</span></td>
                            <td style="text-align: center;">${formatDateTime(etiqueta.last_processed_at)}</td>
                        </tr>
                    `;
                });

                elements.tableBody.innerHTML = tableHtml; // Atualiza o corpo da tabela
            }
            // --- FIM DA LÓGICA DE RENDERIZAÇÃO ---

            // Atualiza o estado da paginação
            state.totalPages = data.pagination.totalPages;
            state.currentPage = data.pagination.currentPage;
            renderPagination(data.pagination);

        } catch (error) {
            console.error("Erro ao buscar dados das etiquetas ML:", error);
            elements.tableBody.innerHTML = `<tr><td colspan="10" class="text-center text-danger p-5">Erro ao carregar dados: ${error.message}</td></tr>`;
            renderPagination({ currentPage: 1, totalPages: 1 }); // Reseta paginação
        } finally {
            ModalSystem.hideLoading();
        }
    } // Fim da função fetchData

    /** Renderiza os controles de paginação (Idêntico ao anterior) */
    function renderPagination(pagination) {
        const { currentPage, totalPages } = pagination;
        let paginationHtml = '';

        if (totalPages <= 1) {
            elements.paginationContainer.innerHTML = '';
            return;
        }

        paginationHtml += `
            <button id="ml-etiquetas-prev-page" class="btn btn-secondary btn-sm" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Anterior</button>
            <select id="ml-etiquetas-page-select" class="page-select-dropdown" style="width: auto; display: inline-block;">
        `;
        for (let i = 1; i <= totalPages; i++) {
            paginationHtml += `<option value="${i}" ${i === currentPage ? 'selected' : ''}>Página ${i}</option>`;
        }
        paginationHtml += `
            </select>
            <button id="ml-etiquetas-next-page" class="btn btn-secondary btn-sm" ${currentPage === totalPages ? 'disabled' : ''}>Próxima &raquo;</button>
            <span class="ml-3">Página ${currentPage} de ${totalPages}</span>
        `;

        elements.paginationContainer.innerHTML = paginationHtml;

        // Reatribui listeners aos botões/select de paginação
        document.getElementById('ml-etiquetas-prev-page')?.addEventListener('click', () => {
            if (state.currentPage > 1) {
                state.currentPage--;
                fetchData();
            }
        });
        document.getElementById('ml-etiquetas-next-page')?.addEventListener('click', () => {
            if (state.currentPage < state.totalPages) {
                state.currentPage++;
                fetchData();
            }
        });
        document.getElementById('ml-etiquetas-page-select')?.addEventListener('change', (e) => {
            state.currentPage = parseInt(e.target.value, 10);
            fetchData();
        });
    }

    /** Atualiza o estado com base nos filtros e busca os dados (Idêntico ao anterior) */
    function applyFiltersAndFetch() {
        state.search = elements.searchInput.value.trim();
        state.situacao = elements.situacaoFilter.value;
        state.startDate = elements.startDateInput.value;
        state.endDate = elements.endDateInput.value;
        state.currentPage = 1; // Volta para a primeira página ao aplicar filtros
        fetchData();
    }

    // --- 4. Event Listeners (Idênticos aos anteriores) ---

    // Botão Filtrar
    elements.filterBtn?.addEventListener('click', applyFiltersAndFetch);

    // Input de busca (com debounce)
    elements.searchInput?.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            applyFiltersAndFetch();
        }, 500);
    });

    // Selects de filtro (busca imediata)
    elements.situacaoFilter?.addEventListener('change', applyFiltersAndFetch);

    elements.startDateInput?.addEventListener('change', applyFiltersAndFetch);
    elements.endDateInput?.addEventListener('change', applyFiltersAndFetch);

    // Botão Download Excel (Idêntico ao anterior)
    elements.reportBtn?.addEventListener('click', async () => {
        const originalButtonText = elements.reportBtn.innerHTML;
        elements.reportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportBtn.disabled = true;

        const params = new URLSearchParams({
            search: state.search,
            situacao: state.situacao,
            startDate: state.startDate,
            endDate: state.endDate,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder
        });

        for (let [key, value] of params.entries()) {
            if (!value) {
                params.delete(key);
            }
        }

        const reportUrl = `/api/etiquetas/exportar?${params.toString()}`;

        try {
            window.location.href = reportUrl; // Inicia download GET
            setTimeout(() => {
                elements.reportBtn.innerHTML = originalButtonText;
                elements.reportBtn.disabled = false;
            }, 3000);
        } catch (error) {
            console.error("Erro ao iniciar download do relatório:", error);
            ModalSystem.alert('Erro ao tentar baixar o relatório.', 'Erro');
            elements.reportBtn.innerHTML = originalButtonText;
            elements.reportBtn.disabled = false;
        }
    });

    elements.skuQtdReportBtn?.addEventListener('click', async () => {
        const originalButtonText = elements.skuQtdReportBtn.innerHTML;
        elements.skuQtdReportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.skuQtdReportBtn.disabled = true;

        const reportUrl = `/api/etiquetas/exportar-sku-qtd`; // Rota SEM filtros

        try {
            const response = await fetch(reportUrl); // Usa fetch para poder verificar o status

            if (!response.ok) {
                 // Se a API retornou 404 (sem dados), mostra um alerta
                 if (response.status === 404) {
                     const message = await response.text();
                     ModalSystem.alert(message || 'Nenhuma etiqueta pendente encontrada para gerar o relatório.', 'Relatório Vazio');
                 } else {
                     // Outros erros
                    const errorText = await response.text();
                     throw new Error(`Erro ${response.status}: ${errorText || 'Falha ao gerar relatório.'}`);
                 }
                 // Reativa o botão em caso de não sucesso
                 elements.skuQtdReportBtn.innerHTML = originalButtonText;
                 elements.skuQtdReportBtn.disabled = false;
                 return; // Interrompe a execução
            }

            // Se a resposta foi OK (200), inicia o download
            window.location.href = reportUrl; // Redireciona para iniciar o download GET

            // Simula um tempo de espera antes de reativar o botão
            setTimeout(() => {
                elements.skuQtdReportBtn.innerHTML = originalButtonText;
                elements.skuQtdReportBtn.disabled = false;
            }, 3000); // Espera 3 segundos

        } catch (error) {
            console.error("Erro ao iniciar download do relatório SKU/Qtd:", error);
            ModalSystem.alert(`Erro ao tentar baixar o relatório: ${error.message}`, 'Erro');
            elements.skuQtdReportBtn.innerHTML = originalButtonText;
            elements.skuQtdReportBtn.disabled = false;
        }
    });

    // --- 5. Inicialização ---
    fetchData(); // Busca os dados iniciais ao carregar a página
});