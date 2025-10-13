document.addEventListener('DOMContentLoaded', async function() {
    console.log('emissaoManager.js: DOMContentLoaded - Script iniciado.');

    // Seleção dos elementos do DOM
    const carrierAssignmentView = document.getElementById('carrierAssignmentView');
    const emissaoListView = document.getElementById('emissaoListView');
    const emissaoDetailView = document.getElementById('emissaoDetailView');
    const btnAddEmissaoTop = document.getElementById('btnAddEmissao');
    const emissaoCardListContainer = document.getElementById('emissaoCardListContainer');
    const paginationControlsContainer = document.getElementById('paginationControlsContainer');
    const emissaoDetailTitle = document.getElementById('emissaoDetailTitle');
    const barcodeListContainer = document.getElementById('barcodeListContainer');
    const btnFinishEmissao = document.getElementById('btnFinishEmissao');
    const btnBackToList = document.getElementById('btnBackToList');
    const mainContainer = document.querySelector('.emissao-page-container');
    const bipadosCounter = document.getElementById('bipadosCounter');

    // Verificações de Elementos Essenciais (para ajudar na depuração)
    if (!emissaoListView) console.error('ERRO: Elemento emissaoListView não encontrado!');
    if (!emissaoDetailView) console.error('ERRO: Elemento emissaoDetailView não encontrado!');
    if (!btnAddEmissaoTop) console.error('ERRO: Elemento btnAddEmissaoTop não encontrado!');
    if (!emissaoCardListContainer) console.error('ERRO: Elemento emissaoCardListContainer não encontrado!');
    if (!paginationControlsContainer) console.error('ERRO: Elemento paginationControlsContainer não encontrado!');
    if (!emissaoDetailTitle) console.error('ERRO: Elemento emissaoDetailTitle não encontrado!');
    if (!barcodeListContainer) console.error('ERRO: Elemento barcodeListContainer não encontrado!');
    if (!btnFinishEmissao) console.error('ERRO: Elemento btnFinishEmissao não encontrado!');
    if (!btnBackToList) console.error('ERRO: Elemento btnBackToList não encontrado!');

    // Estado da Aplicação
    let allFinalizedEmissions = []; 
    let transportadorasMap = {}; // Começa como um objeto vazio
    let currentPage = 1;
    const itemsPerPage = 10; 
    let isNewEmissionMode = false;
    let currentVirtualEmissionTitle = "";
    let currentEmissionIdForDetail = null;
    let currentBipadosNestaEmissaoSet = new Set(); // Rastreia códigos já bipados NESTA SESSÃO
    let processedReportsFromFirstSubmission = [];

    if (mainContainer && mainContainer.dataset.transportadorasMap) {
        try {
            transportadorasMap = JSON.parse(mainContainer.dataset.transportadorasMap);
        } catch (e) {
            console.error("Erro ao fazer o parse do JSON de transportadoras:", e);
            // O mapa continuará vazio, mas o script não vai quebrar.
        }
    } else {
        console.warn("Container principal ou data-attribute de transportadoras não encontrado. A atribuição manual de transportadoras pode não funcionar.");
    }

    console.log("Transportadoras carregadas:", transportadorasMap);

    function updateBipadosCount() {
        if (!bipadosCounter || !barcodeListContainer) return;

        // Conta quantos inputs na lista têm um valor válido (44 dígitos)
        const validInputs = barcodeListContainer.querySelectorAll('.barcode-input');
        const count = Array.from(validInputs).filter(input => /^\d{44}$/.test(input.value.trim())).length;
        
        bipadosCounter.textContent = count;
    }
    
    function getFormattedDateTime(date) {
        const d = new Date(date);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }

    function parseBlingBarcode(barcodeScanned) {
        if (typeof barcodeScanned !== 'string') return null;
        const cleanedBarcode = barcodeScanned.replace(/\s+/g, '');
        if (cleanedBarcode.length < 44) {
            return null;
        }
        const chaveAcesso = cleanedBarcode.substring(0, 44);
        if (!/^\d{44}$/.test(chaveAcesso)) {
            return null;
        }
        
        // A lógica para determinar a conta pode ser simplificada ou removida no frontend
        // se não for estritamente necessária para a função de remoção.
        // Manteremos por consistência.
        const nNFString = chaveAcesso.substring(25, 34);
        if (!/^\d{9}$/.test(nNFString)) {
            return { chaveAcesso, accountType: null }; // Retorna a chave mesmo se a conta não for determinada
        }

        const nNFSignificantDigits = parseInt(nNFString, 10).toString();
        let accountType = null;
        if (nNFSignificantDigits.length === 6) accountType = 'lucas';
        else if (nNFSignificantDigits.length === 5) accountType = 'eliane';
        
        return { chaveAcesso, accountType };
    }

    async function fetchAllFinalizedEmissions() {
        console.log("fetchAllFinalizedEmissions: Buscando emissões...");
        try {
            const response = await fetch('/emissao/all'); // Sem /api/ conforme sua configuração
            if (!response.ok) {
                let errorMsg = `Erro ${response.status} (${response.statusText}) ao buscar emissões.`;
                const responseBodyAsText = await response.text();
                try { const errorData = JSON.parse(responseBodyAsText); errorMsg = errorData.message || errorMsg; }
                catch (e) { errorMsg += ` Detalhe: ${responseBodyAsText.substring(0,150)}`; }
                throw new Error(errorMsg);
            }
            allFinalizedEmissions = await response.json();
            currentPage = 1;
            renderEmissaoListPage();
        } catch (error) {
            console.error('Falha ao carregar emissões finalizadas:', error);
            if(emissaoCardListContainer) emissaoCardListContainer.innerHTML = `<p style="text-align:center; color:var(--color-danger, red);">Erro ao carregar emissões: ${error.message}</p>`;
        }
    }

    /**
     * Nova função que avisa o backend sobre o status da página.
     * @param {boolean} isActive - True se a página de emissão está ativa, false caso contrário.
     */
    async function notifyServerActivity(isActive) {
        try {
            const url = isActive ? '/emissao/set-activity-status' : '/emissao/release-lock';
            
            if (!isActive && navigator.sendBeacon) {
                // Beacon para garantir que a trava seja liberada mesmo se a aba for fechada
                navigator.sendBeacon(url, new Blob([JSON.stringify({ from: 'beacon' })], { type: 'application/json' }));
                console.log("Trava de emissão liberada (via Beacon).");
            } else {
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isActive: isActive }) // O corpo é o mesmo, a URL muda
                });
                console.log(`Atividade/Trava da página de emissão reportada como: ${isActive ? 'ATIVA' : 'INATIVA/LIBERADA'}.`);
            }
        } catch (error) {
            console.error("Erro ao notificar atividade/trava do servidor:", error);
        }
    }

    // Listener para avisar o backend quando o usuário tenta fechar a aba
    window.addEventListener('beforeunload', function() {
        if (isNewEmissionMode) {
            notifyServerActivity(false);
        }
    });
    
    if (btnAddEmissaoTop) {
        btnAddEmissaoTop.addEventListener('click', async function() {
            ModalSystem.showLoading("Verificando disponibilidade...");
            try {
                // 1. Tenta adquirir a trava no backend
                const response = await fetch('/emissao/acquire-lock', { method: 'POST' });
                const result = await response.json();
                ModalSystem.hideLoading();

                if (!response.ok) {
                    // Se a resposta não for OK (ex: 409 - Conflito), mostra o aviso
                    throw new Error(result.message);
                }
                
                // 2. Se deu certo, continua com a lógica normal para abrir a tela
                isNewEmissionMode = true;
                currentVirtualEmissionTitle = `Emissão - ${getFormattedDateTime(new Date())}`;
                if(emissaoDetailView.querySelector('#emissaoDetailTitle')) emissaoDetailView.querySelector('#emissaoDetailTitle').textContent = currentVirtualEmissionTitle;
                
                if(barcodeListContainer) {
                    barcodeListContainer.innerHTML = '<h5>Códigos de Barras para Processar:</h5>';
                    barcodeListContainer.style.display = 'block';
                    addBarcodeField(true); 
                }
                
                updateBipadosCount();

                if(btnFinishEmissao) btnFinishEmissao.style.display = 'inline-block'; 
                if(emissaoListView) emissaoListView.style.display = 'none';
                if(carrierAssignmentView) carrierAssignmentView.style.display = 'none';
                if(emissaoDetailView) emissaoDetailView.style.display = 'block';
                
                notifyServerActivity(true); // Avisa que a página está ativa

            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(error.message, "Página em Uso");
            }
        });
    }

    function renderEmissaoListPage() { 
        if(!emissaoCardListContainer || !paginationControlsContainer) return;
        emissaoCardListContainer.innerHTML = ''; paginationControlsContainer.innerHTML = '';
        if (allFinalizedEmissions.length === 0) {
            emissaoCardListContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted, #777);">Nenhuma emissão finalizada.</p>'; return;
        }
        const totalPages = Math.ceil(allFinalizedEmissions.length / itemsPerPage);
        if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
        if (currentPage < 1 && totalPages > 0) currentPage = 1; if (totalPages === 0) currentPage = 1;
        const startIndex = (currentPage - 1) * itemsPerPage; const endIndex = startIndex + itemsPerPage;
        const pageItems = allFinalizedEmissions.slice(startIndex, endIndex);
        pageItems.forEach(emissao => createAndAppendFinalizedEmissaoCardDOM(emissao.title, emissao.id));
        renderPaginationControls(totalPages);
    }

    function createAndAppendFinalizedEmissaoCardDOM(title, dbId) { 
        const card = document.createElement('div'); card.className = 'emissao-card-item';
        card.dataset.emissaoId = dbId; 
        const titleElement = document.createElement('h4'); titleElement.textContent = title;
        const actionsDiv = document.createElement('div'); actionsDiv.className = 'emissao-card-actions';
        
        const openButton = document.createElement('button'); openButton.innerHTML = '<i class="fas fa-eye"></i> Visualizar';
        openButton.className = 'btn btn-success-alt btn-icon'; openButton.title = "Visualizar Detalhes";

        openButton.addEventListener('click', async function() { 
            isNewEmissionMode = false;
            try {
                const response = await fetch(`/emissao/${dbId}/details`);
                if (!response.ok) {
                    let eMsg = `Erro ${response.status}.`; const rTxt = await response.text(); 
                    try {eMsg = JSON.parse(rTxt).message || eMsg;}catch(e){eMsg+=` Detalhe: ${rTxt.substring(0,100)}`;}
                    throw new Error(eMsg);
                }
                const details = await response.json(); 
                
                if(emissaoDetailTitle) emissaoDetailTitle.textContent = details.title;
                if(barcodeListContainer) { 
                    barcodeListContainer.innerHTML = ''; // Limpa a área
                    bipadosCounter.style.display = 'none'; // Esconde o contador
                    const h = document.createElement('h5');
                    h.textContent = 'Notas Fiscais Processadas nesta Emissão:';
                    h.style.marginBottom = '15px';
                    barcodeListContainer.appendChild(h);

                    if (details.nfe_reports && details.nfe_reports.length > 0) {
                        const ul = document.createElement('ul');
                        ul.style.listStyleType = 'decimal'; 
                        ul.style.paddingLeft = '20px'; 
                        ul.style.fontSize = "0.9em";

                        details.nfe_reports.forEach(report => {
                            const li = document.createElement('li');
                            
                            // Monta a string simples com a informação essencial
                            let infoText = `NF Nº: <strong>${report.nfe_numero || 'ERRO'}</strong> (Conta: ${report.bling_account_type || 'N/D'})`;
                            
                            // Adiciona um indicativo se foi marcada como Frenet
                            if (report.eh_frenet) {
                                infoText += ` <span class="frenet-indicator">(Frenet)</span>`;
                            }

                            // Se houve erro no processamento, exibe o status
                            if (report.status_processamento !== 'SUCCESS') {
                                infoText += ` <span class="status-error-indicator">[${report.status_processamento}]</span>`;
                            }
                            
                            li.innerHTML = infoText;
                            li.style.marginBottom = "5px";
                            ul.appendChild(li);
                        });

                        barcodeListContainer.appendChild(ul);

                    } else {
                        barcodeListContainer.innerHTML += '<p class="text-muted">Nenhum relatório de NF processado para esta emissão.</p>';
                    }
                }
                
                // Esconde o botão "Finalizar" e mostra a view de detalhes
                if(btnFinishEmissao) btnFinishEmissao.style.display = 'none'; 
                if(emissaoListView) emissaoListView.style.display = 'none'; 
                if(emissaoDetailView) emissaoDetailView.style.display = 'block';
            } catch (err) {
                ModalSystem.alert(`Erro ao carregar detalhes: ${err.message}`, 'Erro');
            }
        });

        const removeButton = document.createElement('button');
        removeButton.innerHTML = '<i class="fas fa-trash"></i> Remover';
        removeButton.className = 'btn btn-danger-alt btn-icon';
        removeButton.title = "Remover Emissão";
        removeButton.addEventListener('click', () => {
            ModalSystem.confirm(`Remover "${title}"? Esta ação é irreversível.`, 'Confirmar Remoção', async () => {
                try {
                    const resp = await fetch(`/emissao/${dbId}/remove`, { method: 'DELETE' });
                    if (!resp.ok) { const errData = await resp.json(); throw new Error(errData.message || `Erro ${resp.status}`); }
                    await fetchAllFinalizedEmissions();
                    ModalSystem.alert('Emissão removida com sucesso!', 'Sucesso');
                } catch (err) {
                    ModalSystem.alert(`Erro ao remover: ${err.message}`, 'Erro na Remoção');
                }
            });
        });
        
        actionsDiv.appendChild(openButton);
        actionsDiv.appendChild(removeButton);
        card.appendChild(titleElement);
        card.appendChild(actionsDiv);
        if(emissaoCardListContainer) emissaoCardListContainer.appendChild(card);
    }

    function renderPaginationControls(totalPages) { 
        if(!paginationControlsContainer) return; paginationControlsContainer.innerHTML = ''; if (totalPages <= 1) return; 
        const prev = document.createElement('button'); prev.innerHTML = '<i class="fas fa-chevron-left"></i> Ant'; prev.className = 'btn'; prev.disabled = currentPage === 1;
        prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderEmissaoListPage(); } }); paginationControlsContainer.appendChild(prev);
        const info = document.createElement('span'); info.className = 'page-info'; info.textContent = `Pág ${currentPage} de ${totalPages}`; paginationControlsContainer.appendChild(info);
        const next = document.createElement('button'); next.innerHTML = 'Próx <i class="fas fa-chevron-right"></i>'; next.className = 'btn'; next.disabled = currentPage === totalPages;
        next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; renderEmissaoListPage(); } }); paginationControlsContainer.appendChild(next);
    }
    
    function addBarcodeField(focusNewField = true) {
        if (!isNewEmissionMode || !barcodeListContainer) return;
        const wrapper = document.createElement('div'); wrapper.className = 'barcode-input-wrapper';
        const input = document.createElement('input'); input.type = 'text';
        input.placeholder = 'Bipe ou digite o código de barras (44 dígitos)'; input.className = 'barcode-input form-control';
        input.dataset.lastValidatedValue = ""; 

        const frenetContainer = document.createElement('div');
        frenetContainer.className = 'frenet-checkbox-container';
        frenetContainer.style.display = 'none'; // Começa escondido
        // Usar Math.random para garantir ID único
        const randomId = Math.random().toString(36).substring(2);
        frenetContainer.innerHTML = `<input type="checkbox" id="frenet_check_new_${randomId}" class="frenet-checkbox-new"><label for="frenet_check_new_${randomId}">É Frenet?</label>`;
        
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button'; deleteButton.className = 'delete-barcode-btn';
        deleteButton.innerHTML = '&times;'; deleteButton.title = 'Remover este campo';
        deleteButton.addEventListener('click', () => {
            const valueToRemove = input.dataset.lastValidatedValue;
            if (valueToRemove) currentBipadosNestaEmissaoSet.delete(valueToRemove);
            wrapper.remove();
            updateBipadosCount();
        });

        const processInput = () => {
            const barcodeValue = input.value.trim();
            if (barcodeValue === input.dataset.lastValidatedValue) return true; // Já validado, não fazer nada
            if (barcodeValue === '') { 
                frenetContainer.style.display = 'none'; 
                updateBipadosCount();
                return true; 
            }

            if (!/^\d{44}$/.test(barcodeValue)) {
                ModalSystem.alert(`Código inválido (deve ter 44 dígitos numéricos).`, "Formato Inválido", () => { input.value = ''; input.focus(); frenetContainer.style.display = 'none'; updateBipadosCount(); });
                updateBipadosCount();
                return false;
            }

            let isDuplicate = false;
            barcodeListContainer.querySelectorAll('.barcode-input').forEach(otherInput => {
                if (otherInput !== input && otherInput.value.trim() === barcodeValue) isDuplicate = true;
            });

            if (isDuplicate) {
                ModalSystem.alert(`O código "...${barcodeValue.slice(-12)}" já foi bipado nesta emissão.`, "Código Duplicado", () => { input.value = ''; input.focus(); frenetContainer.style.display = 'none'; updateBipadosCount();});
                updateBipadosCount();
                return false;
            }
            
            frenetContainer.style.display = 'flex';
            input.dataset.lastValidatedValue = barcodeValue;
            updateBipadosCount();
            return true;
        };

        input.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault(); 
                if (processInput()) {
                    updateBipadosCount();
                    const allInputs = Array.from(barcodeListContainer.querySelectorAll('.barcode-input'));
                    const currentIndex = allInputs.indexOf(this);
                    if (this.value.trim() && currentIndex === allInputs.length - 1) addBarcodeField(true);
                    else if (allInputs[currentIndex + 1]) allInputs[currentIndex + 1].focus();
                }
            }
        });
        input.addEventListener('blur', processInput);
        input.addEventListener('input', function() {
            if (this.value.trim() === '') {
                frenetContainer.style.display = 'none';
                // [NOVO] Atualiza o contador em tempo real se o campo for limpo
                updateBipadosCount();
            }
        });
        
        wrapper.appendChild(input); wrapper.appendChild(frenetContainer); //wrapper.appendChild(deleteButton);
        barcodeListContainer.appendChild(wrapper);
        if (focusNewField) input.focus();
    }

    /**
     * Processa um código de barras bipado DENTRO DA MESMA EMISSÃO (validação local).
     * Chamado no Enter ou Blur do input.
     * @param {HTMLInputElement} inputElement - O campo de input que disparou o evento.
     * @returns {boolean} - True se o código for válido (formato) e não duplicado localmente, false caso contrário.
     */
    function processBipadoInputEmissao(inputElement) {
        const barcodeValue = inputElement.value.trim();
        // inputElement.style.borderColor = ''; // Remove qualquer feedback de borda anterior

        if (barcodeValue === '') {
            // Se o campo estava previamente no Set e foi limpo, o listener 'input' já tratou.
            // Se o usuário deu blur em um campo vazio, não faz nada.
            return true; // Permite sair de campo vazio sem erro/modal
        }

        // Validação de formato (44 dígitos numéricos)
        if (!/^\d{44}$/.test(barcodeValue)) {
            ModalSystem.alert(
                `O código "${barcodeValue.substring(0,20)}..." não é uma Chave de Acesso válida (deve ter 44 dígitos numéricos).`, 
                "Formato Inválido", 
                () => { 
                    inputElement.value = ''; 
                    // Se antes tinha um valor válido no Set, remove-o
                    if (inputElement.dataset.addedToSet) {
                        currentBipadosNestaEmissaoSet.delete(inputElement.dataset.addedToSet);
                        inputElement.dataset.addedToSet = '';
                    }
                    inputElement.focus(); 
                }
            );
            return false; 
        }

        // VERIFICAÇÃO DE DUPLICIDADE NA EMISSÃO ATUAL (currentBipadosNestaEmissaoSet)
        // Verifica se o código atual já está no Set e NÃO foi o valor que este próprio input adicionou
        if (currentBipadosNestaEmissaoSet.has(barcodeValue) && inputElement.dataset.addedToSet !== barcodeValue) {
            ModalSystem.alert(
                `O código de barras "...${barcodeValue.slice(-12)}" já foi bipado anteriormente nesta emissão.`, 
                "Código Duplicado Nesta Emissão", 
                () => {
                    inputElement.value = '';
                    updateBipadosCount();
                    // Não precisa mexer no dataset.addedToSet aqui, pois o valor atual não era o "added"
                    inputElement.focus();
                }
            );
            return false; 
        }
        
        // Se o código é novo para este input e não está no Set (ou é o mesmo que este input já adicionou)
        // Remove o valor antigo do Set se o valor do input mudou
        if (inputElement.dataset.addedToSet && inputElement.dataset.addedToSet !== barcodeValue) {
            currentBipadosNestaEmissaoSet.delete(inputElement.dataset.addedToSet);
        }
        // Adiciona o novo valor válido e não duplicado ao Set e marca no input
        currentBipadosNestaEmissaoSet.add(barcodeValue);
        inputElement.dataset.addedToSet = barcodeValue;
        
        console.log(`Código "${barcodeValue.substring(0,10)}..." validado localmente e adicionado/confirmado no Set.`);
        return true; 
    }

    if (btnBackToList) {
        btnBackToList.addEventListener('click', function() {
            // Se não estamos no modo de nova emissão, apenas volta para a lista.
            if (!isNewEmissionMode) {
                emissaoDetailView.style.display = 'none';
                emissaoListView.style.display = 'block';
                return;
            }

            // Se estamos no modo de nova emissão...
            const bipadosAtuais = Array.from(barcodeListContainer.querySelectorAll('.barcode-input'))
                                    .filter(input => input.value.trim() !== '');

            // Função para ser chamada para sair e liberar a trava
            const exitAndReleaseLock = () => {
                console.log("Saindo do modo de nova emissão e liberando a trava.");
                notifyServerActivity(false); // << A chamada crucial para liberar a trava
                isNewEmissionMode = false; 
                emissaoDetailView.style.display = 'none';
                emissaoListView.style.display = 'block';
                currentBipadosNestaEmissaoSet.clear();
            };

            // Se não há nada bipado, simplesmente sai e libera a trava.
            if (bipadosAtuais.length === 0) {
                exitAndReleaseLock();
            } else {
                // Se há algo bipado, pede confirmação.
                ModalSystem.confirm(
                    "Descartar esta emissão com os códigos bipados?", 
                    "Descartar Emissão?",
                    () => { // onConfirm
                        exitAndReleaseLock();
                    },
                    () => { // onCancel
                        // Não faz nada, apenas fecha o modal, mantendo o usuário na página.
                        console.log("Descarte de emissão cancelado pelo usuário.");
                    }
                );
            }
        });
    }

    function removeDuplicateInputs(keysToRemove) {
        if (!keysToRemove || keysToRemove.length === 0) return;

        console.log("Removendo campos duplicados da tela:", keysToRemove);
        const wrappers = barcodeListContainer.querySelectorAll('.barcode-input-wrapper');
        
        wrappers.forEach(wrapper => {
            const input = wrapper.querySelector('.barcode-input');
            if (input && input.value) {
                const chaveAcesso = parseBlingBarcode(input.value.trim())?.chaveAcesso;
                if (chaveAcesso && keysToRemove.includes(chaveAcesso)) {
                    // Remove o elemento visual da tela
                    wrapper.remove();
                }
            }
        });

        updateBipadosCount();
    }

    async function proceedWithFinalize(barcodesPayload, isResubmission = false) {
        ModalSystem.showLoading('Processando emissão...');
        try {
            const response = await fetch(`/emissao/save-finalized`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: currentVirtualEmissionTitle, barcodes: barcodesPayload, isResubmissionWithCarriers: isResubmission })
            });
            const result = await response.json();
            ModalSystem.hideLoading();

            if (!response.ok) {
                // Anexa o corpo do erro ao objeto de erro para que o catch possa lê-lo
                const error = new Error(result.message || `Erro ${response.status}.`);
                error.data = result; // Guarda os dados do erro (ex: a lista de duplicatas)
                error.status = response.status;
                throw error;
            }

            if (result.status === 'carrier_assignment_required') {
                processedReportsFromFirstSubmission = result.processedReports;
                showCarrierAssignmentUI(processedReportsFromFirstSubmission); // Não precisa mais passar parâmetros
            } else {
                notifyServerActivity(false);
                ModalSystem.alert(result.message, "Sucesso", () => { window.location.href = '/emissao'; });
            }
        } catch (error) {
            ModalSystem.hideLoading();
            notifyServerActivity(false);
            
            if (error.status === 409 && error.data?.duplicateKeys) {
                playAlarmSound(); // Toca o som de alarme
                ModalSystem.alert(
                    error.message || "Foram encontradas notas duplicadas.", 
                    "Notas Duplicadas",
                    // A função de limpeza é chamada QUANDO o usuário clica em "OK"
                    () => removeDuplicateInputs(error.data.duplicateKeys)
                );
            } else {
                // Tratamento para todos os outros erros
                notifyServerActivity(false);
                ModalSystem.alert(`Erro: ${error.message}`, 'Erro ao Salvar');
            }
        }
    }

    function showCarrierAssignmentUI(reports) {
        const tbody = document.getElementById('carrierAssignmentTbody');
        const btnFinalize = document.getElementById('btnFinalizeWithCarriers');
        //const btnCancel = document.getElementById('btnCancelCarrierAssignment');
        if (!tbody || !btnFinalize || !carrierAssignmentView) return;

        tbody.innerHTML = '';
        reports.forEach(report => {
            // Adiciona uma linha na tabela apenas se a transportadora estiver faltando
            if ((report.transportador_nome === 'N/D' || report.transportador_nome === null || report.transportador_nome === '') && !report.eh_frenet) {
                const tr = tbody.insertRow();
                tr.dataset.chaveAcesso = report.nfe_chave_acesso_usada;

                tr.innerHTML = `
                    <td>${report.nfe_numero}</td>
                    <td>...${report.nfe_chave_acesso_44d.slice(-12)}</td>
                    <td>
                        <select class="form-control form-control-sm manual-carrier-select">
                            <option value="">Selecione uma transportadora...</option>
                        </select>
                    </td>
                `;
                const select = tr.querySelector('select');
                const uniqueApelidos = [...new Set(Object.values(transportadorasMap))];
                for (const apelido of uniqueApelidos.sort()) {
                    // Garante que não adicionamos uma opção vazia se existir no mapa
                    if (apelido) { 
                        const option = new Option(apelido, apelido);
                        select.add(option);
                    }
                }
            }
        });

        // Listener para o botão de finalizar desta nova tela
        // Em public/scripts/emissaoManager.js -> dentro da função showCarrierAssignmentUI

        btnFinalize.onclick = async () => {
            let allAssigned = true;
            let finalPayload = JSON.parse(JSON.stringify(processedReportsFromFirstSubmission));

            tbody.querySelectorAll('tr').forEach(tr => {
                const chave = tr.dataset.chaveAcesso;
                const select = tr.querySelector('.manual-carrier-select');
                
                if (!select.value) {
                    allAssigned = false;
                } else {
                    const reportToUpdate = finalPayload.find(r => r.nfe_chave_acesso_usada === chave);
                    if(reportToUpdate) {
                        // Apenas adicionamos a propriedade com o apelido escolhido.
                        // O backend fará o resto.
                        reportToUpdate.manualCarrierApelido = select.value;
                    }
                }
            });

            if (!allAssigned) {
                ModalSystem.alert("Por favor, atribua uma transportadora para todas as notas na lista.", "Ação Necessária");
                return;
            }

            console.log("Reenviando dados com atribuições manuais:", finalPayload);
            // A chamada para proceedWithFinalize permanece a mesma
            await proceedWithFinalize(finalPayload, true);
        };

        // Listener para o botão de cancelar/voltar
        /*btnCancel.onclick = () => {
            carrierAssignmentView.style.display = 'none';
            emissaoDetailView.style.display = 'block';
        };*/

        // Mostra a nova tela
        emissaoDetailView.style.display = 'none';
        carrierAssignmentView.style.display = 'block';
    }

    if (btnFinishEmissao) {
        btnFinishEmissao.addEventListener('click', async function() {
            if (!isNewEmissionMode) return;
            
            const barcodesData = [];
            let invalidFormatFound = false;
            
            barcodeListContainer.querySelectorAll('.barcode-input-wrapper').forEach(wrapper => {
                const input = wrapper.querySelector('.barcode-input');
                const checkbox = wrapper.querySelector('.frenet-checkbox-new');
                const barcodeValue = input.value.trim();

                if (barcodeValue) {
                    if (!/^\d{44}$/.test(barcodeValue)) {
                        invalidFormatFound = true;
                        ModalSystem.alert(`O código "${barcodeValue.substring(0,20)}..." não é uma Chave de Acesso válida.`, "Formato Inválido na Lista");
                        input.focus();
                        return;
                    }
                    barcodesData.push({
                        value: barcodeValue,
                        isFrenet: checkbox ? checkbox.checked : false
                    });
                }
            });

            if (invalidFormatFound) return;
            
            if (barcodesData.length === 0) {
                ModalSystem.confirm("Finalizar emissão vazia?", "Confirmação", async () => { await proceedWithFinalize(currentVirtualEmissionTitle, barcodesData); });
                return; 
            }
            await proceedWithFinalize(barcodesData, false);
        });
    }
    
    if (typeof fetchAllFinalizedEmissions === 'function') {
        fetchAllFinalizedEmissions(); 
    }
});

function playAlarmSound() {
    // Cria um novo objeto de áudio, apontando para o seu ficheiro de som.
    // O caminho é relativo à raiz do seu site.
    const alarmAudio = new Audio('/public/sounds/notification.mp3');

    // O método play() retorna uma Promise. Usamos .catch() para lidar com
    // possíveis erros, como restrições de autoplay do navegador.
    alarmAudio.play().catch(error => {
        // O erro é normalmente ignorado se o utilizador ainda não interagiu com a página.
        console.error("Erro ao tentar tocar o som do alarme:", error);
    });
}