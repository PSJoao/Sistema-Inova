/**
 * public/scripts/centralPromocoesManager.js
 * Gerencia a Central de Promoções — listagem única de promoções agrupadas por ID
 * com funcionalidade de Reembolso Máximo.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Elementos da DOM ===
    const buscaInput = document.getElementById('buscaPromo');
    const filtroReembolso = document.getElementById('filtroReembolso');
    const filtroReembolsoML = document.getElementById('filtroReembolsoML');
    const filtroEmpresaCentral = document.getElementById('filtroEmpresaCentral');
    const filtroNomePromoCentral = document.getElementById('filtroNomePromoCentral');
    const filtroStatus = document.getElementById('filtroPromoStatusCentral');
    const promosGrid = document.getElementById('promos-grid');
    const promosLoading = document.getElementById('promos-loading');
    const promosEmpty = document.getElementById('promos-empty');
    const promosSummary = document.getElementById('promos-summary');
    const summaryTotal = document.getElementById('summary-total');
    const summaryActive = document.getElementById('summary-active');
    const summaryReembolso = document.getElementById('summary-reembolso');
    const paginationContainer = document.getElementById('pagination-container');

    // === Estado ===
    let allPromos = [];
    let debounceTimer = null;
    let currentPage = 1;
    let pageLimit = 20; // 5 fileiras x 4 cards por página

    // Multi-Select Filter de Nome de Promoção
    const promoMultiFilter = typeof MultiSelectPromoFilter !== 'undefined' ? new MultiSelectPromoFilter({
        btnId: 'filtroNomePromoCentralBtn',
        dropdownId: 'filtroNomePromoCentralDropdown',
        listId: 'filtroNomePromoCentralList',
        placeholder: 'Todas as Promoções',
        onFilterChange: () => {
            currentPage = 1;
            applyFiltersAndRender();
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

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch (e) { return dateStr; }
    };

    const showToast = (message, isError = false) => {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();
        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        if (isError) toast.style.background = '#dc3545';
        toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    };

    const getStatusInfo = (status) => {
        switch (status) {
            case 'started':
            case 'active':
                return { label: 'Ativa', class: 'central-badge-active', icon: 'fa-circle' };
            case 'candidate':
                return { label: 'Elegível', class: 'central-badge-candidate', icon: 'fa-star' };
            case 'finished':
                return { label: 'Finalizada', class: 'central-badge-finished', icon: 'fa-flag-checkered' };
            default:
                return { label: status || 'Desconhecido', class: 'central-badge-finished', icon: 'fa-question' };
        }
    };

    const getTypeLabel = (type) => {
        switch (type) {
            case 'DEAL': return 'Oferta';
            case 'SELLER_CAMPAIGN': return 'Campanha';
            case 'MARKETPLACE_CAMPAIGN': return 'Campanha ML';
            case 'PRICE_DISCOUNT': return 'Desconto';
            default: return type || 'Outro';
        }
    };

    const isActiveStatus = (status) => status === 'started' || status === 'active';

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================

    const loadPromos = async () => {
        try {
            promosLoading.style.display = 'block';
            promosGrid.innerHTML = '';
            promosEmpty.style.display = 'none';
            promosSummary.style.display = 'none';

            const response = await fetch('/api/anuncios/central-promocoes/listagem');
            if (!response.ok) throw new Error('Erro ao buscar dados.');

            const result = await response.json();
            allPromos = result.data || [];

            if (filtroEmpresaCentral && filtroEmpresaCentral.options.length <= 1) {
                const uniqueEmpresas = Array.from(new Set(allPromos.flatMap(p => p.empresas || []).filter(Boolean))).sort();
                uniqueEmpresas.forEach(emp => {
                    const opt = document.createElement('option');
                    opt.value = emp;
                    opt.textContent = emp;
                    filtroEmpresaCentral.appendChild(opt);
                });
            }

            if (promoMultiFilter) {
                const promoCounts = {};
                allPromos.forEach(p => {
                    if (p && p.name) {
                        promoCounts[p.name] = (promoCounts[p.name] || 0) + 1;
                    }
                });
                const options = Object.keys(promoCounts).map(name => ({ name, count: promoCounts[name] }));
                promoMultiFilter.setOptions(options);
            }

            applyFiltersAndRender();
        } catch (error) {
            console.error('[Central Promoções] Erro ao carregar:', error);
            promosLoading.style.display = 'none';
            promosEmpty.style.display = 'block';
        }
    };

    // =============================================
    // === FILTROS E RENDERIZAÇÃO ===
    // =============================================

    const applyFiltersAndRender = () => {
        const searchTerm = (buscaInput.value || '').trim().toLowerCase();
        const reembolsoFilter = filtroReembolso.value;
        const reembolsoMLFilter = filtroReembolsoML ? filtroReembolsoML.value : '';
        const statusFilter = filtroStatus.value;
        const empresaFilter = filtroEmpresaCentral ? filtroEmpresaCentral.value.toLowerCase() : '';

        if (promoMultiFilter) {
            const promoCounts = {};
            allPromos.forEach(p => {
                if (searchTerm && !(p.name || '').toLowerCase().includes(searchTerm) && !(p.promo_id || '').toLowerCase().includes(searchTerm)) return;
                if (reembolsoFilter === 'com' && (!p.reembolso_maximo || p.reembolso_maximo <= 0)) return;
                if (reembolsoFilter === 'sem' && p.reembolso_maximo && p.reembolso_maximo > 0) return;
                const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
                if (reembolsoMLFilter === 'com' && meliPct <= 0) return;
                if (reembolsoMLFilter === 'sem' && meliPct > 0) return;
                if (statusFilter) {
                    if (statusFilter === 'active' && !isActiveStatus(p.status)) return;
                    if (statusFilter === 'candidate' && p.status !== 'candidate') return;
                    if (statusFilter === 'finished' && p.status !== 'finished') return;
                }
                if (empresaFilter) {
                    const hasEmpresa = Array.isArray(p.empresas) && p.empresas.some(e => (e || '').toLowerCase().includes(empresaFilter));
                    if (!hasEmpresa) return;
                }
                if (p && p.name) {
                    promoCounts[p.name] = (promoCounts[p.name] || 0) + 1;
                }
            });
            const options = Object.keys(promoCounts).map(name => ({ name, count: promoCounts[name] }));
            promoMultiFilter.setOptions(options);
        }

        let filtered = allPromos.filter(p => {
            // Filtro de busca por nome
            if (searchTerm && !(p.name || '').toLowerCase().includes(searchTerm) && !(p.promo_id || '').toLowerCase().includes(searchTerm)) {
                return false;
            }

            // Filtro de reembolso máximo
            if (reembolsoFilter === 'com' && (!p.reembolso_maximo || p.reembolso_maximo <= 0)) return false;
            if (reembolsoFilter === 'sem' && p.reembolso_maximo && p.reembolso_maximo > 0) return false;

            // Filtro de reembolso ML
            const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
            if (reembolsoMLFilter === 'com' && meliPct <= 0) return false;
            if (reembolsoMLFilter === 'sem' && meliPct > 0) return false;

            // Filtro de status
            if (statusFilter) {
                if (statusFilter === 'active' && !isActiveStatus(p.status)) return false;
                if (statusFilter === 'candidate' && p.status !== 'candidate') return false;
                if (statusFilter === 'finished' && p.status !== 'finished') return false;
            }

            // Filtro de empresa / loja
            const empresaFilter = filtroEmpresaCentral ? filtroEmpresaCentral.value.toLowerCase() : '';
            if (empresaFilter) {
                const hasEmpresa = Array.isArray(p.empresas) && p.empresas.some(e => (e || '').toLowerCase().includes(empresaFilter));
                if (!hasEmpresa) return false;
            }

            // Filtro de nome da promoção (Multi-Select)
            if (promoMultiFilter && promoMultiFilter.hasFilter() && !promoMultiFilter.matches(p.name)) return false;

            return true;
        });

        // Ordena: ativas primeiro, depois por nome
        filtered.sort((a, b) => {
            const aActive = isActiveStatus(a.status);
            const bActive = isActiveStatus(b.status);
            if (aActive && !bActive) return -1;
            if (!aActive && bActive) return 1;
            return (a.name || '').localeCompare(b.name || '', 'pt-BR');
        });

        // Atualiza contadores
        const totalActive = allPromos.filter(p => isActiveStatus(p.status)).length;
        const totalReembolso = allPromos.filter(p => p.reembolso_maximo && p.reembolso_maximo > 0).length;
        summaryTotal.textContent = allPromos.length;
        summaryActive.textContent = totalActive;
        summaryReembolso.textContent = totalReembolso;
        promosSummary.style.display = 'flex';

        // Paginação
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / pageLimit) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIndex = (currentPage - 1) * pageLimit;
        const pageItems = filtered.slice(startIndex, startIndex + pageLimit);

        renderGrid(pageItems);
        renderPagination({ currentPage, totalPages, totalItems });
    };

    // =============================================
    // === PAGINAÇÃO ===
    // =============================================

    const renderPagination = (pagination) => {
        if (!paginationContainer) return;
        if (!pagination || pagination.totalPages <= 1) {
            paginationContainer.innerHTML = pagination
                ? `<span class="pagination-info">${pagination.totalItems} promoção(ões) encontrada(s)</span>`
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

        html += `<span class="pagination-info">${pagination.totalItems} promoção(ões) — Página ${currentPage} de ${pagination.totalPages}</span>`;

        paginationContainer.innerHTML = html;

        // Event listeners
        paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page, 10);
                if (page && page !== currentPage && !btn.disabled) {
                    currentPage = page;
                    applyFiltersAndRender();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    };

    // =============================================
    // === RENDERIZAR GRID DE CARDS ===
    // =============================================

    const renderGrid = (promos) => {
        promosLoading.style.display = 'none';

        if (!promos || promos.length === 0) {
            promosGrid.innerHTML = '';
            promosEmpty.style.display = 'block';
            return;
        }

        promosEmpty.style.display = 'none';

        promosGrid.innerHTML = promos.map(p => {
            const statusInfo = getStatusInfo(p.status);
            const isActive = isActiveStatus(p.status);
            const typeLabel = getTypeLabel(p.type);
            const reembolsoVal = p.reembolso_maximo != null ? p.reembolso_maximo : '';

            // Datas
            let dateHtml = '';
            const inicio = formatDate(p.start_date);
            const fim = formatDate(p.finish_date);
            if (inicio && fim) {
                dateHtml = `
                    <div class="central-card-dates">
                        <i class="far fa-calendar-alt"></i>
                        <span>${inicio} <strong>→</strong> ${fim}</span>
                    </div>`;
            } else if (fim) {
                dateHtml = `
                    <div class="central-card-dates">
                        <i class="far fa-calendar-alt"></i>
                        <span>Até <strong>${fim}</strong></span>
                    </div>`;
            }

            const meliPct = p.meli_percentage != null ? Number(p.meli_percentage) : 0;
            let meliBadge = '';
            if (meliPct > 0) {
                meliBadge = `<span class="central-badge" style="background: rgba(23, 162, 184, 0.15); color: #17a2b8; border: 1px solid rgba(23, 162, 184, 0.3);" title="Reembolso de tarifa concedido pelo Mercado Livre sobre o preço promocional"><i class="fas fa-hand-holding-usd"></i> Reembolso ML: ${meliPct.toFixed(1).replace('.', ',')}%</span>`;
            }

            return `
                <div class="central-promo-card${isActive ? ' card-active' : ''}" data-promo-id="${escapeHtml(p.promo_id)}">
                    <div class="central-card-header">
                        <span class="central-card-title">${escapeHtml(p.name || 'Promoção sem nome')}</span>
                        <span class="central-card-id">${escapeHtml(p.promo_id)}</span>
                    </div>

                    <div class="central-card-badges">
                        <span class="central-badge ${statusInfo.class}"><i class="fas ${statusInfo.icon}"></i> ${statusInfo.label}</span>
                        <span class="central-badge central-badge-type"><i class="fas fa-tag"></i> ${typeLabel}</span>
                        ${meliBadge}
                        <span class="central-badge central-badge-count"><i class="fas fa-link"></i> ${p.anuncios_count || 0} anúncio(s)</span>
                    </div>

                    ${dateHtml}

                    <div class="central-reembolso-section">
                        <div class="central-reembolso-label">
                            <i class="fas fa-percentage"></i> Reembolso Máximo
                        </div>
                        <div class="central-reembolso-input-wrapper">
                            <input type="number"
                                   class="central-reembolso-input"
                                   data-promo-id="${escapeHtml(p.promo_id)}"
                                   data-promo-name="${escapeHtml(p.name || '')}"
                                   value="${reembolsoVal}"
                                   placeholder="—"
                                   step="0.1"
                                   min="0"
                                   max="100" />
                            <span class="central-reembolso-suffix">%</span>
                            <span class="central-reembolso-saved-msg" id="saved-${escapeHtml(p.promo_id)}">
                                <i class="fas fa-check"></i> Salvo!
                            </span>
                        </div>
                        <div class="central-reembolso-hint">Pressione Enter ou clique fora para salvar</div>
                    </div>
                </div>`;
        }).join('');

        // Attach event listeners nos inputs de reembolso
        promosGrid.querySelectorAll('.central-reembolso-input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });
            input.addEventListener('blur', () => {
                saveReembolso(input);
            });
        });
    };

    // =============================================
    // === SALVAR REEMBOLSO MÁXIMO ===
    // =============================================

    const saveReembolso = async (input) => {
        const promoId = input.dataset.promoId;
        const promoName = input.dataset.promoName;
        const value = input.value.trim();

        const reembolsoMaximo = value !== '' ? parseFloat(value) : null;

        if (reembolsoMaximo !== null && (isNaN(reembolsoMaximo) || reembolsoMaximo < 0 || reembolsoMaximo > 100)) {
            showToast('Valor inválido. Use um número entre 0 e 100.', true);
            return;
        }

        // Se o valor é idêntico ao que já está salvo no estado local, ignora
        const promo = allPromos.find(p => p.promo_id === promoId);
        const currentSaved = promo ? (promo.reembolso_maximo != null ? Number(promo.reembolso_maximo) : null) : null;
        if (currentSaved === reembolsoMaximo) {
            return;
        }

        try {
            input.disabled = true;

            const response = await fetch('/api/anuncios/central-promocoes/reembolso', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    promo_id: promoId,
                    promo_name: promoName,
                    reembolso_maximo: reembolsoMaximo
                })
            });

            if (!response.ok) throw new Error('Erro ao salvar.');

            // Atualiza no estado local
            if (promo) promo.reembolso_maximo = reembolsoMaximo;

            // Feedback visual
            input.classList.add('saved');
            const savedMsg = document.getElementById(`saved-${promoId}`);
            if (savedMsg) savedMsg.classList.add('visible');

            setTimeout(() => {
                input.classList.remove('saved');
                if (savedMsg) savedMsg.classList.remove('visible');
            }, 2000);

            // Atualiza contadores
            const totalReembolso = allPromos.filter(p => p.reembolso_maximo && p.reembolso_maximo > 0).length;
            summaryReembolso.textContent = totalReembolso;

            showToast(`Reembolso de ${promoName || promoId} salvo!`);
        } catch (error) {
            console.error('[Central Promoções] Erro ao salvar reembolso:', error);
            showToast('Erro ao salvar reembolso. Tente novamente.', true);
        } finally {
            input.disabled = false;
        }
    };

    // =============================================
    // === EVENT LISTENERS ===
    // =============================================

    buscaInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            currentPage = 1;
            applyFiltersAndRender();
        }, 300);
    });

    filtroReembolso.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
    if (filtroReembolsoML) filtroReembolsoML.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
    if (filtroEmpresaCentral) filtroEmpresaCentral.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
    if (filtroNomePromoCentral) filtroNomePromoCentral.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
    filtroStatus.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    loadPromos();
});
