// public/scripts/conferenciaManager.js

document.addEventListener('DOMContentLoaded', () => {
    
    // --- ELEMENTOS DOM ---
    const elements = {
        input: document.getElementById('conferenciaInput'),
        activePanel: document.getElementById('active-note-panel'),
        emptyPanel: document.getElementById('empty-state-panel'),
        
        // Dados da Nota Ativa
        lblNfeNumber: document.getElementById('active-nfe-number'),
        progressBar: document.getElementById('active-progress-bar'),
        volumesList: document.getElementById('active-volumes-list'),
        btnCloseNote: document.getElementById('btn-close-active-note'),
        
        // Lista Pendentes
        pendingList: document.getElementById('pending-notes-list'),

        //Lista Conferidas
        completedList: document.getElementById('completed-notes-list'),
        btnClearCompleted: document.getElementById('btn-clear-completed'),
        btnSyncCompleted: document.getElementById('btn-sync-completed'),
        fabFinalizarContainer: document.getElementById('fab-finalizar-container'),
        badgeSyncCount: document.getElementById('badge-sync-count')
    };

    // --- ESTADO (STATE) ---
    let state = {
        activeNfe: null,
        pending: [],
        completed: []
    };

    // --- SONS ---
    const sounds = {
        success: document.getElementById('audio-success') || new Audio('/public/sounds/notification.mp3'),
        error: document.getElementById('audio-error') || new Audio('/public/sounds/error.mp3')
    };
    
    // --- INICIALIZAÇÃO ---
    init();

    async function init() {
        await loadState();
        renderUI();
        
        if(elements.input) elements.input.focus();
        
        // Event Listeners
        if(elements.input) elements.input.addEventListener('keypress', handleInput);
        if(elements.btnCloseNote) elements.btnCloseNote.addEventListener('click', pauseActiveNote);

        // Foco automático ao fechar modals
        const modalElement = document.getElementById('customModal');
        if (modalElement) {
            modalElement.addEventListener('hidden.bs.modal', () => {
                if (elements.input) elements.input.focus();
            });
        }
        
        // Clique na lista de pendentes para retomar
        if(elements.pendingList) {
            elements.pendingList.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.btn-delete-pending');
                if (deleteBtn) {
                    e.stopPropagation(); // Impede que abra a nota ao clicar em excluir
                    const nfeNumero = deleteBtn.dataset.nfe;
                    
                    ModalSystem.confirm(`Deseja remover a NF ${nfeNumero} da lista de conferência?`, "Confirmar Exclusão", () => {
                        removePendingNote(nfeNumero);
                    });
                    return;
                }
                const item = e.target.closest('.nota-pendente-item');
                if (item) {
                    const nfeNumero = item.dataset.nfe;
                    activatePendingNote(nfeNumero);
                }
            });
        }

        if (elements.btnClearCompleted) {
            elements.btnClearCompleted.addEventListener('click', handleClearCompleted);
        }

        if (elements.btnSyncCompleted) elements.btnSyncCompleted.addEventListener('click', handleSyncBatch);
    }

    // --- GERENCIAMENTO DE ESTADO ---

    async function loadState() {
        try {
            const response = await fetch('/conferencia/api/state');
            const data = await response.json();
            if (data) {
                state = data;
                
                // [CORREÇÃO] Garante que os arrays existam mesmo se o estado salvo for antigo
                if (!Array.isArray(state.pending)) state.pending = [];
                if (!Array.isArray(state.completed)) state.completed = [];
                
                // Se activeNfe vier vazio ou null, garante que seja null
                if (!state.activeNfe) state.activeNfe = null;
            }
        } catch (error) {
            console.error("Erro ao carregar estado:", error);
            ToastSystem.error("Não foi possível carregar o progresso anterior.");
            if(elements.input) elements.input.focus();
        }
    }

    async function saveState() {
        try {
            await fetch('/conferencia/api/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state)
            });
        } catch (error) {
            console.error("Erro ao salvar estado:", error);
        }
    }

    // --- LÓGICA DE BIPAGEM ---

    async function handleInput(e) {
        if (e.key !== 'Enter') return;
        
        const code = elements.input.value.trim();
        elements.input.value = '';
        if (!code) return;

        // Regra simples: Chave de Acesso tem 44 dígitos
        const isNfeKey = code.length === 44 && !isNaN(code);

        if (isNfeKey) {
            await handleNfeScan(code);
        } else {
            handleProductScan(code);
        }
    }

    async function handleNfeScan(chave) {
        // 1. Verifica se já é a nota ativa
        if (state.activeNfe && state.activeNfe.chave === chave) {
            sounds.error.play().catch(e => console.log(e));
            ToastSystem.warning("Esta nota já está em conferência.");
            if(elements.input) elements.input.focus();
            return;
        }

        // 2. Verifica se está nas pendentes (Retomar)
        const pendingIndex = state.pending.findIndex(n => n.chave === chave);
        if (pendingIndex !== -1) {
            pauseActiveNote(); // Pausa a atual se houver
            state.activeNfe = state.pending[pendingIndex];
            state.pending.splice(pendingIndex, 1);
            saveState();
            renderUI();
            return;
        }

        // 3. Busca Nova Nota no Backend
        ModalSystem.showLoading("Buscando dados da Nota Fiscal...", "Aguarde");
        try {
            const response = await fetch(`/conferencia/api/nfe/${chave}`);
            const data = await response.json();

            ModalSystem.hideLoading();

            if (!response.ok) {
                sounds.error.play().catch(e => console.log(e));
                if (data.code === 'ALREADY_CHECKED') {
                    ToastSystem.warning(`A nota fiscal ${data.nfeNumero || 'N/A'} já foi conferida!`);
                } else {
                    ToastSystem.error(data.message || "Erro ao buscar nota.");
                }
                if(elements.input) elements.input.focus();
                return;
            }

            // Nota encontrada com sucesso
            pauseActiveNote(); 
            
            // Monta o objeto da nova nota
            const newNote = {
                numero: data.nfe.numero,
                chave: data.nfe.chave,
                cliente: data.nfe.cliente,
                uf: data.nfe.uf,
                pedidoBlingId: data.nfe.pedidoBlingId,
                conta: data.nfe.conta,
                volumes: data.volumes.map(v => ({
                    ...v,
                    checked: false 
                }))
            };

            state.activeNfe = newNote;
            sounds.success.play().catch(e => console.log(e));
            saveState();
            renderUI();

        } catch (error) {
            ModalSystem.hideLoading();
            sounds.error.play().catch(e => console.log(e));
            ToastSystem.error("Erro de comunicação com o servidor.");
            if(elements.input) elements.input.focus();
        }
    }

    function handleProductScan(code) {
        if (!state.activeNfe) {
            sounds.error.play().catch(e => console.log(e));
            ToastSystem.warning("Bipe uma Nota Fiscal primeiro!");
            if(elements.input) elements.input.focus();
            return;
        }

        const volumes = state.activeNfe.volumes;
        
        // [ATENÇÃO] Lógica de Match Atualizada para incluir component_sku
        const matchIndex = volumes.findIndex(v => 
            !v.checked && (
                v.gtin === code ||
                v.gtin_embalagem === code ||
                v.codigo_fabrica === code ||
                v.component_sku === code // Garante que o SKU da estrutura seja aceito
            )
        );

        if (matchIndex !== -1) {
            // MATCH!
            volumes[matchIndex].checked = true;
            sounds.success.play().catch(e => console.log('Erro som', e));
            
            checkCompletion();
            saveState();
            renderUI();
        } else {
            // ERRO / NÃO PERTENCE
            // Verifica se já foi conferido (duplicidade)
            const alreadyChecked = volumes.find(v => 
                v.checked && (
                    v.gtin === code || 
                    v.codigo_fabrica === code || 
                    v.component_sku === code
                )
            );

            if (alreadyChecked) {
                sounds.error.play().catch(e => console.log('Erro som', e));
                ToastSystem.warning("Este volume já foi conferido!");
            } else {
                sounds.error.play().catch(e => console.log('Erro som', e));
                ToastSystem.error("Este produto NÃO pertence à nota atual.");
            }
            if(elements.input) elements.input.focus();
        }
    }

    // --- CONTROLE DE FLUXO ---

    function pauseActiveNote() {
        if (state.activeNfe) {
            state.pending.unshift(state.activeNfe); 
            state.activeNfe = null;
            saveState();
            renderUI();
        }
    }

    function removePendingNote(nfeNumero) {
        const index = state.pending.findIndex(n => n.numero == nfeNumero);
        if (index !== -1) {
            state.pending.splice(index, 1); // Remove do array
            saveState(); // Salva o novo estado no banco
            renderUI();  // Atualiza a tela
        }
    }

    function handleClearCompleted() {
        if (state.completed.length === 0) return;

        ModalSystem.confirm("Deseja limpar todo o histórico de notas conferidas desta sessão?", "Limpar Histórico", () => {
            state.completed = [];
            saveState();
            renderUI();
        });
    }

    function activatePendingNote(nfeNumero) {
        const index = state.pending.findIndex(n => n.numero == nfeNumero);
        if (index !== -1) {
            pauseActiveNote(); 
            state.activeNfe = state.pending[index];
            state.pending.splice(index, 1);
            saveState();
            renderUI();
        }
    }

    async function checkCompletion() {
        if (!state.activeNfe) return;

        const total = state.activeNfe.volumes.length;
        const checked = state.activeNfe.volumes.filter(v => v.checked).length;

        if (checked === total && total > 0) {
            const nfe = state.activeNfe;
            
            // Marca como pendente de envio para o Bling
            nfe.syncStatus = 'pending'; // 'pending', 'success', 'error'
            nfe.finishedAt = new Date().toLocaleTimeString();
            
            // Move para a lista de conferidas
            state.completed.unshift(nfe);
            state.activeNfe = null;
            
            // Atualiza UI e Salva, SEM chamar API de finalize aqui
            renderUI(); 
            saveState();
            
            // Feedback sonoro extra ou visual se desejar
        }
    }

    async function handleSyncBatch() {
        // Filtra apenas as que ainda não foram enviadas com sucesso
        const pendingNotes = state.completed.filter(n => n.syncStatus !== 'success');

        if (pendingNotes.length === 0) {
            ToastSystem.info("Não há notas pendentes de envio nesta lista.");
            if(elements.input) elements.input.focus();
            return;
        }

        ModalSystem.confirm(`Confirma o envio de ${pendingNotes.length} nota(s) para o Bling?`, "Finalizar Lote", async () => {
            
            ModalSystem.showLoading(`Processando 0/${pendingNotes.length}...`, "Enviando");
            
            let retryList = [];
            let successCount = 0;

            // PRIMEIRA TENTATIVA
            for (let i = 0; i < pendingNotes.length; i++) {
                const nfe = pendingNotes[i];
                
                const spinnerMsg = document.getElementById('customModalMessage');
                if(spinnerMsg) spinnerMsg.textContent = `Processando nota ${i+1}/${pendingNotes.length}...`;

                try {
                    const response = await fetch('/conferencia/api/finalize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            nfeNumero: nfe.numero,
                            pedidoBlingId: nfe.pedidoBlingId
                        })
                    });

                    if (response.ok) {
                        nfe.syncStatus = 'success';
                        nfe.syncErrorMsg = null;
                        successCount++;
                    } else {
                        const errData = await response.json();
                        nfe.syncErrorMsg = errData.message || "Erro desconhecido na API.";
                        retryList.push(nfe);
                    }
                } catch (error) {
                    console.error("Erro de rede:", error);
                    nfe.syncErrorMsg = "Falha de comunicação/Rede.";
                    retryList.push(nfe);
                }
                
                saveState();
                renderUI(); 
                
                // Pausa rigorosa de 1 segundo entre requisições
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // SEGUNDA TENTATIVA (RETRY PARA AS FALHAS)
            if (retryList.length > 0) {
                const spinnerMsg = document.getElementById('customModalMessage');
                if(spinnerMsg) spinnerMsg.textContent = `Re-tentando ${retryList.length} notas que falharam...`;
                
                // Pequena pausa antes de começar os retries
                await new Promise(resolve => setTimeout(resolve, 1500));

                for (let i = 0; i < retryList.length; i++) {
                    const nfe = retryList[i];
                    
                    if(spinnerMsg) spinnerMsg.textContent = `Re-tentando nota ${i+1}/${retryList.length}...`;

                    try {
                        const response = await fetch('/conferencia/api/finalize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                nfeNumero: nfe.numero,
                                pedidoBlingId: nfe.pedidoBlingId
                            })
                        });

                        if (response.ok) {
                            nfe.syncStatus = 'success';
                            nfe.syncErrorMsg = null;
                            successCount++;
                        } else {
                            const errData = await response.json();
                            nfe.syncStatus = 'error'; // Marcar como erro definitivo para exibição
                            nfe.syncErrorMsg = errData.message || "Falha definitiva na API.";
                        }
                    } catch (error) {
                        nfe.syncStatus = 'error';
                        nfe.syncErrorMsg = "Falha definitiva de comunicação/Rede.";
                    }
                    
                    saveState();
                    renderUI();
                    
                    // Pausa rigorosa de 1 segundo entre requisições de retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            ModalSystem.hideLoading();
            renderUI(); // Atualiza os ícones na lista

            const errorCount = pendingNotes.length - successCount;

            if (errorCount > 0) {
                sounds.error.play().catch(e => console.log(e));
                ToastSystem.warning(`${successCount} com sucesso. ${errorCount} notas falharam (detalhes na lista).`);
                if(elements.input) elements.input.focus();
            } else {
                sounds.success.play().catch(e => console.log(e));
                ToastSystem.success(`${successCount} notas finalizadas com sucesso!`);
                if(elements.input) elements.input.focus();
            }
        });
    }

    // --- RENDERIZAÇÃO (VIEW) ---

    function renderUI() {
        // 1. Painel da Nota Ativa
        if (state.activeNfe) {
            elements.activePanel.style.display = 'flex';
            elements.emptyPanel.style.display = 'none';
            elements.activePanel.classList.add('active'); 

            const nfe = state.activeNfe;
            elements.lblNfeNumber.textContent = nfe.numero;
            
            const lblCliente = document.getElementById('active-nfe-cliente');
            if (lblCliente) lblCliente.textContent = nfe.cliente ? `${nfe.cliente} - ${nfe.uf || ''}` : 'Cliente não informado';

            const lblConta = document.getElementById('active-nfe-conta');
            if (lblConta) lblConta.textContent = nfe.conta ? `Conta: ${nfe.conta}` : '';

            // Barra de Progresso
            const total = nfe.volumes.length;
            const done = nfe.volumes.filter(v => v.checked).length;
            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
            
            elements.progressBar.style.width = `${percent}%`;
            
            const progressTextEl = document.getElementById('active-progress-text');
            if (progressTextEl) {
                progressTextEl.textContent = `${done}/${total} (${percent}%)`;
            } else {
                elements.progressBar.textContent = `${done}/${total} (${percent}%)`;
            }
            
            // Lista de Volumes
            elements.volumesList.innerHTML = nfe.volumes.map(vol => `
                <div class="volume-item ${vol.checked ? 'conferido' : ''}">
                    <i class="fas ${vol.checked ? 'fa-check-circle' : 'fa-box'} status-icon"></i>
                    <div class="volume-details">
                        <strong>${vol.structure_name || vol.component_sku}</strong><br>
                        <span>SKU: ${vol.component_sku}</span>
                        ${vol.codigo_fabrica ? `<br><small style="color:#666">Cod. Fab: ${vol.codigo_fabrica}</small>` : ''}
                    </div>
                </div>
            `).join('');

        } else {
            elements.activePanel.style.display = 'none';
            elements.emptyPanel.style.display = 'flex';
            elements.activePanel.classList.remove('active');
        }

        // 2. Lista de Pendentes
        if (state.pending.length === 0) {
            elements.pendingList.innerHTML = `
                <div class="text-center mt-5" style="font-size: 0.9rem; color: #555;">
                    <i class="fas fa-check-double fa-2x mb-2"></i><br>
                    Nenhuma nota pendente.
                </div>`;
        } else {
            elements.pendingList.innerHTML = state.pending.map(nfe => {
                const done = nfe.volumes.filter(v => v.checked).length;
                const total = nfe.volumes.length;
                return `
                <div class="nota-pendente-item" data-nfe="${nfe.numero}">
                    <div class="nota-pendente-info">
                        <strong>NF ${nfe.numero}</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="badge-progresso">${done}/${total}</span>
                        <button class="btn btn-sm btn-outline-danger btn-delete-pending" data-nfe="${nfe.numero}" title="Remover da lista" style="padding: 2px 6px;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                `;
            }).join('');
        }

        // 3. Lista de Conferidas
        if (state.completed.length === 0) {
            elements.completedList.innerHTML = `
                <div class="text-center mt-3" style="font-size: 0.9rem; color: #555;">
                    <i class="fas fa-clipboard-list fa-2x mb-2" style="color: #333;"></i><br>
                    Nenhuma nota aguardando.
                </div>`;
            elements.btnClearCompleted.style.display = 'none';
            if(elements.fabFinalizarContainer) elements.fabFinalizarContainer.style.display = 'none';
        } else {
            elements.btnClearCompleted.style.display = 'inline-block';
            
            const countToSync = state.completed.filter(n => n.syncStatus !== 'success').length;
            if(elements.fabFinalizarContainer) {
                elements.fabFinalizarContainer.style.display = countToSync > 0 ? 'block' : 'none';
                if(elements.badgeSyncCount) elements.badgeSyncCount.textContent = countToSync;
            }
            
            elements.completedList.innerHTML = state.completed.map(nfe => {
                // Define cor e ícone baseados no status de envio
                let borderClass = 'border-secondary';
                let iconHtml = '<i class="fas fa-clock" title="Aguardando Envio"></i>';
                let statusColor = '#888';
                let errorHtml = '';

                if (nfe.syncStatus === 'success') {
                    statusColor = '#28a745'; // Verde
                    iconHtml = '<i class="fas fa-check-double" title="Enviado com Sucesso"></i>';
                } else if (nfe.syncStatus === 'error') {
                    statusColor = '#dc3545'; // Vermelho
                    iconHtml = '<i class="fas fa-exclamation-triangle" title="Erro no Envio"></i>';
                    if (nfe.syncErrorMsg) {
                        errorHtml = `<div style="color: #ff8888; font-size: 0.8rem; margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 5px;">
                                        <i class="fas fa-info-circle"></i> ${nfe.syncErrorMsg}
                                     </div>`;
                    }
                } else {
                    // Pending (Amarelo/Laranja)
                    statusColor = '#ffc107'; 
                    iconHtml = '<i class="fas fa-hourglass-half" title="Pendente de Conferência"></i>';
                }

                return `
                <div class="nota-conferida-item" style="border-left: 4px solid ${statusColor}; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; width: 100%;">
                        <div class="nota-conferida-info">
                            <strong>NF ${nfe.numero}</strong>
                            <span style="color: ${statusColor}; font-size: 0.85rem; font-weight:bold; margin-left: 5px;">
                                ${iconHtml} ${nfe.syncStatus === 'success' ? 'Finalizado' : (nfe.syncStatus === 'error' ? 'Falha' : 'Aguardando')}
                            </span>
                        </div>
                        <div style="text-align: right;">
                             <div style="font-size: 0.75rem; color: #666;">${nfe.finishedAt}</div>
                             <span class="badge-progresso" style="background-color: #333; border: 1px solid #555;">${nfe.volumes.length} vol</span>
                        </div>
                    </div>
                    ${errorHtml}
                </div>
                `;
            }).join('');
        }
    }
});
