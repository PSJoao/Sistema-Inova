/**
 * anunciosListaManager.js
 * Gerencia a listagem de anúncios ML com busca, paginação e botão de sincronização.
 * Estilo e lógica baseados no estoqueListaManager.js.
 */
document.addEventListener('DOMContentLoaded', function () {
    // === Elementos ===
    const tableBody = document.getElementById('table-body');
    const tableHeaders = document.querySelectorAll('#tabela-estoque th.sortable');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const buscaInput = document.getElementById('buscaGeral');
    const filtroLimite = document.getElementById('filtroLimite');
    const filtroStatus = document.getElementById('filtroStatus');
    const filtroCatalogo = document.getElementById('filtroCatalogo');
    const filtroTipo = document.getElementById('filtroTipo');
    const btnSincronizar = document.getElementById('btnSincronizar');
    const btnExportar = document.getElementById('btnExportar');

    // === Estado ===
    let currentPage = 1;
    let pageLimit = 50;
    let orderBy = 'last_updated_at';
    let orderDir = 'DESC';
    let debounceTimer = null;
    let rawAnunciosList = [];
    let columnExcelFilters = {}; // { colKey: Set([val1, val2...]) }
    let activeDropdownMenu = null;
    let clickTimer = null;

    // Ordem Padrão das Colunas
    const DEFAULT_COLUMN_ORDER = [
        'id_anuncio',
        'thumbnail',
        'sku',
        'descricao',
        'tipo_anuncio',
        'status',
        'ganhando_catalogo',
        'prazo_disponibilidade',
        'estoque_plataforma',
        'experiencia_compra',
        'vendas_total',
        'preco',
        'preco_promocional',
        'tarifa',
        'margem_lucro',
        'estoque_ml',
        'frete'
    ];
    let currentColumnOrder = [...DEFAULT_COLUMN_ORDER];

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================

    const loadAnuncios = async () => {
        try {
            const params = new URLSearchParams({
                all: 'true',
                orderBy: orderBy,
                orderDir: orderDir
            });

            const busca = buscaInput.value.trim();
            if (busca) params.set('search', busca);

            const status = filtroStatus.value;
            if (status) params.set('status', status);

            const catalog = filtroCatalogo.value;
            if (catalog) params.set('catalog', catalog);

            const tipo = filtroTipo.value;
            if (tipo) params.set('tipo', tipo);

            const response = await fetch(`/api/anuncios/listagem?${params.toString()}`);
            if (!response.ok) throw new Error('Erro ao carregar anúncios');

            const result = await response.json();
            rawAnunciosList = result.data || [];
            applyExcelFiltersAndRender();
        } catch (error) {
            console.error('[Anúncios] Erro ao carregar:', error);
            tableBody.innerHTML = '<tr><td colspan="15" class="text-center text-danger">Erro ao carregar anúncios.</td></tr>';
            emptyState.style.display = 'block';
            emptyState.querySelector('p').textContent = 'Erro ao carregar anúncios. Tente novamente.';
        }
    };

    // =============================================
    // === RENDERIZAÇÃO DA TABELA ===
    // =============================================

    const updateHeaderClasses = () => {
        tableHeaders.forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === orderBy) {
                th.classList.add(orderDir.toLowerCase());
            }
            const col = th.dataset.column;
            const hasFilter = columnExcelFilters[col] && columnExcelFilters[col].size > 0;
            th.classList.toggle('filter-active', Boolean(hasFilter));
        });
    };

    const renderTable = (anuncios) => {
        tableBody.innerHTML = '';
        updateHeaderClasses();

        if (!anuncios || anuncios.length === 0) {
            emptyState.style.display = 'block';
            paginationContainer.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';

        anuncios.forEach(anuncio => {
            // Badge de status
            let statusClass = '';
            let statusLabel = anuncio.status || '-';
            switch (anuncio.status) {
                case 'active':
                    statusClass = 'qty-ok';
                    statusLabel = 'Ativo';
                    break;
                case 'paused':
                    statusClass = 'qty-low';
                    statusLabel = 'Pausado';
                    break;
                case 'closed':
                case 'under_review':
                    statusClass = 'qty-zero';
                    statusLabel = anuncio.status === 'closed' ? 'Encerrado' : 'Em revisão';
                    break;
                default:
                    statusClass = '';
            }

            // Badge de estoque ML
            const estoqueML = anuncio.estoque_ml != null ? anuncio.estoque_ml : '-';
            const estoqueMLClass = estoqueML === '-' ? '' :
                estoqueML === 0 ? 'qty-zero' :
                    estoqueML <= 5 ? 'qty-low' : 'qty-ok';

            // Prazo de disponibilidade: garante "dias" em tudo que é número limpo
            let prazoLabel = '-';
            if (anuncio.prazo_disponibilidade != null && anuncio.prazo_disponibilidade !== '') {
                const dias = String(anuncio.prazo_disponibilidade).replace(/\D/g, '');
                prazoLabel = dias !== '' ? `${dias} dias` : anuncio.prazo_disponibilidade;
            }

            // Frete formatado em R$
            const freteVal = Number(anuncio.frete) || 0;
            const freteLabel = freteVal > 0
                ? freteVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                : 'R$ 0,00';

            // Preços formatados em R$
            const precoVal = Number(anuncio.preco) || 0;
            const precoLabel = precoVal > 0 ? precoVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

            const precoPromoVal = Number(anuncio.preco_promocional) || null;
            const precoPromoLabel = precoPromoVal ? precoPromoVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

            // Verifica se tem promo para riscar o preço original
            const finalPrecoOriginalHtml = precoPromoVal
                ? `<span style="text-decoration: line-through; color: #888; font-size: 0.85rem;">${precoLabel}</span>`
                : precoLabel;

            const finalPrecoPromoHtml = precoPromoVal
                ? `<span style="color: #2e7d32; font-weight: bold;">${precoPromoLabel}</span>`
                : '-';

            // Estoque Bling (da cached_products.estoque_plataforma)
            const estoqueBling = anuncio.estoque_plataforma != null ? anuncio.estoque_plataforma : '-';
            const estoqueBlingClass = estoqueBling === '-' ? '' :
                estoqueBling === 0 ? 'qty-zero' :
                    estoqueBling <= 5 ? 'qty-low' : 'qty-ok';

            const tr = document.createElement('tr');

            const catalogBadge = anuncio.catalog_listing
                ? ` <span class="qty-badge" style="background-color: rgba(156, 39, 176, 0.15); color: #9c27b0; font-size: 0.7rem; padding: 0.15rem 0.35rem; min-width: auto; margin-left: 5px;">Catálogo</span>`
                : '';

            let winBoxBadge = '-';
            if (anuncio.catalog_listing) {
                winBoxBadge = anuncio.ganhando_catalogo
                    ? `<span class="qty-badge" style="background-color: #e8f5e9; color: #2e7d32;">Ganhando</span>`
                    : `<span class="qty-badge" style="background-color: #ffebee; color: #c62828;">Perdendo</span>`;
            }

            const tipoHtml = anuncio.tipo_anuncio === 'Premium'
                ? `<span class="qty-badge" style="background-color: #fff3e0; color: #e65100;">${anuncio.tipo_anuncio}</span>`
                : `<span class="qty-badge" style="background-color: #f5f5f5; color: #616161;">${anuncio.tipo_anuncio || '-'}</span>`;

            const experienciaHtml = anuncio.experiencia_compra ? `${anuncio.experiencia_compra}%` : '0%';

            const tarifaVal = Number(anuncio.tarifa) || 0;
            const tarifaHtml = tarifaVal > 0 ? `${tarifaVal.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%` : '-';

            const urlAnuncio = anuncio.permalink || (anuncio.id_anuncio ? `https://produto.mercadolivre.com.br/${anuncio.id_anuncio}` : '#');
            const imgHtml = anuncio.thumbnail 
                ? `<img src="${anuncio.thumbnail}" alt="Foto" style="width: 36px; height: 36px; object-fit: contain; border-radius: 4px; vertical-align: middle; background: #fff;" />` 
                : '-';

            const renderCell = (colKey) => {
                switch (colKey) {
                    case 'id_anuncio':
                        const copyIdBtnHtml = anuncio.id_anuncio 
                            ? `<button class="btn-copy-id-anuncio" data-id-anuncio="${escapeHtml(anuncio.id_anuncio)}" title="Copiar ID do Anúncio" style="background: none; border: none; color: #888; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; transition: color 0.2s;"><i class="far fa-copy"></i></button>`
                            : '';
                        return `<td><div style="display: inline-flex; align-items: center; gap: 4px;"><a href="${urlAnuncio}" target="_blank" style="color: #f39c12; font-weight: bold; text-decoration: none;" title="Abrir anúncio no Mercado Livre">${escapeHtml(anuncio.id_anuncio || '-')}</a>${copyIdBtnHtml}</div></td>`;
                    case 'thumbnail':
                        return `<td class="text-center">${imgHtml}</td>`;
                    case 'sku':
                        const copyBtnHtml = anuncio.sku 
                            ? `<button class="btn-copy-sku" data-sku="${escapeHtml(anuncio.sku)}" title="Copiar SKU" style="background: none; border: none; color: #888; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; transition: color 0.2s;"><i class="far fa-copy"></i></button>`
                            : '';
                        return `<td><div style="display: inline-flex; align-items: center; gap: 4px;"><strong>${escapeHtml(anuncio.sku || '-')}</strong>${copyBtnHtml}${catalogBadge}</div></td>`;
                    case 'descricao':
                        return `<td style="min-width: 450px; max-width: 550px; word-break: break-word; white-space: normal; line-height: 1.2;">${escapeHtml(anuncio.descricao || '-')}</td>`;
                    case 'tipo_anuncio':
                        return `<td>${tipoHtml}</td>`;
                    case 'status':
                        return `<td><span class="qty-badge ${statusClass}">${statusLabel}</span></td>`;
                    case 'ganhando_catalogo':
                        return `<td class="text-center">${winBoxBadge}</td>`;
                    case 'prazo_disponibilidade':
                        return `<td class="text-center">${prazoLabel}</td>`;
                    case 'estoque_plataforma':
                        return `<td class="text-center"><span class="qty-badge ${estoqueBlingClass}">${estoqueBling}</span></td>`;
                    case 'experiencia_compra':
                        return `<td class="text-center">${experienciaHtml}</td>`;
                    case 'vendas_total':
                        return `<td class="text-center">${Number(anuncio.vendas_total || 0).toLocaleString('pt-BR')}</td>`;
                    case 'preco':
                        return `<td class="text-center">${finalPrecoOriginalHtml}</td>`;
                    case 'preco_promocional':
                        return `<td class="text-center">${finalPrecoPromoHtml}</td>`;
                    case 'tarifa':
                        return `<td class="text-center">${tarifaHtml}</td>`;
                    case 'margem_lucro':
                        const margemVal = Number(anuncio.margem_lucro);
                        if (anuncio.margem_lucro == null || isNaN(margemVal) || (margemVal === 0 && (!anuncio.custo_produto || Number(anuncio.custo_produto) === 0))) {
                            return `<td class="text-center">-</td>`;
                        }
                        const margemClass = margemVal >= 15 ? 'qty-ok' : (margemVal >= 5 ? 'qty-low' : 'qty-zero');
                        return `<td class="text-center"><span class="qty-badge ${margemClass}">${margemVal.toFixed(2).replace('.', ',')}%</span></td>`;
                    case 'estoque_ml':
                        return `<td class="text-center"><span class="qty-badge ${estoqueMLClass}">${estoqueML}</span></td>`;
                    case 'frete':
                        return `<td class="text-center">${freteLabel}</td>`;
                    default:
                        return `<td>-</td>`;
                }
            };

            tr.innerHTML = currentColumnOrder.map(colKey => renderCell(colKey)).join('');
            tableBody.appendChild(tr);
        });
    };

    // =============================================
    // === PAGINAÇÃO ===
    // =============================================

    const renderPagination = (pagination) => {
        if (!pagination || pagination.totalPages <= 1) {
            paginationContainer.innerHTML = pagination
                ? `<span class="pagination-info">${pagination.totalItems} anúncio(s) encontrado(s)</span>`
                : '';
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
        let endPage = Math.min(pagination.totalPages, startPage + maxVisible - 1);

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

        if (endPage < pagination.totalPages) {
            if (endPage < pagination.totalPages - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${pagination.totalPages}">${pagination.totalPages}</button>`;
        }

        // Botão próximo
        html += `<button ${currentPage >= pagination.totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
                    <i class="fas fa-chevron-right"></i>
                 </button>`;

        html += `<span class="pagination-info">${pagination.totalItems} anúncio(s)</span>`;

        paginationContainer.innerHTML = html;

        // Event listeners
        paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page !== currentPage && !btn.disabled) {
                    currentPage = page;
                    applyExcelFiltersAndRender();
                }
            });
        });
    };

    // =============================================
    // === SINCRONIZAÇÃO ===
    // =============================================

    const handleSync = async () => {
        // Coleta os filtros ativos da página para enviar na sincronização inteligente
        const syncParams = {};
        const busca = buscaInput ? buscaInput.value.trim() : '';
        if (busca) syncParams.search = busca;
        if (filtroStatus && filtroStatus.value) syncParams.status = filtroStatus.value;
        if (filtroCatalogo && filtroCatalogo.value) syncParams.catalog = filtroCatalogo.value;
        if (filtroTipo && filtroTipo.value) syncParams.tipo = filtroTipo.value;

        if (Array.isArray(rawAnunciosList) && rawAnunciosList.length > 0) {
            syncParams.item_ids = rawAnunciosList.map(a => a.id_anuncio).filter(Boolean);
        }

        const hasFilters = Object.keys(syncParams).length > 0;
        const confirmMsg = hasFilters
            ? 'Deseja sincronizar apenas os anúncios filtrados nesta busca com o Mercado Livre?<br><br><small>Sincronização dinâmica inteligente ativada.</small>'
            : 'Deseja sincronizar todos os anúncios com o Mercado Livre?<br><br><small>Isso pode levar alguns segundos...</small>';

        ModalSystem.confirm(
            confirmMsg,
            'Sincronizar Anúncios',
            async () => {
                btnSincronizar.disabled = true;
                const originalText = btnSincronizar.innerHTML;
                btnSincronizar.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sincronizando...';

                try {
                    const response = await fetch('/api/anuncios/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(syncParams)
                    });
                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(result.error || 'Erro na sincronização');
                    }

                    ModalSystem.alert(
                        `<strong>${escapeHtml(result.message || 'Sincronização concluída!')}</strong><br><br>` +
                        `<strong>Itens Sincronizados:</strong> ${result.total}<br>` +
                        `<strong>Novos:</strong> ${result.novos}<br>` +
                        `<strong>Atualizados:</strong> ${result.atualizados}`,
                        'Sucesso!'
                    );

                    currentPage = 1;
                    loadAnuncios();

                } catch (error) {
                    console.error('[Anúncios] Erro na sincronização:', error);
                    ModalSystem.alert(
                        error.message || 'Erro ao sincronizar anúncios. Tente novamente.',
                        'Erro na Sincronização'
                    );
                } finally {
                    btnSincronizar.disabled = false;
                    btnSincronizar.innerHTML = originalText;
                }
            }
        );
    };

    /**
     * Alterna a ordenação ao clicar no cabeçalho.
     */
    const handleSort = (column) => {
        if (orderBy === column) {
            orderDir = orderDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            orderBy = column;
            orderDir = column === 'last_updated_at' ? 'DESC' : 'ASC';
        }
        currentPage = 1;
        loadAnuncios();
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

    // =============================================
    // === FILTRO COMBOGOX ESTILO EXCEL (DUPLO CLIQUE) ===
    // =============================================

    const getColumnDisplayValue = (anuncio, colKey) => {
        if (!anuncio) return '-';
        switch (colKey) {
            case 'id_anuncio':
                return anuncio.id_anuncio || '-';
            case 'sku':
                return anuncio.sku || '-';
            case 'descricao':
                return anuncio.descricao || '-';
            case 'tipo_anuncio':
                return anuncio.tipo_anuncio || '-';
            case 'status':
                if (anuncio.status === 'active') return 'Ativo';
                if (anuncio.status === 'paused') return 'Pausado';
                if (anuncio.status === 'closed') return 'Encerrado';
                if (anuncio.status === 'under_review') return 'Em revisão';
                return anuncio.status || '-';
            case 'ganhando_catalogo':
                if (!anuncio.catalog_listing) return '-';
                return anuncio.ganhando_catalogo ? 'Ganhando' : 'Perdendo';
            case 'experiencia_compra':
                return anuncio.experiencia_compra ? `${anuncio.experiencia_compra}%` : '0%';
            case 'vendas_total':
                return String(anuncio.vendas_total != null ? anuncio.vendas_total : 0);
            case 'preco':
                return anuncio.preco ? `R$ ${Number(anuncio.preco).toFixed(2).replace('.', ',')}` : '-';
            case 'preco_promocional':
                return anuncio.preco_promocional ? `R$ ${Number(anuncio.preco_promocional).toFixed(2).replace('.', ',')}` : '-';
            case 'tarifa':
                const tarifaVal = Number(anuncio.tarifa) || 0;
                return tarifaVal > 0 ? `${tarifaVal.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%` : '-';
            case 'estoque_ml':
                return String(anuncio.estoque_ml != null ? anuncio.estoque_ml : 0);
            case 'prazo_disponibilidade':
                if (anuncio.prazo_disponibilidade != null && anuncio.prazo_disponibilidade !== '') {
                    const dias = String(anuncio.prazo_disponibilidade).replace(/\D/g, '');
                    return dias !== '' ? `${dias} dias` : String(anuncio.prazo_disponibilidade);
                }
                return '-';
            case 'frete':
                const f = Number(anuncio.frete) || 0;
                return f > 0 ? f.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';
            case 'estoque_plataforma':
                return String(anuncio.estoque_plataforma != null ? anuncio.estoque_plataforma : '-');
            default:
                return String(anuncio[colKey] || '-');
        }
    };

    const applyExcelFiltersAndRender = () => {
        const activeCols = Object.keys(columnExcelFilters);
        let filtered = rawAnunciosList;

        if (activeCols.length > 0) {
            filtered = rawAnunciosList.filter(anuncio => {
                for (const colKey of activeCols) {
                    const selectedSet = columnExcelFilters[colKey];
                    if (selectedSet) {
                        const displayVal = getColumnDisplayValue(anuncio, colKey);
                        if (!selectedSet.has(displayVal)) {
                            return false;
                        }
                    }
                }
                return true;
            });
        }

        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / pageLimit) || 1;

        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        const startIndex = (currentPage - 1) * pageLimit;
        const pageSlice = filtered.slice(startIndex, startIndex + pageLimit);

        renderTable(pageSlice);
        renderPagination({
            totalItems: totalItems,
            totalPages: totalPages
        });
    };

    const openColumnFilterMenu = (thElement) => {
        const colKey = thElement.dataset.column;
        if (!colKey) return;

        if (activeDropdownMenu) {
            activeDropdownMenu.remove();
            activeDropdownMenu = null;
        }

        // Extrai valores únicos e contagem dos itens carregados
        const valueCounts = {};
        rawAnunciosList.forEach(anuncio => {
            const val = getColumnDisplayValue(anuncio, colKey);
            valueCounts[val] = (valueCounts[val] || 0) + 1;
        });

        const uniqueValues = Object.keys(valueCounts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        // Conjunto de valores atualmente selecionados
        const currentSelected = columnExcelFilters[colKey]
            ? new Set(columnExcelFilters[colKey])
            : new Set(uniqueValues);

        // Cria o elemento dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'excel-filter-dropdown';

        dropdown.innerHTML = `
            <div class="excel-filter-header">
                <input type="text" class="excel-filter-search" placeholder="Pesquisar no filtro..." />
                <div class="excel-filter-quick-actions">
                    <button type="button" class="excel-filter-quick-btn btn-select-all">Selecionar Tudo</button>
                    <button type="button" class="excel-filter-quick-btn btn-clear-all">Limpar Seleção</button>
                </div>
            </div>
            <div class="excel-filter-list">
                ${uniqueValues.map((val, idx) => {
            const checked = currentSelected.has(val) ? 'checked' : '';
            const safeId = `chk_excel_${colKey}_${idx}`;
            return `
                        <div class="excel-filter-item">
                            <input type="checkbox" id="${safeId}" ${checked} value="${escapeHtml(val)}" />
                            <label for="${safeId}" class="excel-filter-item-label" title="${escapeHtml(val)}">${escapeHtml(val)}</label>
                            <span class="excel-filter-item-count">(${valueCounts[val]})</span>
                        </div>
                    `;
        }).join('')}
            </div>
            <div class="excel-filter-footer">
                <button type="button" class="excel-filter-btn excel-filter-btn-clear">Limpar Filtro</button>
                <button type="button" class="excel-filter-btn excel-filter-btn-apply">Aplicar</button>
            </div>
        `;

        document.body.appendChild(dropdown);
        activeDropdownMenu = dropdown;

        // Posicionamento
        const rect = thElement.getBoundingClientRect();
        let top = rect.bottom + window.scrollY + 4;
        let left = rect.left + window.scrollX;

        if (left + 270 > window.innerWidth) {
            left = window.innerWidth - 280;
        }

        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;

        // Interações
        const searchInput = dropdown.querySelector('.excel-filter-search');
        const filterList = dropdown.querySelector('.excel-filter-list');
        const items = filterList.querySelectorAll('.excel-filter-item');
        const btnSelectAll = dropdown.querySelector('.btn-select-all');
        const btnClearAll = dropdown.querySelector('.btn-clear-all');
        const btnApply = dropdown.querySelector('.excel-filter-btn-apply');
        const btnClear = dropdown.querySelector('.excel-filter-btn-clear');

        searchInput.focus();

        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase().trim();
            items.forEach(item => {
                const label = item.querySelector('.excel-filter-item-label').textContent.toLowerCase();
                item.style.display = label.includes(term) ? 'flex' : 'none';
            });
        });

        btnSelectAll.addEventListener('click', () => {
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input[type="checkbox"]').checked = true;
                }
            });
        });

        btnClearAll.addEventListener('click', () => {
            items.forEach(item => {
                if (item.style.display !== 'none') {
                    item.querySelector('input[type="checkbox"]').checked = false;
                }
            });
        });

        btnApply.addEventListener('click', () => {
            const checkedBoxes = filterList.querySelectorAll('input[type="checkbox"]:checked');
            const newSelectedSet = new Set();
            checkedBoxes.forEach(box => newSelectedSet.add(box.value));

            if (newSelectedSet.size === uniqueValues.length) {
                delete columnExcelFilters[colKey];
            } else {
                columnExcelFilters[colKey] = newSelectedSet;
            }

            applyExcelFiltersAndRender();
            closeDropdown();
        });

        btnClear.addEventListener('click', () => {
            delete columnExcelFilters[colKey];
            applyExcelFiltersAndRender();
            closeDropdown();
        });

        const closeDropdown = () => {
            if (activeDropdownMenu) {
                activeDropdownMenu.remove();
                activeDropdownMenu = null;
            }
        };

        setTimeout(() => {
            const clickOutsideHandler = (e) => {
                if (activeDropdownMenu && !activeDropdownMenu.contains(e.target) && !thElement.contains(e.target)) {
                    closeDropdown();
                    document.removeEventListener('click', clickOutsideHandler);
                }
            };
            document.addEventListener('click', clickOutsideHandler);
        }, 50);
    };

    // Cliques de ordenação e duplo clique para Filtro Combobox no cabeçalho <th>
    tableHeaders.forEach(th => {
        th.addEventListener('click', (e) => {
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                const column = th.dataset.column;
                handleSort(column);
            }, 220);
        });

        th.addEventListener('dblclick', (e) => {
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            e.preventDefault();
            e.stopPropagation();
            openColumnFilterMenu(th);
        });
    });

    // Busca com debounce de 400ms
    buscaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentPage = 1;
            loadAnuncios();
        }, 400);
    });

    // Filtro de limite por página
    filtroLimite.addEventListener('change', () => {
        pageLimit = parseInt(filtroLimite.value) || 50;
        currentPage = 1;
        applyExcelFiltersAndRender();
    });

    // Filtro de status
    filtroStatus.addEventListener('change', () => {
        currentPage = 1;
        loadAnuncios();
    });

    // Filtro de catálogo
    filtroCatalogo.addEventListener('change', () => {
        currentPage = 1;
        loadAnuncios();
    });

    // Filtro de tipo
    filtroTipo.addEventListener('change', () => {
        currentPage = 1;
        loadAnuncios();
    });

    // Botão de sincronização
    btnSincronizar.addEventListener('click', handleSync);

    // Botão de exportação
    if (btnExportar) {
        btnExportar.addEventListener('click', () => {
            const params = new URLSearchParams({
                orderBy: orderBy,
                orderDir: orderDir
            });
            const busca = buscaInput.value.trim();
            if (busca) params.set('search', busca);

            const status = filtroStatus.value;
            if (status) params.set('status', status);

            const catalog = filtroCatalogo.value;
            if (catalog) params.set('catalog', catalog);

            const tipo = filtroTipo.value;
            if (tipo) params.set('tipo', tipo);

            // Redireciona para baixar o arquivo
            window.location.href = `/api/anuncios/exportar?${params.toString()}`;
        });
    }

    // =============================================
    // === REORDENAÇÃO & PREFERÊNCIA DE COLUNAS ===
    // =============================================

    const showToast = (message) => {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    };

    const fetchColumnOrder = async () => {
        try {
            const res = await fetch('/api/anuncios/column-order');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.columnOrder) && data.columnOrder.length > 0) {
                    const loadedSet = new Set(data.columnOrder);
                    const missing = DEFAULT_COLUMN_ORDER.filter(col => !loadedSet.has(col));
                    currentColumnOrder = [...data.columnOrder, ...missing];
                }
            }
        } catch (err) {
            console.warn('[Anúncios] Não foi possível carregar ordem de colunas do servidor:', err);
        }
        reorderTableHeaderDOM();
    };

    const saveColumnOrderToServer = async () => {
        try {
            await fetch('/api/anuncios/column-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnOrder: currentColumnOrder })
            });
            showToast('Ordem das colunas salva no seu perfil!');
        } catch (err) {
            console.error('[Anúncios] Erro ao salvar ordem de colunas:', err);
        }
    };

    const reorderTableHeaderDOM = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const thMap = {};
        const allThs = Array.from(theadTr.querySelectorAll('th'));
        allThs.forEach(th => {
            const colKey = th.dataset.column || (th.textContent.trim().toLowerCase() === 'foto' ? 'thumbnail' : null);
            if (colKey) thMap[colKey] = th;
        });

        currentColumnOrder.forEach(colKey => {
            if (thMap[colKey]) {
                theadTr.appendChild(thMap[colKey]);
            }
        });
    };

    let holdTimer = null;
    let isDraggingColumn = false;
    let draggedTh = null;
    let dragSourceColKey = null;

    const setupLongPressColumnDrag = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const getColKey = (th) => {
            if (!th) return null;
            return th.dataset.column || (th.textContent.trim().toLowerCase() === 'foto' ? 'thumbnail' : null);
        };

        const handlePressStart = (e, th) => {
            if (isDraggingColumn) return;
            const colKey = getColKey(th);
            if (!colKey) return;

            const startX = e.clientX || e.touches?.[0]?.clientX || 0;
            const startY = e.clientY || e.touches?.[0]?.clientY || 0;

            holdTimer = setTimeout(() => {
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }

                isDraggingColumn = true;
                draggedTh = th;
                dragSourceColKey = colKey;
                th.classList.add('column-dragging');
                if (navigator.vibrate) navigator.vibrate(50);
                showToast('Modo de Mover Coluna Ativo! Arraste para os lados.');
            }, 1000);

            const cancelHold = (moveEvent) => {
                if (moveEvent && moveEvent.type === 'mousemove') {
                    const currentX = moveEvent.clientX;
                    const currentY = moveEvent.clientY;
                    if (Math.abs(currentX - startX) > 5 || Math.abs(currentY - startY) > 5) {
                        if (holdTimer && !isDraggingColumn) {
                            clearTimeout(holdTimer);
                            holdTimer = null;
                        }
                    }
                } else if (!isDraggingColumn) {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                }
            };

            window.addEventListener('mousemove', cancelHold);
            window.addEventListener('mouseup', () => {
                window.removeEventListener('mousemove', cancelHold);
                if (holdTimer && !isDraggingColumn) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
            }, { once: true });
        };

        const allThs = theadTr.querySelectorAll('th');
        allThs.forEach(th => {
            th.addEventListener('mousedown', (e) => handlePressStart(e, th));
            th.addEventListener('touchstart', (e) => handlePressStart(e, th), { passive: true });

            th.addEventListener('mouseenter', () => {
                if (isDraggingColumn && draggedTh && th !== draggedTh) {
                    const targetColKey = getColKey(th);
                    if (!targetColKey || !dragSourceColKey) return;

                    const fromIdx = currentColumnOrder.indexOf(dragSourceColKey);
                    const toIdx = currentColumnOrder.indexOf(targetColKey);

                    if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
                        currentColumnOrder.splice(fromIdx, 1);
                        currentColumnOrder.splice(toIdx, 0, dragSourceColKey);

                        reorderTableHeaderDOM();
                        applyExcelFiltersAndRender();
                    }
                }
            });
        });

        const finishDrag = () => {
            if (isDraggingColumn && draggedTh) {
                draggedTh.classList.remove('column-dragging');
                isDraggingColumn = false;
                draggedTh = null;
                dragSourceColKey = null;

                saveColumnOrderToServer();
            }
        };

        window.addEventListener('mouseup', finishDrag);
        window.addEventListener('touchend', finishDrag);
    };

    // =============================================
    // === MODAL DE IMPORTAÇÃO DE CUSTOS ===
    // =============================================

    const btnImportarCustos = document.getElementById('btnImportarCustos');
    const modalCustosOverlay = document.getElementById('modalCustosOverlay');
    const modalCustos = document.getElementById('modalCustos');
    const inputPlanilhaCustos = document.getElementById('inputPlanilhaCustos');
    const nomeArquivoSelecionado = document.getElementById('nomeArquivoSelecionado');
    const btnConfirmarModalCustos = document.getElementById('btnConfirmarModalCustos');
    const btnCancelarModalCustos = document.getElementById('btnCancelarModalCustos');
    const importCustosSpinner = document.getElementById('importCustosSpinner');
    const importCustosStatusMsg = document.getElementById('importCustosStatusMsg');

    const openCustosModal = () => {
        if (!modalCustos || !modalCustosOverlay) return;
        inputPlanilhaCustos.value = '';
        nomeArquivoSelecionado.textContent = 'Nenhum arquivo selecionado';
        btnConfirmarModalCustos.disabled = true;
        importCustosSpinner.style.display = 'none';
        importCustosStatusMsg.style.display = 'none';
        importCustosStatusMsg.textContent = '';

        modalCustosOverlay.style.display = 'block';
        modalCustos.style.display = 'block';
        setTimeout(() => {
            modalCustosOverlay.classList.add('visible');
            modalCustos.classList.add('visible');
        }, 10);
    };

    const closeCustosModal = () => {
        if (!modalCustos || !modalCustosOverlay) return;
        modalCustosOverlay.classList.remove('visible');
        modalCustos.classList.remove('visible');
        setTimeout(() => {
            modalCustosOverlay.style.display = 'none';
            modalCustos.style.display = 'none';
        }, 200);
    };

    if (btnImportarCustos) {
        btnImportarCustos.addEventListener('click', openCustosModal);
    }
    if (btnCancelarModalCustos) {
        btnCancelarModalCustos.addEventListener('click', closeCustosModal);
    }

    if (inputPlanilhaCustos) {
        inputPlanilhaCustos.addEventListener('change', () => {
            if (inputPlanilhaCustos.files && inputPlanilhaCustos.files[0]) {
                const file = inputPlanilhaCustos.files[0];
                nomeArquivoSelecionado.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
                btnConfirmarModalCustos.disabled = false;
            } else {
                nomeArquivoSelecionado.textContent = 'Nenhum arquivo selecionado';
                btnConfirmarModalCustos.disabled = true;
            }
        });
    }

    if (btnConfirmarModalCustos) {
        btnConfirmarModalCustos.addEventListener('click', async () => {
            if (!inputPlanilhaCustos.files || !inputPlanilhaCustos.files[0]) return;

            const formData = new FormData();
            formData.append('planilha', inputPlanilhaCustos.files[0]);

            btnConfirmarModalCustos.disabled = true;
            btnCancelarModalCustos.disabled = true;
            importCustosSpinner.style.display = 'block';
            importCustosStatusMsg.style.display = 'block';
            importCustosStatusMsg.style.color = '#f07c00';
            importCustosStatusMsg.textContent = 'Processando planilha e recalculando margens...';

            try {
                const response = await fetch('/api/anuncios/importar-custos', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    importCustosStatusMsg.style.color = '#2e7d32';
                    importCustosStatusMsg.textContent = result.message;
                    setTimeout(() => {
                        closeCustosModal();
                        showToast(result.message);
                        loadAnuncios();
                    }, 1200);
                } else {
                    throw new Error(result.message || 'Erro ao importar planilha.');
                }
            } catch (err) {
                console.error('[Importar Custos] Erro:', err);
                importCustosStatusMsg.style.color = '#ff6b6b';
                importCustosStatusMsg.textContent = `Erro: ${err.message}`;
                btnConfirmarModalCustos.disabled = false;
                btnCancelarModalCustos.disabled = false;
            } finally {
                importCustosSpinner.style.display = 'none';
            }
        });
    }

    // Delegate para copiar SKU ou ID do Anúncio para a área de transferência
    document.addEventListener('click', (e) => {
        const copySkuBtn = e.target.closest('.btn-copy-sku');
        if (copySkuBtn) {
            e.stopPropagation();
            const skuToCopy = copySkuBtn.dataset.sku;
            if (skuToCopy) {
                navigator.clipboard.writeText(skuToCopy).then(() => {
                    showToast(`SKU ${skuToCopy} copiado!`);
                    const icon = copySkuBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-check';
                        icon.style.color = '#2e7d32';
                        setTimeout(() => {
                            icon.className = 'far fa-copy';
                            icon.style.color = '#888';
                        }, 1500);
                    }
                }).catch(err => {
                    console.error('Erro ao copiar SKU:', err);
                });
            }
            return;
        }

        const copyIdBtn = e.target.closest('.btn-copy-id-anuncio');
        if (copyIdBtn) {
            e.stopPropagation();
            const idToCopy = copyIdBtn.dataset.idAnuncio;
            if (idToCopy) {
                navigator.clipboard.writeText(idToCopy).then(() => {
                    showToast(`ID Anúncio ${idToCopy} copiado!`);
                    const icon = copyIdBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-check';
                        icon.style.color = '#2e7d32';
                        setTimeout(() => {
                            icon.className = 'far fa-copy';
                            icon.style.color = '#888';
                        }, 1500);
                    }
                }).catch(err => {
                    console.error('Erro ao copiar ID do Anúncio:', err);
                });
            }
        }
    });

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    fetchColumnOrder().then(() => {
        setupLongPressColumnDrag();
        loadAnuncios();
    });
});
