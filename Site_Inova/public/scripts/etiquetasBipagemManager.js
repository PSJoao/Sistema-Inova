// public/scripts/etiquetasBipagemManager.js
document.addEventListener('DOMContentLoaded', async function() { // Tornar async
    
    // Elementos da UI
    const bipagemInput = document.getElementById('bipagemInput');
    const listContainer = document.getElementById('bipagemListContainer');
    const addPalletBtn = document.getElementById('bipagemAddPalletBtn');
    const finalizeBtn = document.getElementById('bipagemFinalizeBtn');
    
    const currentScanListEl = document.getElementById('currentScanList');
    //const fecharProdutoBtn = document.getElementById('bipagemFecharProdutoBtn');
    const clearCurrentBtn = document.getElementById('bipagemClearCurrentBtn');

    const montarKitBtn = document.getElementById('bipagemMontarKitBtn');
    const montarKitBtnText = montarKitBtn.querySelector('span'); // Seleciona o span dentro do botão
    const montarKitBtnIcon = montarKitBtn.querySelector('i'); // Seleciona o ícone
    const cancelarKitBtn = document.getElementById('bipagemCancelarKitBtn');
    
    // Elementos de Stats
    const statProdutos = document.getElementById('statProdutosCompletos');
    const statEstruturas = document.getElementById('statEstruturasBipadas');
    const statPalete = document.getElementById('statPaleteAtual');
    const placeholder = document.querySelector('.bipagem-placeholder');

    // Estado da Aplicação
    // scanList armazena {type: 'product'} ou {type: 'pallet'}
    let scanList = []; 
    // productAggregates rastreia o *total* consumido por SKU
    let productAggregates = {}; 
    let palletCount = 1;
    // currentBips armazena os SKUs/GTINs da bipagem atual
    let currentBips = []; 
    let isKitMode = false;
    let isPalletCounterActive = false;
    const palletCounterCheckbox = document.getElementById('palletCounterCheckbox');

    // Sons (opcional, mas melhora a usabilidade)
    const successSound = new Audio('/public/sounds/notification.mp3'); // Assumindo que existe
    const errorSound = new Audio(); // Crie um som de erro se desejar

    /**
     * Serializa o estado para o localStorage (convertendo Sets para Arrays)
     * (Mantido para compatibilidade se estados antigos usavam Sets)
     */
    function serializeAggregates(aggregates) {
        const serializable = {};
        for (const key in aggregates) {
            serializable[key] = { ...aggregates[key] };
            if (aggregates[key].scannedSkus instanceof Set) {
                 serializable[key].scannedSkus = Array.from(aggregates[key].scannedSkus);
            }
             if (aggregates[key].requiredSkus instanceof Set) {
                 serializable[key].requiredSkus = Array.from(aggregates[key].requiredSkus);
            }
        }
        return serializable;
    }

    /**
     * Desserializa o estado do localStorage (convertendo Arrays para Sets)
     * (Mantido para compatibilidade)
     */
    function deserializeAggregates(serializable) {
        const aggregates = {};
        for (const key in serializable) {
             aggregates[key] = { ...serializable[key] };
             if (Array.isArray(serializable[key].scannedSkus)) {
                 aggregates[key].scannedSkus = new Set(serializable[key].scannedSkus);
             }
             if (Array.isArray(serializable[key].requiredSkus)) {
                 aggregates[key].requiredSkus = new Set(serializable[key].requiredSkus);
             }
        }
        return aggregates;
    }

    /**
     * Salva o estado atual no localStorage
     */
    async function saveStateToBackend() {
        console.log('Salvando estado da bipagem ML no backend...');
        const stateToSave = {
            scanList,
            productAggregates,
            palletCount,
            isPalletCounterActive,
            currentBips,
            isKitMode
        };
        try {
            // URL da API sem parâmetro de transportadora
            const response = await fetch('/etiquetas/bipagem/save-state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(stateToSave)
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error('Erro ao salvar estado:', errorData.message);
                ModalSystem.showToast('Falha ao salvar progresso no servidor.', 'error', { duration: 2000 });
            } else {
                console.log('Estado salvo com sucesso.');
                // Opcional: Mostrar indicador de sucesso (ex: ícone verde)
            }
        } catch (error) {
            console.error('Erro de rede ao salvar estado:', error);
            ModalSystem.showToast('Erro de rede ao salvar progresso.', 'error', { duration: 2000 });
        }
    }

    /**
     * Carrega o estado do localStorage
     */
    async function loadStateFromBackend() {
        console.log('Carregando estado da bipagem ML do backend...');
        ModalSystem.showLoading('Carregando progresso anterior...');
        try {
            // URL da API sem parâmetro de transportadora
            const response = await fetch('/etiquetas/bipagem/load-state');
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.state && Object.keys(data.state).length > 0) { // Verifica se state não é null ou {}
                    console.log('Estado anterior encontrado:', data.state);
                    // Restaura o estado (com valores padrão se algo faltar)
                    scanList = data.state.scanList || [];
                    productAggregates = data.state.productAggregates || {};
                    palletCount = data.state.palletCount || 1;
                    currentBips = data.state.currentBips || [];
                    isKitMode = data.state.isKitMode || false;
                    isPalletCounterActive = (data.state.isPalletCounterActive !== undefined) 
                        ? data.state.isPalletCounterActive 
                        : true; 

                    if (palletCounterCheckbox) {
                        palletCounterCheckbox.checked = isPalletCounterActive;
                    }
                    renderUI(); // Atualiza a interface com os dados carregados
                    console.log('Estado restaurado do backend.');
                } else if (data.success && (data.state === null || Object.keys(data.state).length === 0)) {
                    console.log('Nenhum estado salvo encontrado para a bipagem ML.');
                    // Mantém o estado inicial padrão
                    renderUI(); // Renderiza a UI vazia
                } else {
                    isPalletCounterActive = true;
                    if (palletCounterCheckbox) palletCounterCheckbox.checked = true;
                    renderUI();
                }
            } else {
                console.error('Erro HTTP ao carregar estado:', response.statusText);
                ModalSystem.alert(`Erro ${response.status} ao buscar estado anterior. Iniciando nova sessão.`, 'Erro');
                renderUI(); // Renderiza a UI vazia
            }
        } catch (error) {
            console.error('Erro de rede ao carregar estado:', error);
            ModalSystem.alert('Erro de comunicação ao buscar estado anterior. Iniciando nova sessão.', 'Erro de Rede');
            renderUI(); // Renderiza a UI vazia
        } finally {
            ModalSystem.hideLoading();
            bipagemInput?.focus(); // Foca no input após carregar (Adicionado '?')
        }
    }

    /**
     * Recalcula o próximo número de palete (próximo ID) baseado no scanList.
     */
    function updatePalletCountFromScanList() {
        // Se o contador persistente estiver ATIVO, não recalculamos baseado na lista,
        // pois ele segue uma contagem própria incrementada manualmente.
        if (isPalletCounterActive) return;

        // Comportamento padrão (se checkbox desligado): pega o último + 1
        const lastPallet = scanList.filter(i => i.type === 'pallet').pop();
        palletCount = lastPallet ? lastPallet.number + 1 : 1;
    }
    /**
     * Renderiza a UI inteira (Bips Atuais e Lista Principal) baseado no estado.
     */
    function renderUI() {
        // 1. Renderiza a lista de *bipagem atual* (currentBips)
        currentScanListEl.innerHTML = '';
        if (currentBips.length === 0) {
            currentScanListEl.innerHTML = '<li class="current-scan-placeholder">Bipe as estruturas deste produto...</li>';
        } else {
            currentBips.forEach((sku, index) => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span>${sku}</span>
                    <button type="button" class="remove-structure-btn" data-index="${index}" title="Remover">&times;</button>
                `;
                currentScanListEl.appendChild(li);
            });
        }
        
        // 2. Renderiza a *lista principal* (scanList)
        // **Esta é a correção para o isolamento de paletes:**
        // Renderiza os itens na ordem exata em que estão no scanList.
        listContainer.innerHTML = '';
        if (scanList.length === 0) {
            if(placeholder) placeholder.style.display = 'flex';
        } else {
            if(placeholder) placeholder.style.display = 'none';
            
            // Itera o scanList na ordem correta
            scanList.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'bipagem-item';
                
                // Adiciona o botão de remover em todos os itens da lista principal
                const removeBtn = `<button type="button" class="remove-main-item-btn" data-index="${index}" title="Remover Item">&times;</button>`;
                
                if (item.type === 'pallet') {
                    div.classList.add('bipagem-pallet');
                    div.innerHTML = `<i class="fas fa-pallet"></i> <span>PALETE ${item.number}</span> ${removeBtn}`;
                } else if (item.type === 'product') {
                    div.classList.add('bipagem-produto-fechado');
                    // Mostra o nome do produto e as estruturas que o formam
                    div.innerHTML = `
                        <div>
                            <span class="item-sku-parent">${item.parentProduct.name} (SKU: ${item.parentProduct.sku})</span>
                            <small class="item-components">${item.scannedComponents.join(', ')}</small>
                        </div>
                        ${removeBtn}
                    `;
                }
                listContainer.appendChild(div);
            });
        }

        if (isKitMode) {
            montarKitBtnText.textContent = 'Fechar Kit';
            montarKitBtnIcon.className = 'fas fa-box-check'; // Ícone de fechar
            cancelarKitBtn.style.display = 'inline-flex'; // Mostra Cancelar
            // Desabilita "Montar Kit" se a lista estiver vazia (forçando o Fechar Kit ou Cancelar)
            // montarKitBtn.disabled = currentBips.length === 0; // Ou podemos deixar habilitado para fechar um kit vazio (que falhará)
        } else {
            montarKitBtnText.textContent = 'Montar Kit';
            montarKitBtnIcon.className = 'fas fa-boxes'; // Ícone de montar
            cancelarKitBtn.style.display = 'none'; // Esconde Cancelar
            // Habilita "Montar Kit" apenas se a lista atual estiver VAZIA
            montarKitBtn.disabled = currentBips.length > 0;
        }
        // Habilita/Desabilita Limpar com base na lista atual
        clearCurrentBtn.disabled = currentBips.length === 0;

        // 3. Atualiza os stats
        listContainer.scrollTop = listContainer.scrollHeight;
        updateStats();
    }
    
    /**
     * Atualiza os contadores no cabeçalho
     */
    function updateStats() {
        let produtosCompletos = 0;
        // O aggregate é a fonte da *contagem* total de produtos bipados
        for (const sku in productAggregates) {
            produtosCompletos += productAggregates[sku].timesCompleted;
        }
        
        // O stat "Estruturas Bipadas" conta as estruturas *dentro* dos produtos já fechados no scanList
        let estruturasBipadas = 0;
        scanList.filter(i => i.type === 'product').forEach(p => {
            estruturasBipadas += p.scannedComponents.length;
        });

        statProdutos.textContent = produtosCompletos;
        statEstruturas.textContent = estruturasBipadas;
        statPalete.textContent = palletCount; // Mostra o próximo número de palete
    }

    /**
     * Gerencia a troca do Contador.
     * Para DESLIGAR, exige senha. Para LIGAR, verifica se a lista está limpa.
     */
    async function handlePalletCounterSwitch(e) {
        const tryingToTurnOn = e.target.checked;
        const checkbox = e.target;

        if (!tryingToTurnOn) {
            // --- TENTATIVA DE DESLIGAR (Requer Senha) ---
            
            // 1. Impede a mudança visual imediata (mantém marcado até digitar a senha)
            e.preventDefault();
            checkbox.checked = true; 

            // 2. Cria um ID único para o input de senha
            const passInputId = 'authPass_' + Date.now();
            
            // 3. Monta o HTML do Modal com Input
            const modalHtml = `
                <div class="text-left">
                    <p class="mb-2">Este recurso deve permanecer ativo por padrão.</p>
                    <p class="mb-3 small text-muted">Para desativar e resetar a contagem manualmente, insira a senha de administrador:</p>
                    <input type="password" id="${passInputId}" class="form-control" placeholder="Senha de Acesso" autocomplete="off">
                </div>
            `;

            ModalSystem.confirm(
                modalHtml, 
                'Autenticação Requerida', 
                async function() { // Callback de confirmação
                    const inputEl = document.getElementById(passInputId);
                    const typedPass = inputEl ? inputEl.value : '';

                    if (typedPass === '332211') {
                        // SENHA CORRETA
                        isPalletCounterActive = false;
                        palletCount = 1; // Reseta ao desligar
                        checkbox.checked = false; // Desmarca visualmente agora
                        
                        ModalSystem.showToast('Contador desbloqueado e resetado.', 'success');
                        updateStats();
                        await saveStateToBackend();
                    } else {
                        // SENHA INCORRETA
                        ModalSystem.showToast('Senha incorreta. Ação negada.', 'error');
                        // O checkbox continua marcado pois prevenimos o default no início
                    }
                },
                null, // Callback cancelar (não faz nada, mantém marcado)
                { isHtml: true, confirmText: 'Confirmar', cancelText: 'Cancelar' }
            );

        } else {
            // --- TENTATIVA DE LIGAR ---
            
            // Regra: Só pode ativar se NÃO houver paletes na lista atual
            const hasPalletInList = scanList.some(item => item.type === 'pallet');
            
            if (hasPalletInList) {
                ModalSystem.alert(
                    'Para reativar o contador, remova os paletes manuais da lista ou finalize a bipagem atual.', 
                    'Ação Bloqueada'
                );
                e.preventDefault();
                checkbox.checked = false;
                return;
            }
            
            // Se passou, ativa e inicia do 1
            isPalletCounterActive = true;
            palletCount = 1; 
            ModalSystem.showToast('Contador Diário ATIVO. Iniciando do Palete 1.', 'success');
            
            updateStats();
            await saveStateToBackend();
        }
    }

    /**
     * Lida com o 'Enter' no campo de bipagem.
     * Apenas adiciona o SKU ao grupo de bipagem atual (currentBips).
     */
    async function handleScan() {
        const componentSku = bipagemInput.value.trim();
        if (!componentSku) return;

        // Verifica duplicata no grupo atual
        if (currentBips.includes(componentSku)) {
            // errorSound.play();
            ModalSystem.alert(`A estrutura ${componentSku} já foi bipada neste grupo.`, 'Duplicado');
            bipagemInput.value = '';
            bipagemInput.focus();
            return;
        }

        // Adiciona ao grupo atual localmente
        // successSound.play(); // Talvez tocar só no sucesso da validação
        currentBips.push(componentSku);
        renderUI(); // Atualiza a lista de bipagem atual e o estado dos botões
        await saveStateToBackend();
        bipagemInput.value = ''; // Limpa o input
        bipagemInput.focus();

        // Se NÃO estiver montando um kit, valida imediatamente
        if (!isKitMode) {
            await validateAndCommitCurrentBips();
        }
        // Se estiver montando kit, apenas adiciona e espera o "Fechar Kit"
    }

    async function validateAndCommitCurrentBips() {
        if (currentBips.length === 0) return; // Nada para validar

        ModalSystem.showLoading('Validando produto...');
        const codesToValidate = [...currentBips]; // Copia os códigos

        try {
            const response = await fetch('/etiquetas/validar-produto-fechado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ componentSkus: codesToValidate }) // Envia os códigos atuais
            });

            const data = await response.json();
            ModalSystem.hideLoading();

            console.log("Data:", JSON.stringify(data, null, 2)); // Indenta com 2 espaços

            if (!data.success) {
                // errorSound.play();
                // No modo NÃO-Kit, se a validação falhar, limpamos a bipagem atual
                if (!isKitMode) {
                    currentBips = []; // Limpa o bip inválido
                    renderUI(); // Atualiza a UI para refletir a limpeza
                    await saveStateToBackend();
                }
                // Mostra o erro (seja kit ou não)
                return ModalSystem.alert(data.message, 'Falha na Validação');
            }

            // Sucesso! O backend validou.
            // data.productFound = { parentProduct, requiredSkus, totalPendente }
            commitScannedGroupToState(data.productFound); // Adiciona ao estado principal

            // Se estávamos em modo Kit E validou, saímos do modo Kit
            if (isKitMode) {
                isKitMode = false;
                renderUI(); // Atualiza os botões do kit
                await saveStateToBackend();
            }

        } catch (error) {
            ModalSystem.hideLoading();
            // errorSound.play();
             // No modo NÃO-Kit, limpamos em caso de erro de rede também
            if (!isKitMode) {
                 currentBips = [];
                 renderUI();
                 await saveStateToBackend();
            }
            ModalSystem.alert(`Erro de comunicação com o servidor: ${error.message}`, 'Erro de Rede');
        } finally {
            bipagemInput.focus();
        }
    }
    
    /**
     * Limpa o grupo de bipagem atual (botão Limpar)
     */
    async function handleClearCurrent() {
        currentBips = [];
        renderUI();
        await saveStateToBackend();
        bipagemInput.focus();
    }
    
    /**
     * Remove uma estrutura específica do grupo de bipagem atual (botão X interno)
     */
    async function handleRemoveStructure(e) {
         if (e.target && e.target.classList.contains('remove-structure-btn')) {
            const index = parseInt(e.target.getAttribute('data-index'), 10);
            currentBips.splice(index, 1);
            renderUI();
            await saveStateToBackend();
            bipagemInput.focus();
        }
    }

    async function handleMontarKit() {
        if (!isKitMode) {
            // Tentando ENTRAR no modo Kit
            if (currentBips.length > 0) {
                ModalSystem.alert('Limpe a bipagem atual antes de montar um kit.', 'Aviso');
                return;
            }
            isKitMode = true;
            renderUI(); // Atualiza os botões
            bipagemInput.focus();
        } else {
            // Tentando FECHAR o kit (botão agora diz "Fechar Kit")
            if (currentBips.length === 0) {
                 ModalSystem.alert('Bipe pelo menos uma estrutura para fechar o kit.', 'Aviso');
                 return;
            }
            // Chama a mesma função de validação usada pelo scan único
            await validateAndCommitCurrentBips();
            // Se validateAndCommitCurrentBips for sucesso, ele já sai do isKitMode e limpa currentBips.
            // Se falhar, ele mostra o erro e *não* sai do isKitMode nem limpa currentBips.
        }
    }

    async function handleCancelarKit() {
         isKitMode = false;
         currentBips = []; // Limpa as estruturas do kit cancelado
         renderUI(); // Atualiza botões e lista atual
         await saveStateToBackend();
         bipagemInput.focus();
     }

    /**
     * Handler para o botão "Fechar Produto".
     * Envia o grupo atual para validação no backend.
     */
    /*async function handleFecharProduto() {
        if (currentBips.length === 0) {
            return ModalSystem.alert('Bipe pelo menos uma estrutura antes de fechar o produto.', 'Aviso');
        }

        ModalSystem.showLoading('Validando produto...');
        
        try {
            const response = await fetch('/etiquetas/validar-produto-fechado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ componentSkus: currentBips }) // No controller é 'scannedCodes'
            });

            const data = await response.json();
            ModalSystem.hideLoading();

            if (!data.success) {
                // errorSound.play();
                return ModalSystem.alert(data.message, 'Falha na Validação');
            }

            // Sucesso! O backend validou o produto.
            // data.productFound = { parentProduct, requiredSkus, totalPendente }
            commitScannedGroupToState(data.productFound);

        } catch (error) {
            ModalSystem.hideLoading();
            // errorSound.play();
            ModalSystem.alert(`Erro de comunicação com o servidor: ${error.message}`, 'Erro de Rede');
        }
        
        bipagemInput.focus();
    }*/
    
    /**
     * Aplica o grupo validado ao estado principal (scanList e aggregates).
     */
    async function commitScannedGroupToState(productData) {
        const parentSku = productData.parentProduct.sku;

        console.log(parentSku);
        console.log("Data:", JSON.stringify(productData, null, 2)); // Indenta com 2 espaços

        // 1. Inicializa o agregado se for a primeira vez
        if (!productAggregates[parentSku]) {
            productAggregates[parentSku] = {
                productName: productData.parentProduct.name,
                totalPendente: productData.totalPendente,
                timesCompleted: 0
            };
        }
        console.log("Data:", JSON.stringify(productAggregates, null, 2));
        const agg = productAggregates[parentSku];

        console.log(agg.timesCompleted);
        console.log(agg.totalPendente);

        if (agg.timesCompleted >= productData.totalPendente) {
            ModalSystem.alert(
                // Mostra o totalPendente ATUALIZADO (vindo do productData)
                `Quantidade máxima (${productData.totalPendente}) para o produto ${parentSku} já foi atingida.`,
                'Limite Excedido',
                function() { handleClearCurrent(); } // Limpa no OK
            );
            return;
        }

        // 3. Adiciona o produto ao estado
        agg.timesCompleted++;
        
        // 4. ATUALIZA o totalPendente no agregado local com o valor mais recente
        //    Isso garante que, mesmo que o usuário remova, o valor 'pendente' está correto.
        agg.totalPendente = productData.totalPendente;
        
        // 5. Adiciona o *produto fechado* ao scanList
        scanList.push({
            type: 'product',
            parentProduct: productData.parentProduct,
            scannedComponents: [...productData.requiredSkus] // Usa os SKUs validados que vieram do backend
        });

        // 6. Limpa o grupo atual
        currentBips = [];
        
        successSound.play();
        /*ModalSystem.alert(`Produto ${parentSku} (${agg.productName}) adicionado! (${agg.timesCompleted}/${agg.totalPendente})`, 'Produto Fechado');*/
        
        // 7. Atualiza UI e salva o estado
        renderUI();
        await saveStateToBackend();
    }

    /**
     * Adiciona um marcador de palete
     */
    async function handleAddPallet() {
        if (scanList.length === 0) {
            return ModalSystem.alert('Feche pelo menos um produto antes de adicionar um novo palete.', 'Aviso');
        }

        if (scanList.length > 0 && scanList[scanList.length - 1].type === 'pallet') {
            return ModalSystem.alert('Você já adicionou um palete. Bipe um produto.', 'Aviso');
        }
        
        // Usa o palletCount atual e DEPOIS incrementa
        scanList.push({
            type: 'pallet',
            number: palletCount
        });
        palletCount++; // Incrementa para o próximo

        renderUI();
        await saveStateToBackend();
        bipagemInput.focus();
    }

    /**
     * Finaliza a bipagem e gera o PDF
     */
    async function handleFinalize() {
        if (scanList.length === 0) {
            return ModalSystem.alert('Nenhum item foi bipado.', 'Aviso');
        }
        
        let produtosCompletos = 0;
        for (const sku in productAggregates) {
            produtosCompletos += productAggregates[sku].timesCompleted;
        }
        
        if (produtosCompletos === 0) {
            return ModalSystem.alert('Nenhum produto foi fechado.', 'Aviso');
        }

        // Prepara o scanList para o backend ("achata" a lista)
        const flatScanList = [];
        scanList.forEach(item => {
            if (item.type === 'pallet') {
                flatScanList.push(item);
            } else if (item.type === 'product') {
                // "Explode" o produto em seus itens individuais para o backend
                item.scannedComponents.forEach(sku => {
                    flatScanList.push({
                        type: 'item', // O tipo que o backend espera
                        scannedComponent: sku,
                        parentProduct: item.parentProduct
                    });
                });
            }
        });
        
        // Verifica se a lista achatada tem itens (pode não ter se só tiver paletes vazios)
        if (flatScanList.filter(i => i.type === 'item').length === 0) {
             return ModalSystem.alert('Nenhum produto foi fechado.', 'Aviso');
        }

        ModalSystem.confirm(
            `Você está prestes a finalizar a bipagem com <strong>${produtosCompletos} produtos</strong>. Deseja continuar?`,
            'Finalizar Bipagem',
            async function() { // onConfirm
                ModalSystem.showLoading('Gerando PDF e atualizando banco de dados...');
                
                try {
                    const response = await fetch('/etiquetas/finalizar-bipagem', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ scanList: flatScanList }) 
                    });

                    if (!response.ok) {
                        let errorMsg = `Erro ${response.status}: ${response.statusText}`;
                        try {
                            const errData = await response.json();
                            errorMsg = errData.message || errorMsg;
                        } catch (e) { /* Não era JSON */ }
                        throw new Error(errorMsg);
                    }

                    const blob = await response.blob();
                    
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'Bipagem-Finalizada.pdf';
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                        if (filenameMatch && filenameMatch[1]) {
                            filename = filenameMatch[1];
                        }
                    }

                    ModalSystem.hideLoading();
                    
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();

                    ModalSystem.alert('Bipagem finalizada com sucesso! O PDF foi baixado. A página será reiniciada.', 'Sucesso', async function() {
                        
                        // 1. Limpa as variáveis de lista e produtos
                        scanList = [];
                        productAggregates = {};
                        currentBips = [];
                        isKitMode = false;
                        
                        // 2. LÓGICA DE RESET DO CONTADOR
                        if (isPalletCounterActive) {
                            // Se o contador persistente está LIGADO:
                            // NÃO resetamos o palletCount. Ele mantém o valor atual (que já está pronto para o próximo).
                            console.log('Finalizando com Contador Ativo. Próximo palete será: ' + palletCount);
                        } else {
                            // Se o contador persistente está DESLIGADO:
                            // Resetamos para 1, pois é uma finalização comum.
                            palletCount = 1;
                        }
                        
                        // 3. Salva o estado limpo (com o número de palete correto para a próxima vez)
                        await saveStateToBackend(); 
                        
                        // 4. Recarrega a página para limpar visualmente tudo
                        location.reload();
                    });

                } catch (error) {
                    ModalSystem.hideLoading();
                    ModalSystem.alert(`Ocorreu um erro ao finalizar: ${error.message}`, 'Erro de Processamento');
                }
            },
            null, // onCancel
            { confirmText: "Sim, Finalizar", cancelText: "Cancelar", isHtml: true }
        );
    }
    
    /**
     * Remove um item da lista principal (Produto ou Palete)
     */
    async function handleRemoveMainItem(e) {
        if (!e.target.classList.contains('remove-main-item-btn')) return;
        
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        if (isNaN(index)) return;

        const item = scanList[index];
        const itemName = item.type === 'pallet' ? `Palete ${item.number}` : item.parentProduct.name;

        ModalSystem.confirm(
            `Deseja realmente remover o item <strong>${itemName}</strong> da lista?`,
            "Confirmar Remoção",
            async () => { // onConfirm
                // 1. Remove o item do scanList
                scanList.splice(index, 1);

                // 2. Se for um produto, atualiza (decrementa) o aggregate
                // **Esta é a lógica de "devolução":**
                if (item.type === 'product') {
                    const sku = item.parentProduct.sku;
                    if (productAggregates[sku] && productAggregates[sku].timesCompleted > 0) {
                        productAggregates[sku].timesCompleted--;
                    }
                }
                
                // 3. Se for um palete (ou qualquer remoção), recalcula o próximo número
                updatePalletCountFromScanList();
                
                // 4. Salva e Renderiza
                await saveStateToBackend();
                renderUI();
            },
            null, // onCancel
            { isHtml: true, confirmText: "Remover", cancelText: "Cancelar" }
        );
    }

    // --- Event Listeners ---
    if (bipagemInput) {
        bipagemInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                handleScan();
            }
        });
    }
    
    if (clearCurrentBtn) {
        clearCurrentBtn.addEventListener('click', handleClearCurrent);
    }
    if (currentScanListEl) {
        currentScanListEl.addEventListener('click', handleRemoveStructure);
    }
    // --- Novos Listeners ---
    if (montarKitBtn) {
        montarKitBtn.addEventListener('click', handleMontarKit);
    }
    if (cancelarKitBtn) {
        cancelarKitBtn.addEventListener('click', handleCancelarKit);
    }
    // --- Fim Novos Listeners ---

    if (addPalletBtn) {
        addPalletBtn.addEventListener('click', handleAddPallet);
    }
    if (finalizeBtn) {
        finalizeBtn.addEventListener('click', handleFinalize);
    }
    if (listContainer) {
        listContainer.addEventListener('click', handleRemoveMainItem);
    }
    if (palletCounterCheckbox) {
        palletCounterCheckbox.addEventListener('change', handlePalletCounterSwitch);
    }

    // --- Carregamento Inicial ---
    await loadStateFromBackend(); // Carrega o estado do backend ao iniciar
    bipagemInput.focus();
});