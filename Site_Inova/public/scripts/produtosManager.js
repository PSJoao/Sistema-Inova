// public/scripts/produtosManager.js

document.addEventListener('DOMContentLoaded', function() {
    // --- 1. Elementos da UI ---
    const searchInput = document.getElementById('produtos-search-input');
    const tipoFilter = document.getElementById('produtos-tipo-filter');
    const tableHead = document.getElementById('produtos-table-head');
    const tableBody = document.getElementById('produtos-table-body');
    const paginationContainer = document.getElementById('produtos-pagination');

    // --- 2. Estado dos Filtros ---
    let currentSearch = '';
    let currentTipo = 'produto'; // Default para 'produto'
    let currentPage = 1;
    let currentLimit = 50; // Padrão
    let currentSortBy = 'sku'; // Default
    let currentSortOrder = 'ASC'; // Default
    let debounceTimer;

    // --- 3. Cabeçalhos Dinâmicos ---
    const headers = {
        produto: `
            <tr>
                <th>SKU</th>
                <th>Nome</th>
                <th>Custo</th>
                <th>Ações</th>
            </tr>
        `,
        estrutura: `
            <tr>
                <th>SKU Componente</th>
                <th>Nome Estrutura</th>
                <th>Localização</th>
                <th>GTIN</th>
                <th>GTIN Embalagem</th>
                <th>Ações</th>
            </tr>
        `
    };

    // --- 4. Funções Auxiliares (Helpers) ---
    function formatPrice(price) {
        if (price === null || price === undefined || isNaN(parseFloat(price))) {
            return "R$ 0,00";
        }
        const numericPrice = parseFloat(String(price).replace(',', '.'));
        return `R$ ${numericPrice.toFixed(2).replace('.', ',')}`;
    }

    function truncate(str, len) {
        if (!str) return '';
        if (str.length > len && str.length > 0) {
            return str.substr(0, len) + '...';
        }
        return str;
    }

    // --- 5. Lógica de Renderização ---

    /**
     * Função principal para buscar e renderizar os dados
     */
    async function fetchProdutos() {
        // Mostra o feedback de carregamento
        tableHead.innerHTML = ''; // Limpa cabeçalho
        tableBody.innerHTML = '<tr><td colspan="10" class="text-center p-5">Carregando...</td></tr>';
        
        const params = new URLSearchParams({
            page: currentPage,
            limit: currentLimit,
            search: currentSearch,
            tipo: currentTipo,
            sortBy: currentSortBy,
            sortOrder: currentSortOrder
        });

        try {
            const response = await fetch(`/api/produtos/listagem?${params.toString()}`);
            if (!response.ok) {
                let errorMsg = `Erro ${response.status}: ${response.statusText}`;
                try {
                    const errData = await response.json();
                    errorMsg = errData.message || errorMsg;
                } catch (e) { /* Ignora se não for JSON */ }
                throw new Error(errorMsg);
            }
            
            const result = await response.json();
            
            // Renderiza a tabela e a paginação
            renderTable(result.data, result.tipo);
            renderPaginationControls(result.pagination); // Usa a função padrão do mlEtiquetasListManager

        } catch (error) {
            console.error('Erro ao buscar produtos:', error);
            tableBody.innerHTML = `<tr><td colspan="10" class="text-center p-5 text-danger">Erro ao carregar dados: ${error.message}</td></tr>`;
            paginationContainer.innerHTML = ''; // Limpa paginação em caso de erro
        }
    }

    /**
     * Renderiza o cabeçalho e as linhas da tabela dinamicamente
     */
    function renderTable(data, tipo) {
        // 1. Limpa a tabela
        tableHead.innerHTML = '';
        tableBody.innerHTML = '';

        // 2. Define o cabeçalho correto
        tableHead.innerHTML = headers[tipo] || headers.produto;

        // 3. Verifica se há dados
        if (!data || data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="10" class="text-center p-5">Nenhum item encontrado para os filtros selecionados.</td></tr>';
            return;
        }

        // 4. Constrói as linhas (HTML)
        // O CSS da classe 'nfe-history-table' no Handlebars já garante a borda inferior
        let rowsHtml = '';
        if (tipo === 'produto') {
            data.forEach(item => {
                rowsHtml += `
                    <tr style="border-bottom: 1px solid #535353e5;">
                        <td data-label="SKU">${item.sku || 'N/A'}</td>
                        <td data-label="Nome" title="${item.nome}">${truncate(item.nome, 60) || 'N/A'}</td>
                        <td data-label="Custo">${formatPrice(item.preco_custo)}</td>
                        <td data-label="Ações" style="text-align: center;">
                            <a href="/produtos/editar/produto/${encodeURIComponent(item.sku)}" class="btn btn-sm btn-primary" title="Editar">
                                <i class="fas fa-edit"></i>
                            </a>
                        </td>
                    </tr>
                `;
            });
        } else { // tipo === 'estrutura'
             data.forEach(item => {
                rowsHtml += `
                    <tr style="border-bottom: 1px solid #535353e5;">
                        <td data-label="SKU Componente">${item.component_sku || 'N/A'}</td>
                        <td data-label="Nome Estrutura" title="${item.structure_name}">${truncate(item.structure_name, 50) || 'N/A'}</td>
                        <td data-label="Localização">${item.component_location || 'N/A'}</td>
                        <td data-label="GTIN">${item.gtin || 'N/A'}</td>
                        <td data-label="GTIN Embalagem">${item.gtin_embalagem || 'N/A'}</td>
                        <td data-label="Ações" style="text-align: center;">
                            <a href="/produtos/editar/estrutura/${encodeURIComponent(item.component_sku)}" class="btn btn-sm btn-primary" title="Editar">
                                <i class="fas fa-edit"></i>
                            </a>
                        </td>
                    </tr>
                `;
            });
        }
        tableBody.innerHTML = rowsHtml;
    }

    /**
     * Renderiza os controles de paginação (Estilo mlEtiquetasListManager)
     */
    function renderPaginationControls(pagination) {
        paginationContainer.innerHTML = ''; // Limpa a paginação existente
        const { currentPage, totalPages, totalItems } = pagination;

        if (totalPages <= 1) return; // Não mostra paginação se só tiver 1 página

        let paginationHtml = '';

        // Botão "Anterior"
        paginationHtml += `
            <button class="page-link" style="margin-right: 15px;" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>
                &laquo; Anterior
            </button>`;

        // Combobox (Select) de Página
        paginationHtml += '<span class="pagination-select-container">';
        paginationHtml += `<select id="produtos-page-select" class="page-select-dropdown">`;
        
        for (let i = 1; i <= totalPages; i++) {
            paginationHtml += `<option value="${i}"Página ${i === currentPage ? 'selected' : ''}>${i}</option>`;
        }
        
        paginationHtml += `</select> de ${totalPages}
            </span>`;

        // Botão "Próximo"
        paginationHtml += `
            <button class="page-link" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>
                Próximo &raquo;
            </button>`;
            

        paginationContainer.innerHTML = paginationHtml;
    }

    // --- 6. Event Listeners ---

    // Filtro de Busca (com debounce)
    searchInput.addEventListener('keyup', (e) => {
        clearTimeout(debounceTimer);
        const value = e.target.value;
        debounceTimer = setTimeout(() => {
            currentSearch = value;
            currentPage = 1; // Reseta para página 1
            fetchProdutos();
        }, 400); // 400ms de delay
    });

    // Filtro de Tipo (Produto/Estrutura)
    tipoFilter.addEventListener('change', (e) => {
        currentTipo = e.target.value;
        currentPage = 1; // Reseta para página 1
        currentSearch = ''; // Limpa a busca ao trocar de tipo
        searchInput.value = '';
        
        // Atualiza o placeholder da busca
        if (currentTipo === 'produto') {
             searchInput.placeholder = "SKU, Nome...";
             currentSortBy = 'sku';
        } else {
             searchInput.placeholder = "SKU, Nome, GTIN...";
             currentSortBy = 'component_sku';
        }
        
        fetchProdutos();
    });

    // Listener de CLIQUE para botões "Anterior/Próximo"
    paginationContainer.addEventListener('click', (e) => {
        // Procura pelo botão clicado (ou um ícone dentro dele)
        const targetButton = e.target.closest('button.page-link');
        
        if (targetButton && targetButton.dataset.page) {
            const newPage = parseInt(targetButton.dataset.page, 10);
            if (newPage !== currentPage && newPage > 0) {
                currentPage = newPage;
                fetchProdutos();
            }
        }
    });

    // Listener de MUDANÇA para o <select> de página
    paginationContainer.addEventListener('change', (e) => {
        if (e.target.id === 'produtos-page-select') {
            const newPage = parseInt(e.target.value, 10);
            if (newPage !== currentPage) {
                currentPage = newPage;
                fetchProdutos();
            }
        }
    });

    // --- 7. Inicialização ---
    
    // Pega o tipo da URL (caso tenha vindo de um redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const tipoFromUrl = urlParams.get('tipo');
    if (tipoFromUrl === 'estrutura') {
        currentTipo = 'estrutura';
        tipoFilter.value = 'estrutura';
        searchInput.placeholder = "SKU, Nome, GTIN...";
        currentSortBy = 'component_sku';
    }
    
    fetchProdutos(); // Carga inicial
});