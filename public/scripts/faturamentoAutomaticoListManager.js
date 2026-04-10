// public/scripts/faturamentoAutomaticoListManager.js

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Seleção de Elementos ---
    const elements = {
        gridContainer: document.getElementById('faturamento-auto-grid'),
        paginationContainer: document.getElementById('faturamento-auto-pagination'),
        manualFilter: document.getElementById('faturamento-auto-manual-filter'),
        searchInput: document.getElementById('faturamento-auto-search-input'),
        reportBtn: document.getElementById('faturamento-auto-report-btn'),
        cardTemplate: document.getElementById('faturamento-auto-card-template')
    };

    if (!elements.gridContainer) {
        return; 
    }

    // --- 2. Estado da Aplicação ---
    let state = {
        currentPage: 1,
        totalPages: 1,
        search: '',
        isManual: '' // '' = Todos, 'true' = Manual, 'false' = Automático
    };

    let debounceTimer;

    // --- 3. Funções de Renderização e API ---

    // Formatação de Data (DD/MM/YYYY HH:mm)
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Formatação de Moeda (BRL)
    const formatCurrency = (value) => {
        if (value === null || value === undefined) return '-';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    const fetchNotes = async () => {
        // Mostra Loading
        elements.gridContainer.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;">Carregando notas pendentes...</td></tr>';

        const params = new URLSearchParams({
            page: state.currentPage,
            search: state.search,
            isManual: state.isManual
        });

        try {
            const response = await fetch(`/faturamento-automatico/api/list?${params.toString()}`);
            const data = await response.json();

            if (data.success) {
                state.totalPages = data.totalPages;
                state.currentPage = data.currentPage;
                renderGrid(data.data);
                renderPagination(data.currentPage, data.totalPages);
            } else {
                elements.gridContainer.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Erro: ${data.message}</td></tr>`;
            }
        } catch (error) {
            console.error('Erro ao buscar notas:', error);
            elements.gridContainer.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">Erro de conexão ao buscar notas.</td></tr>';
        }
    };

    const renderGrid = (notes) => {
        elements.gridContainer.innerHTML = '';

        if (notes.length === 0) {
            elements.gridContainer.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;">Nenhuma nota pendente encontrada com os filtros atuais.</td></tr>';
            return;
        }

        notes.forEach(note => {
            // Clona o template
            const clone = elements.cardTemplate.content.cloneNode(true);
            const tr = clone.querySelector('tr');

            // Preenche os dados
            tr.querySelector('.col-numero').textContent = note.nfe_numero || 'S/N';
            
            // Chave de Acesso (Tratamento para Chave Temporária)
            /*const chaveDisplay = note.chave_acesso && note.chave_acesso.startsWith('TEMP') 
                ? 'Em Processamento (Temp)' 
                : note.chave_acesso || '-';
            tr.querySelector('.col-chave').textContent = chaveDisplay;
            tr.querySelector('.col-chave').title = note.chave_acesso || ''; // Tooltip*/

            /*tr.querySelector('.col-emissao').textContent = formatDate(note.data_emissao);*/
            
            // Coluna Valor (calculado ou total_volumes usado como placeholder se não houver valor monetário explícito na tabela cached_nfe, 
            // mas assumindo que adicionamos ou usaremos volumes/descrição)
            // A tabela cached_nfe original não tinha 'valor_total' explícito no DDL passado, 
            // mas assumirei que podemos mostrar volumes ou adicionar valor. 
            // Vou usar Total Volumes aqui conforme tabela fornecida, ou '-' se não aplicável.
            tr.querySelector('.col-volumes').textContent = note.total_volumes || 0;

            // Status (Manual vs Auto)
            const statusSpan = tr.querySelector('.col-status span');
            if (note.is_manual) {
                statusSpan.className = 'nfe-status status-manual';
                statusSpan.textContent = 'Manual';
            } else {
                statusSpan.className = 'nfe-status status-automatico';
                statusSpan.textContent = 'Automático';
            }

            // Descrição (Truncada)
            const desc = note.product_descriptions_list || '';
            tr.querySelector('.col-produtos').textContent = desc.length > 50 ? desc.substring(0, 50) + '...' : desc;
            tr.querySelector('.col-produtos').title = desc;

            tr.querySelector('.col-updated').textContent = formatDate(note.last_updated_at);

            elements.gridContainer.appendChild(clone);
        });
    };

    const renderPagination = (current, total) => {
        elements.paginationContainer.innerHTML = '';

        if (total <= 1) return;

        // Botão Anterior
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btn-secondary';
        prevBtn.innerHTML = '&laquo; Anterior';
        prevBtn.disabled = current === 1;
        prevBtn.onclick = () => changePage(current - 1);
        elements.paginationContainer.appendChild(prevBtn);

        // Select de Páginas
        const pageSelect = document.createElement('select');
        pageSelect.id = 'page-select';
        for (let i = 1; i <= total; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.text = `Página ${i}`;
            if (i === current) option.selected = true;
            pageSelect.appendChild(option);
        }
        pageSelect.onchange = (e) => changePage(parseInt(e.target.value));
        elements.paginationContainer.appendChild(pageSelect);

        // Texto informativo
        const info = document.createElement('span');
        info.className = 'page-info';
        info.textContent = ` de ${total}`;
        elements.paginationContainer.appendChild(info);

        // Botão Próxima
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-secondary';
        nextBtn.innerHTML = 'Próxima &raquo;';
        nextBtn.disabled = current === total;
        nextBtn.onclick = () => changePage(current + 1);
        elements.paginationContainer.appendChild(nextBtn);
    };

    const changePage = (newPage) => {
        if (newPage < 1 || newPage > state.totalPages) return;
        state.currentPage = newPage;
        fetchNotes();
    };

    // --- 4. Event Listeners ---

    // Filtro Manual
    elements.manualFilter.addEventListener('change', (e) => {
        state.isManual = e.target.value;
        state.currentPage = 1;
        fetchNotes();
    });

    // Busca com Debounce
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        state.search = e.target.value;
        debounceTimer = setTimeout(() => {
            state.currentPage = 1;
            fetchNotes();
        }, 500);
    });

    // Relatório Excel
    elements.reportBtn.addEventListener('click', async () => {
        const originalText = elements.reportBtn.innerHTML;
        elements.reportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        elements.reportBtn.disabled = true;

        const params = new URLSearchParams({
            search: state.search,
            isManual: state.isManual
        });

        try {
            const url = `/faturamento-automatico/api/report?${params.toString()}`;
            // Dispara download direto
            window.location.href = url;
        } catch (error) {
            alert('Erro ao gerar relatório');
        } finally {
            setTimeout(() => {
                elements.reportBtn.innerHTML = originalText;
                elements.reportBtn.disabled = false;
            }, 2000);
        }
    });

    // --- 5. Inicialização ---
    fetchNotes();
});