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
        btnFinalizeNote: document.getElementById('btn-finalize-active-note'),

        // Lista Pendentes
        pendingList: document.getElementById('pending-notes-list'),

        // Lista Conferidas
        completedList: document.getElementById('completed-notes-list'),
        btnClearCompleted: document.getElementById('btn-clear-completed'),

        // Elementos Modo ML e Produtividade
        toggleModoMl: document.getElementById('toggle-modo-ml'),
        btnIconPause: document.getElementById('btn-close-icon'),
        btnTextPause: document.getElementById('btn-close-text'),
        modalCarregadores: document.getElementById('modal-carregadores'),
        listaCarregadoresModal: document.getElementById('lista-carregadores-modal'),
        btnConfirmarCarregadores: document.getElementById('btn-confirmar-carregadores'),
        btnCancelarCarregadores: document.getElementById('btn-cancelar-carregadores')
    };

    let state = {
        activeNfe: null,
        pending: [],
        completed: [],
        modoMercadoLivre: true,
        saveDateStr: new Date().toLocaleDateString()
    };

    let allCarregadores = [];
    let selectedCarregadores = [];

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

        if (elements.input) elements.input.focus();

        // Event Listeners
        if (elements.input) elements.input.addEventListener('keypress', handleInput);
        if (elements.btnCloseNote) elements.btnCloseNote.addEventListener('click', pauseActiveNote);
        if (elements.btnFinalizeNote) elements.btnFinalizeNote.addEventListener('click', handleFinalizeBtnClick);

        // Foco automático ao fechar modals
        const modalElement = document.getElementById('customModal');
        if (modalElement) {
            modalElement.addEventListener('hidden.bs.modal', () => {
                if (elements.input) elements.input.focus();
            });
        }

        // [FOCO GLOBAL] Sempre retorna foco ao input após qualquer clique na página
        document.addEventListener('click', () => {
            setTimeout(() => {
                if (elements.input && document.activeElement !== elements.input) {
                    elements.input.focus();
                }
            }, 150);
        });

        // [FOCO GLOBAL] Intervalo de segurança para garantir foco contínuo (caso modais/toasts roubem)
        setInterval(() => {
            if (elements.input && document.activeElement !== elements.input) {
                elements.input.focus();
            }
        }, 1500);

        // Clique na lista de pendentes para retomar
        if (elements.pendingList) {
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

        // --- MODO MERCADO LIVRE ---
        if (elements.toggleModoMl) {
            elements.toggleModoMl.addEventListener('change', (e) => {
                state.modoMercadoLivre = e.target.checked;
                updateModoMlUI();
                saveState();
            });
        }

        // --- CARREGADORES (PRODUTIVIDADE) ---
        // (Modal foi removido e substituído por checkbox e scan direto)
        const chkSemCarregador = document.getElementById('chk-sem-carregador');
        if (chkSemCarregador) {
            chkSemCarregador.addEventListener('change', () => {
                if (chkSemCarregador.checked) {
                    checkCompletion();
                }
            });
        }

        loadCarregadoresList();
    }

    async function loadCarregadoresList() {
        try {
            const res = await fetch('/api/expedicao/carregadores/ativos');
            allCarregadores = await res.json();
        } catch (e) {
            console.error("Erro ao carregar carregadores ativos", e);
        }
    }

    function updateModoMlUI() {
        const container = document.getElementById('ml-mode-container');
        const text = document.getElementById('ml-mode-text');
        if (state.modoMercadoLivre) {
            elements.btnIconPause.className = 'fas fa-eraser';
            elements.btnTextPause.textContent = 'Limpar';
            elements.btnCloseNote.classList.remove('btn-bip');
            elements.btnCloseNote.classList.add('btn-bip');
            if (container && text) {
                container.style.background = 'rgba(255, 165, 0, 0.2)';
                container.style.borderColor = 'rgba(255, 165, 0, 0.5)';
                text.textContent = 'Modo Mercado Livre';
                text.style.color = '#ffa500';
            }
        } else {
            elements.btnIconPause.className = 'fas fa-pause';
            elements.btnTextPause.textContent = 'Pausar';
            if (container && text) {
                container.style.background = 'rgba(0,0,0,0.2)';
                container.style.borderColor = 'rgba(255,255,255,0.05)';
                text.textContent = 'Modo Transportadora';
                text.style.color = 'var(--text-muted)';
            }
        }
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
                if (!Array.isArray(state.carregadoresBipados)) state.carregadoresBipados = [];
                if (state.modoMercadoLivre === undefined) state.modoMercadoLivre = true;

                // Se activeNfe vier vazio ou null, garante que seja null
                if (!state.activeNfe) state.activeNfe = null;

                // Limpeza de histórico de notas por virada de dia
                const todayStr = new Date().toLocaleDateString();
                if (state.saveDateStr !== todayStr) {
                    state.completed = []; // Limpa histórico antigo da view
                    state.saveDateStr = todayStr;
                    console.log("[Conferência] Novo dia detectado. Lista de conferidas zerada visualmente.");
                }

                if (elements.toggleModoMl) {
                    elements.toggleModoMl.checked = state.modoMercadoLivre;
                    updateModoMlUI();
                }
            }
        } catch (error) {
            console.error("Erro ao carregar estado:", error);
            ToastSystem.error("Não foi possível carregar o progresso anterior.");
            if (elements.input) elements.input.focus();
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

        // Verifica se é carregador
        const carregador = allCarregadores && allCarregadores.find(c => String(c.codigo_barras) === code);
        if (carregador) {
            handleCarregadorScan(carregador);
            return;
        }

        let isNfeKey = false;
        // Chave de acesso tem 44 dígitos
        if (code.length === 44 && !isNaN(code)) {
            isNfeKey = true;
        }
        // Se não houver NF ativa, tenta buscar NF pelo número (geralmente <= 10 dígitos numéricos)
        else if (!state.activeNfe && code.length <= 10 && !isNaN(code)) {
            isNfeKey = true;
        }

        if (isNfeKey) {
            await handleNfeScan(code);
        } else {
            handleProductScan(code);
        }
    }

    function handleCarregadorScan(carregador) {
        if (!state.activeNfe) {
            ToastSystem.warning('Você precisa abrir uma NF antes de bipar os carregadores.');
            if (elements.input) elements.input.focus();
            return;
        }
        if (!state.carregadoresBipados) state.carregadoresBipados = [];
        if (!state.carregadoresBipados.includes(carregador.id)) {
            state.carregadoresBipados.push(carregador.id);
            saveState();
            renderUI();
            sounds.success.play().catch(e => console.log(e));
            ToastSystem.success(`Carregador ${carregador.nome} adicionado.`);
        } else {
            ToastSystem.info('Carregador já foi bipado.');
        }
        if (elements.input) elements.input.focus();
    }

    async function handleNfeScan(chave) {
        // 1. Verifica se já é a nota ativa (por chave ou número)
        if (state.activeNfe && (state.activeNfe.chave === chave || state.activeNfe.numero == chave)) {
            sounds.error.play().catch(e => console.log(e));
            ToastSystem.warning("Esta nota já está em conferência.");
            if (elements.input) elements.input.focus();
            return;
        }

        // 2. Verifica se está nas pendentes (Retomar)
        const pendingIndex = state.pending.findIndex(n => n.chave === chave);
        if (pendingIndex !== -1) {
            if (state.modoMercadoLivre && state.activeNfe) {
                sounds.error.play().catch(e => console.log(e));
                ToastSystem.warning("Conclua a nota atual ou limpe-a manualmente antes de retomar outra.");
                if (elements.input) elements.input.focus();
                return;
            }
            pauseActiveNote(); // Pausa a atual se houver
            state.activeNfe = state.pending[pendingIndex];
            state.pending.splice(pendingIndex, 1);
            saveState();
            renderUI();
            return;
        }

        // Verifica se há nota em andamento e tenta fechá-la ou pausá-la
        if (state.activeNfe) {
            const total = state.activeNfe.volumes.length;
            const checked = state.activeNfe.volumes.filter(v => v.checked).length;
            const chkSemCarregador = document.getElementById('chk-sem-carregador');
            const useSemCarregador = chkSemCarregador ? chkSemCarregador.checked : false;

            if (checked === total && total > 0) {
                // Se a nota está concluída, tentar finalizar:
                if (useSemCarregador || (state.carregadoresBipados && state.carregadoresBipados.length > 0)) {
                    const finalizada = await attemptFinalizeActiveNote();
                    if (!finalizada) {
                        if (elements.input) elements.input.focus();
                        return; // falhou na rede ou algo do tipo, bloqueia pra não perder
                    }
                } else {
                    if (state.modoMercadoLivre) {
                        sounds.error.play().catch(e => console.log(e));
                        ToastSystem.error("Você precisa bipar carregadores na nota atual antes de passar para a próxima!");
                        if (elements.input) elements.input.focus();
                        return;
                    } else {
                        pauseActiveNote();
                    }
                }
            } else {
                // Incompleta
                if (state.modoMercadoLivre) {
                    sounds.error.play().catch(e => console.log(e));
                    ToastSystem.warning("Termine de bipar a nota atual ou clique em LIMPAR antes de abrir uma nova.");
                    if (elements.input) elements.input.focus();
                    return;
                } else {
                    pauseActiveNote();
                }
            }
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
                if (elements.input) elements.input.focus();
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
            if (elements.input) elements.input.focus();
        }
    }

    function handleProductScan(code) {
        if (!state.activeNfe) {
            sounds.error.play().catch(e => console.log(e));
            ToastSystem.warning("Bipe uma Nota Fiscal primeiro!");
            if (elements.input) elements.input.focus();
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

            // Incrementa o contador do palete atual
            incrementarPaleteAtual();

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
            if (elements.input) elements.input.focus();
        }
    }

    // --- CONTROLE DE FLUXO ---

    function pauseActiveNote() {
        if (!state.activeNfe) return;

        if (state.modoMercadoLivre) {
            // Em modo ML, a ação é de "Limpar", não pausar. Pede confirmação e exclui.
            ModalSystem.confirm("Atenção! No Modo ML isso irá DESCARTE a conferência desta nota. Deseja prosseguir?", "Limpar Nota", () => {
                // [PALETE] Antes de limpar, remove a contagem do palete
                const checkedCount = state.activeNfe.volumes.filter(v => v.checked).length;
                if (checkedCount > 0) {
                    decrementarPaleteAtual(checkedCount);
                }

                state.activeNfe = null;
                saveState();
                renderUI();
            });
        } else {
            // Comportamento Original (Pausa)
            state.pending.unshift(state.activeNfe);
            state.activeNfe = null;
            saveState();
            renderUI();
        }
    }

    function removePendingNote(nfeNumero) {
        const index = state.pending.findIndex(n => n.numero == nfeNumero);
        if (index !== -1) {
            const nfe = state.pending[index];
            // [PALETE] Remove a contagem do palete se houver itens bipados
            const checkedCount = nfe.volumes.filter(v => v.checked).length;
            if (checkedCount > 0) {
                decrementarPaleteAtual(checkedCount);
            }

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

    async function handleFinalizeBtnClick() {
        if (!state.activeNfe) return;

        const total = state.activeNfe.volumes.length;
        const checked = state.activeNfe.volumes.filter(v => v.checked).length;
        if (checked < total || total === 0) {
            ToastSystem.warning("Você precisa concluir a bipagem de todos os itens primeiro.");
            return;
        }

        const chkSemCarregador = document.getElementById('chk-sem-carregador');
        const useSemCarregador = chkSemCarregador ? chkSemCarregador.checked : false;

        if (useSemCarregador || (state.carregadoresBipados && state.carregadoresBipados.length > 0)) {
            await attemptFinalizeActiveNote();
        } else {
            ToastSystem.warning("Bipe pelo menos um carregador ou ative 'Sem Carregador'.", 4000);
            if (elements.input) elements.input.focus();
        }
    }

    async function attemptFinalizeActiveNote() {
        if (!state.activeNfe) return false;

        const chkSemCarregador = document.getElementById('chk-sem-carregador');
        const useSemCarregador = chkSemCarregador ? chkSemCarregador.checked : false;

        let carregadoresParaSalvar = [...(state.carregadoresBipados || [])];
        if (useSemCarregador && carregadoresParaSalvar.length === 0) {
            const objNinguem = allCarregadores.find(c => String(c.codigo_barras) === "300");
            if (objNinguem) {
                carregadoresParaSalvar.push(objNinguem.id);
            } else {
                console.warn("ALERTA: Carregador 'NINGUÉM' (Cód 300) não localizado. Rateio vazio.");
            }
        }
        return await submitFinalizeNfe(carregadoresParaSalvar);
    }

    async function checkCompletion() {
        if (!state.activeNfe) return;

        const total = state.activeNfe.volumes.length;
        const checked = state.activeNfe.volumes.filter(v => v.checked).length;

        if (checked === total && total > 0) {
            const chkSemCarregador = document.getElementById('chk-sem-carregador');
            const useSemCarregador = chkSemCarregador ? chkSemCarregador.checked : false;

            if (useSemCarregador) {
                await attemptFinalizeActiveNote();
            } else {
                sounds.success.play().catch(e => console.log(e));
                renderUI(); // Renderiza para mostrar o botão de Finalizar
            }
        }
    }

    async function submitFinalizeNfe(carregadores) {
        if (!state.activeNfe) return;

        const nfe = state.activeNfe;

        ModalSystem.showLoading("Finalizando a Nota e registrando produtividade...", "Aguarde");

        try {
            const response = await fetch('/conferencia/api/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nfeNumero: nfe.numero,
                    pedidoBlingId: nfe.pedidoBlingId,
                    carregadores: carregadores
                })
            });

            const data = await response.json();
            ModalSystem.hideLoading();

            if (response.ok) {
                sounds.success.play().catch(e => console.log(e));
                ToastSystem.success("Nota Finalizada!");

                nfe.syncStatus = 'success'; // Como é local agora, apenas salva na view. O BD fará o Sync Massivo dps.
                nfe.finishedAt = new Date().toLocaleTimeString();

                state.completed.unshift(nfe);
                state.activeNfe = null;
                state.carregadoresBipados = []; // Limpa carregadores para a próxima NF

                saveState();
                renderUI();
                if (elements.input) elements.input.focus();
                return true;
            } else {
                sounds.error.play().catch(e => console.log(e));
                ToastSystem.error(data.message || "Erro ao finalizar a nota fiscal.");
                return false;
            }

        } catch (error) {
            ModalSystem.hideLoading();
            console.error("Erro de rede:", error);
            ToastSystem.error("Falha de comunicação/Rede ao finalizar nota.");
            return false;
        }
    }

    // --- RENDERIZAÇÃO (VIEW) ---

    function renderUI() {
        // 1. Painel da Nota Ativa
        renderCarregadoresBipados();

        // [FOCO] Sempre volta ao topo para não perder a visão da bipagem
        window.scrollTo({ top: 0, behavior: 'smooth' });

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

            if (elements.btnFinalizeNote) {
                if (percent === 100 && total > 0) {
                    elements.btnFinalizeNote.style.display = 'inline-block';
                } else {
                    elements.btnFinalizeNote.style.display = 'none';
                }
            }

            // Lista de Volumes
            elements.volumesList.innerHTML = nfe.volumes.map((vol, idx) => {
                const ean = vol.gtin || vol.gtin_embalagem;
                const semEan = !ean;
                const eanBadge = ean
                    ? `<span style="background: rgba(40,167,69,0.2); color: #28a745; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-left: 8px;">EAN: ${ean}</span>`
                    : `<span style="background: rgba(220,53,69,0.2); color: #dc3545; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-left: 8px; cursor: pointer;" title="Clique para dar como bipado">Sem EAN</span>`;

                // Botão de copiar SKU
                const copyBtn = `<button class="btn-copy-sku" data-sku="${vol.component_sku}" title="Copiar SKU" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 4px; font-size: 0.75rem; transition: color 0.2s;"><i class="fas fa-copy"></i></button>`;

                // Item clicável se sem EAN e não conferido
                const clickable = semEan && !vol.checked;
                const clickAttr = clickable ? `data-manual-check-idx="${idx}" style="cursor: pointer;" title="Clique para marcar como bipado (sem EAN)"` : '';

                return `
                <div class="volume-item ${vol.checked ? 'conferido' : ''}" ${clickAttr}>
                    <i class="fas ${vol.checked ? 'fa-check-circle' : 'fa-box'} status-icon"></i>
                    <div class="volume-details">
                        <strong>${vol.structure_name || vol.component_sku}</strong><br>
                        <div style="display: flex; align-items: center; margin-top: 4px; flex-wrap: wrap; gap: 4px;">
                            <span>SKU: ${vol.component_sku}</span>
                            ${copyBtn}
                            ${eanBadge}
                        </div>
                        ${vol.codigo_fabrica ? `<small style="color:#888; display: block; margin-top: 4px;">Cod. Fab: ${vol.codigo_fabrica}</small>` : ''}
                    </div>
                </div>
                `;
            }).join('');

            // Event listeners para copiar SKU
            elements.volumesList.querySelectorAll('.btn-copy-sku').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const sku = btn.dataset.sku;
                    navigator.clipboard.writeText(sku).then(() => {
                        ToastSystem.success(`SKU "${sku}" copiado!`, 2000);
                    }).catch(() => {
                        ToastSystem.error('Erro ao copiar SKU.');
                    });
                });
            });

            // Event listeners para marcar manualmente itens sem EAN (dupla confirmação)
            elements.volumesList.querySelectorAll('[data-manual-check-idx]').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.btn-copy-sku')) return; // Ignora se clicou no copiar
                    const idx = parseInt(el.dataset.manualCheckIdx);
                    const vol = state.activeNfe.volumes[idx];
                    if (!vol || vol.checked) return;

                    // 1º Modal: Pergunta inicial
                    ModalSystem.confirm(
                        `Deseja marcar o item <strong>${vol.component_sku}</strong> como bipado manualmente?<br><small style="color:#dc3545;">Este item não possui EAN cadastrado.</small>`,
                        'Bipagem Manual',
                        () => {
                            // 2º Modal: Confirmação de segurança
                            ModalSystem.confirm(
                                `<strong>Confirmação de segurança:</strong><br>Tem certeza que o item <strong>${vol.component_sku}</strong> está fisicamente presente e conferido?`,
                                'Confirmar Bipagem Manual',
                                () => {
                                    vol.checked = true;
                                    incrementarPaleteAtual();
                                    sounds.success.play().catch(() => {});
                                    ToastSystem.success(`${vol.component_sku} marcado como conferido!`);
                                    saveState();
                                    renderUI();
                                    checkCompletion();
                                }
                            );
                        }
                    );
                });
            });

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
            if (elements.fabFinalizarContainer) elements.fabFinalizarContainer.style.display = 'none';
        } else {
            elements.btnClearCompleted.style.display = 'inline-block';

            const countToSync = state.completed.filter(n => n.syncStatus !== 'success').length;
            if (elements.fabFinalizarContainer) {
                elements.fabFinalizarContainer.style.display = countToSync > 0 ? 'block' : 'none';
                if (elements.badgeSyncCount) elements.badgeSyncCount.textContent = countToSync;
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

    function renderCarregadoresBipados() {
        const ul = document.getElementById('lista-carregadores-bipados');
        if (!ul) return;

        ul.innerHTML = '';
        if (!state.carregadoresBipados || state.carregadoresBipados.length === 0) {
            ul.innerHTML = '<li style="background: transparent; padding: 0;"><span class="text-muted" style="font-size: 0.9rem;">Nenhum bipado.</span></li>';
        } else {
            state.carregadoresBipados.forEach(id => {
                const c = allCarregadores && allCarregadores.find(car => car.id === id);
                if (c) {
                    ul.innerHTML += `<li style="margin-bottom: 5px; font-size: 0.9rem; color: white;"><i class="fas fa-user-check" style="color: #28a745; margin-right: 5px;"></i> ${c.nome}</li>`;
                }
            });
        }
    }

    // --- PALETES (Contador Flutuante - Persistido no Banco) ---

    // Cache local dos paletes (carregado do banco)
    let paletesCache = [{ id: 1, nome: 'Palete 1', count: 0 }];
    let paleteAtualIdCache = 1;

    async function carregarPaletesDB() {
        try {
            const res = await fetch('/conferencia/api/paletes');
            const data = await res.json();
            if (data.success && data.paletes.length > 0) {
                paletesCache = data.paletes;
                paleteAtualIdCache = data.paleteAtualId || paletesCache[0].id;
            }
            updatePaleteUI();
        } catch (e) {
            console.error('Erro ao carregar paletes do banco:', e);
        }
    }

    async function salvarPaleteDB(palete) {
        try {
            await fetch('/conferencia/api/paletes/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: palete.id, nome: palete.nome, count: palete.count })
            });
        } catch (e) {
            console.error('Erro ao salvar palete no banco:', e);
        }
    }

    async function setPaleteAtualDB(id) {
        paleteAtualIdCache = id;
        try {
            await fetch('/conferencia/api/paletes/set-atual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paleteAtualId: id })
            });
        } catch (e) {
            console.error('Erro ao definir palete atual no banco:', e);
        }
    }

    async function incrementarPaleteAtual() {
        const palete = paletesCache.find(p => p.id === paleteAtualIdCache);
        if (palete) {
            palete.count++;
            updatePaleteUI();
            await salvarPaleteDB(palete);
        }
    }

    async function decrementarPaleteAtual(quantidade = 1) {
        const palete = paletesCache.find(p => p.id === paleteAtualIdCache);
        if (palete) {
            palete.count = Math.max(0, palete.count - quantidade);
            updatePaleteUI();
            await salvarPaleteDB(palete);
        }
    }

    async function criarNovoPalete() {
        const maxId = Math.max(...paletesCache.map(p => p.id), 0);
        const novoId = maxId + 1;
        const novoPalete = { id: novoId, nome: `Palete ${novoId}`, count: 0 };
        paletesCache.push(novoPalete);
        paleteAtualIdCache = novoId;
        updatePaleteUI();
        await salvarPaleteDB(novoPalete);
        await setPaleteAtualDB(novoId);
        ToastSystem.success(`Palete ${novoId} criado!`);
        if (elements.input) elements.input.focus();
    }

    function abrirModalPaletes() {
        const totalGeral = paletesCache.reduce((sum, p) => sum + (p.count || 0), 0);

        let listaHtml = paletesCache.map(p => {
            const isAtual = p.id === paleteAtualIdCache;
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; border-radius: 8px; background: ${isAtual ? 'rgba(255,165,0,0.15)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${isAtual ? 'rgba(255,165,0,0.4)' : 'rgba(255,255,255,0.06)'}; transition: all 0.2s; cursor: pointer;" onclick="document.dispatchEvent(new CustomEvent('selecionarPalete', { detail: ${p.id} }))">
                    <div>
                        <span style="font-weight: bold; color: ${isAtual ? '#ffa500' : 'white'}; font-size: 0.95rem;">
                            <i class="fas fa-pallet" style="margin-right: 6px;"></i>${p.nome}
                        </span>
                        ${isAtual ? '<span style="background: var(--accent-orange); color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; margin-left: 8px;">ATIVO</span>' : ''}
                    </div>
                    <span style="font-size: 1.1rem; font-weight: bold; color: ${isAtual ? '#ffa500' : '#aaa'};">${p.count || 0}</span>
                </div>
            `;
        }).join('');

        const conteudo = `
            <div style="margin-bottom: 12px;">
                ${listaHtml}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">
                <span style="font-weight: bold; color: white;">Total Geral</span>
                <span style="font-size: 1.2rem; font-weight: bold; color: var(--accent-orange);">${totalGeral}</span>
            </div>
            <div style="margin-top: 16px; text-align: center;">
                <button id="btn-reset-paletes" style="background: linear-gradient(135deg, #dc3545, #c82333); color: white; border: none; padding: 8px 20px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; cursor: pointer; transition: opacity 0.2s;">
                    <i class="fas fa-redo-alt" style="margin-right: 5px;"></i> Resetar Contagem
                </button>
            </div>
            <p style="text-align: center; font-size: 0.75rem; color: #666; margin-top: 10px;">Clique num palete para torná-lo ativo.</p>
        `;

        ModalSystem.alert(conteudo, 'Controle de Paletes');

        // Listener temporário para seleção de palete
        const handler = async (e) => {
            await setPaleteAtualDB(e.detail);
            updatePaleteUI();
            document.removeEventListener('selecionarPalete', handler);
            setTimeout(() => abrirModalPaletes(), 200);
        };
        document.addEventListener('selecionarPalete', handler);

        // Listener do reset
        setTimeout(() => {
            const btnReset = document.getElementById('btn-reset-paletes');
            if (btnReset) {
                btnReset.addEventListener('click', () => {
                    ModalSystem.confirm(
                        '<strong>Tem certeza?</strong><br>Isso irá zerar a contagem de <strong>todos</strong> os paletes e remover os adicionais.',
                        'Resetar Paletes',
                        async () => {
                            try {
                                await fetch('/conferencia/api/paletes/reset', { method: 'POST' });
                                paletesCache = [{ id: 1, nome: 'Palete 1', count: 0 }];
                                paleteAtualIdCache = 1;
                                updatePaleteUI();
                                ToastSystem.success('Contagem de paletes resetada!');
                                if (elements.input) elements.input.focus();
                            } catch (e) {
                                ToastSystem.error('Erro ao resetar paletes.');
                            }
                        }
                    );
                });
            }
        }, 300);
    }

    function updatePaleteUI() {
        const btnPalete = document.getElementById('fab-palete-atual');
        const badgeCount = document.getElementById('fab-palete-count');
        if (!btnPalete || !badgeCount) return;

        const paleteAtual = paletesCache.find(p => p.id === paleteAtualIdCache);
        if (paleteAtual) {
            btnPalete.textContent = `P${paleteAtual.id}`;
            badgeCount.textContent = paleteAtual.count || 0;
            badgeCount.style.display = 'flex';
        }
    }

    // Inicializar paletes do banco
    setTimeout(async () => {
        await carregarPaletesDB();

        const btnPalete = document.getElementById('fab-palete-atual');
        const btnNovo = document.getElementById('fab-novo-palete');

        if (btnPalete) btnPalete.addEventListener('click', abrirModalPaletes);
        if (btnNovo) btnNovo.addEventListener('click', criarNovoPalete);
    }, 100);
});
