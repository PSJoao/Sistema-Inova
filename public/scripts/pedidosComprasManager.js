// public/scripts/pedidosComprasManager.js
document.addEventListener('DOMContentLoaded', () => {
    let pedidosList = [];
    let rawCatalogProducts = [];
    let currentStatusTab = 'pendente';
    let searchTerm = '';
    let currentSort = 'recentes';
    let editingOrderId = null;
    let editingItems = [];
    let editingSupplierProducts = [];
    let buscaDisponiveisTerm = '';

    // Estado do Modo Romaneio
    let modoRomaneioAtivo = false;
    const pedidosSelecionadosRomaneio = new Set();

    // Elementos do DOM
    const cardsContainer = document.getElementById('pedidosCardsContainer');
    const emptyState = document.getElementById('pedidosEmptyState');
    const emptyStateDesc = document.getElementById('emptyStateDesc');
    const buscaInput = document.getElementById('buscaPedidosInput');
    const selectStatus = document.getElementById('selectStatusPedidos');
    const selectOrdenacao = document.getElementById('selectOrdenacaoPedidos');

    // Elementos do Modo Romaneio
    const pedidosNormalActions = document.getElementById('pedidosNormalActions');
    const romaneioModeActions = document.getElementById('romaneioModeActions');
    const btnMontarRomaneio = document.getElementById('btnMontarRomaneio');
    const btnCancelarRomaneio = document.getElementById('btnCancelarRomaneio');
    const btnFinalizarRomaneio = document.getElementById('btnFinalizarRomaneio');
    const romaneioSelectedCount = document.getElementById('romaneioSelectedCount');

    // Modal de Edição
    const modalEdit = document.getElementById('modalEditarPedido');
    const btnFecharModal = document.getElementById('btnFecharModalEdit');
    const btnCancelarModal = document.getElementById('btnCancelarModalEdit');
    const btnSalvarModal = document.getElementById('btnSalvarModalEdit');
    const modalNumeroPedido = document.getElementById('modalEditNumeroPedido');
    const modalFabricaNome = document.getElementById('modalEditFabricaNome');
    const modalTotalItens = document.getElementById('modalEditTotalItens');
    const modalTotalUnidades = document.getElementById('modalEditTotalUnidades');
    const modalItemsTableBody = document.getElementById('modalEditItemsTableBody');
    const modalDisponiveisTableBody = document.getElementById('modalDisponiveisTableBody');
    const modalBuscaDisponiveis = document.getElementById('modalBuscaDisponiveis');
    const modalObservacoes = document.getElementById('modalEditObservacoes');

    // =============================================
    // === CARREGAMENTO INICIAL ===
    // =============================================

    async function carregarCatalogoProdutos() {
        try {
            const res = await fetch('/analise-compras/api/produtos');
            const result = await res.json();
            if (result.success && Array.isArray(result.data)) {
                rawCatalogProducts = result.data;
            }
        } catch (err) {
            console.warn('Erro ao carregar catálogo completo de produtos para o modal:', err);
        }
    }

    async function carregarPedidos() {
        if (cardsContainer) {
            cardsContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                    <i class="fas fa-spinner fa-spin fa-2x mb-3" style="color: var(--accent-orange);"></i>
                    <p>Carregando pedidos...</p>
                </div>
            `;
        }

        try {
            const resPedidos = await fetch('/analise-compras/api/pedidos?status=todos');
            const data = await resPedidos.json();

            if (data.success) {
                pedidosList = data.pedidos || [];
                filtrarEOrdenar();
            } else {
                throw new Error(data.message || 'Erro ao buscar pedidos');
            }
        } catch (error) {
            console.error('Erro ao carregar pedidos:', error);
            if (cardsContainer) {
                cardsContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-danger);">
                        <i class="fas fa-exclamation-triangle fa-2x mb-3"></i>
                        <p>Erro ao carregar a lista de pedidos. Tente novamente.</p>
                    </div>
                `;
            }
        }
    }

    // =============================================
    // === FILTRAGEM E ORDENAÇÃO ===
    // =============================================

    function normalizarBusca(txt) {
        if (!txt) return '';
        return String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    function extrairChaveFornecedor(nome) {
        if (!nome) return '';
        let limpo = String(nome).trim().replace(/\s+/g, ' ');
        const palavras = limpo.split(' ').map(p => p.trim()).filter(Boolean);
        if (palavras.length === 0) return '';

        const palavrasIgnoraveis = new Set([
            'IND', 'IND.', 'INDUSTRIA', 'INDÚSTRIA', 
            'COMERCIO', 'COMÉRCIO', 'COMERCIAL', 
            'DISTRIBUIDORA', 'FABRICA', 'FÁBRICA', 
            'CIA', 'CIA.', 'COMPANHIA', 'MANUFATURA',
            'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'EM', 'P/',
            'MOVEIS', 'MÓVEIS', 'ESTOFADOS', 'COLCHOES', 'COLCHÕES'
        ]);

        let palavrasSignificativas = [];
        for (let i = 0; i < palavras.length; i++) {
            const pUpper = palavras[i].toUpperCase().replace(/[.,\-_/]/g, '');
            if (!palavrasIgnoraveis.has(pUpper)) {
                palavrasSignificativas = palavras.slice(i);
                break;
            }
        }

        if (palavrasSignificativas.length === 0) {
            palavrasSignificativas = palavras;
        }

        const p1 = palavrasSignificativas[0];
        const p1Clean = p1.toUpperCase().replace(/[.,\-_/]/g, '');

        if ((p1Clean.length <= 2 || p1.includes('.')) && palavrasSignificativas.length > 1) {
            const p2 = palavrasSignificativas[1];
            return `${p1Clean} ${p2.toUpperCase().replace(/[.,\-_/]/g, '')}`;
        }

        return p1Clean;
    }

    function filtrarEOrdenar() {
        const termo = normalizarBusca(searchTerm);

        let filtrados = pedidosList.filter(ped => {
            // Filtro de Status
            if (currentStatusTab !== 'todos' && ped.status !== currentStatusTab) {
                return false;
            }

            // Filtro de Texto
            if (termo) {
                const num = normalizarBusca(ped.numero_pedido || '');
                const fab = normalizarBusca(ped.nome_fabrica || '');
                const obs = normalizarBusca(ped.observacoes || '');
                
                let matchItem = false;
                const itens = Array.isArray(ped.itens) ? ped.itens : [];
                for (const it of itens) {
                    const sku = normalizarBusca(it.sku || '');
                    const nome = normalizarBusca(it.nome || '');
                    if (sku.includes(termo) || nome.includes(termo)) {
                        matchItem = true;
                        break;
                    }
                }

                if (!num.includes(termo) && !fab.includes(termo) && !obs.includes(termo) && !matchItem) {
                    return false;
                }
            }

            return true;
        });

        // Ordenação
        filtrados.sort((a, b) => {
            if (currentSort === 'antigos') {
                return new Date(a.created_at) - new Date(b.created_at);
            } else if (currentSort === 'maior_qtd') {
                return (b.total_unidades || 0) - (a.total_unidades || 0);
            } else if (currentSort === 'fabrica') {
                return (a.nome_fabrica || '').localeCompare(b.nome_fabrica || '');
            } else {
                // 'recentes' padrão
                return new Date(b.created_at) - new Date(a.created_at);
            }
        });

        renderCards(filtrados);
    }

    // =============================================
    // === RENDERIZAÇÃO DOS CARDS ===
    // =============================================

    function formatDataRelativa(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function renderCards(pedidos) {
        if (!cardsContainer) return;

        if (pedidos.length === 0) {
            cardsContainer.innerHTML = '';
            cardsContainer.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'block';
                if (emptyStateDesc) {
                    if (currentStatusTab === 'pendente') {
                        emptyStateDesc.textContent = 'Não há nenhum pedido pendente no momento.';
                    } else if (currentStatusTab === 'finalizado') {
                        emptyStateDesc.textContent = 'Nenhum pedido finalizado encontrado no histórico.';
                    } else {
                        emptyStateDesc.textContent = 'Nenhum pedido corresponde à sua pesquisa.';
                    }
                }
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        cardsContainer.style.display = 'grid';

        cardsContainer.innerHTML = pedidos.map(ped => {
            const isPendente = ped.status === 'pendente';
            const isFinalizado = ped.status === 'finalizado';
            const itens = Array.isArray(ped.itens) ? ped.itens : [];
            const previewLimit = 4;
            const previewItens = itens.slice(0, previewLimit);
            const hiddenItensCount = itens.length - previewLimit;

            let statusBadgeHtml = '';
            let cardExtraClasses = '';

            if (modoRomaneioAtivo) {
                if (isPendente) {
                    const isSelected = pedidosSelecionadosRomaneio.has(ped.id);
                    cardExtraClasses = `card-romaneio-selectable ${isSelected ? 'card-romaneio-selected' : ''}`;
                    statusBadgeHtml = `
                        <label class="romaneio-checkbox-container" onclick="event.stopPropagation();">
                            <input type="checkbox" class="romaneio-card-checkbox" data-pedido-id="${ped.id}" ${isSelected ? 'checked' : ''}>
                            <span class="romaneio-checkbox-text">${isSelected ? 'Selecionado' : 'Selecionar'}</span>
                        </label>
                    `;
                } else {
                    cardExtraClasses = 'card-romaneio-disabled';
                    statusBadgeHtml = `<span class="status-badge status-finalizado">Finalizado</span>`;
                }
            } else {
                if (isPendente) {
                    statusBadgeHtml = `<span class="status-badge status-pendente">Pendente</span>`;
                } else if (isFinalizado) {
                    statusBadgeHtml = `<span class="status-badge status-finalizado">Finalizado</span>`;
                } else {
                    statusBadgeHtml = `<span class="status-badge status-cancelado">Cancelado</span>`;
                }
            }

            const itemsRowsHtml = previewItens.map(it => `
                <div class="pedido-item-row">
                    <span class="pedido-item-sku">${escapeHtml(it.sku || '-')}</span>
                    <span class="pedido-item-nome" title="${escapeHtml(it.nome || '')}">${escapeHtml(it.nome || '-')}</span>
                    <span class="pedido-item-qtd">${it.quantidade} un</span>
                </div>
            `).join('');

            const expandBtnHtml = hiddenItensCount > 0 ? `
                <button type="button" class="pedido-expand-items-btn" data-pedido-id="${ped.id}">
                    + ${hiddenItensCount} itens adicionais
                </button>
            ` : '';

            const obsHtml = ped.observacoes ? `
                <div class="pedido-card-obs" title="${escapeHtml(ped.observacoes)}">
                    "${escapeHtml(ped.observacoes)}"
                </div>
            ` : '';

            const actionButtonsHtml = modoRomaneioAtivo ? `
                <div class="pedido-card-footer" style="background: ${pedidosSelecionadosRomaneio.has(ped.id) ? 'rgba(240,124,0,0.15)' : 'rgba(0,0,0,0.12)'};">
                    <span style="font-size: 0.78rem; font-weight: 600; color: ${isPendente ? 'var(--accent-orange)' : 'var(--text-muted)'};">
                        ${isPendente ? (pedidosSelecionadosRomaneio.has(ped.id) ? '✓ Incluído no Romaneio' : 'Clique no card para incluir') : 'Indisponível para Romaneio'}
                    </span>
                    <button type="button" class="btn btn-sm btn-outline-accent card-btn-pdf" data-pedido-id="${ped.id}" title="Visualizar PDF deste Pedido">
                        <i class="fas fa-file-pdf"></i>
                    </button>
                </div>
            ` : `
                <div class="pedido-card-footer">
                    <button type="button" class="btn btn-sm btn-outline-accent card-btn-pdf" data-pedido-id="${ped.id}" title="Baixar PDF">
                        <i class="fas fa-file-pdf me-1"></i>PDF
                    </button>
                    ${isPendente ? `
                        <button type="button" class="btn btn-sm btn-secondary card-btn-edit" data-pedido-id="${ped.id}" title="Editar Itens do Pedido">
                            <i class="fas fa-edit me-1"></i>Editar
                        </button>
                        <button type="button" class="btn btn-sm btn-success card-btn-finalizar" data-pedido-id="${ped.id}" style="background-color: #28a745; border-color: #28a745;" title="Finalizar Pedido">
                            <i class="fas fa-check me-1"></i>Finalizar
                        </button>
                    ` : `
                        <span style="font-size: 0.76rem; color: var(--text-muted);">
                            Finalizado em: ${formatDataRelativa(ped.finalizado_em)}
                        </span>
                    `}
                </div>
            `;

            return `
                <div class="pedido-card ${isFinalizado ? 'card-finalizado' : ''} ${cardExtraClasses}" id="card-pedido-${ped.id}" data-pedido-id="${ped.id}">
                    <div class="pedido-card-header">
                        <div>
                            <h3 class="pedido-card-fabrica">
                                ${escapeHtml(ped.nome_fabrica)}
                            </h3>
                            <span class="pedido-card-numero">${escapeHtml(ped.numero_pedido || `#${ped.id}`)}</span>
                            <span class="pedido-card-date">${formatDataRelativa(ped.created_at)}</span>
                        </div>
                        <div>
                            ${statusBadgeHtml}
                        </div>
                    </div>

                    <div class="pedido-card-body">
                        <div class="pedido-metrics-row">
                            <span><strong>${ped.total_itens || itens.length}</strong> produtos</span>
                            <span><strong style="color: var(--accent-orange);">${(ped.total_unidades || 0).toLocaleString('pt-BR')}</strong> peças</span>
                        </div>

                        <div class="pedido-items-preview" id="preview-items-${ped.id}">
                            ${itemsRowsHtml}
                            ${expandBtnHtml}
                        </div>

                        ${obsHtml}
                    </div>

                    ${actionButtonsHtml}
                </div>
            `;
        }).join('');

        vincularEventosCards();
    }

    function vincularEventosCards() {
        // Se estiver no Modo Romaneio, vincular clique de seleção aos cards pendentes
        if (modoRomaneioAtivo) {
            document.querySelectorAll('.pedido-card.card-romaneio-selectable').forEach(card => {
                const id = parseInt(card.getAttribute('data-pedido-id'), 10);
                card.addEventListener('click', (e) => {
                    // Evita disparar se o usuário clicou no botão de PDF ou expandir
                    if (e.target.closest('.card-btn-pdf') || e.target.closest('.pedido-expand-items-btn')) {
                        return;
                    }
                    toggleSelecaoPedidoRomaneio(id);
                });
            });

            document.querySelectorAll('.romaneio-card-checkbox').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const id = parseInt(chk.getAttribute('data-pedido-id'), 10);
                    toggleSelecaoPedidoRomaneio(id, chk.checked);
                });
            });
        }

        // 1. Baixar PDF
        document.querySelectorAll('.card-btn-pdf').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-pedido-id');
                window.open(`/analise-compras/pedidos/${id}/pdf`, '_blank');
            });
        });

        // 2. Editar Pedido (modo normal)
        document.querySelectorAll('.card-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-pedido-id');
                abrirModalEdicao(id);
            });
        });

        // 3. Finalizar Pedido (modo normal)
        document.querySelectorAll('.card-btn-finalizar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-pedido-id');
                finalizarPedidoAction(id);
            });
        });

        // 4. Expandir Itens do Preview
        document.querySelectorAll('.pedido-expand-items-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-pedido-id');
                const ped = pedidosList.find(p => String(p.id) === String(id));
                if (!ped) return;

                const previewContainer = document.getElementById(`preview-items-${id}`);
                if (!previewContainer) return;

                const itens = Array.isArray(ped.itens) ? ped.itens : [];
                previewContainer.innerHTML = itens.map(it => `
                    <div class="pedido-item-row">
                        <span class="pedido-item-sku">${escapeHtml(it.sku || '-')}</span>
                        <span class="pedido-item-nome" title="${escapeHtml(it.nome || '')}">${escapeHtml(it.nome || '-')}</span>
                        <span class="pedido-item-qtd">${it.quantidade} un</span>
                    </div>
                `).join('');
            });
        });
    }

    // =============================================
    // === AÇÃO DE FINALIZAR PEDIDO ===
    // =============================================

    function finalizarPedidoAction(id) {
        const ped = pedidosList.find(p => String(p.id) === String(id));
        const num = ped ? (ped.numero_pedido || `#${ped.id}`) : `#${id}`;

        const mensagem = `Deseja realmente marcar o pedido <strong>${escapeHtml(num)}</strong> como <strong>FINALIZADO</strong>?<br><br><small style="color: var(--text-muted);">Ao finalizar, as quantidades deste pedido deixarão de constar como "chegando" no estoque e o pedido será arquivado no histórico.</small>`;

        if (typeof ModalSystem !== 'undefined' && ModalSystem.confirm) {
            ModalSystem.confirm(
                mensagem,
                'Finalizar Pedido',
                async () => {
                    if (typeof ModalSystem.showLoading === 'function') {
                        ModalSystem.showLoading('Finalizando pedido e atualizando estoque...', 'Processando');
                    }
                    try {
                        const res = await fetch(`/analise-compras/api/pedidos/${id}/finalizar`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        const data = await res.json();
                        if (typeof ModalSystem.hideLoading === 'function') {
                            ModalSystem.hideLoading();
                        }

                        if (data.success) {
                            mostrarNotificacao(data.message || 'Pedido finalizado com sucesso!', 'success');
                            carregarPedidos();
                        } else {
                            throw new Error(data.message || 'Erro ao finalizar pedido');
                        }
                    } catch (error) {
                        if (typeof ModalSystem.hideLoading === 'function') {
                            ModalSystem.hideLoading();
                        }
                        console.error('Erro ao finalizar:', error);
                        if (typeof ModalSystem.alert === 'function') {
                            ModalSystem.alert('Erro ao finalizar pedido: ' + error.message, 'Erro');
                        } else {
                            mostrarNotificacao('Erro ao finalizar pedido: ' + error.message, 'error');
                        }
                    }
                },
                null,
                { confirmText: 'Sim, Finalizar', cancelText: 'Voltar' }
            );
        } else {
            // Fallback caso ModalSystem não esteja presente
            if (confirm(`Deseja realmente finalizar o pedido ${num}?`)) {
                fetch(`/analise-compras/api/pedidos/${id}/finalizar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                }).then(r => r.json()).then(data => {
                    if (data.success) {
                        mostrarNotificacao('Pedido finalizado com sucesso!', 'success');
                        carregarPedidos();
                    }
                });
            }
        }
    }

    // =============================================
    // === MODAL DE EDIÇÃO DE PEDIDO ===
    // =============================================

    async function abrirModalEdicao(id) {
        const ped = pedidosList.find(p => String(p.id) === String(id));
        if (!ped) return;

        // Feedback visual elegante com o modal do sistema
        if (typeof ModalSystem !== 'undefined' && ModalSystem.showLoading) {
            ModalSystem.showLoading('Carregando produtos do fornecedor...', 'Abrindo Pedido');
        }

        try {
            editingOrderId = id;
            editingItems = JSON.parse(JSON.stringify(Array.isArray(ped.itens) ? ped.itens : []));
            buscaDisponiveisTerm = '';

            if (modalNumeroPedido) modalNumeroPedido.textContent = ped.numero_pedido || `#${ped.id}`;
            if (modalFabricaNome) modalFabricaNome.textContent = ped.nome_fabrica;
            if (modalObservacoes) modalObservacoes.value = ped.observacoes || '';
            if (modalBuscaDisponiveis) modalBuscaDisponiveis.value = '';

            // Se o catálogo geral ainda não foi carregado, carrega agora
            if (rawCatalogProducts.length === 0) {
                await carregarCatalogoProdutos();
            }

            // Filtra todos os produtos pertencentes a este fornecedor
            const chavePedido = extrairChaveFornecedor(ped.nome_fabrica);
            const fabNorm = normalizarBusca(ped.nome_fabrica);

            editingSupplierProducts = rawCatalogProducts.filter(p => {
                const chaveProd = p.fornecedor_chave || (p.fornecedor_nome ? extrairChaveFornecedor(p.fornecedor_nome) : '');
                const nomeNorm = normalizarBusca(p.fornecedor_nome || '');
                const matchChave = chaveProd && chavePedido && chaveProd === chavePedido;
                const matchNome = nomeNorm && fabNorm && (nomeNorm.includes(fabNorm) || fabNorm.includes(nomeNorm));
                const matchId = ped.fornecedor_id && p.fornecedor_id && String(p.fornecedor_id) === String(ped.fornecedor_id);
                return matchChave || matchNome || matchId;
            });

            renderModalItens();
        } catch (err) {
            console.error('Erro ao abrir modal de edição:', err);
        } finally {
            if (typeof ModalSystem !== 'undefined' && ModalSystem.hideLoading) {
                ModalSystem.hideLoading();
            }
            if (modalEdit) modalEdit.style.display = 'flex';
        }
    }

    function fecharModalEdicao() {
        if (modalEdit) modalEdit.style.display = 'none';
        editingOrderId = null;
        editingItems = [];
        editingSupplierProducts = [];
        buscaDisponiveisTerm = '';
    }

    function renderModalItens() {
        // --- 1. SEÇÃO DE ITENS NO PEDIDO ---
        const totalUnidades = editingItems.reduce((acc, it) => acc + (parseInt(it.quantidade, 10) || 0), 0);
        if (modalTotalItens) modalTotalItens.textContent = editingItems.length;
        if (modalTotalUnidades) modalTotalUnidades.textContent = `${totalUnidades.toLocaleString('pt-BR')} un`;

        if (modalItemsTableBody) {
            if (editingItems.length === 0) {
                modalItemsTableBody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center text-muted" style="padding: 16px; font-size: 0.8rem;">
                            Nenhum item restante no pedido. Adicione itens da tabela abaixo.
                        </td>
                    </tr>
                `;
            } else {
                modalItemsTableBody.innerHTML = editingItems.map((it, idx) => `
                    <tr>
                        <td>
                            <span style="font-family: monospace; font-weight: 600; color: #fff; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 0.76rem;">
                                ${escapeHtml(it.sku || '-')}
                            </span>
                        </td>
                        <td>
                            <span style="color: var(--text-primary); font-weight: 500;">${escapeHtml(it.nome || '-')}</span>
                        </td>
                        <td class="text-center">
                            <input type="number" class="form-control form-control-sm modal-input-qtd" data-index="${idx}" min="1" value="${it.quantidade}" />
                        </td>
                        <td class="text-center">
                            <button type="button" class="btn-remove-item" data-index="${idx}" title="Remover item do pedido">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');

                // Eventos de alteração de quantidade
                modalItemsTableBody.querySelectorAll('.modal-input-qtd').forEach(input => {
                    input.addEventListener('input', () => {
                        const idx = parseInt(input.getAttribute('data-index'), 10);
                        const novaQtd = parseInt(input.value, 10) || 0;
                        if (editingItems[idx]) {
                            editingItems[idx].quantidade = Math.max(0, novaQtd);
                            const totalU = editingItems.reduce((acc, it) => acc + (parseInt(it.quantidade, 10) || 0), 0);
                            if (modalTotalUnidades) modalTotalUnidades.textContent = `${totalU.toLocaleString('pt-BR')} un`;
                        }
                    });
                });

                // Eventos de remoção (move em tempo real para a tabela de disponíveis)
                modalItemsTableBody.querySelectorAll('.btn-remove-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const idx = parseInt(btn.getAttribute('data-index'), 10);
                        editingItems.splice(idx, 1);
                        renderModalItens();
                    });
                });
            }
        }

        // --- 2. SEÇÃO DE OUTROS PRODUTOS DO FORNECEDOR (DISPONÍVEIS) ---
        if (modalDisponiveisTableBody) {
            // Produtos que NÃO estão em editingItems
            const itensDisponiveis = editingSupplierProducts.filter(p => {
                const skuProd = p.sku ? String(p.sku).trim().toUpperCase() : null;
                const pId = p.parent_product_bling_id ? String(p.parent_product_bling_id) : null;

                const jaEstaNoPedido = editingItems.some(it => {
                    const itSku = it.sku ? String(it.sku).trim().toUpperCase() : null;
                    const itParentId = it.parent_product_bling_id ? String(it.parent_product_bling_id) : null;
                    return (skuProd && itSku && skuProd === itSku) || (pId && itParentId && pId === itParentId);
                });

                return !jaEstaNoPedido;
            });

            // Filtro de busca na tabela de disponíveis
            const termoBusca = normalizarBusca(buscaDisponiveisTerm);
            const filtradosDisponiveis = itensDisponiveis.filter(p => {
                if (!termoBusca) return true;
                const sku = normalizarBusca(p.sku || '');
                const nome = normalizarBusca(p.produto_nome || '');
                return sku.includes(termoBusca) || nome.includes(termoBusca);
            });

            if (filtradosDisponiveis.length === 0) {
                modalDisponiveisTableBody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center text-muted" style="padding: 16px; font-size: 0.8rem;">
                            ${itensDisponiveis.length === 0 ? 'Todos os produtos deste fornecedor já estão inclusos no pedido.' : 'Nenhum produto disponível corresponde ao filtro.'}
                        </td>
                    </tr>
                `;
            } else {
                modalDisponiveisTableBody.innerHTML = filtradosDisponiveis.map((p, idx) => `
                    <tr>
                        <td>
                            <span style="font-family: monospace; font-weight: 600; color: var(--text-primary); background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px; font-size: 0.76rem;">
                                ${escapeHtml(p.sku || '-')}
                            </span>
                        </td>
                        <td>
                            <span style="color: var(--text-secondary); font-size: 0.8rem;">${escapeHtml(p.produto_nome || '-')}</span>
                        </td>
                        <td class="text-center">
                            <input type="number" class="form-control form-control-sm modal-input-qtd input-add-qtd-row" data-index="${idx}" min="1" value="1" />
                        </td>
                        <td class="text-center">
                            <button type="button" class="btn-add-item-modal" data-index="${idx}" title="Adicionar ao pedido">
                                <i class="fas fa-plus me-1"></i>Adicionar
                            </button>
                        </td>
                    </tr>
                `).join('');

                // Evento ao clicar em + Adicionar
                modalDisponiveisTableBody.querySelectorAll('.btn-add-item-modal').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const idx = parseInt(btn.getAttribute('data-index'), 10);
                        const prod = filtradosDisponiveis[idx];
                        if (!prod) return;

                        const row = btn.closest('tr');
                        const inputQtd = row ? row.querySelector('.input-add-qtd-row') : null;
                        const qtd = inputQtd ? parseInt(inputQtd.value, 10) || 1 : 1;

                        editingItems.push({
                            sku: prod.sku || null,
                            nome: prod.produto_nome || prod.sku,
                            parent_product_bling_id: prod.parent_product_bling_id || null,
                            quantidade: Math.max(1, qtd)
                        });

                        renderModalItens();
                    });
                });
            }
        }
    }

    // Busca rápida nos itens disponíveis do fornecedor
    if (modalBuscaDisponiveis) {
        modalBuscaDisponiveis.addEventListener('input', () => {
            buscaDisponiveisTerm = modalBuscaDisponiveis.value;
            renderModalItens();
        });
    }

    // Salvar alterações do modal
    if (btnSalvarModal) {
        btnSalvarModal.addEventListener('click', async () => {
            if (!editingOrderId) return;

            const itensValidos = editingItems.filter(it => (parseInt(it.quantidade, 10) || 0) > 0);
            if (itensValidos.length === 0) {
                if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
                    ModalSystem.alert('O pedido deve conter pelo menos 1 produto com quantidade maior que 0.', 'Atenção');
                } else {
                    alert('O pedido deve conter pelo menos 1 produto com quantidade maior que 0.');
                }
                return;
            }

            btnSalvarModal.disabled = true;
            btnSalvarModal.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Salvando...';

            try {
                const res = await fetch(`/analise-compras/api/pedidos/${editingOrderId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: itensValidos,
                        observacoes: modalObservacoes ? modalObservacoes.value.trim() : null
                    })
                });
                const data = await res.json();

                if (data.success) {
                    mostrarNotificacao('Pedido atualizado com sucesso! Estoque chegando recalculado.', 'success');
                    fecharModalEdicao();
                    carregarPedidos();
                } else {
                    throw new Error(data.message || 'Erro ao atualizar pedido');
                }
            } catch (error) {
                console.error('Erro ao salvar:', error);
                if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
                    ModalSystem.alert('Erro ao salvar alterações: ' + error.message, 'Erro');
                } else {
                    alert('Erro ao salvar alterações: ' + error.message);
                }
            } finally {
                btnSalvarModal.disabled = false;
                btnSalvarModal.innerHTML = '<i class="fas fa-save me-1"></i> Salvar Alterações';
            }
        });
    }

    if (btnFecharModal) btnFecharModal.addEventListener('click', fecharModalEdicao);
    if (btnCancelarModal) btnCancelarModal.addEventListener('click', fecharModalEdicao);

    // =============================================
    // === CONTROLE DO MODO ROMANEIO ===
    // =============================================

    function ativarModoRomaneio() {
        modoRomaneioAtivo = true;
        pedidosSelecionadosRomaneio.clear();

        if (pedidosNormalActions) pedidosNormalActions.style.display = 'none';
        if (romaneioModeActions) romaneioModeActions.style.display = 'flex';

        // Garante que a listagem exiba os pedidos pendentes
        if (selectStatus && currentStatusTab === 'finalizado') {
            selectStatus.value = 'pendente';
            currentStatusTab = 'pendente';
        }

        atualizarContadorRomaneio();
        filtrarEOrdenar();

        mostrarNotificacao('Modo Romaneio ativado. Selecione os pedidos pendentes para a carga.', 'info');
    }

    function desativarModoRomaneio() {
        modoRomaneioAtivo = false;
        pedidosSelecionadosRomaneio.clear();

        if (romaneioModeActions) romaneioModeActions.style.display = 'none';
        if (pedidosNormalActions) pedidosNormalActions.style.display = 'flex';

        filtrarEOrdenar();
    }

    function toggleSelecaoPedidoRomaneio(id, forceState = null) {
        const ped = pedidosList.find(p => p.id === id);
        if (!ped || ped.status !== 'pendente') return;

        if (forceState !== null) {
            if (forceState) {
                pedidosSelecionadosRomaneio.add(id);
            } else {
                pedidosSelecionadosRomaneio.delete(id);
            }
        } else {
            if (pedidosSelecionadosRomaneio.has(id)) {
                pedidosSelecionadosRomaneio.delete(id);
            } else {
                pedidosSelecionadosRomaneio.add(id);
            }
        }

        // Atualização visual rápida do card
        const card = document.getElementById(`card-pedido-${id}`);
        const isSelected = pedidosSelecionadosRomaneio.has(id);
        if (card) {
            if (isSelected) {
                card.classList.add('card-romaneio-selected');
            } else {
                card.classList.remove('card-romaneio-selected');
            }

            const chk = card.querySelector('.romaneio-card-checkbox');
            if (chk) chk.checked = isSelected;

            const chkText = card.querySelector('.romaneio-checkbox-text');
            if (chkText) chkText.textContent = isSelected ? 'Selecionado' : 'Selecionar';

            const footerText = card.querySelector('.pedido-card-footer span');
            if (footerText) {
                footerText.textContent = isSelected ? '✓ Incluído no Romaneio' : 'Clique no card para incluir';
            }
            const footer = card.querySelector('.pedido-card-footer');
            if (footer) {
                footer.style.background = isSelected ? 'rgba(240,124,0,0.15)' : 'rgba(0,0,0,0.12)';
            }
        }

        atualizarContadorRomaneio();
    }

    function atualizarContadorRomaneio() {
        const totalPeds = pedidosSelecionadosRomaneio.size;
        let totalPecas = 0;

        pedidosSelecionadosRomaneio.forEach(id => {
            const ped = pedidosList.find(p => p.id === id);
            if (ped) {
                totalPecas += (parseInt(ped.total_unidades, 10) || 0);
            }
        });

        if (romaneioSelectedCount) {
            romaneioSelectedCount.textContent = `${totalPeds} pedido(s) selecionado(s) (${totalPecas.toLocaleString('pt-BR')} peças)`;
        }

        if (btnFinalizarRomaneio) {
            btnFinalizarRomaneio.disabled = (totalPeds === 0);
            btnFinalizarRomaneio.innerHTML = `<i class="fas fa-file-pdf me-2"></i>Finalizar Romaneio (${totalPeds})`;
        }
    }

    async function finalizarRomaneioAction() {
        if (pedidosSelecionadosRomaneio.size === 0) {
            if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
                ModalSystem.alert('Por favor, selecione pelo menos um pedido pendente para compor o romaneio.', 'Atenção');
            } else {
                alert('Selecione pelo menos um pedido para o romaneio.');
            }
            return;
        }

        const idsArray = Array.from(pedidosSelecionadosRomaneio);

        if (typeof ModalSystem !== 'undefined' && ModalSystem.showLoading) {
            ModalSystem.showLoading('Consolidando itens dos pedidos e calculando pesos da carga...', 'Gerando Romaneio de Carga');
        }

        if (btnFinalizarRomaneio) {
            btnFinalizarRomaneio.disabled = true;
            btnFinalizarRomaneio.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando Romaneio...';
        }

        try {
            const res = await fetch('/analise-compras/gerar-romaneio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedidosIds: idsArray })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || 'Erro ao gerar PDF do romaneio');
            }

            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            // Dispara download automático do PDF
            const dataAgora = new Date().toISOString().slice(2, 10).replace(/-/g, '');
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `Romaneio_Carga_${dataAgora}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);

            if (typeof ModalSystem !== 'undefined' && ModalSystem.hideLoading) {
                ModalSystem.hideLoading();
            }

            mostrarNotificacao(`Romaneio com ${idsArray.length} pedidos gerado com sucesso!`, 'success');
            desativarModoRomaneio();
        } catch (error) {
            if (typeof ModalSystem !== 'undefined' && ModalSystem.hideLoading) {
                ModalSystem.hideLoading();
            }
            console.error('Erro ao gerar romaneio:', error);
            if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
                ModalSystem.alert('Erro ao gerar Romaneio: ' + error.message, 'Erro');
            } else {
                alert('Erro ao gerar Romaneio: ' + error.message);
            }
        } finally {
            if (btnFinalizarRomaneio) {
                btnFinalizarRomaneio.disabled = false;
                btnFinalizarRomaneio.innerHTML = `<i class="fas fa-file-pdf me-2"></i>Finalizar Romaneio (${pedidosSelecionadosRomaneio.size})`;
            }
        }
    }

    // Listeners do Modo Romaneio
    if (btnMontarRomaneio) btnMontarRomaneio.addEventListener('click', ativarModoRomaneio);
    if (btnCancelarRomaneio) btnCancelarRomaneio.addEventListener('click', desativarModoRomaneio);
    if (btnFinalizarRomaneio) btnFinalizarRomaneio.addEventListener('click', finalizarRomaneioAction);

    // =============================================
    // === LISTENERS DA PÁGINA ===
    // =============================================

    // Filtro de Status (Select)
    if (selectStatus) {
        selectStatus.addEventListener('change', () => {
            currentStatusTab = selectStatus.value || 'pendente';
            filtrarEOrdenar();
        });
    }

    // Busca Rápida
    if (buscaInput) {
        buscaInput.addEventListener('input', () => {
            searchTerm = buscaInput.value;
            filtrarEOrdenar();
        });
    }

    // Ordenação
    if (selectOrdenacao) {
        selectOrdenacao.addEventListener('change', () => {
            currentSort = selectOrdenacao.value;
            filtrarEOrdenar();
        });
    }

    // =============================================
    // === NOTIFICAÇÕES E UTILITÁRIOS ===
    // =============================================

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function mostrarNotificacao(mensagem, tipo = 'success') {
        const toast = document.createElement('div');
        toast.className = `custom-toast toast-${tipo}`;
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.padding = '10px 18px';
        toast.style.borderRadius = '6px';
        toast.style.fontSize = '0.86rem';
        toast.style.fontWeight = '600';
        toast.style.zIndex = '9999';
        toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '8px';
        toast.style.animation = 'modalFadeIn 0.2s ease-out';

        if (tipo === 'success') {
            toast.style.background = '#15803d';
            toast.style.color = '#fff';
            toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(mensagem)}</span>`;
        } else if (tipo === 'info') {
            toast.style.background = '#0369a1';
            toast.style.color = '#fff';
            toast.innerHTML = `<i class="fas fa-info-circle"></i> <span>${escapeHtml(mensagem)}</span>`;
        } else {
            toast.style.background = '#b91c1c';
            toast.style.color = '#fff';
            toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> <span>${escapeHtml(mensagem)}</span>`;
        }

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Inicialização
    carregarPedidos();
});

