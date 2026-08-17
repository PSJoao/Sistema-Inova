/**
 * public/scripts/configurarPrazosManager.js
 * Gerenciamento da tela de Configuração de Prazos de Disponibilidade dos Anúncios
 * Visual e comportamento 100% padronizados com a Listagem de Anúncios.
 * Inclui Gestão de Fornecedores, Gestão de SKUs e Histórico Completo de Alterações.
 */

document.addEventListener('DOMContentLoaded', () => {
    // === Elementos da DOM - Abas ===
    const tabBtnFornecedores = document.getElementById('tabBtnFornecedores');
    const tabBtnProdutos = document.getElementById('tabBtnProdutos');
    const tabBtnHistorico = document.getElementById('tabBtnHistorico');
    const secaoFornecedores = document.getElementById('secao-fornecedores');
    const secaoProdutos = document.getElementById('secao-produtos');
    const secaoHistorico = document.getElementById('secao-historico');
    const badgeCountFornecedores = document.getElementById('badgeCountFornecedores');
    const badgeCountProdutos = document.getElementById('badgeCountProdutos');
    const badgeCountHistorico = document.getElementById('badgeCountHistorico');

    // === Elementos da DOM - Resumo ===
    const summaryTotalFornecedores = document.getElementById('summary-total-fornecedores');
    const summaryFornecedoresComPrazo = document.getElementById('summary-fornecedores-com-prazo');
    const summaryProdutosComPrazo = document.getElementById('summary-produtos-com-prazo');

    // === Elementos da DOM - Botão Aplicar ===
    const btnAplicarPrazosAgora = document.getElementById('btnAplicarPrazosAgora');

    // === Elementos da DOM - Fornecedores ===
    const buscaFornecedorInput = document.getElementById('buscaFornecedor');
    const filtroStatusPrazoForn = document.getElementById('filtroStatusPrazoForn');
    const tabelaFornecedores = document.getElementById('tabela-fornecedores');
    const tbodyFornecedores = document.getElementById('tbody-fornecedores');
    const loadingFornecedores = document.getElementById('loading-fornecedores');
    const emptyFornecedores = document.getElementById('empty-fornecedores');

    // === Elementos da DOM - Produtos ===
    const buscaProdutoInput = document.getElementById('buscaProduto');
    const filtroFornecedorProd = document.getElementById('filtroFornecedorProd');
    const filtroTipoPrazoProd = document.getElementById('filtroTipoPrazoProd');
    const filtroLimiteProd = document.getElementById('filtroLimiteProd');
    const tabelaProdutos = document.getElementById('tabela-produtos');
    const tbodyProdutos = document.getElementById('tbody-produtos');
    const paginationProdutos = document.getElementById('pagination-produtos');
    const loadingProdutos = document.getElementById('loading-produtos');
    const emptyProdutos = document.getElementById('empty-produtos');

    // === Elementos da DOM - Histórico ===
    const buscaHistoricoInput = document.getElementById('buscaHistorico');
    const filtroAcaoHistorico = document.getElementById('filtroAcaoHistorico');
    const filtroStatusHistorico = document.getElementById('filtroStatusHistorico');
    const filtroLimiteHistorico = document.getElementById('filtroLimiteHistorico');
    const tabelaHistorico = document.getElementById('tabela-historico');
    const tbodyHistorico = document.getElementById('tbody-historico');
    const paginationHistorico = document.getElementById('pagination-historico');
    const loadingHistorico = document.getElementById('loading-historico');
    const emptyHistorico = document.getElementById('empty-historico');

    // === Estado da Aplicação ===
    let allFornecedores = [];
    let allProdutos = [];
    let allHistorico = [];

    let currentPageProdutos = 1;
    let limitProdutos = 50;
    let currentPageHistorico = 1;
    let limitHistorico = 50;

    let debounceTimerForn = null;
    let debounceTimerProd = null;
    let debounceTimerHist = null;

    // Estado de Ordenação
    let sortFornecedorCol = 'fornecedor_nome';
    let sortFornecedorDir = 'asc';
    let sortProdutoCol = 'sku';
    let sortProdutoDir = 'asc';
    let sortHistoricoCol = 'created_at';
    let sortHistoricoDir = 'desc';

    // =============================================
    // === UTILITÁRIOS ===
    // =============================================

    const escapeHtml = (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const showToast = (message, isError = false) => {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();
        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        if (isError) toast.style.background = '#dc3545';
        toast.innerHTML = `<i class="fas ${isError ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    };

    // =============================================
    // === CONTROLE DE ABAS ===
    // =============================================

    const alternarAba = (targetId) => {
        [tabBtnFornecedores, tabBtnProdutos, tabBtnHistorico].forEach(btn => btn?.classList.remove('active'));
        [secaoFornecedores, secaoProdutos, secaoHistorico].forEach(sec => { if (sec) sec.style.display = 'none'; });

        if (targetId === 'secao-fornecedores') {
            tabBtnFornecedores.classList.add('active');
            secaoFornecedores.style.display = 'block';
        } else if (targetId === 'secao-produtos') {
            tabBtnProdutos.classList.add('active');
            secaoProdutos.style.display = 'block';
        } else if (targetId === 'secao-historico') {
            tabBtnHistorico.classList.add('active');
            secaoHistorico.style.display = 'block';
            carregarHistorico();
        }
    };

    tabBtnFornecedores.addEventListener('click', () => alternarAba('secao-fornecedores'));
    tabBtnProdutos.addEventListener('click', () => alternarAba('secao-produtos'));
    tabBtnHistorico.addEventListener('click', () => alternarAba('secao-historico'));

    // =============================================
    // === ATUALIZAR CONTADORES DE RESUMO ===
    // =============================================

    const atualizarResumos = () => {
        const totalForn = allFornecedores.length;
        const fornComPrazo = allFornecedores.filter(f => Number(f.prazo_dias) > 0).length;
        const prodComPrazo = allProdutos.filter(p => Number(p.prazo_personalizado) > 0).length;

        summaryTotalFornecedores.textContent = totalForn;
        summaryFornecedoresComPrazo.textContent = fornComPrazo;
        summaryProdutosComPrazo.textContent = prodComPrazo;

        badgeCountFornecedores.textContent = totalForn;
        badgeCountProdutos.textContent = allProdutos.length;
        badgeCountHistorico.textContent = allHistorico.length;
    };

    // =============================================
    // === CARREGAMENTO DE DADOS ===
    // =============================================

    const carregarDadosIniciais = async () => {
        await Promise.all([carregarFornecedores(), carregarProdutos(), carregarHistorico()]);
        atualizarResumos();
    };

    // =============================================
    // === FORNECEDORES ===
    // =============================================

    const carregarFornecedores = async () => {
        loadingFornecedores.style.display = 'block';
        emptyFornecedores.style.display = 'none';
        tbodyFornecedores.innerHTML = '';

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/fornecedores');
            if (!resp.ok) throw new Error('Falha ao buscar fornecedores.');
            const result = await resp.json();
            allFornecedores = result.data || [];
            renderizarTabelaFornecedores();
            popularSelectFornecedores();
        } catch (err) {
            console.error('Erro ao carregar fornecedores:', err);
            showToast('Erro ao carregar lista de fornecedores.', true);
        } finally {
            loadingFornecedores.style.display = 'none';
        }
    };

    const updateFornecedorHeaderClasses = () => {
        tabelaFornecedores.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === sortFornecedorCol) {
                th.classList.add(sortFornecedorDir);
            }
        });
    };

    const renderizarTabelaFornecedores = () => {
        const termoBusca = (buscaFornecedorInput.value || '').trim().toLowerCase();
        const statusFiltro = filtroStatusPrazoForn.value;

        let filtrados = allFornecedores.filter(f => {
            const nome = (f.fornecedor_nome || '').toLowerCase();
            const matchesBusca = !termoBusca || nome.includes(termoBusca);

            const prazo = Number(f.prazo_dias) || 0;
            let matchesStatus = true;
            if (statusFiltro === 'com_prazo') matchesStatus = prazo > 0;
            if (statusFiltro === 'sem_prazo') matchesStatus = prazo === 0;

            return matchesBusca && matchesStatus;
        });

        // Ordenação
        filtrados.sort((a, b) => {
            let valA = a[sortFornecedorCol];
            let valB = b[sortFornecedorCol];

            if (sortFornecedorCol === 'total_skus' || sortFornecedorCol === 'prazo_dias') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
                return sortFornecedorDir === 'asc' ? valA - valB : valB - valA;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
                return sortFornecedorDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
        });

        updateFornecedorHeaderClasses();

        if (filtrados.length === 0) {
            tbodyFornecedores.innerHTML = '';
            emptyFornecedores.style.display = 'block';
            return;
        }

        emptyFornecedores.style.display = 'none';

        tbodyFornecedores.innerHTML = filtrados.map(f => {
            const prazo = Number(f.prazo_dias) || 0;
            const hasPrazo = prazo > 0;
            const statusBadge = hasPrazo
                ? `<span class="qty-badge qty-ok"><i class="fas fa-check-circle me-1"></i> Ativo (${prazo}d)</span>`
                : `<span class="qty-badge qty-zero"><i class="fas fa-minus-circle me-1"></i> Inativo</span>`;

            return `
                <tr data-fornecedor-id="${escapeHtml(f.fornecedor_id || '')}" data-fornecedor-nome="${escapeHtml(f.fornecedor_nome || '')}">
                    <td>
                        <strong style="color: #fff; font-size: 0.9rem;">${escapeHtml(f.fornecedor_nome || 'Sem Nome')}</strong>
                    </td>
                    <td class="text-center">
                        <span class="qty-badge" style="background: rgba(255,255,255,0.06); color: #ccc; border: 1px solid rgba(255,255,255,0.1);">
                            <i class="fas fa-boxes me-1" style="font-size: 0.75rem; opacity: 0.7;"></i> ${f.total_skus || 0}
                        </span>
                    </td>
                    <td class="text-center">
                        <div class="prazo-inline-wrapper">
                            <input type="number" 
                                   class="prazo-inline-input input-prazo-fornecedor ${hasPrazo ? 'input-has-value' : ''}" 
                                   data-fornecedor-id="${escapeHtml(f.fornecedor_id || '')}"
                                   data-fornecedor-nome="${escapeHtml(f.fornecedor_nome || '')}"
                                   value="${prazo}" 
                                   min="0" 
                                   max="45" 
                                   step="1" />
                            <span class="prazo-inline-suffix">dias</span>
                            <span class="prazo-saved-msg"><i class="fas fa-check"></i> Salvo!</span>
                        </div>
                    </td>
                    <td class="text-center status-col">
                        ${statusBadge}
                    </td>
                </tr>
            `;
        }).join('');

        // Event listeners nos inputs de fornecedores
        tbodyFornecedores.querySelectorAll('.input-prazo-fornecedor').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });

            input.addEventListener('blur', () => {
                salvarPrazoFornecedor(input);
            });
        });
    };

    // Ordenação clicando nos cabeçalhos de fornecedores
    tabelaFornecedores.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.column;
            if (sortFornecedorCol === col) {
                sortFornecedorDir = sortFornecedorDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortFornecedorCol = col;
                sortFornecedorDir = 'asc';
            }
            renderizarTabelaFornecedores();
        });
    });

    const salvarPrazoFornecedor = async (input) => {
        const fornecedorId = input.dataset.fornecedorId || null;
        const fornecedorNome = input.dataset.fornecedorNome;
        const rawVal = input.value.trim();
        const dias = rawVal === '' ? 0 : parseInt(rawVal, 10);

        if (isNaN(dias) || dias < 0 || dias > 45) {
            showToast('O prazo deve ser um número inteiro entre 0 e 45 dias.', true);
            input.value = 0;
            return;
        }

        input.value = dias;

        const itemForn = allFornecedores.find(f => (fornecedorId && String(f.fornecedor_id) === String(fornecedorId)) || f.fornecedor_nome === fornecedorNome);
        if (itemForn && Number(itemForn.prazo_dias) === dias) {
            return;
        }

        try {
            input.disabled = true;

            const resp = await fetch('/api/anuncios/configurar-prazos/fornecedores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
                    fornecedor_nome: fornecedorNome,
                    prazo_dias: dias
                })
            });

            if (!resp.ok) throw new Error('Falha ao salvar.');

            if (itemForn) itemForn.prazo_dias = dias;

            allProdutos.forEach(p => {
                if ((fornecedorId && String(p.fornecedor_id) === String(fornecedorId)) || p.fornecedor_nome === fornecedorNome) {
                    p.prazo_fornecedor = dias;
                    p.prazo_efetivo = Number(p.prazo_personalizado) > 0 ? Number(p.prazo_personalizado) : dias;
                }
            });

            if (dias > 0) {
                input.classList.add('input-has-value');
            } else {
                input.classList.remove('input-has-value');
            }

            const savedMsg = input.parentElement.querySelector('.prazo-saved-msg');
            if (savedMsg) {
                savedMsg.style.display = 'inline-block';
                setTimeout(() => { savedMsg.style.display = 'none'; }, 1800);
            }

            const tr = input.closest('tr');
            if (tr) {
                const statusCol = tr.querySelector('.status-col');
                if (statusCol) {
                    statusCol.innerHTML = dias > 0
                        ? `<span class="qty-badge qty-ok"><i class="fas fa-check-circle me-1"></i> Ativo (${dias}d)</span>`
                        : `<span class="qty-badge qty-zero"><i class="fas fa-minus-circle me-1"></i> Inativo</span>`;
                }
            }

            atualizarResumos();
            renderizarTabelaProdutos();
            showToast(`Prazo de ${dias} dias salvo para "${fornecedorNome}".`);

        } catch (err) {
            console.error('Erro ao salvar prazo do fornecedor:', err);
            showToast('Erro ao salvar prazo do fornecedor.', true);
        } finally {
            input.disabled = false;
        }
    };

    // Filtros de Fornecedores
    buscaFornecedorInput.addEventListener('input', () => {
        clearTimeout(debounceTimerForn);
        debounceTimerForn = setTimeout(renderizarTabelaFornecedores, 250);
    });

    filtroStatusPrazoForn.addEventListener('change', renderizarTabelaFornecedores);

    // =============================================
    // === PRODUTOS (SKUS) ===
    // =============================================

    const carregarProdutos = async () => {
        loadingProdutos.style.display = 'block';
        emptyProdutos.style.display = 'none';
        tbodyProdutos.innerHTML = '';

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/produtos');
            if (!resp.ok) throw new Error('Falha ao buscar produtos.');
            const result = await resp.json();
            allProdutos = result.data || [];
            renderizarTabelaProdutos();
        } catch (err) {
            console.error('Erro ao carregar produtos:', err);
            showToast('Erro ao carregar lista de produtos.', true);
        } finally {
            loadingProdutos.style.display = 'none';
        }
    };

    const popularSelectFornecedores = () => {
        const fornecedoresNomes = Array.from(new Set(allFornecedores.map(f => f.fornecedor_nome).filter(Boolean))).sort();
        filtroFornecedorProd.innerHTML = '<option value="">Todos os Fornecedores</option>' +
            fornecedoresNomes.map(nome => `<option value="${escapeHtml(nome)}">${escapeHtml(nome)}</option>`).join('');
    };

    const getBadgePrazoEfetivo = (prod) => {
        const personalizado = Number(prod.prazo_personalizado) || 0;
        const fornecedor = Number(prod.prazo_fornecedor) || 0;

        if (personalizado > 0) {
            return `<span class="qty-badge qty-custom" title="Prazo personalizado do produto sobrepõe o fornecedor"><i class="fas fa-user-edit me-1"></i> ${personalizado} dias</span>`;
        } else if (fornecedor > 0) {
            return `<span class="qty-badge qty-inherited" title="Herdado da configuração do fornecedor"><i class="fas fa-industry me-1"></i> ${fornecedor} dias</span>`;
        } else {
            return `<span class="qty-badge qty-muted"><i class="fas fa-minus me-1"></i> 0 dias</span>`;
        }
    };

    const getBadgeEstoque = (estoque) => {
        const num = Number(estoque) || 0;
        if (num === 0) {
            return `<span class="qty-badge qty-zero" title="Estoque zero: Receberá prazo de disponibilidade">${num}</span>`;
        } else if (num <= 5) {
            return `<span class="qty-badge qty-low" title="Estoque crítico (&le; 5): Receberá prazo de disponibilidade">${num}</span>`;
        } else if (num >= 15) {
            return `<span class="qty-badge qty-ok" title="Estoque normal (&ge; 15): Prazo de disponibilidade é removido">${num}</span>`;
        } else {
            return `<span class="qty-badge" style="background: rgba(255, 193, 7, 0.15); color: #ffc107; border: 1px solid rgba(255, 193, 7, 0.3);" title="Estoque neutro (6 a 14)">${num}</span>`;
        }
    };

    const updateProdutoHeaderClasses = () => {
        tabelaProdutos.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === sortProdutoCol) {
                th.classList.add(sortProdutoDir);
            }
        });
    };

    const renderizarTabelaProdutos = () => {
        const termoBusca = (buscaProdutoInput.value || '').trim().toLowerCase();
        const fornecedorFiltro = filtroFornecedorProd.value;
        const tipoPrazoFiltro = filtroTipoPrazoProd.value;

        let filtrados = allProdutos.filter(p => {
            const sku = (p.sku || '').toLowerCase();
            const desc = (p.descricao || '').toLowerCase();
            const forn = (p.fornecedor_nome || '').toLowerCase();

            const matchesBusca = !termoBusca || sku.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca);
            const matchesFornecedor = !fornecedorFiltro || (p.fornecedor_nome === fornecedorFiltro);

            const personalizado = Number(p.prazo_personalizado) || 0;
            const efetivo = Number(p.prazo_efetivo) || 0;

            let matchesTipoPrazo = true;
            if (tipoPrazoFiltro === 'personalizado') matchesTipoPrazo = personalizado > 0;
            if (tipoPrazoFiltro === 'herdado') matchesTipoPrazo = personalizado === 0 && efetivo > 0;
            if (tipoPrazoFiltro === 'com_prazo_efetivo') matchesTipoPrazo = efetivo > 0;
            if (tipoPrazoFiltro === 'sem_prazo') matchesTipoPrazo = efetivo === 0;

            return matchesBusca && matchesFornecedor && matchesTipoPrazo;
        });

        // Ordenação
        filtrados.sort((a, b) => {
            let valA = a[sortProdutoCol];
            let valB = b[sortProdutoCol];

            if (sortProdutoCol === 'estoque_plataforma' || sortProdutoCol === 'prazo_fornecedor' || sortProdutoCol === 'prazo_personalizado' || sortProdutoCol === 'prazo_efetivo') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
                return sortProdutoDir === 'asc' ? valA - valB : valB - valA;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
                return sortProdutoDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
        });

        updateProdutoHeaderClasses();

        if (filtrados.length === 0) {
            tbodyProdutos.innerHTML = '';
            paginationProdutos.innerHTML = '';
            emptyProdutos.style.display = 'block';
            return;
        }

        emptyProdutos.style.display = 'none';

        // Paginação
        limitProdutos = parseInt(filtroLimiteProd.value, 10) || 50;
        const totalPages = Math.ceil(filtrados.length / limitProdutos);
        if (currentPageProdutos > totalPages) currentPageProdutos = 1;

        const startIdx = (currentPageProdutos - 1) * limitProdutos;
        const endIdx = startIdx + limitProdutos;
        const paginados = filtrados.slice(startIdx, endIdx);

        tbodyProdutos.innerHTML = paginados.map(p => {
            const personalizado = Number(p.prazo_personalizado) || 0;
            const fornecedorPrazo = Number(p.prazo_fornecedor) || 0;
            const hasPersonalizado = personalizado > 0;

            return `
                <tr data-sku="${escapeHtml(p.sku)}">
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <strong style="color: var(--accent-orange, #f07c00); font-family: monospace; font-size: 0.9rem;">
                                ${escapeHtml(p.sku)}
                            </strong>
                            <button type="button" class="btn-copy-sku" data-sku="${escapeHtml(p.sku)}" title="Copiar SKU" style="background: none; border: none; color: #777; cursor: pointer; padding: 2px 4px; font-size: 0.8rem; transition: color 0.15s;">
                                <i class="far fa-copy"></i>
                            </button>
                        </div>
                    </td>
                    <td>
                        <div style="max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e0e0e0;" title="${escapeHtml(p.descricao || '')}">
                            ${escapeHtml(p.descricao || '—')}
                        </div>
                    </td>
                    <td>
                        <span style="color: #bbb; font-size: 0.85rem;">
                            ${escapeHtml(p.fornecedor_nome || 'Sem Fornecedor')}
                        </span>
                    </td>
                    <td class="text-center">
                        ${getBadgeEstoque(p.estoque_plataforma)}
                    </td>
                    <td class="text-center">
                        <span class="qty-badge ${fornecedorPrazo > 0 ? 'qty-inherited' : 'qty-muted'}">
                            ${fornecedorPrazo > 0 ? `${fornecedorPrazo} dias` : '0 dias'}
                        </span>
                    </td>
                    <td class="text-center">
                        <div class="prazo-inline-wrapper">
                            <input type="number" 
                                   class="prazo-inline-input input-prazo-produto ${hasPersonalizado ? 'input-has-value' : ''}" 
                                   data-sku="${escapeHtml(p.sku)}"
                                   value="${personalizado}" 
                                   min="0" 
                                   max="45" 
                                   step="1" 
                                   placeholder="0" />
                            <span class="prazo-inline-suffix">dias</span>
                            <span class="prazo-saved-msg"><i class="fas fa-check"></i> Salvo!</span>
                        </div>
                    </td>
                    <td class="text-center prazo-efetivo-col">
                        ${getBadgePrazoEfetivo(p)}
                    </td>
                </tr>
            `;
        }).join('');

        // Event listeners de cópia de SKU
        tbodyProdutos.querySelectorAll('.btn-copy-sku').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                if (sku) {
                    navigator.clipboard.writeText(sku).then(() => {
                        const icon = btn.querySelector('i');
                        if (icon) {
                            icon.className = 'fas fa-check';
                            icon.style.color = '#28a745';
                            setTimeout(() => {
                                icon.className = 'far fa-copy';
                                icon.style.color = '';
                            }, 1500);
                        }
                    });
                }
            });
        });

        renderizarPaginacaoProdutos(filtrados.length, totalPages);

        // Event listeners nos inputs de produtos
        tbodyProdutos.querySelectorAll('.input-prazo-produto').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                }
            });

            input.addEventListener('blur', () => {
                salvarPrazoProduto(input);
            });
        });
    };

    // Ordenação clicando nos cabeçalhos de produtos
    tabelaProdutos.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.column;
            if (sortProdutoCol === col) {
                sortProdutoDir = sortProdutoDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortProdutoCol = col;
                sortProdutoDir = 'asc';
            }
            renderizarTabelaProdutos();
        });
    });

    const salvarPrazoProduto = async (input) => {
        const sku = input.dataset.sku;
        const rawVal = input.value.trim();
        const dias = rawVal === '' ? 0 : parseInt(rawVal, 10);

        if (isNaN(dias) || dias < 0 || dias > 45) {
            showToast('O prazo deve ser um número inteiro entre 0 e 45 dias.', true);
            input.value = 0;
            return;
        }

        input.value = dias;

        const itemProd = allProdutos.find(p => p.sku === sku);
        if (itemProd && Number(itemProd.prazo_personalizado) === dias) {
            return;
        }

        try {
            input.disabled = true;

            const resp = await fetch('/api/anuncios/configurar-prazos/produtos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sku: sku,
                    prazo_dias: dias
                })
            });

            if (!resp.ok) throw new Error('Falha ao salvar.');

            if (itemProd) {
                itemProd.prazo_personalizado = dias;
                itemProd.prazo_efetivo = dias > 0 ? dias : (Number(itemProd.prazo_fornecedor) || 0);
            }

            if (dias > 0) {
                input.classList.add('input-has-value');
            } else {
                input.classList.remove('input-has-value');
            }

            const savedMsg = input.parentElement.querySelector('.prazo-saved-msg');
            if (savedMsg) {
                savedMsg.style.display = 'inline-block';
                setTimeout(() => { savedMsg.style.display = 'none'; }, 1800);
            }

            const tr = input.closest('tr');
            if (tr && itemProd) {
                const badgeCol = tr.querySelector('.prazo-efetivo-col');
                if (badgeCol) {
                    badgeCol.innerHTML = getBadgePrazoEfetivo(itemProd);
                }
            }

            atualizarResumos();
            showToast(`Prazo de ${dias} dias salvo para o SKU "${sku}".`);

        } catch (err) {
            console.error('Erro ao salvar prazo do produto:', err);
            showToast('Erro ao salvar prazo do produto.', true);
        } finally {
            input.disabled = false;
        }
    };

    const renderizarPaginacaoProdutos = (totalItems, totalPages) => {
        if (totalPages <= 1) {
            paginationProdutos.innerHTML = '';
            return;
        }

        let html = '';
        html += `<button class="btn-page" ${currentPageProdutos === 1 ? 'disabled' : ''} data-page="${currentPageProdutos - 1}">Anterior</button>`;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPageProdutos - 2 && i <= currentPageProdutos + 2)) {
                html += `<button class="btn-page ${i === currentPageProdutos ? 'active' : ''}" data-page="${i}">${i}</button>`;
            } else if (i === currentPageProdutos - 3 || i === currentPageProdutos + 3) {
                html += `<span class="page-ellipsis">...</span>`;
            }
        }

        html += `<button class="btn-page" ${currentPageProdutos === totalPages ? 'disabled' : ''} data-page="${currentPageProdutos + 1}">Próxima</button>`;
        paginationProdutos.innerHTML = html;

        paginationProdutos.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = parseInt(btn.dataset.page, 10);
                if (p && p !== currentPageProdutos && !btn.disabled) {
                    currentPageProdutos = p;
                    renderizarTabelaProdutos();
                    document.querySelector('#secao-produtos .table-responsive')?.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    };

    // Filtros de Produtos
    buscaProdutoInput.addEventListener('input', () => {
        clearTimeout(debounceTimerProd);
        debounceTimerProd = setTimeout(() => {
            currentPageProdutos = 1;
            renderizarTabelaProdutos();
        }, 250);
    });

    filtroFornecedorProd.addEventListener('change', () => {
        currentPageProdutos = 1;
        renderizarTabelaProdutos();
    });

    filtroTipoPrazoProd.addEventListener('change', () => {
        currentPageProdutos = 1;
        renderizarTabelaProdutos();
    });

    filtroLimiteProd.addEventListener('change', () => {
        currentPageProdutos = 1;
        renderizarTabelaProdutos();
    });

    // =============================================
    // === HISTÓRICO DE ALTERAÇÕES ===
    // =============================================

    const carregarHistorico = async () => {
        if (!loadingHistorico) return;
        loadingHistorico.style.display = 'block';
        if (emptyHistorico) emptyHistorico.style.display = 'none';
        if (tbodyHistorico) tbodyHistorico.innerHTML = '';

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/historico');
            if (!resp.ok) throw new Error('Falha ao buscar histórico.');
            const result = await resp.json();
            allHistorico = result.data || [];
            renderizarTabelaHistorico();
            atualizarResumos();
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
        } finally {
            if (loadingHistorico) loadingHistorico.style.display = 'none';
        }
    };

    const updateHistoricoHeaderClasses = () => {
        if (!tabelaHistorico) return;
        tabelaHistorico.querySelectorAll('th.sortable').forEach(th => {
            th.classList.remove('asc', 'desc');
            if (th.dataset.column === sortHistoricoCol) {
                th.classList.add(sortHistoricoDir);
            }
        });
    };

    const renderizarTabelaHistorico = () => {
        if (!tbodyHistorico) return;

        const termoBusca = (buscaHistoricoInput?.value || '').trim().toLowerCase();
        const acaoFiltro = filtroAcaoHistorico?.value || '';
        const statusFiltro = filtroStatusHistorico?.value || '';

        let filtrados = allHistorico.filter(h => {
            const idAnuncio = (h.id_anuncio || '').toLowerCase();
            const sku = (h.sku || '').toLowerCase();
            const desc = (h.descricao || '').toLowerCase();
            const forn = (h.fornecedor_nome || '').toLowerCase();
            const motivo = (h.motivo || '').toLowerCase();

            const matchesBusca = !termoBusca || idAnuncio.includes(termoBusca) || sku.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca) || motivo.includes(termoBusca);
            const matchesAcao = !acaoFiltro || h.acao === acaoFiltro;

            let matchesStatus = true;
            if (statusFiltro === 'sucesso') matchesStatus = h.sucesso === true;
            if (statusFiltro === 'falha') matchesStatus = h.sucesso === false;

            return matchesBusca && matchesAcao && matchesStatus;
        });

        // Ordenação
        filtrados.sort((a, b) => {
            let valA = a[sortHistoricoCol];
            let valB = b[sortHistoricoCol];

            if (sortHistoricoCol === 'estoque_bling') {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
                return sortHistoricoDir === 'asc' ? valA - valB : valB - valA;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
                return sortHistoricoDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
        });

        updateHistoricoHeaderClasses();

        if (filtrados.length === 0) {
            tbodyHistorico.innerHTML = '';
            if (paginationHistorico) paginationHistorico.innerHTML = '';
            if (emptyHistorico) emptyHistorico.style.display = 'block';
            return;
        }

        if (emptyHistorico) emptyHistorico.style.display = 'none';

        // Paginação
        limitHistorico = parseInt(filtroLimiteHistorico?.value, 10) || 50;
        const totalPages = Math.ceil(filtrados.length / limitHistorico);
        if (currentPageHistorico > totalPages) currentPageHistorico = 1;

        const startIdx = (currentPageHistorico - 1) * limitHistorico;
        const endIdx = startIdx + limitHistorico;
        const paginados = filtrados.slice(startIdx, endIdx);

        tbodyHistorico.innerHTML = paginados.map(h => {
            const isAplicado = h.acao === 'APLICADO';
            const acaoBadge = isAplicado
                ? `<span class="qty-badge qty-custom"><i class="fas fa-arrow-down me-1"></i> Aplicado</span>`
                : `<span class="qty-badge qty-ok"><i class="fas fa-arrow-up me-1"></i> Removido</span>`;

            const statusBadge = h.sucesso
                ? `<span class="qty-badge qty-ok"><i class="fas fa-check-circle me-1"></i> Sucesso</span>`
                : `<span class="qty-badge qty-zero" title="${escapeHtml(h.mensagem_erro || 'Erro na API')}"><i class="fas fa-times-circle me-1"></i> Erro</span>`;

            const numericId = String(h.id_anuncio || '').replace(/\D/g, '');
            const mlUrl = numericId ? `https://produto.mercadolivre.com.br/MLB-${numericId}` : '#';

            return `
                <tr>
                    <td style="font-size: 0.82rem; color: #aaa;">
                        <i class="far fa-clock me-1 text-muted"></i> ${escapeHtml(h.data_formatada || '')}
                    </td>
                    <td>
                        <a href="${mlUrl}" target="_blank" rel="noopener noreferrer" style="color: #64b5f6; text-decoration: none; font-weight: 600; font-family: monospace; font-size: 0.85rem;" title="Abrir anúncio no Mercado Livre">
                            ${escapeHtml(h.id_anuncio)} <i class="fas fa-external-link-alt ms-1" style="font-size: 0.72rem; opacity: 0.7;"></i>
                        </a>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <strong style="color: var(--accent-orange, #f07c00); font-family: monospace; font-size: 0.9rem;">
                                ${escapeHtml(h.sku || '—')}
                            </strong>
                            <button type="button" class="btn-copy-sku" data-sku="${escapeHtml(h.sku || '')}" title="Copiar SKU" style="background: none; border: none; color: #777; cursor: pointer; padding: 2px 4px; font-size: 0.8rem;">
                                <i class="far fa-copy"></i>
                            </button>
                        </div>
                    </td>
                    <td>
                        <div style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ddd;" title="${escapeHtml(h.descricao || '')}">
                            ${escapeHtml(h.descricao || '—')}
                        </div>
                    </td>
                    <td>
                        <span style="color: #bbb; font-size: 0.85rem;">
                            ${escapeHtml(h.fornecedor_nome || '—')}
                        </span>
                    </td>
                    <td class="text-center">
                        ${getBadgeEstoque(h.estoque_bling)}
                    </td>
                    <td class="text-center">
                        ${acaoBadge}
                    </td>
                    <td class="text-center">
                        <span style="color: #888; font-size: 0.82rem;">${escapeHtml(h.prazo_anterior || '—')}</span>
                        <i class="fas fa-arrow-right mx-2" style="font-size: 0.72rem; color: var(--accent-orange, #f07c00);"></i>
                        <strong style="color: #fff; font-size: 0.85rem;">${escapeHtml(h.prazo_novo || '—')}</strong>
                    </td>
                    <td>
                        <span style="font-size: 0.82rem; color: #aaa;">
                            ${escapeHtml(h.motivo || '—')}
                        </span>
                    </td>
                    <td class="text-center">
                        ${statusBadge}
                    </td>
                </tr>
            `;
        }).join('');

        // Event listeners de cópia de SKU
        tbodyHistorico.querySelectorAll('.btn-copy-sku').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                if (sku) {
                    navigator.clipboard.writeText(sku).then(() => {
                        const icon = btn.querySelector('i');
                        if (icon) {
                            icon.className = 'fas fa-check';
                            icon.style.color = '#28a745';
                            setTimeout(() => {
                                icon.className = 'far fa-copy';
                                icon.style.color = '';
                            }, 1500);
                        }
                    });
                }
            });
        });

        renderizarPaginacaoHistorico(filtrados.length, totalPages);
    };

    // Ordenação clicando nos cabeçalhos de histórico
    if (tabelaHistorico) {
        tabelaHistorico.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.column;
                if (sortHistoricoCol === col) {
                    sortHistoricoDir = sortHistoricoDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortHistoricoCol = col;
                    sortHistoricoDir = 'desc';
                }
                renderizarTabelaHistorico();
            });
        });
    }

    const renderizarPaginacaoHistorico = (totalItems, totalPages) => {
        if (!paginationHistorico) return;

        if (totalPages <= 1) {
            paginationHistorico.innerHTML = '';
            return;
        }

        let html = '';
        html += `<button class="btn-page" ${currentPageHistorico === 1 ? 'disabled' : ''} data-page="${currentPageHistorico - 1}">Anterior</button>`;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPageHistorico - 2 && i <= currentPageHistorico + 2)) {
                html += `<button class="btn-page ${i === currentPageHistorico ? 'active' : ''}" data-page="${i}">${i}</button>`;
            } else if (i === currentPageHistorico - 3 || i === currentPageHistorico + 3) {
                html += `<span class="page-ellipsis">...</span>`;
            }
        }

        html += `<button class="btn-page" ${currentPageHistorico === totalPages ? 'disabled' : ''} data-page="${currentPageHistorico + 1}">Próxima</button>`;
        paginationHistorico.innerHTML = html;

        paginationHistorico.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = parseInt(btn.dataset.page, 10);
                if (p && p !== currentPageHistorico && !btn.disabled) {
                    currentPageHistorico = p;
                    renderizarTabelaHistorico();
                    document.querySelector('#secao-historico .table-responsive')?.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    };

    // Filtros de Histórico
    buscaHistoricoInput?.addEventListener('input', () => {
        clearTimeout(debounceTimerHist);
        debounceTimerHist = setTimeout(() => {
            currentPageHistorico = 1;
            renderizarTabelaHistorico();
        }, 250);
    });

    filtroAcaoHistorico?.addEventListener('change', () => {
        currentPageHistorico = 1;
        renderizarTabelaHistorico();
    });

    filtroStatusHistorico?.addEventListener('change', () => {
        currentPageHistorico = 1;
        renderizarTabelaHistorico();
    });

    filtroLimiteHistorico?.addEventListener('change', () => {
        currentPageHistorico = 1;
        renderizarTabelaHistorico();
    });

    // =============================================
    // === BOTÃO: APLICAR PRAZOS ===
    // =============================================

    btnAplicarPrazosAgora.addEventListener('click', async () => {
        const originalText = btnAplicarPrazosAgora.innerHTML;

        try {
            btnAplicarPrazosAgora.disabled = true;
            btnAplicarPrazosAgora.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>Aplicando no ML...`;

            const resp = await fetch('/api/anuncios/configurar-prazos/aplicar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!resp.ok) throw new Error('Falha ao aplicar prazos.');

            const result = await resp.json();

            const msg = `Processamento concluído! Aplicados: ${result.aplicados || 0} | Removidos: ${result.removidos || 0} | Inalterados: ${result.inalterados || 0}`;
            showToast(msg);

            // Recarrega os dados e o histórico para atualizar todas as tabelas
            await carregarDadosIniciais();

        } catch (err) {
            console.error('Erro ao aplicar prazos:', err);
            showToast('Erro ao aplicar prazos de disponibilidade no Mercado Livre.', true);
        } finally {
            btnAplicarPrazosAgora.disabled = false;
            btnAplicarPrazosAgora.innerHTML = originalText;
        }
    });

    // Inicialização
    carregarDadosIniciais();
});
