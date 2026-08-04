/**
 * public/scripts/promocoesListaManager.js
 * Gerencia a listagem dinâmica de promoções dos anúncios.
 * Design 100% integrado ao CSS do sistema inova com cálculo de margem e reembolso por promoção.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Elementos da DOM ===
    const buscaInput = document.getElementById('buscaGeral');
    const filtroStatus = document.getElementById('filtroStatus');
    const filtroCatalogo = document.getElementById('filtroCatalogo');
    const filtroTipo = document.getElementById('filtroTipo');
    const filtroLimite = document.getElementById('filtroLimite');

    const tableBody = document.getElementById('table-body');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const btnSincronizar = document.getElementById('btnSincronizar');
    const btnExportarPromos = document.getElementById('btnExportarPromos');
    const tableHeaders = document.querySelectorAll('#tabela-estoque th.sortable');

    // === Estado ===
    let currentPage = 1;
    let pageLimit = 50;
    let orderBy = 'last_updated_at';
    let orderDir = 'DESC';
    let debounceTimer = null;
    let rawAnunciosList = [];
    let columnExcelFilters = {};
    let activeDropdownMenu = null;
    let clickTimer = null;

    // =============================================
    // === UTILIDADES ===
    // =============================================

    const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const showToast = (message) => {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();
        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch (e) { return dateStr; }
    };

    const parsePromos = (promosJson) => {
        if (!promosJson) return [];
        try {
            const promos = typeof promosJson === 'string' ? JSON.parse(promosJson) : promosJson;
            return Array.isArray(promos) ? promos : [];
        } catch (e) { return []; }
    };

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================

    const loadPromocoes = async () => {
        try {
            showLoadingState();
            const params = new URLSearchParams({
                page: currentPage,
                limit: pageLimit,
                orderBy,
                orderDir,
                all: 'true'
            });

            const busca = buscaInput.value.trim();
            if (busca) params.set('search', busca);
            if (filtroStatus.value) params.set('status', filtroStatus.value);
            if (filtroCatalogo.value) params.set('catalog', filtroCatalogo.value);
            if (filtroTipo.value) params.set('tipo', filtroTipo.value);

            const response = await fetch(`/api/anuncios/promocoes/listagem?${params.toString()}`);
            if (!response.ok) throw new Error('Erro ao buscar dados das promoções.');

            const result = await response.json();
            const fetched = result.data || [];

            // Filtra apenas anúncios com pelo menos 1 promoção com preço > 0
            rawAnunciosList = fetched.filter(anuncio => {
                let promos = parsePromos(anuncio.promocoes_json);
                return promos.some(p => p && p.price != null && Number(p.price) > 0);
            });

            applyExcelFiltersAndRender();
        } catch (error) {
            console.error('[Promoções] Erro ao carregar:', error);
            showErrorState('Erro ao carregar os dados das promoções.');
        }
    };

    const showLoadingState = () => {
        emptyState.style.display = 'none';
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-4">
                    <div class="spinner-border text-warning" role="status"><span class="visually-hidden">Carregando...</span></div>
                    <p class="mt-2 mb-0 text-muted">Carregando promoções...</p>
                </td>
            </tr>
        `;
    };

    const showErrorState = (msg) => {
        emptyState.style.display = 'none';
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center text-danger py-4">
                    <i class="fas fa-exclamation-circle fa-2x mb-2"></i>
                    <p class="mb-0">${escapeHtml(msg)}</p>
                </td>
            </tr>
        `;
    };

    // =============================================
    // === FILTROS EXCEL & RENDERIZAÇÃO ===
    // =============================================

    const getColumnValue = (anuncio, colKey) => {
        switch (colKey) {
            case 'id_anuncio': return anuncio.id_anuncio || '-';
            case 'sku': return anuncio.sku || '-';
            case 'tipo_anuncio': return anuncio.tipo_anuncio || '-';
            case 'status':
                return anuncio.status === 'active' ? 'Ativo' :
                    anuncio.status === 'paused' ? 'Pausado' :
                        anuncio.status === 'closed' ? 'Fechado' :
                            anuncio.status === 'under_review' ? 'Em análise' :
                                anuncio.status === 'inactive' ? 'Inativo' : anuncio.status || '-';
            case 'ganhando_catalogo':
                return anuncio.catalog_listing ? (anuncio.ganhando_catalogo ? 'Ganhando' : 'Perdendo') : '-';
            case 'frete':
                return anuncio.frete != null ? `R$ ${Number(anuncio.frete).toFixed(2).replace('.', ',')}` : 'R$ 0,00';
            case 'estoque_plataforma':
                return anuncio.estoque_plataforma != null ? String(anuncio.estoque_plataforma) : '-';
            default: return '-';
        }
    };

    const applyExcelFiltersAndRender = () => {
        let filteredList = rawAnunciosList.filter(anuncio => {
            for (const [colKey, selectedSet] of Object.entries(columnExcelFilters)) {
                if (selectedSet && selectedSet.size > 0) {
                    if (!selectedSet.has(String(getColumnValue(anuncio, colKey)))) return false;
                }
            }
            return true;
        });

        tableHeaders.forEach(th => {
            const colKey = th.dataset.column;
            if (columnExcelFilters[colKey] && columnExcelFilters[colKey].size > 0) {
                th.classList.add('filter-active');
            } else {
                th.classList.remove('filter-active');
            }
        });

        const totalItems = filteredList.length;
        const totalPages = Math.ceil(totalItems / pageLimit) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * pageLimit;
        const pageItems = filteredList.slice(startIndex, startIndex + pageLimit);

        renderTable(pageItems);
        renderPagination({ currentPage, totalPages, totalItems });
    };

    // =============================================
    // === RENDERIZAR PROMOÇÕES (CARDS EXPANDIDOS) ===
    // =============================================

    const renderPromocoesCell = (anuncio) => {
        let promos = parsePromos(anuncio.promocoes_json);
        // Filtra somente promoções com preço > 0
        promos = promos.filter(p => p && p.price != null && Number(p.price) > 0);

        if (promos.length === 0) {
            return `<span style="color: var(--text-muted); font-style: italic; font-size: 0.82rem;">Sem promoções válidas</span>`;
        }

        // Ordena: ativas primeiro
        promos.sort((a, b) => {
            const aActive = a.status === 'started' || a.status === 'active';
            const bActive = b.status === 'started' || b.status === 'active';
            if (aActive && !bActive) return -1;
            if (!aActive && bActive) return 1;
            return 0;
        });

        const cardsHtml = promos.map(p => {
            const isActive = p.status === 'started' || p.status === 'active';
            const promoPrice = Number(p.price);
            const promoPriceStr = `R$ ${promoPrice.toFixed(2).replace('.', ',')}`;
            const origPriceStr = (p.original_price != null && Number(p.original_price) > promoPrice)
                ? `R$ ${Number(p.original_price).toFixed(2).replace('.', ',')}`
                : '';

            const name = escapeHtml(p.name || p.id || 'Campanha Promocional');

            // Status Badge (sem ícone de bolinha, como solicitado)
            const statusBadge = isActive
                ? `<span class="qty-badge qty-ok" style="font-size: 0.72rem; padding: 2px 6px; min-width: auto; font-weight: 700;">Ativa</span>`
                : `<span class="qty-badge" style="font-size: 0.72rem; padding: 2px 6px; min-width: auto; background: rgba(255,255,255,0.08); color: var(--text-muted); font-weight: 600;">Elegível</span>`;

            // Meli Reimbursement
            const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
            let meliBadge = '';
            if (meliPct > 0) {
                meliBadge = `<span class="promo-pill-meli" title="Reembolso de tarifa concedido pelo Mercado Livre sobre o preço promocional">Reembolso ML: ${meliPct.toFixed(1).replace('.', ',')}%</span>`;
            }

            // Seller Discount
            const sellerPct = p.seller_percentage != null ? Number(p.seller_percentage) : 0;
            let sellerBadge = '';
            if (sellerPct > 0) {
                sellerBadge = `<span class="promo-pill-seller">Vendedor: ${sellerPct.toFixed(1).replace('.', ',')}%</span>`;
            }

            // Margem de Lucro Específica da Promoção
            let margemHtml = '';
            const custo = Number(anuncio.custo_produto) || 0;
            if (custo > 0 && promoPrice > 0) {
                const impostoPct = Number(anuncio.imposto) || 0;
                const tarifaBasePct = Number(anuncio.tarifa) || 0;
                const frete = Number(anuncio.frete) || 0;

                const tarifaEfetivaPct = Math.max(0, tarifaBasePct - meliPct);
                const tarifaReais = promoPrice * (tarifaEfetivaPct / 100.0);
                const impostoReais = promoPrice * (impostoPct / 100.0);
                const despesas = custo + frete + tarifaReais + impostoReais;
                const lucro = promoPrice - despesas;
                const margemVal = (lucro / promoPrice) * 100.0;

                const margemClass = margemVal >= 15 ? 'qty-ok' : (margemVal >= 5 ? 'qty-low' : 'qty-zero');
                margemHtml = `<span class="qty-badge ${margemClass}" style="font-size: 0.72rem; padding: 2px 6px; min-width: auto;" title="Margem de lucro calculada com base no preço promocional">Margem: ${margemVal.toFixed(2).replace('.', ',')}%</span>`;
            }

            // Datas
            let dateHtml = '';
            if (p.start_date || p.finish_date) {
                const inicio = formatDate(p.start_date);
                const fim = formatDate(p.finish_date);
                if (inicio && fim) {
                    dateHtml = `<div class="promo-card-footer"><i class="far fa-calendar-alt"></i><span>Válido de <strong>${inicio}</strong> até <strong>${fim}</strong></span></div>`;
                } else if (fim) {
                    dateHtml = `<div class="promo-card-footer"><i class="far fa-calendar-alt"></i><span>Término: <strong>${fim}</strong></span></div>`;
                }
            }

            const activeClass = isActive ? ' promo-active' : '';

            return `
                <div class="promo-card-item${activeClass}">
                    <div class="promo-card-header">
                        <span class="promo-card-title">${name}</span>
                        ${statusBadge}
                    </div>
                    <div class="promo-card-details">
                        <div>
                            <span class="promo-price-main">${promoPriceStr}</span>
                            ${origPriceStr ? `<span class="promo-price-orig">(${origPriceStr})</span>` : ''}
                        </div>
                        ${meliBadge}
                        ${sellerBadge}
                        ${margemHtml}
                    </div>
                    ${dateHtml}
                </div>
            `;
        }).join('');

        return `<div class="promo-cards-wrapper">${cardsHtml}</div>`;
    };

    // =============================================
    // === RENDERIZAR TABELA ===
    // =============================================

    const renderTable = (data) => {
        if (!data || data.length === 0) {
            tableBody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tableBody.innerHTML = '';

        data.forEach(anuncio => {
            const statusClass = anuncio.status === 'active' ? 'qty-ok' :
                anuncio.status === 'paused' ? 'qty-low' :
                    anuncio.status === 'closed' ? 'qty-zero' : '';

            const statusLabel = anuncio.status === 'active' ? 'Ativo' :
                anuncio.status === 'paused' ? 'Pausado' :
                    anuncio.status === 'closed' ? 'Fechado' :
                        anuncio.status === 'under_review' ? 'Em análise' :
                            anuncio.status === 'inactive' ? 'Inativo' : anuncio.status || '-';

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

            const freteVal = Number(anuncio.frete) || 0;
            const freteLabel = freteVal > 0 ? `R$ ${freteVal.toFixed(2).replace('.', ',')}` : 'R$ 0,00';

            const estoqueBling = anuncio.estoque_plataforma != null ? anuncio.estoque_plataforma : '-';
            const estoqueBlingClass = estoqueBling === '-' ? '' :
                estoqueBling === 0 ? 'qty-zero' :
                    estoqueBling <= 5 ? 'qty-low' : 'qty-ok';

            const urlAnuncio = anuncio.permalink || (anuncio.id_anuncio ? `https://produto.mercadolivre.com.br/${anuncio.id_anuncio}` : '#');
            const imgHtml = anuncio.thumbnail
                ? `<img src="${anuncio.thumbnail}" alt="Foto" style="width: 36px; height: 36px; object-fit: contain; border-radius: 4px; vertical-align: middle; background: #fff;" />`
                : '-';

            const copyIdBtnHtml = anuncio.id_anuncio
                ? `<button class="btn-copy-id-anuncio" data-id-anuncio="${escapeHtml(anuncio.id_anuncio)}" title="Copiar ID do Anúncio" style="background: none; border: none; color: #888; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; transition: color 0.2s;"><i class="far fa-copy"></i></button>`
                : '';

            const copyBtnHtml = anuncio.sku
                ? `<button class="btn-copy-sku" data-sku="${escapeHtml(anuncio.sku)}" title="Copiar SKU" style="background: none; border: none; color: #888; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; transition: color 0.2s;"><i class="far fa-copy"></i></button>`
                : '';

            const promosCellHtml = renderPromocoesCell(anuncio);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><div style="display: inline-flex; align-items: center; gap: 4px;"><a href="${urlAnuncio}" target="_blank" style="color: #f39c12; font-weight: bold; text-decoration: none;" title="Abrir anúncio no Mercado Livre">${escapeHtml(anuncio.id_anuncio || '-')}</a>${copyIdBtnHtml}</div></td>
                <td class="text-center">${imgHtml}</td>
                <td><div style="display: inline-flex; align-items: center; gap: 4px;"><strong>${escapeHtml(anuncio.sku || '-')}</strong>${copyBtnHtml}${catalogBadge}</div></td>
                <td>${tipoHtml}</td>
                <td><span class="qty-badge ${statusClass}">${statusLabel}</span></td>
                <td class="text-center">${winBoxBadge}</td>
                <td class="text-center">${freteLabel}</td>
                <td class="text-center"><span class="qty-badge ${estoqueBlingClass}">${estoqueBling}</span></td>
                <td style="white-space: normal; min-width: 420px;">${promosCellHtml}</td>
            `;
            tableBody.appendChild(tr);
        });
    };

    // =============================================
    // === PAGINAÇÃO ===
    // =============================================

    const renderPagination = (pagination) => {
        if (!pagination || pagination.totalPages <= 1) {
            paginationContainer.innerHTML = pagination
                ? `<span class="pagination-info">${pagination.totalItems} anúncio(s) com promoções encontrado(s)</span>`
                : '';
            return;
        }

        const { currentPage: cp, totalPages, totalItems } = pagination;
        let html = `<span class="pagination-info">${totalItems} anúncio(s) com promoções — Página ${cp} de ${totalPages}</span>`;
        html += '<div class="pagination-buttons">';

        html += `<button class="btn-page" ${cp === 1 ? 'disabled' : ''} data-page="${cp - 1}"><i class="fas fa-chevron-left"></i></button>`;

        let startP = Math.max(1, cp - 2);
        let endP = Math.min(totalPages, cp + 2);

        if (startP > 1) {
            html += `<button class="btn-page" data-page="1">1</button>`;
            if (startP > 2) html += '<span class="pagination-ellipsis">...</span>';
        }
        for (let i = startP; i <= endP; i++) {
            html += `<button class="btn-page ${i === cp ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        if (endP < totalPages) {
            if (endP < totalPages - 1) html += '<span class="pagination-ellipsis">...</span>';
            html += `<button class="btn-page" data-page="${totalPages}">${totalPages}</button>`;
        }

        html += `<button class="btn-page" ${cp === totalPages ? 'disabled' : ''} data-page="${cp + 1}"><i class="fas fa-chevron-right"></i></button>`;
        html += '</div>';

        paginationContainer.innerHTML = html;
        paginationContainer.querySelectorAll('.btn-page[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tp = parseInt(btn.dataset.page, 10);
                if (tp && tp !== currentPage) {
                    currentPage = tp;
                    applyExcelFiltersAndRender();
                }
            });
        });
    };

    // =============================================
    // === SINCRONIZAÇÃO ===
    // =============================================

    const handleSync = async () => {
        if (!btnSincronizar) return;
        btnSincronizar.disabled = true;
        btnSincronizar.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sincronizando...';

        const syncParams = {};
        const busca = buscaInput ? buscaInput.value.trim() : '';
        if (busca) syncParams.search = busca;
        if (filtroStatus && filtroStatus.value) syncParams.status = filtroStatus.value;
        if (filtroCatalogo && filtroCatalogo.value) syncParams.catalog = filtroCatalogo.value;
        if (filtroTipo && filtroTipo.value) syncParams.tipo = filtroTipo.value;

        if (Array.isArray(rawPromocoesList) && rawPromocoesList.length > 0) {
            syncParams.item_ids = rawPromocoesList.map(a => a.id_anuncio).filter(Boolean);
        }

        try {
            const response = await fetch('/api/anuncios/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncParams)
            });
            const result = await response.json();
            if (response.ok) {
                showToast(result.message || 'Sincronização concluída!');
                currentPage = 1;
                loadPromocoes();
            } else {
                showToast(`Erro: ${result.message || 'desconhecido'}`);
            }
        } catch (error) {
            console.error('[Promoções] Erro sync:', error);
            showToast('Erro de conexão ao sincronizar.');
        } finally {
            btnSincronizar.disabled = false;
            btnSincronizar.innerHTML = '<i class="fas fa-sync me-2"></i>Sincronizar Anúncios';
        }
    };

    // =============================================
    // === ORDENAÇÃO ===
    // =============================================

    const handleSort = (column) => {
        if (!column) return;
        if (orderBy === column) {
            orderDir = orderDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
            orderBy = column;
            orderDir = 'ASC';
        }
        tableHeaders.forEach(th => {
            const thIcon = th.querySelector('.sort-icon');
            if (thIcon) thIcon.remove();
            if (th.dataset.column === column) {
                const icon = document.createElement('i');
                icon.className = `fas fa-sort-amount-${orderDir === 'ASC' ? 'up' : 'down'} sort-icon ms-1`;
                th.appendChild(icon);
            }
        });
        loadPromocoes();
    };

    // =============================================
    // === DROPDOWN FILTRO EXCEL ===
    // =============================================

    const openColumnFilterMenu = (thElement) => {
        const colKey = thElement.dataset.column;
        if (!colKey) return;

        if (activeDropdownMenu) { activeDropdownMenu.remove(); activeDropdownMenu = null; }

        const uniqueValues = Array.from(new Set(rawAnunciosList.map(item => String(getColumnValue(item, colKey)))))
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));

        const currentSelected = columnExcelFilters[colKey] ? new Set(columnExcelFilters[colKey]) : new Set(uniqueValues);

        const dropdown = document.createElement('div');
        dropdown.className = 'excel-filter-dropdown';

        const rect = thElement.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
        dropdown.style.left = `${Math.min(rect.left + window.scrollX, window.innerWidth - 290)}px`;

        // Conta ocorrências
        const countMap = {};
        rawAnunciosList.forEach(item => {
            const val = String(getColumnValue(item, colKey));
            countMap[val] = (countMap[val] || 0) + 1;
        });

        dropdown.innerHTML = `
            <input type="text" class="excel-filter-search" placeholder="Pesquisar..." />
            <div class="excel-filter-quick-actions">
                <button class="excel-filter-quick-btn" id="excel-select-all-btn">Selecionar Tudo</button>
                <button class="excel-filter-quick-btn" id="excel-deselect-all-btn">Limpar Seleção</button>
            </div>
            <div class="excel-filter-list">
                ${uniqueValues.map((val, idx) => `
                    <div class="excel-filter-item">
                        <input type="checkbox" class="excel-item-cb" id="cb_${idx}" value="${escapeHtml(val)}" ${currentSelected.has(val) ? 'checked' : ''} />
                        <span class="excel-filter-item-label">${escapeHtml(val)}</span>
                        <span class="excel-filter-item-count">(${countMap[val] || 0})</span>
                    </div>
                `).join('')}
            </div>
            <div class="excel-filter-footer">
                <button class="excel-filter-btn excel-filter-btn-clear">Limpar Filtro</button>
                <button class="excel-filter-btn excel-filter-btn-apply">Aplicar</button>
            </div>
        `;

        document.body.appendChild(dropdown);
        activeDropdownMenu = dropdown;

        const searchInput = dropdown.querySelector('.excel-filter-search');
        const listItems = dropdown.querySelectorAll('.excel-filter-list .excel-filter-item');
        const itemCbs = dropdown.querySelectorAll('.excel-item-cb');
        const btnApply = dropdown.querySelector('.excel-filter-btn-apply');
        const btnClear = dropdown.querySelector('.excel-filter-btn-clear');
        const btnSelectAll = dropdown.querySelector('#excel-select-all-btn');
        const btnDeselectAll = dropdown.querySelector('#excel-deselect-all-btn');

        searchInput.focus();

        searchInput.addEventListener('input', () => {
            const term = searchInput.value.toLowerCase();
            listItems.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(term) ? 'flex' : 'none';
            });
        });

        btnSelectAll.addEventListener('click', () => itemCbs.forEach(cb => { if (cb.closest('.excel-filter-item').style.display !== 'none') cb.checked = true; }));
        btnDeselectAll.addEventListener('click', () => itemCbs.forEach(cb => { if (cb.closest('.excel-filter-item').style.display !== 'none') cb.checked = false; }));

        btnApply.addEventListener('click', () => {
            const checkedValues = Array.from(itemCbs).filter(cb => cb.checked).map(cb => cb.value);
            if (checkedValues.length === uniqueValues.length || checkedValues.length === 0) {
                delete columnExcelFilters[colKey];
            } else {
                columnExcelFilters[colKey] = new Set(checkedValues);
            }
            currentPage = 1;
            applyExcelFiltersAndRender();
            closeDropdown();
        });

        btnClear.addEventListener('click', () => {
            delete columnExcelFilters[colKey];
            currentPage = 1;
            applyExcelFiltersAndRender();
            closeDropdown();
        });

        const closeDropdown = () => {
            if (activeDropdownMenu) { activeDropdownMenu.remove(); activeDropdownMenu = null; }
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

    // =============================================
    // === EVENT LISTENERS ===
    // =============================================

    // Ordenação (clique simples) + Filtro Excel (duplo clique) nos headers
    tableHeaders.forEach(th => {
        th.addEventListener('click', (e) => {
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => handleSort(th.dataset.column), 220);
        });
        th.addEventListener('dblclick', (e) => {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            e.preventDefault();
            e.stopPropagation();
            openColumnFilterMenu(th);
        });
    });

    // Busca com debounce
    buscaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { currentPage = 1; loadPromocoes(); }, 400);
    });

    // Filtros por select
    filtroLimite.addEventListener('change', () => {
        pageLimit = parseInt(filtroLimite.value) || 50;
        currentPage = 1;
        applyExcelFiltersAndRender();
    });
    filtroStatus.addEventListener('change', () => { currentPage = 1; loadPromocoes(); });
    filtroCatalogo.addEventListener('change', () => { currentPage = 1; loadPromocoes(); });
    filtroTipo.addEventListener('change', () => { currentPage = 1; loadPromocoes(); });

    if (btnSincronizar) btnSincronizar.addEventListener('click', handleSync);

    if (btnExportarPromos) {
        btnExportarPromos.addEventListener('click', () => {
            const params = new URLSearchParams({ orderBy, orderDir });
            if (buscaInput.value.trim()) params.set('search', buscaInput.value.trim());
            if (filtroStatus.value) params.set('status', filtroStatus.value);
            if (filtroCatalogo.value) params.set('catalog', filtroCatalogo.value);
            if (filtroTipo.value) params.set('tipo', filtroTipo.value);
            window.location.href = `/api/anuncios/promocoes/exportar?${params.toString()}`;
        });
    }

    // Copiar SKU / ID Anúncio
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
                        setTimeout(() => { icon.className = 'far fa-copy'; icon.style.color = '#888'; }, 1500);
                    }
                }).catch(err => console.error('Erro ao copiar SKU:', err));
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
                        setTimeout(() => { icon.className = 'far fa-copy'; icon.style.color = '#888'; }, 1500);
                    }
                }).catch(err => console.error('Erro ao copiar ID do Anúncio:', err));
            }
        }
    });

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    loadPromocoes();
});
