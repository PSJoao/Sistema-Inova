document.addEventListener('DOMContentLoaded', function() {
    console.log('relacaoManager.js: DOMContentLoaded - Script INICIADO.');

    // --- CONSTANTES GLOBAIS PARA O SCRIPT ---
    const PREDEFINED_JUSTIFICATIONS = [
        { value: "", text: "Selecione um motivo...", isPlaceholder: true, isCancel: false },
        { value: "Não tem produto", text: "Não tem produto", isCancel: false },
        { value: "Não deu tempo de etiquetar", text: "Não deu tempo de etiquetar", isCancel: false },
        { value: "NF não localizada fisicamente", text: "NF não localizada fisicamente", isCancel: false },
        { value: "NÃO VAI SAIR (CANCELAR ENVIO)", text: "Não vai sair (Cancelar envio)", isCancel: true }
    ];

    // --- DETECÇÃO DE PÁGINA ---
    const bipagemViewEl = document.getElementById('bipagemView');
    const justificativasViewEl = document.getElementById('justificativasView'); // Presente em bipagem.hbs
    const canceladasTableEl = document.getElementById('canceladasTable');

    if (bipagemViewEl && justificativasViewEl) {
        console.log("relacaoManager.js: Página de BIPAGEM/JUSTIFICATIVA detectada. Iniciando lógica...");
        initializeBipagemAndJustificativaPage();
    } else if (canceladasTableEl) {
        console.log("relacaoManager.js: Página de CANCELADAS detectada. Iniciando lógica...");
        initializeCanceladasPage();
    } else {
        // console.log("relacaoManager.js: Nenhuma página relevante (bipagem ou canceladas) detectada por este script.");
        return; 
    }

    // --- FUNÇÕES AUXILIARES GLOBAIS ---
    function getFormattedDateTime(dateString, includeTime = true) {
        if (!dateString) return 'N/A';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return 'Data Inválida';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        if (includeTime) {
            const hours = String(d.getHours()).padStart(2, '0');
            const minutes = String(d.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        }
        return `${day}/${month}/${year}`;
    }

    function getChaveFromBipado(bipadoValue) {
        if (typeof bipadoValue !== 'string') return null;
        const cleaned = bipadoValue.replace(/\s+/g, '');
        if (cleaned.length === 44 && /^\d{44}$/.test(cleaned)) return cleaned;
        return null;
    }

    // ========================================================================
    // INICIALIZAÇÃO E LÓGICA PARA PÁGINA DE BIPAGEM E JUSTIFICATIVAS
    // ========================================================================
    function initializeBipagemAndJustificativaPage() {
        console.log("initializeBipagemAndJustificativaPage: EXECUTANDO.");
        
        const bipagemViewEl = document.getElementById('bipagemView');
        const nfsPendentesListEl = document.getElementById('nfsPendentesList');
        const bipadosListContainerEl = document.getElementById('bipadosListContainer');
        const btnFinalizarRelacaoEl = document.getElementById('btnFinalizarRelacao');
        const justificativasViewEl = document.getElementById('justificativasView');
        const justificativasListTbodyEl = document.getElementById('justificativasListContainer');
        const justificativasPaginationControlsContainerEl = document.getElementById('justificativasPaginationControlsContainer');
        const searchJustificativaNFEl = document.getElementById('searchJustificativaNF');
        const selectAllJustificationItemsCheckbox = document.getElementById('selectAllJustificationItems');
        const bulkJustificationSelectEl = document.getElementById('bulkJustificationSelect');
        const btnApplyBulkJustificationEl = document.getElementById('btnApplyBulkJustification');
        const formJustificativas = document.getElementById('formJustificativas');
        const btnCancelJustificativas = document.getElementById('btnCancelJustificativas');
        const btnVoltarEl = document.getElementById('btnVoltar');
        const totalVolumesBipadosCountEl = document.getElementById('totalVolumesBipadosCount');
        const totalPesoBipadoCountEl = document.getElementById('totalPesoBipadoCount');
        const mobileBipagemInput = document.getElementById('mobileBipagemInput');
        const clearMobileBipagemInput = document.getElementById('clearMobileBipagemInput');
        const mobileBipFooter = document.getElementById('mobileBipFooter');

        //const mapChaveAcessoToLiData = new Map();
        let transportadoraApelido = "";
        let allNaoBipadoItemsData = []; 
        let currentJustificativaPage = 1;
        const justificativaItemsPerPage = 10;
        let bipadoItemsParaEnvio = [];
        let selectedJustificationNfeIds = new Set();
        let totalPesoBipado = 0;
        if (totalPesoBipadoCountEl) {
            totalPesoBipadoCountEl.textContent = "0.000";
        }
        // Verificações de elementos DOM
        if (!nfsPendentesListEl) console.error("BIPAGEM ERRO: #nfsPendentesList não encontrado!");
        if (!bipadosListContainerEl) console.error("BIPAGEM ERRO: #bipadosListContainer não encontrado!");
        if (!btnFinalizarRelacaoEl) console.error("BIPAGEM ERRO: #btnFinalizarRelacao não encontrado!");
        if (!justificativasViewEl) console.error("BIPAGEM ERRO: #justificativasView não encontrado!");
        if (!justificativasListTbodyEl) console.error("BIPAGEM ERRO: #justificativasListContainer (tbody) não encontrado!");
        // Adicione mais verificações se necessário
        
        if (!bipagemViewEl) { console.error("FATAL: #bipagemView não encontrado!"); return; }

        // --- CORREÇÃO PRINCIPAL: Pega o apelido do atributo data- ---
        transportadoraApelido = bipagemViewEl.dataset.transportadoraApelido || "DESCONHECIDA";
        if (transportadoraApelido === "DESCONHECIDA") {
            playAlarmSound();
            console.error("ERRO CRÍTICO: Atributo 'data-transportadora-apelido' não encontrado no elemento #bipagemView.");
            ModalSystem.alert("Erro de configuração: Apelido da transportadora não encontrado.", "Erro Crítico");
        }
        document.getElementById('justificativaTransportadoraNome').textContent = transportadoraApelido;
        const nfsState = new Map();

        if (mobileBipagemInput) {
            mobileBipagemInput.addEventListener('keypress', handleMobileBipagemKeyPress);
        }
        if (clearMobileBipagemInput) {
            clearMobileBipagemInput.addEventListener('click', () => {
                if(mobileBipagemInput) {
                    mobileBipagemInput.value = '';
                    mobileBipagemInput.focus();
                }
            });
        }

        function handleMobileBipagemKeyPress(e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();

            const bipadoValue = mobileBipagemInput.value.trim();
            if (bipadoValue === '') return;

            // 1. Validações (copiadas de processBipadoInput)
            const chaveBipada = getChaveFromBipado(bipadoValue);
            if (!chaveBipada) {
                playAlarmSound();
                ModalSystem.alert(`Chave inválida.`, "Formato Inválido", () => {
                    mobileBipagemInput.value = '';
                    mobileBipagemInput.focus();
                });
                return;
            }
            
            const notaState = nfsState.get(chaveBipada);
            if (!notaState) {
                playAlarmSound();
                ModalSystem.alert(`NF não encontrada nas pendentes.`, "NF Não Encontrada", () => {
                    mobileBipagemInput.value = '';
                    mobileBipagemInput.focus();
                });
                return;
            }
            
            if (notaState.bipado >= notaState.total) {
                playAlarmSound();
                ModalSystem.alert(`Todos os volumes para a NF ...${chaveBipada.slice(-9)} já foram bipados.`, "Volumes Completos");
                mobileBipagemInput.value = ''; // Limpa o input móvel
                mobileBipagemInput.focus();
                return;
            }

            // 2. Encontra o próximo input VAZIO na lista de bipagem
            const allInputs = Array.from(bipadosListContainerEl.querySelectorAll('.bipado-barcode-input'));
            const emptyInput = allInputs.find(inp => !inp.value.trim());

            if (emptyInput) {
                // 3. Preenche o input vazio e o processa
                emptyInput.value = bipadoValue;
                processBipadoInput(emptyInput); // Chama a lógica original
            } else {
                // (Isso não deve acontecer se ensureSingleEmptyField funcionar, mas é uma segurança)
                // Adiciona um novo campo e o processa
                const newEmptyInput = addBipadoField(false, bipadoValue); // Adiciona sem focar
                if(newEmptyInput) processBipadoInput(newEmptyInput);
            }

            // 4. Limpa e foca o input móvel
            mobileBipagemInput.value = '';
            mobileBipagemInput.focus();
        }

        function processBipadoInput(inputElement) {
            const bipadoValue = inputElement.value.trim();

            // [NOVO] Impede o reprocessamento desnecessário do mesmo valor,
            // que causava a soma duplicada do peso ao clicar fora do campo.
            if (inputElement.dataset.processedValue === bipadoValue && bipadoValue !== '') {
                return;
            }

            // Primeiro, limpa qualquer estado anterior que este input possa ter tido.
            clearInputState(inputElement);

            // Se o campo ficou vazio, apenas atualiza a UI geral e termina.
            if (bipadoValue === '') {
                updateTotalAndMarkerUI();
                return;
            }

            // --- Validações (como antes) ---
            const chaveBipada = getChaveFromBipado(bipadoValue);
            if (!chaveBipada) { playAlarmSound(); ModalSystem.alert(`Chave inválida.`, "Formato Inválido", () => { inputElement.value = ''; inputElement.focus(); }); return; }
            
            const notaState = nfsState.get(chaveBipada);
            if (!notaState) { playAlarmSound(); ModalSystem.alert(`NF não encontrada nas pendentes.`, "NF Não Encontrada", () => { inputElement.value = ''; inputElement.focus(); }); return; }
            
            if (notaState.bipado >= notaState.total) { playAlarmSound(); ModalSystem.alert(`Todos os volumes para a NF ...${chaveBipada.slice(-9)} já foram bipados.`, "Volumes Completos"); inputElement.value = ''; return; }

            // --- Atualização de Estado (se passou nas validações) ---
            notaState.bipado++;
            notaState.inputs.push(inputElement);
            inputElement.dataset.matchedChave = chaveBipada;
            inputElement.dataset.processedValue = bipadoValue; // Marca que este valor foi processado.

            // Chama a função central para atualizar a nota e o peso, se necessário.
            updateNoteDisplay(chaveBipada);
            updateTotalAndMarkerUI();
            ensureSingleEmptyField();
        }

        function clearInputState(inputElement) {
            const prevChave = inputElement.dataset.matchedChave;
            if (prevChave) {
                const notaState = nfsState.get(prevChave);
                if (notaState) {
                    notaState.bipado--;
                    notaState.inputs = notaState.inputs.filter(inp => inp !== inputElement);
                    updateNoteDisplay(prevChave);
                }
                delete inputElement.dataset.matchedChave;
            }
        }

        function ensureSingleEmptyField() {
            const allInputs = Array.from(bipadosListContainerEl.querySelectorAll('.barcode-input'));
            const emptyInputs = allInputs.filter(inp => !inp.value.trim());
            
            // Remove todos os campos vazios extras
            while (emptyInputs.length > 1) {
                emptyInputs.pop().closest('.barcode-input-wrapper').remove();
            }
            // Se não houver nenhum campo vazio, adiciona um
            if (emptyInputs.length === 0) {
                addBipadoField(true);
            }
        }

        if (nfsPendentesListEl) {
            nfsPendentesListEl.querySelectorAll('li[data-chave]').forEach(li => {
                const chave = li.dataset.chave;
                const total = parseInt(li.querySelector('.volume-counter')?.dataset.totalVolumes, 10) || 0;
                const justificativa = li.dataset.justificativa || ""; // Pega a justificativa do atributo
                
                nfsState.set(chave, { 
                    total, 
                    bipado: 0, 
                    liElement: li, 
                    inputs: [], 
                    idRelatorio: li.dataset.idrelatorio, 
                    numeroNF: li.dataset.nfnumero, 
                    produtos: li.dataset.produtos,
                    justificativa: justificativa, // Armazena no estado da NF
                    isComplete: false
                });
            });
        }

        function reinitializeState() {
            nfsState.clear(); // Limpa o mapa de estado antigo
            nfsPendentesListEl.querySelectorAll('li.nf-list-item[data-chave]').forEach(li => {
                const chave = li.dataset.chave;
                const total = parseInt(li.dataset.totalVolumes, 10) || 0;
                
                nfsState.set(chave, { 
                    total, 
                    bipado: 0, 
                    liElement: li, 
                    inputs: [], 
                    idRelatorio: li.dataset.idrelatorio, 
                    numeroNF: li.dataset.nfnumero, 
                    produtos: li.dataset.produtos,
                    justificativa: li.dataset.justificativa
                });
            });
            console.log("Estado da página reinicializado após a atualização.");
        }

        function abrirModalDeEdicaoVolumes(nfeId, nfeNumero, currentVolumes) {
            const modalContent = `
                <div>
                    <p>Nota Fiscal Nº: <strong>${nfeNumero}</strong></p>
                    <div class="form-group">
                        <label for="newVolumesInput">Nova quantidade de volumes:</label>
                        <input type="number" id="newVolumesInput" class="form-control" value="${currentVolumes}" min="0" style="margin-top: 8px;">
                    </div>
                </div>
            `;

            ModalSystem.confirm(
                modalContent, "Alterar Volumes da Nota",
                async () => { // onConfirm
                    const modalElement = document.getElementById('customModal');
                    const input = modalElement.querySelector('#newVolumesInput');
                    if (!input) {
                        console.error("Não foi possível encontrar o campo de input do modal.");
                        return;
                    }
                    const newVolumes = parseInt(input.value, 10);

                    if (isNaN(newVolumes) || newVolumes < 0) {
                        playAlarmSound();
                        ModalSystem.alert("Por favor, insira um número válido de volumes.", "Entrada Inválida");
                        return;
                    }

                    try {
                        const response = await fetch(`/api/relacoes/nfe/${nfeId}/update-volumes`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ newVolumes })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.message);
                        
                        ModalSystem.alert(result.message, "Sucesso");
                        
                        let chaveDaNotaAlterada = null;
                        let estadoDaNota = null;
                        for (const [chave, estado] of nfsState.entries()) {
                            if (String(estado.idRelatorio) === String(nfeId)) {
                                chaveDaNotaAlterada = chave;
                                estadoDaNota = estado;
                                break;
                            }
                        }

                        if (chaveDaNotaAlterada && estadoDaNota) {
                            const inputsParaRemover = [];
                            bipadosListContainerEl.querySelectorAll('.bipado-barcode-input').forEach(inp => {
                                if (inp.dataset.matchedChave === chaveDaNotaAlterada) {
                                    inputsParaRemover.push(inp);
                                }
                            });

                            // [CORREÇÃO] Antes de remover os inputs, verifica se a nota ESTAVA completa para remover o peso.
                            if (estadoDaNota.isComplete) {
                                updatePesoTotal(estadoDaNota.numeroNF, 'remove');
                            }

                            inputsParaRemover.forEach(inp => {
                                inp.closest('.barcode-input-wrapper').remove();
                            });
                            
                            estadoDaNota.total = newVolumes;
                            estadoDaNota.bipado = 0;
                            estadoDaNota.liElement.dataset.totalVolumes = newVolumes;
                            const totalCountEl = estadoDaNota.liElement.querySelector('.total-count');
                            const bipadoCountEl = estadoDaNota.liElement.querySelector('.bipado-count');
                            if (totalCountEl) totalCountEl.textContent = newVolumes;
                            if (bipadoCountEl) bipadoCountEl.textContent = 0;
                            
                            // Garante que a nota reapareça na lista e o estado 'isComplete' seja resetado.
                            updateNoteDisplay(chaveDaNotaAlterada);
                        }
                        
                        updateTotalAndMarkerUI();
                        ensureSingleEmptyField();

                    } catch (error) {
                        playAlarmSound();
                        ModalSystem.alert(`Erro ao atualizar: ${error.message}`, "Falha na Operação");
                    }
                },
                () => { console.log("Edição de volumes cancelada."); },
                { confirmText: "Atualizar", cancelText: "Cancelar", isHtml: true }
            );
        }

        nfsPendentesListEl.addEventListener('click', function(event) {
            const target = event.target;
            const listItem = target.closest('.nf-list-item');

            // Garante que o clique não foi no botão de adicionar ou no select de justificar
            if (listItem && !target.closest('.btn-add-nfe') && !target.closest('.justification-select')) {
                const nfeId = listItem.dataset.idrelatorio;
                const nfeNumero = listItem.dataset.nfnumero;
                const currentVolumes = listItem.dataset.totalVolumes;
                
                // Chama a função que abre o modal de edição
                abrirModalDeEdicaoVolumes(nfeId, nfeNumero, currentVolumes);
            }
        });

        reinitializeState();

        function addBipadoField(focusNewField = true, value = "") {
            const wrapper = document.createElement('div');
            wrapper.className = 'barcode-input-wrapper';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Bipe a Chave de Acesso';
            input.className = 'bipado-barcode-input form-control';
            input.value = value;
            
            // Adiciona os listeners de evento diretamente
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    processBipadoInput(this);
                    // Move o foco para o próximo campo de input, se existir
                    const nextWrapper = wrapper.nextElementSibling;
                    if (nextWrapper && nextWrapper.classList.contains('barcode-input-wrapper')) {
                        nextWrapper.querySelector('.bipado-barcode-input').focus();
                    }
                }
            });
            input.addEventListener('blur', function() { processBipadoInput(this); });
            // O listener de 'input' agora é crucial para a atualização em tempo real
            input.addEventListener('input', function() {
                if (this.value.trim() === '' && this.dataset.matchedChave) {
                    clearInputState(this);
                    updateTotalAndMarkerUI();
                }
            });

            wrapper.appendChild(input);
            bipadosListContainerEl.appendChild(wrapper);
            if (focusNewField) input.focus();

            return input;
        }

        const preRenderedInputs = bipadosListContainerEl.querySelectorAll('.bipado-barcode-input');
        if (preRenderedInputs.length > 0) {
            console.log(`Encontrados ${preRenderedInputs.length} inputs pré-renderizados. Processando...`);
            
            // Etapa 1: "Processamento Silencioso" - Apenas atualiza os contadores de volume, sem chamar a API de peso.
            preRenderedInputs.forEach(input => {
                addListenersToInput(input);
                const bipadoValue = input.value.trim();
                const chaveBipada = getChaveFromBipado(bipadoValue);
                if (chaveBipada) {
                    const notaState = nfsState.get(chaveBipada);
                    if (notaState) {
                        notaState.bipado++;
                        notaState.inputs.push(input);
                        input.dataset.matchedChave = chaveBipada;
                        input.dataset.processedValue = bipadoValue;
                    }
                }
            });
            
            // Etapa 2: "Cálculo Inicial Centralizado" - Após contar todos os volumes, calcula o peso de uma só vez.
            const nfsCompletasInicialmente = new Set();
            nfsState.forEach(state => {
                const estaCompleta = (state.bipado >= state.total) && (state.total > 0);
                state.isComplete = estaCompleta; // Atualiza a flag
                if (estaCompleta) {
                    nfsCompletasInicialmente.add(state.numeroNF);
                    state.liElement.style.display = 'none'; // Esconde a nota da lista de pendentes
                }
                // Atualiza o contador de volume visual da nota
                const counterElement = state.liElement.querySelector('.bipado-count');
                if (counterElement) counterElement.textContent = state.bipado;
            });

            if (nfsCompletasInicialmente.size > 0) {
                console.log("Calculando peso inicial para NFs já completas:", [...nfsCompletasInicialmente]);
                updatePesoTotal([...nfsCompletasInicialmente], 'add');
            }
        }

        const emptyInputs = Array.from(bipadosListContainerEl.querySelectorAll('.bipado-barcode-input')).filter(inp => !inp.value.trim());

        while (emptyInputs.length > 1) {
            const inputToRemove = emptyInputs.pop();
            inputToRemove.closest('.barcode-input-wrapper').remove();
        }

        if (emptyInputs.length === 0) {
            addBipadoField(true);
        }

        //addBipadoField(preRenderedInputs.length === 0);
        updateTotalBipadoCounter();
        updateMarkerButtonPosition();

        if (btnVoltarEl) {
            btnVoltarEl.addEventListener('click', function(event) {
                event.preventDefault();
                const targetUrl = this.href;

                const barcodesToSave = Array.from(bipadosListContainerEl.querySelectorAll('.bipado-barcode-input'))
                    .map(input => input.value.trim())
                    .filter(value => value);

                if (barcodesToSave.length === 0) {
                    window.location.href = targetUrl;
                    return;
                }

                ModalSystem.confirm(
                    "Deseja salvar o progresso da bipagem antes de sair?",
                    "Salvar Progresso?",
                    async () => { // onConfirm (Salvar e Sair)
                        // Esta parte continua como está
                        ModalSystem.showLoading("Salvando...");
                        try {
                            await fetch(`/api/relacoes/${transportadoraApelido}/save-state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ barcodes: barcodesToSave }) });
                            window.location.href = targetUrl;
                        } catch (error) {
                            ModalSystem.hideLoading();
                            playAlarmSound();
                            ModalSystem.alert(`Erro ao salvar: ${error.message}`, "Erro");
                        }
                    },
                    async () => { // onCancel (Sair sem Salvar) - AGORA É ASSÍNCRONO
                        ModalSystem.showLoading("Descartando alterações...");
                        try {
                            // Chama a nova rota DELETE para limpar o estado no banco
                            await fetch(`/api/relacoes/${transportadoraApelido}/clear-state`, { method: 'DELETE' });
                            // Só navega DEPOIS que o estado foi limpo com sucesso
                            window.location.href = targetUrl;
                        } catch (error) {
                            ModalSystem.hideLoading();
                            playAlarmSound();
                            ModalSystem.alert(`Erro ao limpar o estado salvo: ${error.message}`, "Erro");
                        }
                    },
                    { confirmText: "Salvar e Sair", cancelText: "Sair sem Salvar" }
                );
            });
        }

        function processBipadoInput(inputElement, focusNext = true) {
            clearInputState(inputElement);
            const bipadoValue = inputElement.value.trim();
            if (bipadoValue === '') return;

            const chaveBipada = getChaveFromBipado(bipadoValue);
            if (!chaveBipada) { playAlarmSound(); ModalSystem.alert(`Chave inválida.`, "Formato Inválido", () => { inputElement.value = ''; inputElement.focus(); }); return; }

            const notaState = nfsState.get(chaveBipada);
            if (!notaState) { playAlarmSound(); ModalSystem.alert(`NF não encontrada nas pendentes.`, "NF Não Encontrada", () => { inputElement.value = ''; inputElement.focus(); }); return; }
            
            // Valida se todos os volumes já foram bipados
            if (notaState.bipado >= notaState.total) {
                playAlarmSound();
                ModalSystem.alert(`Todos os volumes para a NF ...${chaveBipada.slice(-9)} já foram bipados.`, "Volumes Completos");
                inputElement.value = ''; return;
            }

            // Incrementa o contador e associa o input à nota
            notaState.bipado++;
            notaState.inputs.push(inputElement);
            inputElement.dataset.matchedChave = chaveBipada;
            
            updateNoteDisplay(chaveBipada);
            updateTotalBipadoCounter();
            updateMarkerButtonPosition();

            if (focusNext && inputElement.value.trim()) {
                const allInputs = Array.from(bipadosListContainerEl.querySelectorAll('.bipado-barcode-input'));
                if (allInputs.indexOf(inputElement) === allInputs.length - 1) addBipadoField(true);
            }
        }

        async function updatePesoTotal(numeros, action) {
            // [CORREÇÃO] Renomeado para 'numeros' para maior clareza
            // Garante que estamos sempre trabalhando com um array simples.
            const nfeNumeros = Array.isArray(numeros) ? numeros : [numeros];

            // Se o array resultante estiver vazio ou só contiver um item inválido, não faz nada.
            if (nfeNumeros.length === 0 || (nfeNumeros.length === 1 && !nfeNumeros[0])) {
                return;
            }
        
            try {
                const response = await fetch('/api/relacoes/get-nfe-weight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // [CORREÇÃO] Enviamos o array diretamente, que agora está sempre no formato correto.
                    body: JSON.stringify({ nfeNumeros: nfeNumeros }) 
                });
        
                if (!response.ok) throw new Error('Falha ao buscar peso da NF.');
        
                const data = await response.json();
                console.log(data);
                const pesoDaNota = data.totalWeight || 0;
        
                if (action === 'add') {
                    totalPesoBipado += pesoDaNota;
                } else if (action === 'remove') {
                    totalPesoBipado -= pesoDaNota;
                }
        
                // Garante que o peso não fique negativo por algum erro
                if (totalPesoBipado < 0) totalPesoBipado = 0;
        
                // Atualiza o elemento na tela
                if (totalPesoBipadoCountEl) {
                    totalPesoBipadoCountEl.textContent = totalPesoBipado.toFixed(3);
                }
        
            } catch (error) {
                console.error("Erro ao atualizar peso total:", error);
            }
        }

        function clearInputState(inputElement) {
            const prevChave = inputElement.dataset.matchedChave;
            if (prevChave) {
                const notaState = nfsState.get(prevChave);
                if (notaState) {
                    // Verifica se a nota ESTAVA completa antes de remover este volume
                    const estavaCompleta = notaState.bipado >= notaState.total;

                    notaState.bipado--;
                    notaState.inputs = notaState.inputs.filter(inp => inp !== inputElement);
                    updateNoteDisplay(prevChave); // Atualiza a UI da nota

                    // Se estava completa e agora não está mais, remove o peso
                    if (estavaCompleta) {
                        updatePesoTotal(notaState.numeroNF, 'remove');
                    }
                }
                delete inputElement.dataset.matchedChave;
            }
        }

        function updateTotalAndMarkerUI() {
            let totalBipadoGeral = 0; nfsState.forEach(state => totalBipadoGeral += state.bipado);
            if (totalVolumesBipadosCountEl) totalVolumesBipadosCountEl.textContent = totalBipadoGeral;
            updateMarkerButtonPosition();
        }

        function updateNoteDisplay(chave) {
            const notaState = nfsState.get(chave);
            if (!notaState) return;

            // 1. Determina o estado de "completude" ANTES e AGORA.
            const estavaCompletaAntes = notaState.isComplete === true;
            const estaCompletaAgora = (notaState.bipado >= notaState.total) && (notaState.total > 0);

            // 2. Atualiza a UI da nota na lista da esquerda (contador e visibilidade).
            const counterElement = notaState.liElement.querySelector('.bipado-count');
            if (counterElement) counterElement.textContent = notaState.bipado;
            notaState.liElement.style.display = estaCompletaAgora ? 'none' : 'flex';
            if (nfsPendentesListEl && !estaCompletaAgora) {
                nfsPendentesListEl.prepend(notaState.liElement);
            }

            // 3. [LÓGICA CENTRAL] Decide se o peso deve ser alterado, baseado na mudança de estado.
            if (!estavaCompletaAntes && estaCompletaAgora) {
                // Se a nota NÃO estava completa e AGORA ESTÁ, adiciona o peso.
                console.log(`NF ${notaState.numeroNF} ficou COMPLETA. Adicionando peso.`);
                updatePesoTotal(notaState.numeroNF, 'add');
            } else if (estavaCompletaAntes && !estaCompletaAgora) {
                // Se a nota ESTAVA completa e AGORA NÃO ESTÁ MAIS, remove o peso.
                console.log(`NF ${notaState.numeroNF} ficou INCOMPLETA. Removendo peso.`);
                updatePesoTotal(notaState.numeroNF, 'remove');
            }

            // 4. Atualiza a flag de estado para a próxima verificação.
            notaState.isComplete = estaCompletaAgora;
        }

        function updateTotalBipadoCounter() {
            if (!totalVolumesBipadosCountEl) return;
            let total = 0;
            nfsState.forEach(state => {
                total += state.bipado;
            });
            totalVolumesBipadosCountEl.textContent = total;
        }

        // Função que atualiza o estado quando um campo é limpo
        function clearInputState(inputElement) {
            const prevChave = inputElement.dataset.matchedChave;
            if (prevChave) {
                const notaState = nfsState.get(prevChave);
                if (notaState) {
                    notaState.bipado--;
                    notaState.inputs = notaState.inputs.filter(inp => inp !== inputElement);
                    // Apenas chama a função principal que já contém toda a lógica de peso e UI.
                    updateNoteDisplay(prevChave);
                }
            }
            // Limpa os atributos do input para que ele possa ser processado novamente.
            delete inputElement.dataset.matchedChave;
            delete inputElement.dataset.processedValue;
        }


        function addListenersToInput(inputElement) {
            inputElement.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    processBipadoInput(this); // Processa o input atual
                    
                    // Move o foco para o próximo campo de input, se existir
                    const nextWrapper = this.closest('.barcode-input-wrapper').nextElementSibling;
                    if (nextWrapper && nextWrapper.classList.contains('barcode-input-wrapper')) {
                        nextWrapper.querySelector('.bipado-barcode-input').focus();
                    }
                }
            });
        
            inputElement.addEventListener('blur', function() {
                // O 'blur' agora só chama a função de processamento, que é mais inteligente.
                processBipadoInput(this);
            });
        
            // O 'input' é usado para detectar quando o usuário apaga o conteúdo.
            inputElement.addEventListener('input', function() {
                if (this.value.trim() === '') {
                    // Se o campo foi limpo, chama a função para reverter o estado.
                    clearInputState(this);
                    updateTotalAndMarkerUI();
                }
            });
        }

        function updateMarkerButtonPosition() {
            document.getElementById('markerBtn')?.remove(); // Remove o botão antigo, se existir
            
            const allElements = Array.from(bipadosListContainerEl.children);
            let lastFilledWrapper = null;
            // Procura o último elemento que é um input preenchido, antes de qualquer marcador.
            for (let i = allElements.length - 1; i >= 0; i--) {
                const el = allElements[i];
                if (el.classList.contains('bipagem-marker')) break; // Para se encontrar um marcador
                if (el.classList.contains('barcode-input-wrapper') && el.querySelector('.bipado-barcode-input').value) {
                    lastFilledWrapper = el;
                    break;
                }
            }

            if (lastFilledWrapper) {
                const markerBtn = document.createElement('button');
                markerBtn.id = 'markerBtn';
                markerBtn.type = 'button';
                markerBtn.className = 'btn btn-secondary-custom btn-sm btn-create-marker';
                markerBtn.textContent = 'Criar Marcação';
                markerBtn.onclick = createMarker;
                lastFilledWrapper.appendChild(markerBtn);
            }
        }

        function createMarker() {
            const markerButtonWrapper = this.closest('.barcode-input-wrapper');
            const allElementsInContainer = Array.from(bipadosListContainerEl.children);
            const markerPositionIndex = allElementsInContainer.indexOf(markerButtonWrapper);

            let lastMarkerPosition = -1;
            allElementsInContainer.forEach((el, index) => {
                if (index < markerPositionIndex && el.classList.contains('bipagem-marker')) {
                    lastMarkerPosition = index;
                }
            });

            let volumesNestaMarcacao = 0;
            for (let i = lastMarkerPosition + 1; i <= markerPositionIndex; i++) {
                if (allElementsInContainer[i].classList.contains('barcode-input-wrapper')) {
                    volumesNestaMarcacao++;
                }
            }
            const markerDiv = document.createElement('div'); markerDiv.className = 'bipagem-marker';
            markerDiv.innerHTML = `<hr><span>Volumes na marcação: ${volumesNestaMarcacao}</span><hr>`;
            markerButtonWrapper.insertAdjacentElement('afterend', markerDiv);
            this.remove();
        }

        function clearMatchForInput(inputElement) {
            const previouslyMatchedChave = inputElement.dataset.matchedChave;
            if (previouslyMatchedChave) {
                const matchedData = nfsState.get(previouslyMatchedChave);
                if (matchedData && matchedData.element) {
                    const matchedLiElement = matchedData.element;
                    let stillMatchedByAnother = false;
                    if(bipadosListContainerEl) {
                        bipadosListContainerEl.querySelectorAll('.bipado-barcode-input').forEach(inp => { if (inp !== inputElement && inp.dataset.matchedChave === previouslyMatchedChave) stillMatchedByAnother = true; });
                    }
                    if (!stillMatchedByAnother) matchedLiElement.style.display = 'flex'; // Ou 'list-item'
                }
                delete inputElement.dataset.matchedChave; delete inputElement.dataset.idrelatorioMatched;
            }
            inputElement.dataset.processedValue = "";
        }
        
        function populateJustificationDropdown(selectElement, selectedValue = "") {
            selectElement.innerHTML = ''; 
            PREDEFINED_JUSTIFICATIONS.forEach(just => {
                const option = document.createElement('option'); option.value = just.value; option.textContent = just.text;
                if (just.isPlaceholder) option.disabled = true;
                option.selected = (just.value === selectedValue || (just.isPlaceholder && (!selectedValue || selectedValue === "")));
                selectElement.appendChild(option);
            });
        }
        
        if (bulkJustificationSelectEl) populateJustificationDropdown(bulkJustificationSelectEl);

        function renderJustificativasPage(page = 1) {
            if (!justificativasListTbodyEl || !justificativasPaginationControlsContainerEl || !searchJustificativaNFEl) {
                console.error("Elementos da UI de justificativa não encontrados para renderização.");
                return;
            }
            currentJustificativaPage = page;
            const searchTerm = searchJustificativaNFEl.value.toLowerCase();
            const filteredItems = allNaoBipadoItemsData.filter(item => 
                item.numeroNF.toLowerCase().includes(searchTerm) || 
                (item.produtos && item.produtos.toLowerCase().includes(searchTerm))
            );

            justificativasListTbodyEl.innerHTML = ''; 
            if (filteredItems.length === 0) {
                justificativasListTbodyEl.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Nenhuma NF para justificar (ou corresponde à busca).</td></tr>';
                renderJustificativasPaginationControls(0); return;
            }
            const totalPages = Math.ceil(filteredItems.length / justificativaItemsPerPage);
            if (currentJustificativaPage > totalPages && totalPages > 0) currentJustificativaPage = totalPages;
            if (currentJustificativaPage < 1 && totalPages > 0) currentJustificativaPage = 1;
            const startIndex = (currentJustificativaPage - 1) * justificativaItemsPerPage;
            const pageItems = filteredItems.slice(startIndex, startIndex + justificativaItemsPerPage);

            pageItems.forEach(item => {
                const tr = justificativasListTbodyEl.insertRow(); tr.className = 'justification-item'; tr.dataset.nfeReportId = item.idRelatorio;
                const selectId = `justSelect_${item.idRelatorio}`; const bulkSelectId = `bulkJustify_${item.idRelatorio}`;
                
                // [ALTERAÇÃO AQUI] Adicionamos a verificação 'checked' diretamente no HTML
                const isChecked = selectedJustificationNfeIds.has(String(item.idRelatorio));

                tr.innerHTML = `
                    <td style="text-align:center;"><input type="checkbox" id="${bulkSelectId}" class="form-check-input bulk-select-justification" ${isChecked ? 'checked' : ''}></td>
                    <td class="nf-numero-just"><strong>${item.numeroNF}</strong></td>
                    <td class="nf-produtos-just">${item.produtos || 'N/D'}</td>
                    <td><select id="${selectId}" class="form-control form-control-sm justification-reason-select"></select></td>`;
                const reasonSelect = tr.querySelector(`#${selectId}`);
                populateJustificationDropdown(reasonSelect, item.selectedJustification);
                function applyColorClass(selectElement) {
                    // Limpa classes antigas
                    selectElement.classList.remove('just-nao-tem-produto', 'just-nao-deu-tempo', 'just-nao-localizada', 'just-cancelar');
                    
                    // Converte o valor em um nome de classe CSS amigável
                    if (selectElement.value === "Não tem produto") {
                        selectElement.classList.add('just-nao-tem-produto');
                    } else if (selectElement.value === "Não deu tempo de etiquetar") {
                        selectElement.classList.add('just-nao-deu-tempo');
                    } else if (selectElement.value === "NF não localizada fisicamente") {
                        selectElement.classList.add('just-nao-localizada');
                    } else if (selectElement.value === "NÃO VAI SAIR (CANCELAR ENVIO)") {
                        selectElement.classList.add('just-cancelar');
                    }
                }
                applyColorClass(reasonSelect);
                reasonSelect.addEventListener('change', function() {
                    const originalItem = allNaoBipadoItemsData.find(it => String(it.idRelatorio) === String(item.idRelatorio));
                    if (originalItem) {
                        originalItem.selectedJustification = this.value;
                        const selectedOptionData = PREDEFINED_JUSTIFICATIONS.find(j => j.value === this.value);
                        originalItem.naoVaiSair = selectedOptionData?.isCancelOption === true;
                    }
                    applyColorClass(this);
                });
            });
            renderJustificativasPaginationControls(totalPages);
            updateSelectAllCheckboxState(); 
        }
        
        function renderJustificativasPaginationControls(totalPages) { 
             if (!justificativasPaginationControlsContainerEl) return;
            justificativasPaginationControlsContainerEl.innerHTML = ''; if (totalPages <= 1) return;
            const prev = document.createElement('button'); prev.innerHTML = '<i class="fas fa-chevron-left"></i> Ant';
            prev.className = 'btn btn-sm'; prev.disabled = currentJustificativaPage === 1;
            prev.addEventListener('click', () => { if (currentJustificativaPage > 1) renderJustificativasPage(currentJustificativaPage - 1); });
            justificativasPaginationControlsContainerEl.appendChild(prev);
            const info = document.createElement('span'); info.className = 'page-info'; info.textContent = `Página ${currentJustificativaPage} de ${totalPages}`;
            justificativasPaginationControlsContainerEl.appendChild(info);
            const next = document.createElement('button'); next.innerHTML = 'Próx <i class="fas fa-chevron-right"></i>';
            next.className = 'btn btn-sm'; next.disabled = currentJustificativaPage === totalPages;
            next.addEventListener('click', () => { if (currentJustificativaPage < totalPages) renderJustificativasPage(currentJustificativaPage + 1); });
            justificativasPaginationControlsContainerEl.appendChild(next);
        }

        async function enviarDadosFinalizados(transportadoraApelido, bipadoItems, naoBipadoItemsComJustificativa, editingRelationId = null) {
            console.log("Enviando:", { transportadoraApelido, bipadoItems, naoBipadoItemsComJustificativa });
            if (!transportadoraApelido || transportadoraApelido === "DESCONHECIDA") { playAlarmSound(); ModalSystem.alert("Transportadora não identificada.", "Erro Crítico"); return; }
            ModalSystem.showLoading("Finalizando Relação e Gerando Excel...");
            try {
                const response = await fetch(`/relacoes/${transportadoraApelido}/finalize`, { 
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bipadoItems, naoBipadoItems: naoBipadoItemsComJustificativa, editingRelationId })
                });
                ModalSystem.hideLoading();
                if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.message || `Erro ${response.status}.`); }
                const result = await response.json();
                let successMessageHtml = `<p>${result.message || "Relação finalizada!"}</p>`;
                // Container para os botões de ação dentro do modal
                successMessageHtml += `<div class="modal-actions-container" style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">`;

                // --- Botão de Imprimir ---
                if (result.relationId) {
                    const printUrl = `/relacoes/print/${result.relationId}`;
                    // O target="_blank" abre a página de impressão em uma nova aba
                    successMessageHtml += `<a href="${printUrl}" target="_blank" class="btn btn-accent"><i class="fas fa-print"></i> Imprimir Relação</a>`;
                }

                // --- Botão de Baixar Excel (como antes) ---
                /*if (result.excelPath) {
                    const downloadUrl = `/relacoes/download/workbook/${encodeURIComponent(result.excelPath)}`;
                    successMessageHtml += `<a href="${downloadUrl}" class="btn btn-success-alt" download><i class="fas fa-file-excel"></i> Baixar Excel</a>`;
                } else {
                    successMessageHtml += `<p style="margin-top:10px;color:var(--color-warning);">Relatório Excel não foi gerado.</p>`;
                }*/

                successMessageHtml += `</div>`;
                ModalSystem.alert(successMessageHtml, "Sucesso", () => { window.location.href = '/relacoes'; });
            } catch (error) { playAlarmSound(); ModalSystem.hideLoading(); ModalSystem.alert(`Erro: ${error.message}`, "Erro no Servidor"); }
        }

        if(searchJustificativaNFEl) searchJustificativaNFEl.addEventListener('input', () => renderJustificativasPage(1));
        
        function updateSelectAllCheckboxState() {
            if (selectAllJustificationItemsCheckbox && justificativasListTbodyEl) {
                const visibleCheckboxes = justificativasListTbodyEl.querySelectorAll('tr.justification-item .bulk-select-justification');
                if (visibleCheckboxes.length === 0) {
                    selectAllJustificationItemsCheckbox.checked = false;
                    selectAllJustificationItemsCheckbox.indeterminate = false;
                    return;
                }
                const checkedVisibleCount = Array.from(visibleCheckboxes).filter(cb => cb.checked).length;
                if (checkedVisibleCount === 0) {
                    selectAllJustificationItemsCheckbox.checked = false;
                    selectAllJustificationItemsCheckbox.indeterminate = false;
                } else if (checkedVisibleCount === visibleCheckboxes.length) {
                    selectAllJustificationItemsCheckbox.checked = true;
                    selectAllJustificationItemsCheckbox.indeterminate = false;
                } else {
                    selectAllJustificationItemsCheckbox.checked = false;
                    selectAllJustificationItemsCheckbox.indeterminate = true;
                }
            }
        }
        

        if(selectAllJustificationItemsCheckbox && justificativasListTbodyEl) {
            // Listener para o checkbox "Selecionar Todos"
            selectAllJustificationItemsCheckbox.addEventListener('change', function() {
                justificativasListTbodyEl.querySelectorAll('tr.justification-item .bulk-select-justification').forEach(cb => {
                    if (cb.closest('tr').offsetParent !== null) { // Apenas os visíveis
                        cb.checked = this.checked;
                        // [NOVA LÓGICA] Adiciona ou remove da nossa lista de seleção
                        const itemRow = cb.closest('.justification-item');
                        const nfeReportId = itemRow.dataset.nfeReportId;
                        if (this.checked) {
                            selectedJustificationNfeIds.add(nfeReportId);
                        } else {
                            selectedJustificationNfeIds.delete(nfeReportId);
                        }
                    }
                });
            });

            // Listener para os checkboxes individuais
            justificativasListTbodyEl.addEventListener('change', (event) => {
                if (event.target.classList.contains('bulk-select-justification')) {
                    // [NOVA LÓGICA] Adiciona ou remove da nossa lista de seleção
                    const itemRow = event.target.closest('.justification-item');
                    const nfeReportId = itemRow.dataset.nfeReportId;
                    if (event.target.checked) {
                        selectedJustificationNfeIds.add(nfeReportId);
                    } else {
                        selectedJustificationNfeIds.delete(nfeReportId);
                    }
                    updateSelectAllCheckboxState();
                }
            });
        }
        
        if (btnApplyBulkJustificationEl && bulkJustificationSelectEl) {
            btnApplyBulkJustificationEl.addEventListener('click', () => {
                const bulkReasonValue = bulkJustificationSelectEl.value;
                if (bulkJustificationSelectEl.selectedIndex === 0) { 
                    ModalSystem.alert("Selecione uma justificativa válida para aplicar.", "Justificativa Inválida"); return; 
                }
                
                // [LÓGICA MELHORADA]
                if (selectedJustificationNfeIds.size === 0) {
                    ModalSystem.alert("Nenhuma NF selecionada.", "Nada Selecionado");
                    return;
                }

                const selectedReasonData = PREDEFINED_JUSTIFICATIONS.find(j => j.value === bulkReasonValue);
                let appliedCount = 0;

                // Itera sobre TODOS os IDs selecionados
                selectedJustificationNfeIds.forEach(nfeId => {
                    const originalItem = allNaoBipadoItemsData.find(it => String(it.idRelatorio) === nfeId);
                    if (originalItem) {
                        originalItem.selectedJustification = bulkReasonValue;
                        originalItem.naoVaiSair = selectedReasonData?.isCancelOption === true;
                        appliedCount++;
                    }
                });
                
                selectedJustificationNfeIds.clear(); // Limpa a seleção após aplicar

                ModalSystem.alert(`Justificativa "${bulkReasonValue}" aplicada a ${appliedCount} NF(s).`, "Aplicado", () => {
                    renderJustificativasPage(currentJustificativaPage); // Re-renderiza a página atual para limpar visualmente
                    bulkJustificationSelectEl.value = ""; 
                });
            });
        }

        if (btnCancelJustificativas) {
            btnCancelJustificativas.addEventListener('click', () => {
                if(justificativasViewEl) justificativasViewEl.style.display = 'none';
                if(bipagemViewEl) bipagemViewEl.style.display = 'block';
                if(mobileBipFooter && window.innerWidth <= 768) mobileBipFooter.style.display = 'block'; // ADICIONADO
            });
        }

        if (formJustificativas) { 
            formJustificativas.addEventListener('submit', async function(event) {
                event.preventDefault(); 

                const editingRelationId = bipagemViewEl.dataset.editingRelationId || null;
                if (editingRelationId) {
                    console.log(`Modo de Edição Ativo (via Justificativa). Substituindo Relação ID: ${editingRelationId}`);
                }
                const naoBipadoItemsFinalizados = [];
                let allItemsHaveValidJustification = true;
                for (const originalItem of allNaoBipadoItemsData) {
                    if (!originalItem.selectedJustification || PREDEFINED_JUSTIFICATIONS.find(j => j.value === originalItem.selectedJustification)?.isPlaceholder) {
                        allItemsHaveValidJustification = false; break; 
                    }
                    naoBipadoItemsFinalizados.push({
                        nfe_report_id: originalItem.idRelatorio,
                        justificativa: originalItem.selectedJustification,
                        naoVaiSair: originalItem.naoVaiSair || false
                    });
                }
                if (!allItemsHaveValidJustification) {
                    playAlarmSound();
                    ModalSystem.alert("Todas as NF-e não bipadas precisam de uma justificativa selecionada.", "Justificativa Obrigatória");
                    return;
                }
                await enviarDadosFinalizados(transportadoraApelido, bipadoItemsParaEnvio, naoBipadoItemsFinalizados, editingRelationId);
            });
        }

        if (btnFinalizarRelacaoEl) {
            btnFinalizarRelacaoEl.addEventListener('click', function() { 
                const incompleteNotes = [];

                nfsState.forEach((state) => {
                    if (state.bipado > 0 && state.bipado < state.total) {
                        incompleteNotes.push(state.numeroNF);
                    }
                });

                if (incompleteNotes.length > 0) {
                    playAlarmSound();
                    
                    // Monta a mensagem HTML
                    const htmlMessage = `Finalização bloqueada. Complete os volumes das seguintes NFs: <ul style="text-align: left; margin-top: 10px;">${incompleteNotes.map(n => `<li>${n}</li>`).join('')}</ul>`;

                    // [CHAMADA CORRIGIDA]
                    ModalSystem.alert(
                        htmlMessage,
                        "Volumes Incompletos",
                        null, // Função onOk (não precisa no seu caso)
                        { isHtml: true } // Informa ao modal que o conteúdo é HTML
                    );
                    return;
                }

                // Pega o ID da relação que está sendo editada, se houver
                const editingRelationId = bipagemViewEl.dataset.editingRelationId || null;
                if (editingRelationId) {
                    console.log(`Modo de Edição Ativo. Substituindo Relação ID: ${editingRelationId}`);
                }

                bipadoItemsParaEnvio = []; 
                const allBipadoInputs = bipadosListContainerEl.querySelectorAll('.bipado-barcode-input');
                allBipadoInputs.forEach(input => {
                    const barcodeValue = input.value.trim();
                    if (barcodeValue) {
                        const chave = getChaveFromBipado(barcodeValue);
                        if (chave) {
                            const notaState = nfsState.get(chave);
                            if (notaState) {
                                // Adiciona um item para cada "bipada"
                                bipadoItemsParaEnvio.push({ nfe_report_id: parseInt(notaState.idRelatorio, 10) });
                            }
                        }
                    }
                });
                const naoBipadoParaJustificarTemp = [];
                nfsState.forEach((state, chave) => {
                    // CONDIÇÃO CORRETA: Uma nota está "bipada" se todos os seus volumes foram contados.
                    if (state.bipado === state.total && state.total > 0) {
                        bipadoItemsParaEnvio.push({ nfe_report_id: parseInt(state.idRelatorio, 10) });
                    } 
                    // CONDIÇÃO CORRETA: Uma nota vai para justificativa se NENHUM volume foi bipado.
                    else if (state.bipado === 0) {
                        naoBipadoParaJustificarTemp.push({ 
                            idRelatorio: parseInt(state.idRelatorio, 10), 
                            numeroNF: state.numeroNF, 
                            chaveAcesso44d: chave, // A chave é o segundo argumento do forEach de um Map
                            produtos: state.produtos,
                            selectedJustification: state.justificativa, // Inicializa para a tela de justificativa
                            naoVaiSair: false
                        });
                    }
                });
                allNaoBipadoItemsData = [...naoBipadoParaJustificarTemp];
                if (allNaoBipadoItemsData.length > 0) {
                    renderJustificativasPage(1); 
                    if(justificativasViewEl) justificativasViewEl.style.display = 'block';
                    if(bipagemViewEl) bipagemViewEl.style.display = 'none';
                    if(mobileBipFooter) mobileBipFooter.style.display = 'none'; // ADICIONADO
                    if(selectAllJustificationItemsCheckbox) { selectAllJustificationItemsCheckbox.checked = false; selectAllJustificationItemsCheckbox.indeterminate = false; }
                } else if (bipadoItemsParaEnvio.length === 0) {
                    playAlarmSound();
                    ModalSystem.alert("Nenhuma NF-e foi bipada.", "Relação Vazia");
                } else {
                    ModalSystem.confirm("Finalizar relação?", "Finalizar Relação", 
                        async () => { await enviarDadosFinalizados(transportadoraApelido, bipadoItemsParaEnvio, [], editingRelationId); }, 
                        () => console.log("Finalização cancelada.")
                    );
                }
            });
        }
        
        if (bipadosListContainerEl) {
            console.log("initializeBipagem: Adicionando primeiro campo de bipagem.");
        } else {
            console.error("initializeBipagem: bipadosListContainerEl NÃO encontrado!");
        }
    }


    // --- LÓGICA ESPECÍFICA PARA PÁGINA DE NF-e CANCELADAS (/relacoes/canceladas) ---
    if (currentPageType === 'canceladas') {
        const tbodyCanceladas = canceladasTableEl.querySelector('tbody');
        let dataTableCanceladasInstance = null; // Para guardar a instância do DataTable

        async function carregarNfesCanceladas() { /* ... (COMO ANTES, mas interage com DataTables API se possível) ... */ 
            if (!tbodyCanceladas) { console.error("tbody da tabela de canceladas não encontrado."); return; }
            console.log("Carregando NF-e canceladas...");

            // Inicializa DataTable se ainda não for uma, ou apenas limpa se já for.
            if ($.fn.dataTable.isDataTable('#canceladasTable')) {
                dataTableCanceladasInstance = $('#canceladasTable').DataTable();
                dataTableCanceladasInstance.clear();
            } else {
                // Se não for DataTable, limpa o tbody manualmente.
                // A inicialização do DataTable será feita pelo dataTables.js global.
                // Para que o dataTables.js global funcione, ele precisa ser chamado DEPOIS deste script
                // ou este script precisa esperar o $(document).ready() do dataTables.js.
                // Por ora, vamos assumir que o dataTables.js já rodou ou rodará.
                tbodyCanceladas.innerHTML = ''; 
            }


            try {
                const response = await fetch('/api/relacoes/canceladas/all');
                if (!response.ok) { const eData = await response.json(); throw new Error(eData.message || `Erro ${response.status}`);}
                const nfesCanceladas = await response.json();
                
                if (nfesCanceladas.length === 0) {
                    if (dataTableCanceladasInstance) dataTableCanceladasInstance.draw(); // Para mostrar msg do DT
                    else tbodyCanceladas.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhuma NF-e cancelada.</td></tr>';
                } else {
                    const rowsToAdd = nfesCanceladas.map(nf => {
                        const chaveCurta = nf.nfe_chave_acesso_44d ? `...${String(nf.nfe_chave_acesso_44d).slice(-12)}` : 'N/A';
                        return [
                            nf.emissao_title || 'N/A',
                            nf.nfe_numero || 'N/A',
                            chaveCurta,
                            nf.transportadora_apelido || 'N/A',
                            getFormattedDateTime(nf.data_referencia, false),
                            `<button class="btn btn-icon btn-success-alt btn-reativar-nfe" data-nfereportid="${nf.id}" title="Reativar NF-e"><i class="fas fa-undo"></i> Reativar</button>`
                        ];
                    });
                    if (dataTableCanceladasInstance) {
                        dataTableCanceladasInstance.rows.add(rowsToAdd).draw();
                    } else { // Fallback se DataTable não inicializou ainda
                        rowsToAdd.forEach(rowData => {
                            const tr = tbodyCanceladas.insertRow();
                            tr.innerHTML = rowData.map(d => `<td>${d}</td>`).join('');
                        });
                    }
                }
            } catch (error) {
                console.error("Erro ao carregar NF-e canceladas:", error);
                if (tbodyCanceladas) tbodyCanceladas.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-danger);">Erro: ${error.message}</td></tr>`;
            }
        }

        if (tbodyCanceladas) {
            tbodyCanceladas.addEventListener('click', async function(event) { /* ... (COMO ANTES, com ModalSystem) ... */
                const targetButton = event.target.closest('.btn-reativar-nfe');
                if (targetButton) {
                    const nfeReportId = targetButton.dataset.nfereportid;
                    const nfNumero = targetButton.closest('tr').cells[1].textContent; 
                    ModalSystem.confirm(`Reativar NF Nº ${nfNumero}?`, "Confirmar", async () => {
                        try {
                            const response = await fetch(`/api/relacoes/nfe/${nfeReportId}/reativar`, { method: 'POST' });
                            if (!response.ok) { const eD = await response.json(); throw new Error(eD.message || `E ${response.status}`);}
                            const result = await response.json();
                            ModalSystem.alert(result.message || `NF Nº ${nfNumero} reativada!`, "Sucesso", carregarNfesCanceladas);
                        } catch (error) { ModalSystem.alert(`Erro: ${error.message}`, "Erro Reativação"); }
                    });
                }
            });
        }
        
        // Garante que o DataTable seja inicializado se ainda não foi, ANTES de carregar os dados
        // Isso é importante se o dataTables.js global não pegar esta tabela a tempo.
        if ($ && $.fn.dataTable && !$.fn.dataTable.isDataTable('#canceladasTable')) {
            console.log("Inicializando #canceladasTable diretamente no relacaoManager.js");
            dataTableCanceladasInstance = $('#canceladasTable').DataTable({
                // Adicione suas opções padrão do DataTables aqui, se necessário
                // Elas devem ser consistentes com o que está no seu dataTables.js global
                "pageLength": 10, "searching": true, "paging": true, "info": true, "scrollX": true,
                "language": { /* suas traduções */ }
                // Não precisa de drawCallback para highlightIssues aqui, a menos que essa tabela use .margin-cell
            });
        }
        carregarNfesCanceladas();
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