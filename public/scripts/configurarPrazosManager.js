/**
 * public/scripts/configurarPrazosManager.js
 * Gerenciamento da tela de Configuração de Prazos de Disponibilidade dos Anúncios
 * Visual e comportamento 100% padronizados com a Listagem de Anúncios.
 * Inclui Gestão de Fornecedores, Gestão de SKUs, Aplicação em Lote com Barra Flutuante e Histórico Completo de Alterações.
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
    const summaryProdutosTimerAtivo = document.getElementById('summary-produtos-timer-ativo');
    const summaryProdutosIndeterminadoAtivo = document.getElementById('summary-produtos-indeterminado-ativo');

    // === Elementos da DOM - Botão Aplicar Prazos ===
    const btnAplicarPrazosAgora = document.getElementById('btnAplicarPrazosAgora');

    // === Elementos da DOM - Fornecedores ===
    const buscaFornecedorInput = document.getElementById('buscaFornecedor');
    const filtroStatusPrazoForn = document.getElementById('filtroStatusPrazoForn');
    const btnToggleBatchForn = document.getElementById('btnToggleBatchForn');
    const tabelaFornecedores = document.getElementById('tabela-fornecedores');
    const checkAllFornecedores = document.getElementById('checkAllFornecedores');
    const tbodyFornecedores = document.getElementById('tbody-fornecedores');
    const loadingFornecedores = document.getElementById('loading-fornecedores');
    const emptyFornecedores = document.getElementById('empty-fornecedores');

    // Barra Flutuante de Lote - Fornecedores
    const batchBarFornecedores = document.getElementById('batch-bar-fornecedores');
    const batchCountFornSelected = document.getElementById('batchCountFornSelected');
    const batchDiasFornInput = document.getElementById('batchDiasFornInput');
    const btnApplyBatchForn = document.getElementById('btnApplyBatchForn');
    const btnCancelBatchForn = document.getElementById('btnCancelBatchForn');

    // === Elementos da DOM - Produtos ===
    const buscaProdutoInput = document.getElementById('buscaProduto');
    const filtroFornecedorProd = document.getElementById('filtroFornecedorProd');
    const filtroTipoPrazoProd = document.getElementById('filtroTipoPrazoProd');
    const filtroLimiteProd = document.getElementById('filtroLimiteProd');
    const btnToggleBatchProd = document.getElementById('btnToggleBatchProd');
    const tabelaProdutos = document.getElementById('tabela-produtos');
    const checkAllProdutos = document.getElementById('checkAllProdutos');
    const tbodyProdutos = document.getElementById('tbody-produtos');
    const paginationProdutos = document.getElementById('pagination-produtos');
    const loadingProdutos = document.getElementById('loading-produtos');
    const emptyProdutos = document.getElementById('empty-produtos');

    // Barra Flutuante de Lote - Produtos
    const batchBarProdutos = document.getElementById('batch-bar-produtos');
    const batchCountProdSelected = document.getElementById('batchCountProdSelected');
    const batchDiasProdInput = document.getElementById('batchDiasProdInput');
    const btnApplyBatchProd = document.getElementById('btnApplyBatchProd');
    const btnBatchTimerOn = document.getElementById('btnBatchTimerOn');
    const btnBatchTimerOff = document.getElementById('btnBatchTimerOff');
    const btnBatchIndeterminadoOn = document.getElementById('btnBatchIndeterminadoOn');
    const btnBatchIndeterminadoOff = document.getElementById('btnBatchIndeterminadoOff');
    const btnCancelBatchProd = document.getElementById('btnCancelBatchProd');

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

    // Estado do Modo em Lote
    let isBatchModeForn = false;
    const selectedFornKeys = new Set(); // chave única: fornecedor_id || fornecedor_nome

    let isBatchModeProd = false;
    const selectedProdSkus = new Set(); // chave única: sku

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

    const getFornKey = (f) => String(f.fornecedor_id || f.fornecedor_nome || '');

    // =============================================
    // === CONTROLE DE ABAS ===
    // =============================================

    const resetBatchModeForn = () => {
        if (isBatchModeForn) {
            isBatchModeForn = false;
            selectedFornKeys.clear();
            btnToggleBatchForn.classList.remove('active');
            if (batchBarFornecedores) batchBarFornecedores.style.display = 'none';
            renderizarTabelaFornecedores();
        }
    };

    const resetBatchModeProd = () => {
        if (isBatchModeProd) {
            isBatchModeProd = false;
            selectedProdSkus.clear();
            btnToggleBatchProd.classList.remove('active');
            if (batchBarProdutos) batchBarProdutos.style.display = 'none';
            renderizarTabelaProdutos();
        }
    };

    const alternarAba = (targetId) => {
        [tabBtnFornecedores, tabBtnProdutos, tabBtnHistorico].forEach(btn => btn?.classList.remove('active'));
        [secaoFornecedores, secaoProdutos, secaoHistorico].forEach(sec => { if (sec) sec.style.display = 'none'; });

        // Reseta o modo em lote da aba que está saindo
        if (targetId !== 'secao-fornecedores') resetBatchModeForn();
        if (targetId !== 'secao-produtos') resetBatchModeProd();

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
        const prodIndeterminadoAtivo = allProdutos.filter(p => Boolean(p.liberar_indeterminado) && (Number(p.estoque_plataforma) || 0) > 0).length;
        const prodTimerAtivo = allProdutos.filter(p => p.ignorar_prazos_ate && new Date(p.ignorar_prazos_ate) > new Date() && !(Boolean(p.liberar_indeterminado) && (Number(p.estoque_plataforma) || 0) > 0)).length;

        summaryTotalFornecedores.textContent = totalForn;
        summaryFornecedoresComPrazo.textContent = fornComPrazo;
        summaryProdutosComPrazo.textContent = prodComPrazo;
        if (summaryProdutosTimerAtivo) summaryProdutosTimerAtivo.textContent = prodTimerAtivo;
        if (summaryProdutosIndeterminadoAtivo) summaryProdutosIndeterminadoAtivo.textContent = prodIndeterminadoAtivo;

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

    const getFornecedoresFiltrados = () => {
        const termoBusca = (buscaFornecedorInput.value || '').trim().toLowerCase();
        const statusFiltro = filtroStatusPrazoForn.value;

        return allFornecedores.filter(f => {
            const nome = (f.fornecedor_nome || '').toLowerCase();
            const matchesBusca = !termoBusca || nome.includes(termoBusca);

            const prazo = Number(f.prazo_dias) || 0;
            let matchesStatus = true;
            if (statusFiltro === 'com_prazo') matchesStatus = prazo > 0;
            if (statusFiltro === 'sem_prazo') matchesStatus = prazo === 0;

            return matchesBusca && matchesStatus;
        });
    };

    const atualizarBarraLoteFornecedores = () => {
        if (!batchBarFornecedores) return;

        const count = selectedFornKeys.size;
        if (isBatchModeForn && count > 0) {
            batchBarFornecedores.style.display = 'flex';
            batchCountFornSelected.textContent = count;
        } else if (isBatchModeForn) {
            batchBarFornecedores.style.display = 'flex';
            batchCountFornSelected.textContent = '0';
        } else {
            batchBarFornecedores.style.display = 'none';
        }
    };

    const renderizarTabelaFornecedores = () => {
        let filtrados = getFornecedoresFiltrados();

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

        // Controla exibição da coluna de checkbox no thead
        const thCheckbox = tabelaFornecedores.querySelector('.th-checkbox');
        if (thCheckbox) {
            thCheckbox.style.display = isBatchModeForn ? 'table-cell' : 'none';
        }

        if (filtrados.length === 0) {
            tbodyFornecedores.innerHTML = '';
            emptyFornecedores.style.display = 'block';
            if (checkAllFornecedores) {
                checkAllFornecedores.checked = false;
                checkAllFornecedores.indeterminate = false;
            }
            atualizarBarraLoteFornecedores();
            return;
        }

        emptyFornecedores.style.display = 'none';

        tbodyFornecedores.innerHTML = filtrados.map(f => {
            const key = getFornKey(f);
            const isSelected = selectedFornKeys.has(key);
            const prazo = Number(f.prazo_dias) || 0;
            const hasPrazo = prazo > 0;
            const statusBadge = hasPrazo
                ? `<span class="qty-badge qty-ok"><i class="fas fa-check-circle me-1"></i> Ativo (${prazo}d)</span>`
                : `<span class="qty-badge qty-zero"><i class="fas fa-minus-circle me-1"></i> Inativo</span>`;

            return `
                <tr data-fornecedor-key="${escapeHtml(key)}" class="${isSelected ? 'row-selected' : ''}">
                    <td class="col-checkbox td-checkbox" style="display: ${isBatchModeForn ? 'table-cell' : 'none'};">
                        <input type="checkbox" class="form-check-input select-row-checkbox checkbox-forn" data-key="${escapeHtml(key)}" ${isSelected ? 'checked' : ''} />
                    </td>
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

        // Master Checkbox state
        if (checkAllFornecedores) {
            const visibleKeys = filtrados.map(f => getFornKey(f));
            const selectedVisibleCount = visibleKeys.filter(k => selectedFornKeys.has(k)).length;
            checkAllFornecedores.checked = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
            checkAllFornecedores.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;
        }

        // Event listeners nas checkboxes de fornecedores
        tbodyFornecedores.querySelectorAll('.checkbox-forn').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const key = cb.dataset.key;
                if (cb.checked) {
                    selectedFornKeys.add(key);
                } else {
                    selectedFornKeys.delete(key);
                }
                const tr = cb.closest('tr');
                if (tr) tr.classList.toggle('row-selected', cb.checked);
                atualizarBarraLoteFornecedores();

                // Atualiza o master checkbox
                const visibleKeys = filtrados.map(f => getFornKey(f));
                const selCount = visibleKeys.filter(k => selectedFornKeys.has(k)).length;
                if (checkAllFornecedores) {
                    checkAllFornecedores.checked = visibleKeys.length > 0 && selCount === visibleKeys.length;
                    checkAllFornecedores.indeterminate = selCount > 0 && selCount < visibleKeys.length;
                }
            });
        });

        // Clique na linha no modo em lote
        tbodyFornecedores.querySelectorAll('tr').forEach(tr => {
            tr.addEventListener('click', (e) => {
                if (!isBatchModeForn) return;
                if (e.target.closest('input') || e.target.closest('button') || e.target.closest('a')) return;

                const cb = tr.querySelector('.checkbox-forn');
                if (cb) {
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });
        });

        // Event listeners nos inputs de prazos individuais
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

        atualizarBarraLoteFornecedores();
    };

    // Alternar modo em lote de fornecedores
    btnToggleBatchForn.addEventListener('click', () => {
        isBatchModeForn = !isBatchModeForn;
        btnToggleBatchForn.classList.toggle('active', isBatchModeForn);
        if (!isBatchModeForn) {
            selectedFornKeys.clear();
        }
        renderizarTabelaFornecedores();
    });

    // Check All Fornecedores (visíveis)
    if (checkAllFornecedores) {
        checkAllFornecedores.addEventListener('change', () => {
            const filtrados = getFornecedoresFiltrados();
            filtrados.forEach(f => {
                const key = getFornKey(f);
                if (checkAllFornecedores.checked) {
                    selectedFornKeys.add(key);
                } else {
                    selectedFornKeys.delete(key);
                }
            });
            renderizarTabelaFornecedores();
        });
    }

    // Cancelar modo em lote de fornecedores
    if (btnCancelBatchForn) {
        btnCancelBatchForn.addEventListener('click', () => {
            selectedFornKeys.clear();
            isBatchModeForn = false;
            btnToggleBatchForn.classList.remove('active');
            renderizarTabelaFornecedores();
        });
    }

    // Aplicar em lote aos fornecedores selecionados
    if (btnApplyBatchForn) {
        btnApplyBatchForn.addEventListener('click', async () => {
            if (selectedFornKeys.size === 0) {
                showToast('Selecione pelo menos um fornecedor para aplicar.', true);
                return;
            }

            const rawVal = batchDiasFornInput.value.trim();
            const dias = rawVal === '' ? 0 : parseInt(rawVal, 10);
            if (isNaN(dias) || dias < 0 || dias > 45) {
                showToast('O prazo deve ser um número inteiro entre 0 e 45 dias.', true);
                return;
            }

            const fornecedoresParaAtualizar = allFornecedores.filter(f => selectedFornKeys.has(getFornKey(f)));
            const payload = fornecedoresParaAtualizar.map(f => ({
                fornecedor_id: f.fornecedor_id ? Number(f.fornecedor_id) : null,
                fornecedor_nome: f.fornecedor_nome
            }));

            const origHtml = btnApplyBatchForn.innerHTML;
            btnApplyBatchForn.disabled = true;
            btnApplyBatchForn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Aplicando...`;

            try {
                const resp = await fetch('/api/anuncios/configurar-prazos/fornecedores/lote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fornecedores: payload,
                        prazo_dias: dias
                    })
                });

                if (!resp.ok) throw new Error('Falha ao aplicar prazos em lote.');

                // Atualiza o estado local
                fornecedoresParaAtualizar.forEach(f => {
                    f.prazo_dias = dias;
                });

                const fornKeysSet = new Set(fornecedoresParaAtualizar.map(f => getFornKey(f)));
                const fornNomesSet = new Set(fornecedoresParaAtualizar.map(f => f.fornecedor_nome));

                allProdutos.forEach(p => {
                    if (p.fornecedor_id && fornKeysSet.has(String(p.fornecedor_id)) || fornNomesSet.has(p.fornecedor_nome)) {
                        p.prazo_fornecedor = dias;
                        p.prazo_efetivo = Number(p.prazo_personalizado) > 0 ? Number(p.prazo_personalizado) : dias;
                    }
                });

                selectedFornKeys.clear();
                atualizarResumos();
                renderizarTabelaFornecedores();
                renderizarTabelaProdutos();
                showToast(`Prazo de ${dias} dias aplicado com sucesso a ${payload.length} fornecedor(es)!`);

            } catch (err) {
                console.error('Erro ao salvar em lote para fornecedores:', err);
                showToast('Erro ao aplicar prazos em lote para fornecedores.', true);
            } finally {
                btnApplyBatchForn.disabled = false;
                btnApplyBatchForn.innerHTML = origHtml;
            }
        });
    }

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
        const estoque = Number(prod.estoque_plataforma) || 0;
        const isIndeterminadoAtivo = Boolean(prod.liberar_indeterminado) && estoque > 0;
        if (isIndeterminadoAtivo) {
            return `<span class="badge-prazo-indeterminado" title="Liberação Indeterminada ativa: Mantido em Pronta Entrega no ML"><i class="fas fa-infinity me-1"></i> 0d (Indeterminado)</span>`;
        }

        const isTimerAtivo = prod.ignorar_prazos_ate && new Date(prod.ignorar_prazos_ate) > new Date();
        if (isTimerAtivo) {
            return `<span class="badge-prazo-ignorado" title="Temporizador 48h ativo: Mantido em Pronta Entrega no ML"><i class="fas fa-bolt me-1"></i> 0d (48h Ativo)</span>`;
        }

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

    const getTimerCountdownHtml = (p) => {
        const estoque = Number(p.estoque_plataforma) || 0;
        const isIndeterminadoAtivo = Boolean(p.liberar_indeterminado) && estoque > 0;

        if (isIndeterminadoAtivo) {
            return `
                <button type="button" class="btn-toggle-timer-48h btn-timer-disabled" disabled title="Temporizador 48h bloqueado pois a Liberação Indeterminada está ativa para este SKU">
                    <i class="fas fa-stopwatch"></i> Liberar 48h
                </button>
            `;
        }

        if (!p.ignorar_prazos_ate) {
            return `
                <button type="button" class="btn-toggle-timer-48h btn-ativar-timer" data-sku="${escapeHtml(p.sku)}" title="Liberar 48h de pronta entrega (ignora prazos no ML)">
                    <i class="fas fa-stopwatch"></i> Liberar 48h
                </button>
            `;
        }

        const expireDate = new Date(p.ignorar_prazos_ate);
        const now = new Date();
        const diffMs = expireDate - now;

        if (diffMs <= 0) {
            // Expirou
            return `
                <button type="button" class="btn-toggle-timer-48h btn-ativar-timer" data-sku="${escapeHtml(p.sku)}" title="Temporizador expirou. Clique para renovar por 48h">
                    <i class="fas fa-stopwatch"></i> Liberar 48h
                </button>
            `;
        }

        const totalSeconds = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let timeText = '';
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remHours = hours % 24;
            timeText = `${days}d ${remHours}h`;
        } else {
            timeText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        const formattedDate = expireDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        return `
            <div class="timer-48h-active-container" data-expire="${expireDate.toISOString()}" title="Pronta Entrega Ativa até ${formattedDate}">
                <span class="timer-48h-badge">
                    <i class="fas fa-clock fa-spin-pulse"></i> <span class="timer-countdown-text">${timeText}</span>
                </span>
                <button type="button" class="btn-timer-cancel" data-sku="${escapeHtml(p.sku)}" title="Cancelar liberação 48h e retornar ao fluxo padrão">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    };

    const getIndeterminadoButtonHtml = (p) => {
        const estoque = Number(p.estoque_plataforma) || 0;
        const isIndeterminadoAtivo = Boolean(p.liberar_indeterminado) && estoque > 0;

        if (estoque <= 0) {
            return `
                <button type="button" class="btn-toggle-indeterminado btn-indeterminado-disabled" disabled title="Indisponível: Estoque zerado ou menor que zero no Bling (${estoque})">
                    <i class="fas fa-infinity"></i> Liberar Indeterminado
                </button>
            `;
        }

        if (isIndeterminadoAtivo) {
            return `
                <div class="indeterminado-active-container" title="Liberação Indeterminada Ativa: Mantido em Pronta Entrega no ML">
                    <span class="indeterminado-badge">
                        <i class="fas fa-infinity fa-fade"></i> <span>Ativo</span>
                    </span>
                    <button type="button" class="btn-indeterminado-cancel" data-sku="${escapeHtml(p.sku)}" title="Desligar liberação indeterminada e retornar ao fluxo padrão">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }

        return `
            <button type="button" class="btn-toggle-indeterminado btn-ativar-indeterminado" data-sku="${escapeHtml(p.sku)}" title="Liberar pronta entrega por tempo indeterminado (ignora prazos até ser desligado ou estoque zerar)">
                <i class="fas fa-infinity"></i> Liberar Indeterminado
            </button>
        `;
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

    const getProdutosFiltrados = () => {
        const termoBusca = (buscaProdutoInput.value || '').trim().toLowerCase();
        const fornecedorFiltro = filtroFornecedorProd.value;
        const tipoPrazoFiltro = filtroTipoPrazoProd.value;

        return allProdutos.filter(p => {
            const sku = (p.sku || '').toLowerCase();
            const desc = (p.descricao || '').toLowerCase();
            const forn = (p.fornecedor_nome || '').toLowerCase();

            const matchesBusca = !termoBusca || sku.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca);
            const matchesFornecedor = !fornecedorFiltro || (p.fornecedor_nome === fornecedorFiltro);

            const personalizado = Number(p.prazo_personalizado) || 0;
            const efetivo = Number(p.prazo_efetivo) || 0;
            const estoque = Number(p.estoque_plataforma) || 0;
            const isIndeterminadoAtivo = Boolean(p.liberar_indeterminado) && estoque > 0;
            const isTimerAtivo = p.ignorar_prazos_ate && new Date(p.ignorar_prazos_ate) > new Date() && !isIndeterminadoAtivo;
            const isLiberadoEspecial = isIndeterminadoAtivo || isTimerAtivo;

            let matchesTipoPrazo = true;
            if (tipoPrazoFiltro === 'indeterminado_ativo') matchesTipoPrazo = isIndeterminadoAtivo;
            if (tipoPrazoFiltro === 'temporizador_ativo') matchesTipoPrazo = isTimerAtivo;
            if (tipoPrazoFiltro === 'personalizado') matchesTipoPrazo = personalizado > 0;
            if (tipoPrazoFiltro === 'herdado') matchesTipoPrazo = personalizado === 0 && efetivo > 0 && !isLiberadoEspecial;
            if (tipoPrazoFiltro === 'com_prazo_efetivo') matchesTipoPrazo = efetivo > 0 && !isLiberadoEspecial;
            if (tipoPrazoFiltro === 'sem_prazo') matchesTipoPrazo = efetivo === 0 || isLiberadoEspecial;

            return matchesBusca && matchesFornecedor && matchesTipoPrazo;
        });
    };

    const atualizarBarraLoteProdutos = () => {
        if (!batchBarProdutos) return;

        const count = selectedProdSkus.size;
        if (isBatchModeProd && count > 0) {
            batchBarProdutos.style.display = 'flex';
            batchCountProdSelected.textContent = count;
        } else if (isBatchModeProd) {
            batchBarProdutos.style.display = 'flex';
            batchCountProdSelected.textContent = '0';
        } else {
            batchBarProdutos.style.display = 'none';
        }
    };

    const renderizarTabelaProdutos = () => {
        let filtrados = getProdutosFiltrados();

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

        // Controla exibição da coluna de checkbox no thead
        const thCheckbox = tabelaProdutos.querySelector('.th-checkbox');
        if (thCheckbox) {
            thCheckbox.style.display = isBatchModeProd ? 'table-cell' : 'none';
        }

        if (filtrados.length === 0) {
            tbodyProdutos.innerHTML = '';
            paginationProdutos.innerHTML = '';
            emptyProdutos.style.display = 'block';
            if (checkAllProdutos) {
                checkAllProdutos.checked = false;
                checkAllProdutos.indeterminate = false;
            }
            atualizarBarraLoteProdutos();
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
            const isSelected = selectedProdSkus.has(p.sku);
            const personalizado = Number(p.prazo_personalizado) || 0;
            const fornecedorPrazo = Number(p.prazo_fornecedor) || 0;
            const hasPersonalizado = personalizado > 0;

            return `
                <tr data-sku="${escapeHtml(p.sku)}" class="${isSelected ? 'row-selected' : ''}">
                    <td class="col-checkbox td-checkbox" style="display: ${isBatchModeProd ? 'table-cell' : 'none'};">
                        <input type="checkbox" class="form-check-input select-row-checkbox checkbox-prod" data-sku="${escapeHtml(p.sku)}" ${isSelected ? 'checked' : ''} />
                    </td>
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
                        <div style="max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e0e0e0;" title="${escapeHtml(p.descricao || '')}">
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
                    <td class="text-center timer-col">
                        ${getTimerCountdownHtml(p)}
                    </td>
                    <td class="text-center indeterminado-col">
                        ${getIndeterminadoButtonHtml(p)}
                    </td>
                    <td class="text-center prazo-efetivo-col">
                        ${getBadgePrazoEfetivo(p)}
                    </td>
                </tr>
            `;
        }).join('');

        // Master Checkbox state para a página visível
        if (checkAllProdutos) {
            const pageSkus = paginados.map(p => p.sku);
            const selectedPageCount = pageSkus.filter(s => selectedProdSkus.has(s)).length;
            checkAllProdutos.checked = pageSkus.length > 0 && selectedPageCount === pageSkus.length;
            checkAllProdutos.indeterminate = selectedPageCount > 0 && selectedPageCount < pageSkus.length;
        }

        // Event listeners nas checkboxes de produtos
        tbodyProdutos.querySelectorAll('.checkbox-prod').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const sku = cb.dataset.sku;
                if (cb.checked) {
                    selectedProdSkus.add(sku);
                } else {
                    selectedProdSkus.delete(sku);
                }
                const tr = cb.closest('tr');
                if (tr) tr.classList.toggle('row-selected', cb.checked);
                atualizarBarraLoteProdutos();

                // Atualiza o master checkbox da página
                const pageSkus = paginados.map(p => p.sku);
                const selCount = pageSkus.filter(s => selectedProdSkus.has(s)).length;
                if (checkAllProdutos) {
                    checkAllProdutos.checked = pageSkus.length > 0 && selCount === pageSkus.length;
                    checkAllProdutos.indeterminate = selCount > 0 && selCount < pageSkus.length;
                }
            });
        });

        // Clique na linha no modo em lote
        tbodyProdutos.querySelectorAll('tr').forEach(tr => {
            tr.addEventListener('click', (e) => {
                if (!isBatchModeProd) return;
                if (e.target.closest('input') || e.target.closest('button') || e.target.closest('a')) return;

                const cb = tr.querySelector('.checkbox-prod');
                if (cb) {
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            });
        });

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

        // Event listeners dos botões de Temporizador 48h (Ativar / Cancelar)
        tbodyProdutos.querySelectorAll('.btn-ativar-timer').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                toggleTemporizadorProduto(sku, 'ativar');
            });
        });

        tbodyProdutos.querySelectorAll('.btn-timer-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                toggleTemporizadorProduto(sku, 'desativar');
            });
        });

        // Event listeners dos botões de Liberação Indeterminada (Ativar / Cancelar)
        tbodyProdutos.querySelectorAll('.btn-ativar-indeterminado').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                toggleIndeterminadoProduto(sku, 'ativar');
            });
        });

        tbodyProdutos.querySelectorAll('.btn-indeterminado-cancel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sku = btn.dataset.sku;
                toggleIndeterminadoProduto(sku, 'desativar');
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

        atualizarBarraLoteProdutos();
    };

    // Alternar modo em lote de produtos
    btnToggleBatchProd.addEventListener('click', () => {
        isBatchModeProd = !isBatchModeProd;
        btnToggleBatchProd.classList.toggle('active', isBatchModeProd);
        if (!isBatchModeProd) {
            selectedProdSkus.clear();
        }
        renderizarTabelaProdutos();
    });

    // Check All Produtos (visíveis na página)
    if (checkAllProdutos) {
        checkAllProdutos.addEventListener('change', () => {
            const filtrados = getProdutosFiltrados();
            const startIdx = (currentPageProdutos - 1) * limitProdutos;
            const endIdx = startIdx + limitProdutos;
            const paginados = filtrados.slice(startIdx, endIdx);

            paginados.forEach(p => {
                if (checkAllProdutos.checked) {
                    selectedProdSkus.add(p.sku);
                } else {
                    selectedProdSkus.delete(p.sku);
                }
            });
            renderizarTabelaProdutos();
        });
    }

    // Cancelar modo em lote de produtos
    if (btnCancelBatchProd) {
        btnCancelBatchProd.addEventListener('click', () => {
            selectedProdSkus.clear();
            isBatchModeProd = false;
            btnToggleBatchProd.classList.remove('active');
            renderizarTabelaProdutos();
        });
    }

    // Aplicar prazo em lote aos produtos selecionados
    if (btnApplyBatchProd) {
        btnApplyBatchProd.addEventListener('click', async () => {
            if (selectedProdSkus.size === 0) {
                showToast('Selecione pelo menos um produto para aplicar.', true);
                return;
            }

            const rawVal = batchDiasProdInput.value.trim();
            const dias = rawVal === '' ? 0 : parseInt(rawVal, 10);
            if (isNaN(dias) || dias < 0 || dias > 45) {
                showToast('O prazo deve ser um número inteiro entre 0 e 45 dias.', true);
                return;
            }

            const skusArray = Array.from(selectedProdSkus);

            const origHtml = btnApplyBatchProd.innerHTML;
            btnApplyBatchProd.disabled = true;
            btnApplyBatchProd.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Aplicando...`;

            try {
                const resp = await fetch('/api/anuncios/configurar-prazos/produtos/lote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skus: skusArray,
                        prazo_dias: dias
                    })
                });

                if (!resp.ok) throw new Error('Falha ao aplicar prazos em lote.');

                const skusSetUpper = new Set(skusArray.map(s => String(s).toUpperCase().trim()));
                allProdutos.forEach(p => {
                    if (skusSetUpper.has(String(p.sku || '').toUpperCase().trim())) {
                        p.prazo_personalizado = dias;
                        const estoque = Number(p.estoque_plataforma) || 0;
                        const isIndeterminadoAtivo = Boolean(p.liberar_indeterminado) && estoque > 0;
                        const isTimerAtivo = p.ignorar_prazos_ate && new Date(p.ignorar_prazos_ate) > new Date() && !isIndeterminadoAtivo;
                        p.prazo_efetivo = (isIndeterminadoAtivo || isTimerAtivo) ? 0 : (dias > 0 ? dias : (Number(p.prazo_fornecedor) || 0));
                    }
                });

                selectedProdSkus.clear();
                atualizarResumos();
                renderizarTabelaProdutos();
                showToast(`Prazo de ${dias} dias aplicado com sucesso a ${skusArray.length} produto(s)!`);

            } catch (err) {
                console.error('Erro ao salvar em lote para produtos:', err);
                showToast('Erro ao aplicar prazos em lote para produtos.', true);
            } finally {
                btnApplyBatchProd.disabled = false;
                btnApplyBatchProd.innerHTML = origHtml;
            }
        });
    }

    // Ações de Temporizador em Lote (Liberar 48h / Cancelar 48h)
    if (btnBatchTimerOn) {
        btnBatchTimerOn.addEventListener('click', () => {
            const skusArray = Array.from(selectedProdSkus);
            toggleTemporizadorProdutosLote(skusArray, 'ativar');
        });
    }

    if (btnBatchTimerOff) {
        btnBatchTimerOff.addEventListener('click', () => {
            const skusArray = Array.from(selectedProdSkus);
            toggleTemporizadorProdutosLote(skusArray, 'desativar');
        });
    }

    // Ações de Liberação Indeterminada em Lote (Liberar Indeterminado / Cancelar Indeterminado)
    if (btnBatchIndeterminadoOn) {
        btnBatchIndeterminadoOn.addEventListener('click', () => {
            const skusArray = Array.from(selectedProdSkus);
            toggleIndeterminadoProdutosLote(skusArray, 'ativar');
        });
    }

    if (btnBatchIndeterminadoOff) {
        btnBatchIndeterminadoOff.addEventListener('click', () => {
            const skusArray = Array.from(selectedProdSkus);
            toggleIndeterminadoProdutosLote(skusArray, 'desativar');
        });
    }

    // Botões de Presets de Dias nas Barras Flutuantes
    document.querySelectorAll('.btn-preset-dias').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const dias = btn.dataset.dias;

            if (target === 'forn' && batchDiasFornInput) {
                batchDiasFornInput.value = dias;
                batchBarFornecedores.querySelectorAll('.btn-preset-dias').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (target === 'prod' && batchDiasProdInput) {
                batchDiasProdInput.value = dias;
                batchBarProdutos.querySelectorAll('.btn-preset-dias').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        });
    });

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

    const toggleTemporizadorProduto = async (sku, acao) => {
        if (!sku) return;

        const isAtivar = acao === 'ativar';
        const targetUpper = String(sku).toUpperCase().trim();

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/produtos/temporizador', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, acao })
            });

            if (!resp.ok) throw new Error('Falha ao alternar temporizador.');
            const resData = await resp.json();

            allProdutos.forEach(p => {
                if (String(p.sku || '').toUpperCase().trim() === targetUpper) {
                    p.ignorar_prazos_ate = resData.ignorar_prazos_ate;
                    p.is_temporizador_ativo = resData.is_temporizador_ativo;
                    p.liberar_indeterminado = false;
                    p.is_indeterminado_ativo = false;

                    if (resData.is_temporizador_ativo) {
                        p.prazo_efetivo = 0;
                    } else {
                        const pers = Number(p.prazo_personalizado) || 0;
                        const forn = Number(p.prazo_fornecedor) || 0;
                        p.prazo_efetivo = pers > 0 ? pers : forn;
                    }
                }
            });

            atualizarResumos();
            renderizarTabelaProdutos();

            if (isAtivar) {
                showToast(`Temporizador 48h ativado para "${sku}"! Prazos liberados no Mercado Livre.`);
            } else {
                showToast(`Temporizador 48h cancelado para "${sku}". Retornado ao fluxo padrão.`);
            }

        } catch (err) {
            console.error('Erro ao alternar temporizador do produto:', err);
            showToast('Erro ao alternar temporizador do produto.', true);
        }
    };

    const toggleTemporizadorProdutosLote = async (skusArray, acao) => {
        if (!Array.isArray(skusArray) || skusArray.length === 0) {
            showToast('Selecione pelo menos um produto.', true);
            return;
        }

        const isAtivar = acao === 'ativar';
        const targetBtn = isAtivar ? btnBatchTimerOn : btnBatchTimerOff;
        const origHtml = targetBtn ? targetBtn.innerHTML : '';
        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> ${isAtivar ? 'Liberando...' : 'Cancelando...'}`;
        }

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/produtos/temporizador/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skus: skusArray, acao })
            });

            if (!resp.ok) throw new Error('Falha ao processar temporizador em lote.');
            const resData = await resp.json();

            const skusSetUpper = new Set(skusArray.map(s => String(s).toUpperCase().trim()));
            allProdutos.forEach(p => {
                if (skusSetUpper.has(String(p.sku || '').toUpperCase().trim())) {
                    p.ignorar_prazos_ate = resData.ignorar_prazos_ate;
                    p.is_temporizador_ativo = isAtivar;
                    p.liberar_indeterminado = false;
                    p.is_indeterminado_ativo = false;

                    if (isAtivar) {
                        p.prazo_efetivo = 0;
                    } else {
                        const pers = Number(p.prazo_personalizado) || 0;
                        const forn = Number(p.prazo_fornecedor) || 0;
                        p.prazo_efetivo = pers > 0 ? pers : forn;
                    }
                }
            });

            selectedProdSkus.clear();
            atualizarResumos();
            renderizarTabelaProdutos();

            if (isAtivar) {
                showToast(`Liberação de 48h ativada para ${skusArray.length} produto(s)! Prazos liberados no ML.`);
            } else {
                showToast(`Liberação de 48h cancelada para ${skusArray.length} produto(s).`);
            }

        } catch (err) {
            console.error('Erro ao processar temporizador em lote:', err);
            showToast('Erro ao processar temporizador em lote.', true);
        } finally {
            if (targetBtn) {
                targetBtn.disabled = false;
                targetBtn.innerHTML = origHtml;
            }
        }
    };

    const toggleIndeterminadoProduto = async (sku, acao) => {
        if (!sku) return;

        const isAtivar = acao === 'ativar';
        const targetUpper = String(sku).toUpperCase().trim();

        const itemProd = allProdutos.find(p => String(p.sku || '').toUpperCase().trim() === targetUpper);
        if (isAtivar && itemProd && (Number(itemProd.estoque_plataforma) || 0) <= 0) {
            showToast(`Não é possível ativar a liberação indeterminada para "${sku}" pois o estoque está zerado ou menor que zero.`, true);
            return;
        }

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/produtos/indeterminado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, acao })
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha ao alternar liberação indeterminada.');
            }
            const resData = await resp.json();

            allProdutos.forEach(p => {
                if (String(p.sku || '').toUpperCase().trim() === targetUpper) {
                    p.liberar_indeterminado = resData.liberar_indeterminado;
                    p.is_indeterminado_ativo = resData.is_indeterminado_ativo;
                    p.is_temporizador_ativo = resData.is_temporizador_ativo;
                    p.ignorar_prazos_ate = resData.ignorar_prazos_ate;

                    if (resData.is_indeterminado_ativo) {
                        p.prazo_efetivo = 0;
                    } else {
                        const pers = Number(p.prazo_personalizado) || 0;
                        const forn = Number(p.prazo_fornecedor) || 0;
                        p.prazo_efetivo = pers > 0 ? pers : forn;
                    }
                }
            });

            atualizarResumos();
            renderizarTabelaProdutos();

            if (isAtivar) {
                showToast(`Liberação por tempo indeterminado ativada para "${sku}"! Prazos liberados no Mercado Livre.`);
            } else {
                showToast(`Liberação indeterminada desligada para "${sku}". Retornado ao fluxo padrão.`);
            }

        } catch (err) {
            console.error('Erro ao alternar liberação indeterminada do produto:', err);
            showToast(err.message || 'Erro ao alternar liberação indeterminada do produto.', true);
        }
    };

    const toggleIndeterminadoProdutosLote = async (skusArray, acao) => {
        if (!Array.isArray(skusArray) || skusArray.length === 0) {
            showToast('Selecione pelo menos um produto.', true);
            return;
        }

        const isAtivar = acao === 'ativar';
        const targetBtn = isAtivar ? btnBatchIndeterminadoOn : btnBatchIndeterminadoOff;
        const origHtml = targetBtn ? targetBtn.innerHTML : '';
        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> ${isAtivar ? 'Liberando...' : 'Cancelando...'}`;
        }

        try {
            const resp = await fetch('/api/anuncios/configurar-prazos/produtos/indeterminado/lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skus: skusArray, acao })
            });

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha ao processar liberação indeterminada em lote.');
            }
            const resData = await resp.json();

            const skusSetUpper = new Set(skusArray.map(s => String(s).toUpperCase().trim()));
            allProdutos.forEach(p => {
                if (skusSetUpper.has(String(p.sku || '').toUpperCase().trim())) {
                    const est = Number(p.estoque_plataforma) || 0;
                    if (isAtivar && est > 0) {
                        p.liberar_indeterminado = true;
                        p.is_indeterminado_ativo = true;
                        p.is_temporizador_ativo = false;
                        p.ignorar_prazos_ate = null;
                        p.prazo_efetivo = 0;
                    } else if (!isAtivar) {
                        p.liberar_indeterminado = false;
                        p.is_indeterminado_ativo = false;
                        const pers = Number(p.prazo_personalizado) || 0;
                        const forn = Number(p.prazo_fornecedor) || 0;
                        p.prazo_efetivo = pers > 0 ? pers : forn;
                    }
                }
            });

            selectedProdSkus.clear();
            atualizarResumos();
            renderizarTabelaProdutos();

            if (isAtivar) {
                showToast(`Liberação indeterminada ativada para ${resData.count} produto(s) com estoque disponível! Prazos liberados no ML.`);
            } else {
                showToast(`Liberação indeterminada cancelada para ${skusArray.length} produto(s).`);
            }

        } catch (err) {
            console.error('Erro ao processar liberação indeterminada em lote:', err);
            showToast(err.message || 'Erro ao processar liberação indeterminada em lote.', true);
        } finally {
            if (targetBtn) {
                targetBtn.disabled = false;
                targetBtn.innerHTML = origHtml;
            }
        }
    };

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

        const itemProd = allProdutos.find(p => String(p.sku || '').toUpperCase().trim() === String(sku).toUpperCase().trim());
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

            const targetUpper = String(sku).toUpperCase().trim();
            allProdutos.forEach(p => {
                if (String(p.sku || '').toUpperCase().trim() === targetUpper) {
                    p.prazo_personalizado = dias;
                    const estoque = Number(p.estoque_plataforma) || 0;
                    const isIndeterminadoAtivo = Boolean(p.liberar_indeterminado) && estoque > 0;
                    const isTimerAtivo = p.ignorar_prazos_ate && new Date(p.ignorar_prazos_ate) > new Date() && !isIndeterminadoAtivo;
                    p.prazo_efetivo = (isIndeterminadoAtivo || isTimerAtivo) ? 0 : (dias > 0 ? dias : (Number(p.prazo_fornecedor) || 0));
                }
            });

            // Atualiza inputs e badges de outros SKUs com mesma grafia visíveis na tela
            document.querySelectorAll(`input.input-prazo-produto`).forEach(inp => {
                if (String(inp.dataset.sku || '').toUpperCase().trim() === targetUpper) {
                    inp.value = dias;
                    if (dias > 0) inp.classList.add('input-has-value');
                    else inp.classList.remove('input-has-value');

                    const tr = inp.closest('tr');
                    if (tr) {
                        const badgeCol = tr.querySelector('.prazo-efetivo-col');
                        if (badgeCol && itemProd) {
                            badgeCol.innerHTML = getBadgePrazoEfetivo(itemProd);
                        }
                    }
                }
            });

            const savedMsg = input.parentElement.querySelector('.prazo-saved-msg');
            if (savedMsg) {
                savedMsg.style.display = 'inline-block';
                setTimeout(() => { savedMsg.style.display = 'none'; }, 1800);
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

    // Ticker para atualizar contagem regressiva dos temporizadores visíveis a cada 1 segundo
    setInterval(() => {
        const containers = document.querySelectorAll('.timer-48h-active-container');
        if (containers.length === 0) return;

        const now = new Date();
        let needsReRender = false;

        containers.forEach(cont => {
            const expireStr = cont.dataset.expire;
            if (!expireStr) return;
            const expireDate = new Date(expireStr);
            const diffMs = expireDate - now;

            if (diffMs <= 0) {
                needsReRender = true;
                return;
            }

            const totalSeconds = Math.floor(diffMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            let timeText = '';
            if (hours >= 24) {
                const days = Math.floor(hours / 24);
                const remHours = hours % 24;
                timeText = `${days}d ${remHours}h`;
            } else {
                timeText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }

            const txtSpan = cont.querySelector('.timer-countdown-text');
            if (txtSpan && txtSpan.textContent !== timeText) {
                txtSpan.textContent = timeText;
            }
        });

        if (needsReRender) {
            atualizarResumos();
            renderizarTabelaProdutos();
        }
    }, 1000);

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
            const executadoPor = (h.executado_por || '').toLowerCase();

            const matchesBusca = !termoBusca || idAnuncio.includes(termoBusca) || sku.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca) || motivo.includes(termoBusca) || executadoPor.includes(termoBusca);
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
                        ${h.executado_por ? `<br><small style="color: #777; font-size: 0.74rem;">${escapeHtml(h.executado_por)}</small>` : ''}
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
    // === BOTÃO: APLICAR PRAZOS NO MERCADO LIVRE ===
    // =============================================

    btnAplicarPrazosAgora.addEventListener('click', async () => {
        const originalText = btnAplicarPrazosAgora.innerHTML;

        try {
            btnAplicarPrazosAgora.disabled = true;
            btnAplicarPrazosAgora.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>Aplicando e Sincronizando...`;

            const resp = await fetch('/api/anuncios/configurar-prazos/aplicar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!resp.ok) throw new Error('Falha ao aplicar prazos.');

            const result = await resp.json();

            const msg = `Processamento concluído! Aplicados: ${result.aplicados || 0} | Removidos: ${result.removidos || 0} | Sincronizados: ${result.sincronizados || (result.aplicados || 0) + (result.removidos || 0)}`;
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
