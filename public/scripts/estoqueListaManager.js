/**
 * estoqueListaManager.js
 * Gerencia a listagem de peças no estoque com filtros, ordenação dinâmica, limite por página, paginação e ações modernas usando tabela HTML responsiva.
 */
document.addEventListener('DOMContentLoaded', function() {
    // === Elementos ===
    const tableBody = document.getElementById('table-body');
    const tableHeaders = document.querySelectorAll('#tabela-estoque th.sortable');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const buscaInput = document.getElementById('buscaGeral');
    const filtroFabrica = document.getElementById('filtroFabrica');
    const filtroLimite = document.getElementById('filtroLimite');

    // === Estado ===
    let currentPage = 1;
    let pageLimit = 50;
    let orderBy = 'created_at';
    let orderDir = 'DESC';
    let debounceTimer = null;

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================

    /**
     * Busca peças da API com os filtros e ordenação atuais.
     */
    const loadPecas = async () => {
        try {
            const params = new URLSearchParams({
                page: currentPage,
                limit: pageLimit,
                orderBy: orderBy,
                orderDir: orderDir
            });

            const busca = buscaInput.value.trim();
            if (busca) params.set('busca', busca);

            const fabrica = filtroFabrica.value;
            if (fabrica) params.set('fabrica_id', fabrica);

            const response = await fetch(`/estoque/api/pecas?${params.toString()}`);
            if (!response.ok) throw new Error('Erro ao carregar peças');

            const result = await response.json();
            renderTable(result.data);
            renderPagination(result);
        } catch (error) {
            console.error('[Estoque Lista] Erro ao carregar:', error);
            tableBody.innerHTML = '<tr><td colspan="11" class="text-center text-danger">Erro ao carregar peças.</td></tr>';
            emptyState.style.display = 'block';
            emptyState.querySelector('p').textContent = 'Erro ao carregar peças. Tente novamente.';
        }
    };

    // =============================================
    // === RENDERIZAÇÃO DA TABELA ===
    // =============================================

    /**
     * Atualiza as setas visuais de ordenação nos cabeçalhos <th>.
     */
    const updateHeaderClasses = () => {
        tableHeaders.forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === orderBy) {
                th.classList.add(orderDir.toLowerCase());
            }
        });
    };

    /**
     * Renderiza as linhas da tabela no tbody.
     */
    const renderTable = (pecas) => {
        tableBody.innerHTML = '';
        updateHeaderClasses();

        if (pecas.length === 0) {
            emptyState.style.display = 'block';
            paginationContainer.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';

        pecas.forEach(peca => {
            const qtyClass = peca.quantidade === 0 ? 'qty-zero' 
                           : peca.quantidade <= 5 ? 'qty-low' 
                           : 'qty-ok';

            const localizacao = (peca.coluna_localizacao || peca.linha_localizacao)
                ? `${peca.coluna_localizacao || '-'} / ${peca.linha_localizacao || '-'}`
                : '-';

            // Formatação do Produto Pai (SKU + Nome) com quebra de linha permitida
            let produtoPai = '-';
            if (peca.produto_pai_sku || peca.produto_pai_nome) {
                const skuPart = peca.produto_pai_sku ? `<strong>${escapeHtml(peca.produto_pai_sku)}</strong>` : '';
                const nomePart = peca.produto_pai_nome ? escapeHtml(peca.produto_pai_nome) : '';
                produtoPai = skuPart && nomePart ? `${skuPart} - ${nomePart}` : (skuPart || nomePart);
            }

            // Formatação das medidas: Altura x Largura x Profundidade
            const medidas = `${parseFloat(peca.altura)} x ${parseFloat(peca.largura)} x ${parseFloat(peca.profundidade)} mm`;

            const tr = document.createElement('tr');
            tr.dataset.id = peca.id;

            tr.innerHTML = `
                <td>${escapeHtml(peca.sku)}</td>
                <td>${escapeHtml(peca.numero_peca || '-')}</td>
                <td>${escapeHtml(peca.fabrica_nome || '-')}</td>
                <td style="max-width: 250px; word-break: break-word; white-space: normal;">${produtoPai}</td>
                <td style="max-width: 250px; word-break: break-word; white-space: normal;">${escapeHtml(peca.nome_peca)}</td>
                <td style="max-width: 200px; word-break: break-word; white-space: normal;">${escapeHtml(peca.observacao || '-')}</td>
                <td>${escapeHtml(peca.cor || '-')}</td>
                <td>${medidas}</td>
                <td class="text-center"><span class="qty-badge ${qtyClass}">${peca.quantidade}</span></td>
                <td>${localizacao}</td>
                <td class="text-center" style="white-space: nowrap;">
                    <button class="btn-action btn-action-print btn-print-etiqueta" data-id="${peca.id}" data-sku="${escapeHtml(peca.sku)}" title="Gerar Etiquetas">
                        <i class="fas fa-print"></i>
                    </button>
                    <a href="/estoque/nova?cloneId=${peca.id}" class="btn-action btn-action-clone" title="Clonar Peça">
                        <i class="fas fa-copy"></i>
                    </a>
                    <a href="/estoque/editar/${peca.id}" class="btn-action btn-action-accent" title="Editar">
                        <i class="fas fa-edit"></i>
                    </a>
                    <button class="btn-action btn-action-danger btn-delete-peca" data-id="${peca.id}" data-sku="${escapeHtml(peca.sku)}" title="Excluir">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        // Re-bind de eventos nos botões de gerar etiquetas
        tableBody.querySelectorAll('.btn-print-etiqueta').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const sku = btn.dataset.sku;
                
                ModalSystem.prompt(
                    `Digite a quantidade de etiquetas para a peça <strong>${sku}</strong>:`,
                    'Gerar Etiquetas de Peça',
                    (val) => {
                        const qtd = parseInt(val);
                        if (isNaN(qtd) || qtd <= 0) {
                            ModalSystem.alert('Por favor, digite uma quantidade de etiquetas válida (maior que 0).', 'Quantidade Inválida');
                            return;
                        }
                        
                        // Abre o PDF gerado em uma nova guia para visualização/impressão
                        window.open(`/estoque/pdf-etiquetas/${id}?quantidade=${qtd}`, '_blank');
                    }
                );
            });
        });

        // Re-bind de eventos nos botões de excluir
        tableBody.querySelectorAll('.btn-delete-peca').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const sku = btn.dataset.sku;
                confirmDelete(id, sku);
            });
        });
    };

    /**
     * Alterna a ordenação ao clicar no cabeçalho.
     */
    const handleSort = (column) => {
        if (orderBy === column) {
            orderDir = orderDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            orderBy = column;
            orderDir = column === 'created_at' ? 'DESC' : 'ASC';
        }
        currentPage = 1;
        loadPecas();
    };

    // =============================================
    // === PAGINAÇÃO ===
    // =============================================

    /**
     * Renderiza os controles de paginação.
     */
    const renderPagination = (result) => {
        if (result.totalPages <= 1) {
            paginationContainer.innerHTML = `<span class="pagination-info">${result.total} peça(s) encontrada(s)</span>`;
            return;
        }

        let html = '';

        // Botão anterior
        html += `<button ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
                    <i class="fas fa-chevron-left"></i>
                 </button>`;

        // Páginas
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(result.totalPages, startPage + maxVisible - 1);

        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            html += `<button data-page="1">1</button>`;
            if (startPage > 2) html += `<span class="pagination-info">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
        }

        if (endPage < result.totalPages) {
            if (endPage < result.totalPages - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${result.totalPages}">${result.totalPages}</button>`;
        }

        // Botão próximo
        html += `<button ${currentPage >= result.totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
                    <i class="fas fa-chevron-right"></i>
                 </button>`;

        html += `<span class="pagination-info">${result.total} peça(s)</span>`;

        paginationContainer.innerHTML = html;

        // Event listeners
        paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page !== currentPage && !btn.disabled) {
                    currentPage = page;
                    loadPecas();
                }
            });
        });
    };

    // =============================================
    // === EXCLUSÃO ===
    // =============================================

    /**
     * Exibe modal de confirmação para exclusão de peça.
     */
    const confirmDelete = (id, sku) => {
        ModalSystem.prompt(
            `Para confirmar a exclusão da peça <strong>${sku}</strong>, digite a senha de segurança:`,
            'Confirmar Exclusão',
            async (password) => {
                if (password !== 'Dev123321') {
                    ModalSystem.alert('Senha incorreta! A exclusão foi abortada.', 'Erro de Autenticação');
                    return;
                }
                try {
                    const response = await fetch(`/estoque/delete/${id}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const result = await response.json();

                    if (!response.ok || !result.success) {
                        throw new Error(result.message || 'Erro ao excluir.');
                    }

                    ModalSystem.alert(result.message, 'Sucesso!');
                    loadPecas(); // Recarrega a lista
                } catch (error) {
                    console.error('[Estoque] Erro ao excluir:', error);
                    ModalSystem.alert(error.message || 'Erro ao excluir a peça.', 'Erro');
                }
            }
        );
    };

    // =============================================
    // === UTILITIES ===
    // =============================================

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =============================================
    // === EVENT LISTENERS ===
    // =============================================

    // Cliques de ordenação no cabeçalho <th>
    tableHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;
            handleSort(column);
        });
    });

    // Busca com debounce de 400ms
    buscaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentPage = 1;
            loadPecas();
        }, 400);
    });

    // Filtro de fábrica
    filtroFabrica.addEventListener('change', () => {
        currentPage = 1;
        loadPecas();
    });

    // Filtro de limite por página
    filtroLimite.addEventListener('change', () => {
        pageLimit = parseInt(filtroLimite.value) || 50;
        currentPage = 1;
        loadPecas();
    });

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    loadPecas();
});
