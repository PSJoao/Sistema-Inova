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
    const filtroEmpresa = document.getElementById('filtroEmpresa');
    const filtroNomePromo = document.getElementById('filtroNomePromo');
    const filtroPromoStatus = document.getElementById('filtroPromoStatus');
    const filtroPromoReembolso = document.getElementById('filtroPromoReembolso');
    const filtroMargemMin = document.getElementById('filtroMargemMin');
    const filtroMargemMax = document.getElementById('filtroMargemMax');
    const filtroMargemReembMin = document.getElementById('filtroMargemReembMin');
    const filtroMargemReembMax = document.getElementById('filtroMargemReembMax');
    const filtroMargemAbaixoReemb = document.getElementById('filtroMargemAbaixoReemb');
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
    let catalogTotals = {};
    let columnExcelFilters = {};
    let activeDropdownMenu = null;
    let clickTimer = null;
    let promoPagesState = {}; // Guarda a página interna de promoções por id_anuncio { [id_anuncio]: pageNum }
    let reembolsoMap = {}; // Mapa de reembolso máximo por promo_id { [promo_id]: reembolso_maximo_pct }

    // Multi-Select Filter de Nome de Promoção
    const promoMultiFilter = typeof MultiSelectPromoFilter !== 'undefined' ? new MultiSelectPromoFilter({
        btnId: 'filtroNomePromoBtn',
        dropdownId: 'filtroNomePromoDropdown',
        listId: 'filtroNomePromoList',
        placeholder: 'Todas as Promoções',
        onFilterChange: () => {
            currentPage = 1;
            applyExcelFiltersAndRender();
        }
    }) : null;

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

    const calculatePromoMargin = (anuncio, p) => {
        const promoPrice = Number(p.price) || 0;
        const custo = Number(anuncio.custo_produto) || 0;
        if (custo <= 0 || promoPrice <= 0) return null;

        const precoOriginal = Number(anuncio.preco) || promoPrice;
        const impostoPct = Number(anuncio.imposto) || 0;
        const tarifaBasePct = Number(anuncio.tarifa) || 0;
        const frete = Number(anuncio.frete) || 0;
        const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;

        // Reembolso ML em R$ = (meliPct / 100) * precoOriginal (arredondado com 2 casas decimais)
        const reembolsoVal = Number(((meliPct / 100.0) * precoOriginal).toFixed(2));
        const comissaoReais = promoPrice * (tarifaBasePct / 100.0);
        const comissaoEfetiva = comissaoReais - reembolsoVal;
        const impostoReais = promoPrice * (impostoPct / 100.0);

        const despesas = custo + frete + comissaoEfetiva + impostoReais;
        const lucro = promoPrice - despesas;
        return (lucro / promoPrice) * 100.0;
    };

    const calculateReembolsoMaxMargin = (anuncio, p, reembolsoMaxPct) => {
        const promoPrice = Number(p.price) || 0;
        const custo = Number(anuncio.custo_produto) || 0;
        if (custo <= 0 || promoPrice <= 0 || !reembolsoMaxPct) return null;

        const tarifaBasePct = Number(anuncio.tarifa) || 0;
        const impostoPct = Number(anuncio.imposto) || 6;
        const frete = Number(anuncio.frete) || 0;

        const comissaoBase = promoPrice * (tarifaBasePct / 100.0);
        const reembolsoVal = promoPrice * (Number(reembolsoMaxPct) / 100.0);
        const comissaoEfetiva = comissaoBase - reembolsoVal;
        const impostoReais = promoPrice * (impostoPct / 100.0);

        const despesas = custo + frete + comissaoEfetiva + impostoReais;
        const lucro = promoPrice - despesas;
        return (lucro / promoPrice) * 100.0;
    };

    const getFilteredPromosForAnuncio = (anuncio) => {
        let promos = parsePromos(anuncio.promocoes_json);
        promos = promos.filter(p => p && p.price != null && Number(p.price) > 0);

        const buscaVal = buscaInput ? buscaInput.value.trim().toLowerCase() : '';
        const promoStatusVal = filtroPromoStatus ? filtroPromoStatus.value : '';
        const promoNameVal = filtroNomePromo ? filtroNomePromo.value : '';
        const promoReembolsoVal = filtroPromoReembolso ? filtroPromoReembolso.value : '';
        const minValStr = filtroMargemMin ? filtroMargemMin.value.trim() : '';
        const maxValStr = filtroMargemMax ? filtroMargemMax.value.trim() : '';
        const minReembValStr = filtroMargemReembMin ? filtroMargemReembMin.value.trim() : '';
        const maxReembValStr = filtroMargemReembMax ? filtroMargemReembMax.value.trim() : '';

        const margemMinVal = minValStr !== '' ? parseFloat(minValStr) : null;
        const margemMaxVal = maxValStr !== '' ? parseFloat(maxValStr) : null;
        const margemReembMinVal = minReembValStr !== '' ? parseFloat(minReembValStr) : null;
        const margemReembMaxVal = maxReembValStr !== '' ? parseFloat(maxReembValStr) : null;

        const matchesAnuncioMeta = buscaVal && (
            (anuncio.sku && String(anuncio.sku).toLowerCase().includes(buscaVal)) ||
            (anuncio.descricao && String(anuncio.descricao).toLowerCase().includes(buscaVal)) ||
            (anuncio.id_anuncio && String(anuncio.id_anuncio).toLowerCase().includes(buscaVal))
        );

        return promos.filter(p => {
            // Se houver busca e o metadado do anúncio não coincidir, verifica o nome ou id da promoção
            if (buscaVal && !matchesAnuncioMeta) {
                const promoName = String(p.name || '').toLowerCase();
                const promoId = String(p.id || '').toLowerCase();
                if (!promoName.includes(buscaVal) && !promoId.includes(buscaVal)) return false;
            }

            // 0. Filtro por Nome de Promoção (Multi-Select)
            if (promoMultiFilter && promoMultiFilter.hasFilter() && !promoMultiFilter.matches(p.name)) return false;

            // 1. Estado da Promoção (Ativas vs Elegíveis)
            const isActive = p.status === 'started' || p.status === 'active';
            if (promoStatusVal === 'ativas' && !isActive) return false;
            if (promoStatusVal === 'elegiveis' && isActive) return false;

            // 2. Reembolso Mercado Livre
            const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
            if (promoReembolsoVal === 'com' && meliPct <= 0) return false;
            if (promoReembolsoVal === 'sem' && meliPct > 0) return false;

            // 3. Margem Promo (%)
            if (margemMinVal !== null || margemMaxVal !== null) {
                const margemVal = calculatePromoMargin(anuncio, p);
                if (margemVal === null || isNaN(margemVal)) return false;
                if (margemMinVal !== null && !isNaN(margemMinVal) && margemVal < margemMinVal) return false;
                if (margemMaxVal !== null && !isNaN(margemMaxVal) && margemVal > margemMaxVal) return false;
            }

            // 4. Margem Reembolso Máximo (%)
            if (margemReembMinVal !== null || margemReembMaxVal !== null) {
                const promoId = p.id || null;
                const reembMaxPct = promoId ? reembolsoMap[promoId] : null;
                if (reembMaxPct == null || Number(reembMaxPct) <= 0) return false;

                const margemVal = calculateReembolsoMaxMargin(anuncio, p, Number(reembMaxPct));
                if (margemVal === null || isNaN(margemVal)) return false;
                if (margemReembMinVal !== null && !isNaN(margemReembMinVal) && margemVal < margemReembMinVal) return false;
                if (margemReembMaxVal !== null && !isNaN(margemReembMaxVal) && margemVal > margemReembMaxVal) return false;
            }

            // 5. Margem Promo < Margem do Reembolso Máximo (diferença > 0.03%)
            const isAbaixoSelected = filtroMargemAbaixoReemb && (filtroMargemAbaixoReemb.value === 'abaixo' || filtroMargemAbaixoReemb.checked);
            if (isAbaixoSelected) {
                const promoId = p.id || null;
                const reembMaxPct = promoId ? reembolsoMap[promoId] : null;
                if (reembMaxPct == null || Number(reembMaxPct) <= 0) return false;

                const margemPromo = calculatePromoMargin(anuncio, p);
                const margemReembMax = calculateReembolsoMaxMargin(anuncio, p, Number(reembMaxPct));
                if (margemPromo === null || isNaN(margemPromo) || margemReembMax === null || isNaN(margemReembMax)) return false;

                const diff = margemReembMax - margemPromo;
                if (diff <= 0.03) return false;
            }

            return true;
        });
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
            if (filtroEmpresa && filtroEmpresa.value) params.set('empresa', filtroEmpresa.value);

            const response = await fetch(`/api/anuncios/promocoes/listagem?${params.toString()}`);
            if (!response.ok) throw new Error('Erro ao buscar dados das promoções.');

            const result = await response.json();
            const fetched = result.data || [];
            reembolsoMap = result.reembolso_map || {};
            catalogTotals = result.catalog_totals || {};

            if (filtroEmpresa && filtroEmpresa.options.length <= 1) {
                const uniqueEmpresas = Array.from(new Set(fetched.map(a => a.empresa).filter(Boolean))).sort();
                uniqueEmpresas.forEach(emp => {
                    const opt = document.createElement('option');
                    opt.value = emp;
                    opt.textContent = emp;
                    filtroEmpresa.appendChild(opt);
                });
            }

            if (promoMultiFilter) {
                const promoCounts = {};
                fetched.forEach(a => {
                    let promos = parsePromos(a.promocoes_json);
                    promos.forEach(p => {
                        if (p && p.name) {
                            promoCounts[p.name] = (promoCounts[p.name] || 0) + 1;
                        }
                    });
                });
                const options = Object.keys(promoCounts).map(name => ({ name, count: promoCounts[name] }));
                promoMultiFilter.setOptions(options);
            }

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
                <td colspan="13" class="text-center text-danger py-4">
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
            case 'nome_promo_ativa':
                return anuncio.nome_promo_ativa || '-';
            case 'preco_promocional':
                return anuncio.preco_promocional ? `R$ ${Number(anuncio.preco_promocional).toFixed(2).replace('.', ',')}` : '-';
            case 'margem_lucro':
                if (anuncio.margem_lucro == null || isNaN(anuncio.margem_lucro)) return '-';
                return `${Number(anuncio.margem_lucro).toFixed(2).replace('.', ',')}%`;
            default: return '-';
        }
    };

    const applyExcelFiltersAndRender = () => {
        let filteredList = rawAnunciosList.filter(anuncio => {
            // Valida se o anúncio possui promoções correspondentes aos filtros ativos
            const matchingPromos = getFilteredPromosForAnuncio(anuncio);
            if (matchingPromos.length === 0) return false;

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

    const PROMOS_PER_PAGE = 3;

    const renderPromocoesCell = (anuncio) => {
        let promos = getFilteredPromosForAnuncio(anuncio);

        if (promos.length === 0) {
            return `<span style="color: var(--text-muted); font-style: italic; font-size: 0.82rem;">Sem promoções correspondentes</span>`;
        }

        // Ordena: do preço mais baixo para o preço mais alto
        promos.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

        const totalPromos = promos.length;
        const totalPages = Math.ceil(totalPromos / PROMOS_PER_PAGE);

        const idAnuncioStr = String(anuncio.id_anuncio || '');
        let currentPromoPage = promoPagesState[idAnuncioStr] || 1;
        if (currentPromoPage > totalPages) currentPromoPage = totalPages;
        if (currentPromoPage < 1) currentPromoPage = 1;
        promoPagesState[idAnuncioStr] = currentPromoPage;

        const startIndex = (currentPromoPage - 1) * PROMOS_PER_PAGE;
        const visiblePromos = promos.slice(startIndex, startIndex + PROMOS_PER_PAGE);

        const cardsHtml = visiblePromos.map(p => {
            const isActive = p.status === 'started' || p.status === 'active';
            const promoPrice = Number(p.price);
            const promoPriceStr = `R$ ${promoPrice.toFixed(2).replace('.', ',')}`;
            const origPriceStr = (p.original_price != null && Number(p.original_price) > promoPrice)
                ? `R$ ${Number(p.original_price).toFixed(2).replace('.', ',')}`
                : '';

            const name = escapeHtml(p.name || p.id || 'Campanha Promocional');

            // Status Badge
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
            const margemVal = calculatePromoMargin(anuncio, p);
            if (margemVal !== null && !isNaN(margemVal)) {
                const margemClass = margemVal >= 15 ? 'qty-ok' : (margemVal >= 5 ? 'qty-low' : 'qty-zero');
                margemHtml = `<span class="qty-badge ${margemClass}" style="font-size: 0.72rem; padding: 2px 6px; min-width: auto;" title="Margem de lucro calculada com base no preço promocional">Margem: ${margemVal.toFixed(2).replace('.', ',')}%</span>`;
            }

            // Reembolso Máximo (da Central de Promoções)
            let reembolsoMaxHtml = '';
            let margemReembolsoMaxHtml = '';
            const promoId = p.id || null;
            if (promoId && reembolsoMap[promoId] != null && Number(reembolsoMap[promoId]) > 0) {
                const reembolsoPct = Number(reembolsoMap[promoId]);
                const reembolsoReais = (reembolsoPct / 100.0) * promoPrice;
                reembolsoMaxHtml = `<span class="promo-pill-meli" style="background: rgba(156, 39, 176, 0.15); color: #ce93d8; border-color: rgba(156, 39, 176, 0.3);" title="Reembolso Máximo definido na Central de Promoções"><i class="fas fa-hand-holding-usd" style="font-size: 0.65rem; margin-right: 2px;"></i>Reemb. Máx: ${reembolsoPct.toFixed(1).replace('.', ',')}% (R$ ${reembolsoReais.toFixed(2).replace('.', ',')})</span>`;

                const margemReembMax = calculateReembolsoMaxMargin(anuncio, p, reembolsoPct);
                if (margemReembMax !== null && !isNaN(margemReembMax)) {
                    margemReembolsoMaxHtml = `<span class="qty-badge" style="background: rgba(233, 30, 99, 0.15); color: #ec407a; border: 1px solid rgba(233, 30, 99, 0.3); font-size: 0.72rem; padding: 2px 6px; min-width: auto;" title="Margem de lucro calculada com base no Reembolso Máximo (${reembolsoPct}%)">Margem Reemb. Máx: ${margemReembMax.toFixed(2).replace('.', ',')}%</span>`;
                }
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
                        ${reembolsoMaxHtml}
                        ${margemReembolsoMaxHtml}
                    </div>
                    ${dateHtml}
                </div>
            `;
        }).join('');

        let paginationHtml = '';
        if (totalPages > 1) {
            paginationHtml = `
                <div class="promo-inner-pagination">
                    <span class="promo-inner-info">
                        <strong>${startIndex + 1}-${Math.min(startIndex + PROMOS_PER_PAGE, totalPromos)}</strong> de <strong>${totalPromos}</strong>
                    </span>
                    <div class="promo-inner-controls">
                        <button type="button" class="btn-promo-page btn-promo-prev" data-id-anuncio="${escapeHtml(anuncio.id_anuncio)}" data-target-page="${currentPromoPage - 1}" ${currentPromoPage === 1 ? 'disabled' : ''} title="Página anterior de promoções">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <span class="promo-inner-page-num">${currentPromoPage}/${totalPages}</span>
                        <button type="button" class="btn-promo-page btn-promo-next" data-id-anuncio="${escapeHtml(anuncio.id_anuncio)}" data-target-page="${currentPromoPage + 1}" ${currentPromoPage === totalPages ? 'disabled' : ''} title="Próxima página de promoções">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="promo-cards-container" data-id-anuncio="${escapeHtml(anuncio.id_anuncio)}">
                <div class="promo-cards-wrapper">${cardsHtml}</div>
                ${paginationHtml}
            </div>
        `;
    };

    // =============================================
    // === RENDERIZAR TABELA ===
    // =============================================

    const groupAnunciosByCatalog = (anunciosList) => {
        const catalogGroups = new Map();
        const standaloneList = [];

        anunciosList.forEach(item => {
            const catId = item.catalog_product_id ? String(item.catalog_product_id).trim() : '';
            const totalCount = catId ? (catalogTotals[catId] || 0) : 0;

            // Só cria grupo se o total real de anúncios desse catálogo na conta for MAIOR que 1
            if (catId && totalCount > 1) {
                if (!catalogGroups.has(catId)) {
                    catalogGroups.set(catId, { totalCount, items: [] });
                }
                catalogGroups.get(catId).items.push(item);
            } else {
                standaloneList.push({ isCatalogGroup: false, item });
            }
        });

        const result = [];
        catalogGroups.forEach((groupData, catId) => {
            result.push({
                isCatalogGroup: true,
                catalogProductId: catId,
                totalCount: groupData.totalCount,
                items: groupData.items
            });
        });

        standaloneList.forEach(s => result.push(s));
        return result;
    };

    const buildAnuncioRow = (anuncio) => {
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

        const nomePromoAtivaHtml = anuncio.nome_promo_ativa
            ? `<span class="qty-badge" style="background-color: rgba(40, 167, 69, 0.15); color: #6ee7b7; font-size: 0.72rem; padding: 2px 6px;">${escapeHtml(anuncio.nome_promo_ativa)}</span>`
            : '-';

        const precoPromoVal = (anuncio.nome_promo_ativa && anuncio.preco_promocional != null) ? Number(anuncio.preco_promocional) : null;
        const precoPromoHtml = precoPromoVal != null && precoPromoVal > 0
            ? `R$ ${precoPromoVal.toFixed(2).replace('.', ',')}`
            : '-';

        let margemPromoVal = (anuncio.nome_promo_ativa && anuncio.margem_lucro != null) ? Number(anuncio.margem_lucro) : null;
        let margemPromoHtml = '-';
        if (margemPromoVal != null && !isNaN(margemPromoVal)) {
            const margemClass = margemPromoVal >= 15 ? 'qty-ok' : (margemPromoVal >= 5 ? 'qty-low' : 'qty-zero');
            margemPromoHtml = `<span class="qty-badge ${margemClass}">${margemPromoVal.toFixed(2).replace('.', ',')}%</span>`;
        }

        const promosCellHtml = renderPromocoesCell(anuncio);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div style="display: inline-flex; align-items: center; gap: 4px;"><a href="${urlAnuncio}" target="_blank" style="color: #f39c12; font-weight: bold; text-decoration: none;" title="Abrir anúncio no Mercado Livre">${escapeHtml(anuncio.id_anuncio || '-')}</a>${copyIdBtnHtml}</div></td>
            <td class="text-center">${imgHtml}</td>
            <td><span class="qty-badge" style="background-color: rgba(33, 150, 243, 0.15); color: #64b5f6; font-size: 0.75rem; padding: 2px 6px;">${escapeHtml(anuncio.empresa || '-')}</span></td>
            <td><div style="display: inline-flex; align-items: center; gap: 4px;"><strong>${escapeHtml(anuncio.sku || '-')}</strong>${copyBtnHtml}${catalogBadge}</div></td>
            <td>${tipoHtml}</td>
            <td><span class="qty-badge ${statusClass}">${statusLabel}</span></td>
            <td class="text-center">${winBoxBadge}</td>
            <td class="text-center">${freteLabel}</td>
            <td class="text-center"><span class="qty-badge ${estoqueBlingClass}">${estoqueBling}</span></td>
            <td class="text-center">${nomePromoAtivaHtml}</td>
            <td class="text-center" style="font-weight: 600; color: #fff;">${precoPromoHtml}</td>
            <td class="text-center">${margemPromoHtml}</td>
            <td style="white-space: normal; min-width: 420px;">${promosCellHtml}</td>
        `;
        return tr;
    };

    const renderTable = (data) => {
        if (!data || data.length === 0) {
            tableBody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tableBody.innerHTML = '';

        const groupedData = groupAnunciosByCatalog(data);
        const colCount = 13;

        groupedData.forEach(groupEntry => {
            if (groupEntry.isCatalogGroup) {
                const { catalogProductId, totalCount, items } = groupEntry;

                // Gera o Link de Busca ML para os anúncios atualmente visíveis no grupo
                const numericIds = items.map(item => String(item.id_anuncio || '').replace(/\D/g, '')).filter(Boolean);
                const searchParam = encodeURIComponent(numericIds.join(' '));
                const mlSearchUrl = `https://vendedores.mercadolivre.com.br/anuncios/lista/promos?page=1&search=${searchParam}`;

                // Renderiza cabeçalho do grupo de catálogo com total persistente e Link de Busca ML
                const headerTr = document.createElement('tr');
                headerTr.className = 'catalog-group-header-row';
                headerTr.innerHTML = `
                    <td colspan="${colCount}">
                        <div class="catalog-group-header-content">
                            <i class="fas fa-layer-group"></i> Catálogo: <strong>${escapeHtml(catalogProductId)}</strong>
                            <span class="catalog-group-badge-count">${totalCount} anúncio(s) conectado(s) neste catálogo</span>
                            <div class="catalog-group-ml-container">
                                <strong>Link de Busca:</strong>
                                <a href="${mlSearchUrl}" target="_blank" class="catalog-group-ml-link" title="Abrir busca destes anúncios no Mercado Livre">
                                    <i class="fas fa-external-link-alt"></i> Mercado Livre
                                </a>
                            </div>
                        </div>
                    </td>
                `;
                tableBody.appendChild(headerTr);

                items.forEach((anuncio, idx) => {
                    const isLast = idx === items.length - 1;
                    const tr = buildAnuncioRow(anuncio);
                    tr.classList.add('catalog-group-row');
                    if (isLast) tr.classList.add('catalog-group-last-row');
                    tableBody.appendChild(tr);
                });
            } else {
                const tr = buildAnuncioRow(groupEntry.item);
                tableBody.appendChild(tr);
            }
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

        html += `<span class="pagination-info">${pagination.totalItems} anúncio(s) com promoções — Página ${currentPage} de ${pagination.totalPages}</span>`;

        paginationContainer.innerHTML = html;

        // Event listeners
        paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tp = parseInt(btn.dataset.page, 10);
                if (tp && tp !== currentPage && !btn.disabled) {
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
    if (filtroEmpresa) {
        filtroEmpresa.addEventListener('change', () => {
            currentPage = 1;
            loadPromocoes();
        });
    }

    if (filtroPromoStatus) filtroPromoStatus.addEventListener('change', () => { currentPage = 1; applyExcelFiltersAndRender(); });
    if (filtroPromoReembolso) filtroPromoReembolso.addEventListener('change', () => { currentPage = 1; applyExcelFiltersAndRender(); });
    if (filtroMargemAbaixoReemb) filtroMargemAbaixoReemb.addEventListener('change', () => { currentPage = 1; applyExcelFiltersAndRender(); });

    const handleMargemInput = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { currentPage = 1; applyExcelFiltersAndRender(); }, 400);
    };
    if (filtroMargemMin) filtroMargemMin.addEventListener('input', handleMargemInput);
    if (filtroMargemMax) filtroMargemMax.addEventListener('input', handleMargemInput);
    if (filtroMargemReembMin) filtroMargemReembMin.addEventListener('input', handleMargemInput);
    if (filtroMargemReembMax) filtroMargemReembMax.addEventListener('input', handleMargemInput);

    if (btnSincronizar) btnSincronizar.addEventListener('click', handleSync);

    if (btnExportarPromos) {
        btnExportarPromos.addEventListener('click', () => {
            const params = new URLSearchParams({ orderBy, orderDir });
            if (buscaInput.value.trim()) params.set('search', buscaInput.value.trim());
            if (filtroStatus.value) params.set('status', filtroStatus.value);
            if (filtroCatalogo.value) params.set('catalog', filtroCatalogo.value);
            if (filtroTipo.value) params.set('tipo', filtroTipo.value);
            if (filtroEmpresa && filtroEmpresa.value) params.set('empresa', filtroEmpresa.value);
            if (filtroPromoStatus && filtroPromoStatus.value) params.set('promoStatus', filtroPromoStatus.value);
            if (filtroPromoReembolso && filtroPromoReembolso.value) params.set('promoReembolso', filtroPromoReembolso.value);
            if (filtroMargemMin && filtroMargemMin.value.trim()) params.set('margemMin', filtroMargemMin.value.trim());
            if (filtroMargemMax && filtroMargemMax.value.trim()) params.set('margemMax', filtroMargemMax.value.trim());
            if (filtroMargemReembMin && filtroMargemReembMin.value.trim()) params.set('margemReembMin', filtroMargemReembMin.value.trim());
            if (filtroMargemReembMax && filtroMargemReembMax.value.trim()) params.set('margemReembMax', filtroMargemReembMax.value.trim());
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
            return;
        }

        // Paginação interna de promoções da linha do anúncio
        const promoBtn = e.target.closest('.btn-promo-page');
        if (promoBtn && !promoBtn.disabled) {
            e.stopPropagation();
            e.preventDefault();
            const idAnuncio = promoBtn.dataset.idAnuncio;
            const targetPage = parseInt(promoBtn.dataset.targetPage, 10);
            if (idAnuncio && targetPage) {
                promoPagesState[idAnuncio] = targetPage;
                const anuncio = rawAnunciosList.find(a => String(a.id_anuncio) === String(idAnuncio));
                if (anuncio) {
                    const container = promoBtn.closest('.promo-cards-container');
                    if (container && container.parentElement) {
                        container.parentElement.innerHTML = renderPromocoesCell(anuncio);
                    }
                }
            }
        }
    });

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    loadPromocoes();
});
