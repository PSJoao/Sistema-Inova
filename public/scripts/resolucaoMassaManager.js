document.addEventListener('DOMContentLoaded', function() {
    
    // --- MAPEAMENTO DOS ELEMENTOS DA UI ---
    const elements = {
        chaveAcessoInput: document.getElementById('chaveAcessoInput'),
        volumesResolvidosList: document.getElementById('volumesResolvidosList'),
        totalBipadosCount: document.getElementById('totalBipadosCount'),
        btnSalvarResolucoes: document.getElementById('btnSalvarResolucoes')
    };

    // --- ESTADO DA APLICAÇÃO ---
    let state = {
        volumesParaResolver: new Map() // Usaremos um Map para evitar duplicatas e facilitar o acesso
    };

    /**
     * Adiciona um volume à lista para ser resolvido.
     * @param {object} assistencia - Os dados da assistência pai.
     * @param {object} volume - O volume (produto) específico a ser adicionado.
     */
    const adicionarVolumeNaLista = (assistenciaInfo, volume) => {
        if (state.volumesParaResolver.has(volume.id)) {
            ModalSystem.alert(`O volume "${volume.nome_produto}" já está na lista.`, "Item Duplicado");
            return;
        }

        state.volumesParaResolver.set(volume.id, {
            // Usa o ID da assistência que veio junto com o produto
            assistenciaId: volume.assistencia_id, 
            produtoId: volume.id,
            nomeProduto: volume.nome_produto,
            nfOrigem: assistenciaInfo.nf_origem,
            nomePedido: assistenciaInfo.nome_pedido
        });
        
        renderizarLista();
    };

    /**
     * Renderiza a lista de volumes na tela com base no estado atual.
     */
    const renderizarLista = () => {
        elements.volumesResolvidosList.innerHTML = ''; // Limpa a lista
        if (state.volumesParaResolver.size === 0) {
            elements.volumesResolvidosList.innerHTML = '<li class="bipagem-list-item empty">Nenhum volume selecionado.</li>';
        } else {
            state.volumesParaResolver.forEach(item => {
                const li = document.createElement('li');
                li.className = 'bipagem-list-item';
                li.dataset.produtoId = item.produtoId;
                li.innerHTML = `
                    <div class="item-info">
                        <strong>${item.nomeProduto}</strong>
                        <small>NF ${item.nfOrigem} - ${item.nomePedido}</small>
                    </div>
                    <button class="btn btn-icon btn-remove-item" title="Remover da Lista">
                        <i class="fas fa-times-circle text-danger"></i>
                    </button>
                `;
                elements.volumesResolvidosList.appendChild(li);
            });
        }
        atualizarResumo();
    };

    /**
     * Atualiza o contador de volumes e o estado do botão de salvar.
     */
    const atualizarResumo = () => {
        const count = state.volumesParaResolver.size;
        elements.totalBipadosCount.textContent = count;
        elements.btnSalvarResolucoes.disabled = count === 0;
    };

    /**
     * Exibe um modal para o usuário selecionar qual volume de uma assistência de múltiplos volumes ele deseja resolver.
     * @param {object} assistencia - Os dados da assistência e seus produtos.
     */
    const abrirModalSelecaoVolume = (assistencia) => {
        const volumesDisponiveis = assistencia.produtos.filter(p => 
            p.status_volume !== 'Resolvida' && !state.volumesParaResolver.has(p.id)
        );

        if (volumesDisponiveis.length === 0) {
            ModalSystem.alert(`Todos os volumes da NF ${assistencia.nf_origem} já foram resolvidos ou já estão na lista.`, "Nenhum Volume Disponível");
            return;
        }

        // Agora o 'value' do option será o ID do produto (volume)
        const optionsHTML = volumesDisponiveis.map(v => 
            `<option value="${v.id}">${v.nome_produto}</option>`
        ).join('');

        const modalContent = `
            <p>A assistência da NF <strong>${assistencia.nf_origem}</strong> possui múltiplos volumes. Selecione qual deles você está resolvendo:</p>
            <select id="volume-select-modal" class="form-select mt-3">${optionsHTML}</select>
        `;

        ModalSystem.confirm(
            modalContent,
            'Selecionar Volume',
            () => { // onConfirm
                const select = document.getElementById('volume-select-modal');
                // Pega o ID do produto selecionado
                const selectedVolumeId = parseInt(select.value, 10);
                // Encontra o objeto completo do volume na lista de disponíveis
                const volumeSelecionado = volumesDisponiveis.find(p => p.id === selectedVolumeId);
                
                if (volumeSelecionado) {
                    // Passa o objeto do volume e os dados gerais da assistência
                    adicionarVolumeNaLista(volumeSelecionado, assistencia);
                }
            },
            null, // onCancel
            { isHtml: true }
        );
    };

    /**
     * Lida com o evento de bipagem (quando o valor do input muda).
     */
    const handleBipagem = async (event) => {
        const chave = event.target.value.trim();
        if (chave.length !== 44) return;

        ModalSystem.showLoading('Buscando assistência...');
        try {
            const response = await fetch(`/assistencias/api/assistencia-by-chave/${chave}`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Assistência não encontrada.');
            }

            const volumesPendentes = data.produtos.filter(p => p.status_volume !== 'Resolvida');

            if (volumesPendentes.length === 0) {
                throw new Error('Nenhum volume pendente encontrado para esta assistência.');
            }

            // [NOVA LÓGICA] Adiciona TODOS os volumes pendentes à lista de uma vez, sem modal.
            volumesPendentes.forEach(volume => {
                adicionarVolumeNaLista(data, volume);
            });

        } catch (error) {
            ModalSystem.alert(error.message, "Erro na Bipagem");
        } finally {
            ModalSystem.hideLoading();
            event.target.value = '';
            event.target.focus();
        }
    };
    
    /**
     * Envia os volumes selecionados para a API para serem salvos como "Resolvidos".
     */
    const salvarResolucoes = async () => {
        const volumeIds = Array.from(state.volumesParaResolver.keys());
        if (volumeIds.length === 0) return;

        ModalSystem.confirm(
            `Você confirma a resolução de ${volumeIds.length} volume(s)?`,
            'Confirmar Resolução em Massa',
            async () => {
                ModalSystem.showLoading('Salvando...', 'Aguarde');
                try {
                    const response = await fetch('/assistencias/api/bulk-resolve-volumes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ volumeIds })
                    });
                    const result = await response.json();
                    if (!response.ok || !result.success) {
                        throw new Error(result.message || 'Falha ao salvar resoluções.');
                    }
                    ModalSystem.alert(result.message, "Sucesso!");
                    // Limpa o estado e a lista após o sucesso
                    state.volumesParaResolver.clear();
                    renderizarLista();
                } catch (error) {
                    ModalSystem.alert(error.message, "Erro ao Salvar");
                } finally {
                    ModalSystem.hideLoading();
                }
            }
        );
    };

    /**
     * Configura todos os listeners de eventos da página.
     */
    const setupEventListeners = () => {
        elements.chaveAcessoInput.addEventListener('change', handleBipagem);
        elements.btnSalvarResolucoes.addEventListener('click', salvarResolucoes);
        
        elements.volumesResolvidosList.addEventListener('click', (e) => {
            const removeButton = e.target.closest('.btn-remove-item');
            if (removeButton) {
                const listItem = removeButton.closest('.bipagem-list-item');
                const produtoId = parseInt(listItem.dataset.produtoId, 10);
                if (state.volumesParaResolver.has(produtoId)) {
                    state.volumesParaResolver.delete(produtoId);
                    renderizarLista();
                }
            }
        });
    };

    // --- INICIALIZAÇÃO ---
    renderizarLista();
    setupEventListeners();
    elements.chaveAcessoInput.focus();
});