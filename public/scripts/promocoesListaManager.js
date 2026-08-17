/**
 * public/scripts/promocoesListaManager.js
 * Gerencia a listagem dinâmica de promoções dos anúncios.
 * Design 100% integrado ao CSS do sistema inova com cálculo de margem e reembolso por promoção.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Elementos da DOM ===
    const buscaInput = document.getElementById('buscaGeral');
    const campoBuscaSelect = document.getElementById('campoBusca');
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

    // Ordem Padrão das Colunas
    const DEFAULT_COLUMN_ORDER = [
        'id_anuncio',
        'thumbnail',
        'empresa',
        'sku',
        'tipo_anuncio',
        'status',
        'ganhando_catalogo',
        'frete',
        'estoque_plataforma',
        'nome_promo_ativa',
        'preco_promocional',
        'margem_lucro',
        'promocoes_disponiveis'
    ];
    const DEFAULT_COLUMN_WIDTHS = {
        'id_anuncio': 150,
        'thumbnail': 65,
        'empresa': 140,
        'sku': 150,
        'tipo_anuncio': 105,
        'status': 100,
        'ganhando_catalogo': 115,
        'frete': 95,
        'estoque_plataforma': 115,
        'nome_promo_ativa': 150,
        'preco_promocional': 110,
        'margem_lucro': 130,
        'promocoes_disponiveis': 420
    };
    let currentColumnOrder = [...DEFAULT_COLUMN_ORDER];
    let currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS };

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

        const precoOriginal = (p.original_price != null && Number(p.original_price) > 0)
            ? Number(p.original_price)
            : (Number(anuncio.preco) || promoPrice);
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
        const impostoPct = Number(anuncio.imposto) || 0;
        const frete = Number(anuncio.frete) || 0;

        const comissaoBase = promoPrice * (tarifaBasePct / 100.0);
        // Reembolso Máximo calculado em cima do VALOR PROMOCIONAL (promoPrice)
        const reembolsoVal = Number(((Number(reembolsoMaxPct) / 100.0) * promoPrice).toFixed(2));
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

            const busca = buscaInput ? buscaInput.value.trim() : '';
            if (busca) {
                params.set('search', busca);
                params.set('searchField', campoBuscaSelect ? campoBuscaSelect.value : 'id_anuncio');
            }
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
            const promoPrice = Number(p.price) || 0;
            const promoPriceStr = `R$ ${promoPrice.toFixed(2).replace('.', ',')}`;
            
            const origPriceVal = (p.original_price != null && Number(p.original_price) > 0)
                ? Number(p.original_price)
                : (anuncio.preco != null && Number(anuncio.preco) > 0 ? Number(anuncio.preco) : null);
            
            const precoRef = origPriceVal || promoPrice;
            const origPriceStr = (origPriceVal && origPriceVal > promoPrice)
                ? `R$ ${origPriceVal.toFixed(2).replace('.', ',')}`
                : '';

            const name = escapeHtml(p.name || p.id || 'Campanha Promocional');

            // Status Badge
            const statusBadge = isActive
                ? `<span class="promo-status-badge promo-status-active"><i class="fas fa-circle promo-pulse-dot"></i> Ativa</span>`
                : `<span class="promo-status-badge promo-status-eligible">Elegível</span>`;

            // 1. Reembolso ML (Tarifa coberta pelo Mercado Livre em R$)
            const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
            let meliBadge = '';
            if (meliPct > 0) {
                const meliReais = (meliPct / 100.0) * precoRef;
                meliBadge = `
                    <span class="promo-flag-chip promo-flag-meli" title="Reembolso ML: R$ ${meliReais.toFixed(2).replace('.', ',')} (${meliPct.toFixed(1).replace('.', ',')}% sobre R$ ${precoRef.toFixed(2).replace('.', ',')})">
                        <i class="fas fa-hand-holding-usd"></i>
                        <span class="promo-flag-val">+R$ ${meliReais.toFixed(2).replace('.', ',')}</span>
                        <span class="promo-flag-sub">${meliPct.toFixed(1).replace('.', ',')}%</span>
                    </span>
                `;
            }

            // 2. Desconto do Vendedor (em R$)
            const sellerPct = p.seller_percentage != null ? Number(p.seller_percentage) : 0;
            let sellerBadge = '';
            if (sellerPct > 0) {
                const sellerReais = (sellerPct / 100.0) * precoRef;
                sellerBadge = `
                    <span class="promo-flag-chip promo-flag-seller" title="Desconto Vendedor: R$ ${sellerReais.toFixed(2).replace('.', ',')} (${sellerPct.toFixed(1).replace('.', ',')}% sobre R$ ${precoRef.toFixed(2).replace('.', ',')})">
                        <i class="fas fa-tag"></i>
                        <span class="promo-flag-val">-R$ ${sellerReais.toFixed(2).replace('.', ',')}</span>
                        <span class="promo-flag-sub">${sellerPct.toFixed(1).replace('.', ',')}%</span>
                    </span>
                `;
            }

            // 3. Margem de Lucro Específica da Promoção (%)
            let margemHtml = '';
            const margemVal = calculatePromoMargin(anuncio, p);
            if (margemVal !== null && !isNaN(margemVal)) {
                const margemClass = margemVal >= 15 ? 'promo-margin-ok' : (margemVal >= 5 ? 'promo-margin-low' : 'promo-margin-zero');
                const margemNivel = margemVal >= 15 ? 'Alta' : (margemVal >= 5 ? 'Média' : 'Baixa');
                margemHtml = `
                    <span class="promo-flag-chip ${margemClass}" title="Margem de Lucro da Promoção: ${margemVal.toFixed(2).replace('.', ',')}% (Nível ${margemNivel})">
                        <i class="fas fa-chart-line"></i>
                        <span class="promo-flag-val">${margemVal.toFixed(2).replace('.', ',')}%</span>
                    </span>
                `;
            }

            // 4. Reembolso Máximo (da Central de Promoções) e 5. Margem c/ Reembolso Máximo
            let reembolsoMaxHtml = '';
            let margemReembolsoMaxHtml = '';
            const promoId = p.id || null;
            if (promoId && reembolsoMap[promoId] != null && Number(reembolsoMap[promoId]) > 0) {
                const reembolsoPct = Number(reembolsoMap[promoId]);
                const reembolsoReais = (reembolsoPct / 100.0) * promoPrice;
                reembolsoMaxHtml = `
                    <span class="promo-flag-chip promo-flag-reemb-max" title="Reembolso Máximo (Central): R$ ${reembolsoReais.toFixed(2).replace('.', ',')} (${reembolsoPct.toFixed(1).replace('.', ',')}% sobre o valor promocional R$ ${promoPrice.toFixed(2).replace('.', ',')})">
                        <i class="fas fa-award"></i>
                        <span class="promo-flag-val">R$ ${reembolsoReais.toFixed(2).replace('.', ',')}</span>
                        <span class="promo-flag-sub">${reembolsoPct.toFixed(1).replace('.', ',')}%</span>
                    </span>
                `;

                const margemReembMax = calculateReembolsoMaxMargin(anuncio, p, reembolsoPct);
                if (margemReembMax !== null && !isNaN(margemReembMax)) {
                    margemReembolsoMaxHtml = `
                        <span class="promo-flag-chip promo-flag-margem-max" title="Margem estimada com Reembolso Máximo (${reembolsoPct}%): ${margemReembMax.toFixed(2).replace('.', ',')}%">
                            <i class="fas fa-calculator"></i>
                            <span class="promo-flag-val">${margemReembMax.toFixed(2).replace('.', ',')}%</span>
                        </span>
                    `;
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
                    <div class="promo-card-body">
                        <div class="promo-price-wrapper">
                            <span class="promo-price-main">${promoPriceStr}</span>
                            ${origPriceStr ? `<span class="promo-price-orig">(${origPriceStr})</span>` : ''}
                        </div>
                        <div class="promo-flags-grid">
                            ${meliBadge}
                            ${sellerBadge}
                            ${margemHtml}
                            ${reembolsoMaxHtml}
                            ${margemReembolsoMaxHtml}
                        </div>
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

    const normalizeTipo = (tipo) => {
        const t = String(tipo || '').toLowerCase();
        if (t.includes('premium') || t === 'gold_pro') return 'Premium';
        if (t.includes('clássico') || t.includes('classico') || t === 'gold_special') return 'Clássico';
        return tipo || '';
    };

    const detectCatalogSiblingsMap = (anunciosList) => {
        const siblingMap = new Map();
        const catalogActiveMap = new Map();

        // 1. Agrupa anúncios de catálogo ATIVOS da listagem filtrada por catalog_product_id
        (anunciosList || []).forEach(item => {
            const catId = item.catalog_product_id ? String(item.catalog_product_id).trim() : '';
            const isCatalog = Boolean(item.catalog_listing && item.catalog_listing !== 'false' && item.catalog_listing !== '0');
            const isActive = item.status === 'active';

            if (catId && isCatalog && isActive) {
                if (!catalogActiveMap.has(catId)) {
                    catalogActiveMap.set(catId, []);
                }
                catalogActiveMap.get(catId).push(item);
            }
        });

        // 2. Para cada anúncio, armazena a lista de TODOS os seus outros irmãos ativos no mesmo catálogo
        catalogActiveMap.forEach((items) => {
            if (items.length >= 2) {
                items.forEach(item => {
                    const siblings = items.filter(other => String(other.id_anuncio) !== String(item.id_anuncio));
                    if (siblings.length > 0) {
                        siblingMap.set(String(item.id_anuncio), siblings);
                    }
                });
            }
        });

        return siblingMap;
    };

    const buildAnuncioRow = (anuncio, siblings = [], isStandalone = false) => {
        const siblingList = Array.isArray(siblings) ? siblings : (siblings ? [siblings] : []);

        // Link de busca de promoções ML para anúncios individuais/sozinhos
        const numericId = String(anuncio.id_anuncio || '').replace(/\D/g, '');
        const mlSearchUrl = numericId ? `https://vendedores.mercadolivre.com.br/anuncios/lista/promos?page=1&search=${numericId}` : null;
        const standaloneMlSearchHtml = (isStandalone && mlSearchUrl)
            ? `<a href="${mlSearchUrl}" target="_blank" class="standalone-ml-link" title="Abrir busca deste anúncio na Central de Promoções do Mercado Livre"><i class="fas fa-external-link-alt"></i> Busca ML</a>`
            : '';

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

        const tipoNorm = normalizeTipo(anuncio.tipo_anuncio);
        const tipoHtml = tipoNorm === 'Premium'
            ? `<span class="qty-badge" style="background-color: #fff3e0; color: #e65100;">${anuncio.tipo_anuncio || 'Premium'}</span>`
            : `<span class="qty-badge" style="background-color: #f5f5f5; color: #616161;">${anuncio.tipo_anuncio || 'Clássico'}</span>`;

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

        // =============================================
        // === SUB-LINHAS SOMBRA DOS IRMÃOS DO CATÁLOGO ===
        // =============================================
        const siblingShadowTipo = siblingList.map(sib => {
            const sibTipoNorm = normalizeTipo(sib.tipo_anuncio);
            const sibTipoBadge = sibTipoNorm === 'Premium'
                ? `<span class="qty-badge sibling-shadow-badge" style="background-color: rgba(255, 243, 224, 0.2); color: #ffb74d; border: 1px solid rgba(255, 183, 77, 0.3);">${escapeHtml(sib.tipo_anuncio || 'Premium')}</span>`
                : `<span class="qty-badge sibling-shadow-badge" style="background-color: rgba(245, 245, 245, 0.15); color: #b0bec5; border: 1px solid rgba(176, 190, 197, 0.3);">${escapeHtml(sib.tipo_anuncio || 'Clássico')}</span>`;
            return `<div class="sibling-shadow-container" title="Anúncio Irmão do Catálogo: ${sibTipoNorm} (${escapeHtml(sib.id_anuncio)})">${sibTipoBadge}</div>`;
        }).join('');

        const siblingShadowStatus = siblingList.map(sib => {
            const sibStatusLabel = sib.status === 'active' ? 'Ativo' :
                sib.status === 'paused' ? 'Pausado' :
                    sib.status === 'closed' ? 'Fechado' :
                        sib.status === 'under_review' ? 'Em análise' :
                            sib.status === 'inactive' ? 'Inativo' : sib.status || '-';
            const sibStatusClass = sib.status === 'active' ? 'qty-ok' : sib.status === 'paused' ? 'qty-low' : 'qty-zero';
            return `<div class="sibling-shadow-container" title="Status do Irmão"><span class="qty-badge ${sibStatusClass} sibling-shadow-badge" style="opacity: 0.7;">${sibStatusLabel}</span></div>`;
        }).join('');

        const siblingShadowWinBox = siblingList.map(sib => {
            let sibWinBoxBadge = '-';
            if (sib.catalog_listing) {
                sibWinBoxBadge = sib.ganhando_catalogo
                    ? `<span class="qty-badge sibling-shadow-badge" style="background-color: rgba(46, 125, 50, 0.18); color: #81c784; border: 1px solid rgba(129, 199, 132, 0.3);">Ganhando</span>`
                    : `<span class="qty-badge sibling-shadow-badge" style="background-color: rgba(198, 40, 40, 0.18); color: #e57373; border: 1px solid rgba(229, 115, 115, 0.3);">Perdendo</span>`;
            }
            return `<div class="sibling-shadow-container" title="Concorrência do Irmão">${sibWinBoxBadge}</div>`;
        }).join('');

        const siblingShadowFrete = siblingList.map(sib => {
            const sibFreteVal = Number(sib.frete) || 0;
            const sibFreteLabel = sibFreteVal > 0 ? `R$ ${sibFreteVal.toFixed(2).replace('.', ',')}` : 'R$ 0,00';
            return `<div class="sibling-shadow-container" title="Frete do Irmão"><span class="sibling-shadow-text">${sibFreteLabel}</span></div>`;
        }).join('');

        const siblingShadowEstoque = siblingList.map(sib => {
            const sibEstoque = sib.estoque_plataforma != null ? sib.estoque_plataforma : '-';
            const sibEstoqueClass = sibEstoque === '-' ? '' : sibEstoque === 0 ? 'qty-zero' : sibEstoque <= 5 ? 'qty-low' : 'qty-ok';
            return `<div class="sibling-shadow-container" title="Estoque Bling do Irmão"><span class="qty-badge ${sibEstoqueClass} sibling-shadow-badge" style="opacity: 0.7;">${sibEstoque}</span></div>`;
        }).join('');

        const siblingShadowNomePromo = siblingList.map(sib => {
            const sibNomePromoHtml = sib.nome_promo_ativa
                ? `<span class="qty-badge sibling-shadow-badge" style="background-color: rgba(40, 167, 69, 0.12); color: rgba(110, 231, 183, 0.75); border: 1px solid rgba(110, 231, 183, 0.3); font-size: 0.68rem; padding: 1px 5px;">${escapeHtml(sib.nome_promo_ativa)}</span>`
                : `<span class="sibling-shadow-text">-</span>`;
            return `<div class="sibling-shadow-container" title="Promoção Ativa do Irmão">${sibNomePromoHtml}</div>`;
        }).join('');

        const siblingShadowPrecoPromo = siblingList.map(sib => {
            const sibPrecoVal = (sib.nome_promo_ativa && sib.preco_promocional != null) ? Number(sib.preco_promocional) : null;
            const sibPrecoLabel = sibPrecoVal != null && sibPrecoVal > 0 ? `R$ ${sibPrecoVal.toFixed(2).replace('.', ',')}` : '-';
            return `<div class="sibling-shadow-container" title="Preço Promo do Irmão"><span class="sibling-shadow-text" style="font-weight: 600;">${sibPrecoLabel}</span></div>`;
        }).join('');

        const siblingShadowMargemPromo = siblingList.map(sib => {
            let sibMargemVal = (sib.nome_promo_ativa && sib.margem_lucro != null) ? Number(sib.margem_lucro) : null;
            let sibMargemHtml = `<span class="sibling-shadow-text">-</span>`;
            if (sibMargemVal != null && !isNaN(sibMargemVal)) {
                const sibMargemClass = sibMargemVal >= 15 ? 'qty-ok' : (sibMargemVal >= 5 ? 'qty-low' : 'qty-zero');
                sibMargemHtml = `<span class="qty-badge ${sibMargemClass} sibling-shadow-badge" style="opacity: 0.7;">${sibMargemVal.toFixed(2).replace('.', ',')}%</span>`;
            }
            return `<div class="sibling-shadow-container" title="Margem Promo do Irmão">${sibMargemHtml}</div>`;
        }).join('');

        const promosCellHtml = renderPromocoesCell(anuncio);

        const renderCell = (colKey) => {
            switch (colKey) {
                case 'id_anuncio':
                    return `
                        <td>
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <div style="display: inline-flex; align-items: center; gap: 4px;">
                                    <a href="${urlAnuncio}" target="_blank" style="color: #f39c12; font-weight: bold; text-decoration: none;" title="Abrir anúncio no Mercado Livre">${escapeHtml(anuncio.id_anuncio || '-')}</a>
                                    ${copyIdBtnHtml}
                                </div>
                                ${standaloneMlSearchHtml}
                            </div>
                        </td>
                    `;
                case 'thumbnail':
                    return `<td class="text-center">${imgHtml}</td>`;
                case 'empresa':
                    return `<td><span class="qty-badge" style="background-color: rgba(33, 150, 243, 0.15); color: #64b5f6; font-size: 0.75rem; padding: 2px 6px;">${escapeHtml(anuncio.empresa || '-')}</span></td>`;
                case 'sku':
                    return `<td><div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;"><strong>${escapeHtml(anuncio.sku || '-')}</strong>${copyBtnHtml}${catalogBadge}</div></td>`;
                case 'tipo_anuncio':
                    return `<td>${tipoHtml}${siblingShadowTipo}</td>`;
                case 'status':
                    return `<td><span class="qty-badge ${statusClass}">${statusLabel}</span>${siblingShadowStatus}</td>`;
                case 'ganhando_catalogo':
                    return `<td class="text-center">${winBoxBadge}${siblingShadowWinBox}</td>`;
                case 'frete':
                    return `<td class="text-center">${freteLabel}${siblingShadowFrete}</td>`;
                case 'estoque_plataforma':
                    return `<td class="text-center"><span class="qty-badge ${estoqueBlingClass}">${estoqueBling}</span>${siblingShadowEstoque}</td>`;
                case 'nome_promo_ativa':
                    return `<td class="text-center">${nomePromoAtivaHtml}${siblingShadowNomePromo}</td>`;
                case 'preco_promocional':
                    return `<td class="text-center" style="font-weight: 600; color: #fff;">${precoPromoHtml}${siblingShadowPrecoPromo}</td>`;
                case 'margem_lucro':
                    return `<td class="text-center">${margemPromoHtml}${siblingShadowMargemPromo}</td>`;
                case 'promocoes_disponiveis':
                    return `<td style="white-space: normal; min-width: 250px;">${promosCellHtml}</td>`;
                default:
                    return `<td>-</td>`;
            }
        };

        const tr = document.createElement('tr');
        tr.innerHTML = currentColumnOrder.map(colKey => renderCell(colKey)).join('');
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

        const siblingMap = detectCatalogSiblingsMap(data);
        const groupedData = groupAnunciosByCatalog(data);
        const colCount = currentColumnOrder.length;

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
                    const siblings = siblingMap.get(String(anuncio.id_anuncio)) || [];
                    const tr = buildAnuncioRow(anuncio, siblings, false);
                    tr.classList.add('catalog-group-row');
                    if (isLast) tr.classList.add('catalog-group-last-row');
                    tableBody.appendChild(tr);
                });
            } else {
                const siblings = siblingMap.get(String(groupEntry.item.id_anuncio)) || [];
                const tr = buildAnuncioRow(groupEntry.item, siblings, true);
                tableBody.appendChild(tr);
            }
        });

        applyColumnWidthsDOM();
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
        if (busca) {
            syncParams.search = busca;
            syncParams.searchField = campoBuscaSelect ? campoBuscaSelect.value : 'id_anuncio';
        }
        if (filtroStatus && filtroStatus.value) syncParams.status = filtroStatus.value;
        if (filtroCatalogo && filtroCatalogo.value) syncParams.catalog = filtroCatalogo.value;
        if (filtroTipo && filtroTipo.value) syncParams.tipo = filtroTipo.value;
        if (filtroEmpresa && filtroEmpresa.value) syncParams.empresa = filtroEmpresa.value;
        if (filtroMargemAbaixoReemb && filtroMargemAbaixoReemb.value) syncParams.margem_reemb = filtroMargemAbaixoReemb.value;

        const hasFilters = Object.keys(syncParams).length > 0;

        if (hasFilters && Array.isArray(rawAnunciosList) && rawAnunciosList.length > 0) {
            syncParams.item_ids = rawAnunciosList.map(a => a.id_anuncio).filter(Boolean);
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
    // === REORDENAÇÃO & PREFERÊNCIA DE COLUNAS ===
    // =============================================

    const COLUMN_LABELS = {
        'id_anuncio': 'ID Anúncio',
        'thumbnail': 'Foto',
        'empresa': 'Empresa / Loja',
        'sku': 'SKU',
        'tipo_anuncio': 'Tipo',
        'status': 'Status',
        'ganhando_catalogo': 'Concorrência',
        'frete': 'Frete',
        'estoque_plataforma': 'Estoque Bling',
        'nome_promo_ativa': 'Promoção Ativa',
        'preco_promocional': 'Preço Promocional',
        'margem_lucro': 'Margem Promo',
        'promocoes_disponiveis': 'Promoções Disponíveis'
    };

    const applyColumnWidthsDOM = () => {
        const table = document.querySelector('#tabela-estoque');
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr || !table) return;

        table.style.tableLayout = 'fixed';

        const allThs = Array.from(theadTr.querySelectorAll('th'));
        allThs.forEach((th, thIdx) => {
            const colKey = th.dataset.column || (th.textContent.trim().toLowerCase() === 'foto' ? 'thumbnail' : null);
            if (!colKey) return;

            const widthVal = currentColumnWidths[colKey] !== undefined ? currentColumnWidths[colKey] : DEFAULT_COLUMN_WIDTHS[colKey];
            const isCollapsed = widthVal != null && widthVal <= 16;

            if (isCollapsed) {
                th.classList.add('is-col-collapsed');
                th.style.width = '6px';
                th.style.minWidth = '6px';
                th.style.maxWidth = '6px';
                th.title = `Coluna "${COLUMN_LABELS[colKey] || colKey}" oculta. Dê duplo clique no separador para restaurar.`;
            } else {
                th.classList.remove('is-col-collapsed');
                const finalW = Math.max(30, widthVal || DEFAULT_COLUMN_WIDTHS[colKey] || 100);
                th.style.width = finalW + 'px';
                th.style.minWidth = finalW + 'px';
                th.style.maxWidth = finalW + 'px';
                th.title = '';
            }

            const colTds = document.querySelectorAll(`#tabela-estoque tbody tr:not(.catalog-group-header-row) td:nth-child(${thIdx + 1})`);
            colTds.forEach(td => {
                if (isCollapsed) {
                    td.classList.add('is-col-collapsed');
                    td.style.width = '6px';
                    td.style.maxWidth = '6px';
                } else {
                    td.classList.remove('is-col-collapsed');
                    td.style.width = '';
                    td.style.maxWidth = '';
                }
            });
        });
    };

    const fetchColumnPreferences = async () => {
        try {
            const res = await fetch('/api/anuncios/promocoes/column-preferences');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.columnOrder) && data.columnOrder.length > 0) {
                    const loadedSet = new Set(data.columnOrder);
                    const missing = DEFAULT_COLUMN_ORDER.filter(col => !loadedSet.has(col));
                    currentColumnOrder = [...data.columnOrder, ...missing];
                }
                if (data.columnWidths && typeof data.columnWidths === 'object') {
                    currentColumnWidths = { ...DEFAULT_COLUMN_WIDTHS, ...data.columnWidths };
                }
            }
        } catch (err) {
            console.warn('[Promoções] Não foi possível carregar preferências de colunas do servidor:', err);
        }
        reorderTableHeaderDOM();
        applyColumnWidthsDOM();
        setupColumnResize();
    };

    let savePreferencesTimer = null;
    const saveColumnPreferencesToServer = (showToastMsg = true) => {
        if (savePreferencesTimer) clearTimeout(savePreferencesTimer);
        savePreferencesTimer = setTimeout(async () => {
            try {
                await fetch('/api/anuncios/promocoes/column-preferences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        viewName: 'promocoes_ml',
                        columnOrder: currentColumnOrder,
                        columnWidths: currentColumnWidths
                    })
                });
                if (showToastMsg) {
                    showToast('Personalização da tabela salva!');
                }
            } catch (err) {
                console.error('[Promoções] Erro ao salvar preferências de colunas:', err);
            }
        }, 300);
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

    // =============================================
    // === REDIMENSIONAMENTO DE LARGURA DE COLUNAS ===
    // =============================================

    const setupColumnResize = () => {
        const theadTr = document.querySelector('#tabela-estoque thead tr');
        if (!theadTr) return;

        const allThs = theadTr.querySelectorAll('th');
        allThs.forEach((th, thIdx) => {
            const colKey = th.dataset.column || (th.textContent.trim().toLowerCase() === 'foto' ? 'thumbnail' : null);
            if (!colKey) return;

            // Remove resizer anterior se houver
            const existingResizer = th.querySelector('.col-resizer');
            if (existingResizer) existingResizer.remove();

            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            resizer.title = 'Arraste para redimensionar. Dê duplo clique para restaurar tamanho padrão.';
            th.appendChild(resizer);

            // Duplo clique no resizer restaura tamanho padrão da coluna (Estilo Excel)
            resizer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const defaultW = DEFAULT_COLUMN_WIDTHS[colKey] || 120;
                currentColumnWidths[colKey] = defaultW;
                applyColumnWidthsDOM();
                saveColumnPreferencesToServer(true);
                showToast(`Coluna "${COLUMN_LABELS[colKey] || colKey}" restaurada!`);
            });

            // Duplo clique no th se estiver colapsado também restaura
            th.addEventListener('dblclick', (e) => {
                if (th.classList.contains('is-col-collapsed')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const defaultW = DEFAULT_COLUMN_WIDTHS[colKey] || 120;
                    currentColumnWidths[colKey] = defaultW;
                    applyColumnWidthsDOM();
                    saveColumnPreferencesToServer(true);
                    showToast(`Coluna "${COLUMN_LABELS[colKey] || colKey}" restaurada!`);
                }
            });

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }

                const startX = e.pageX;
                const startWidth = th.offsetWidth;
                document.body.classList.add('is-column-resizing');
                resizer.classList.add('is-resizing');

                const onMouseMove = (moveEvent) => {
                    const diff = moveEvent.pageX - startX;
                    const calculatedWidth = startWidth + diff;

                    if (calculatedWidth <= 16) {
                        th.classList.add('is-col-collapsed');
                        th.style.width = '6px';
                        th.style.minWidth = '6px';
                        th.style.maxWidth = '6px';
                        currentColumnWidths[colKey] = 6;
                    } else {
                        th.classList.remove('is-col-collapsed');
                        const finalW = Math.max(25, calculatedWidth);
                        th.style.width = finalW + 'px';
                        th.style.minWidth = finalW + 'px';
                        th.style.maxWidth = finalW + 'px';
                        currentColumnWidths[colKey] = finalW;
                    }

                    const colIndex = Array.from(theadTr.children).indexOf(th);
                    if (colIndex !== -1) {
                        const colTds = document.querySelectorAll(`#tabela-estoque tbody tr:not(.catalog-group-header-row) td:nth-child(${colIndex + 1})`);
                        colTds.forEach(td => {
                            if (calculatedWidth <= 16) {
                                td.classList.add('is-col-collapsed');
                                td.style.width = '6px';
                                td.style.maxWidth = '6px';
                            } else {
                                td.classList.remove('is-col-collapsed');
                                td.style.width = '';
                                td.style.maxWidth = '';
                            }
                        });
                    }
                };

                const onMouseUp = () => {
                    document.body.classList.remove('is-column-resizing');
                    resizer.classList.remove('is-resizing');
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);

                    applyColumnWidthsDOM();
                    saveColumnPreferencesToServer(true);
                };

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        });
    };

    // =============================================
    // === REORDENAÇÃO DE COLUNAS VIA DRAG & DROP ===
    // =============================================

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
            if (e.target.closest('.col-resizer')) return;

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
                        setupColumnResize();
                        applyColumnWidthsDOM();
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

                saveColumnPreferencesToServer(true);
            }
        };

        window.addEventListener('mouseup', finishDrag);
        window.addEventListener('touchend', finishDrag);
    };

    // =============================================
    // === EVENT LISTENERS ===
    // =============================================

    // Ordenação (clique simples) + Filtro Excel (duplo clique) nos headers
    tableHeaders.forEach(th => {
        th.addEventListener('click', (e) => {
            if (e.target.closest('.col-resizer')) return;
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => handleSort(th.dataset.column), 220);
        });
        th.addEventListener('dblclick', (e) => {
            if (e.target.closest('.col-resizer')) return;
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            e.preventDefault();
            e.stopPropagation();
            openColumnFilterMenu(th);
        });
    });

    const updateSearchPlaceholder = () => {
        if (!buscaInput || !campoBuscaSelect) return;
        const val = campoBuscaSelect.value;
        if (val === 'sku') {
            buscaInput.placeholder = 'Digite o SKU do produto...';
        } else if (val === 'descricao') {
            buscaInput.placeholder = 'Digite palavras da descrição...';
        } else if (val === 'geral') {
            buscaInput.placeholder = 'Pesquisar por ID, SKU ou Descrição...';
        } else {
            buscaInput.placeholder = 'Digite o ID do anúncio...';
        }
    };

    if (campoBuscaSelect) {
        campoBuscaSelect.addEventListener('change', () => {
            updateSearchPlaceholder();
            if (buscaInput && buscaInput.value.trim() !== '') {
                currentPage = 1;
                loadPromocoes();
            }
        });
    }

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
            if (buscaInput && buscaInput.value.trim()) {
                params.set('search', buscaInput.value.trim());
                params.set('searchField', campoBuscaSelect ? campoBuscaSelect.value : 'id_anuncio');
            }
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

    fetchColumnPreferences().then(() => {
        setupLongPressColumnDrag();
        loadPromocoes();
    });
});
