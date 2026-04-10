// public/scripts/productSyncManager.js
document.addEventListener('DOMContentLoaded', () => {
    console.log('productSyncManager.js: DOMContentLoaded');

    // (MODIFICADO) Seleciona os dois formulários e botões
    const uploadForm = document.getElementById('uploadForm');
    const nameSyncForm = document.getElementById('nameSyncForm');

    const uploadButton = uploadForm ? uploadForm.querySelector('button[type="submit"]') : null;
    const nameSyncButton = nameSyncForm ? nameSyncForm.querySelector('button[type="submit"]') : null;

    if (typeof ModalSystem === 'undefined' || !ModalSystem.showLoading || !ModalSystem.hideLoading || !ModalSystem.alert) {
        console.error('ERRO CRÍTICO: ModalSystem não está definido.');
        if (uploadButton) uploadButton.disabled = true;
        if (nameSyncButton) nameSyncButton.disabled = true;
        alert('Erro crítico: O sistema de modais não carregou corretamente. A funcionalidade de sincronização está desabilitada.');
        return;
    } else {
        if (ModalSystem.initialize) ModalSystem.initialize();
        console.log('ModalSystem verificado e pronto.');
    }

    if (!uploadForm || !uploadButton) {
        console.warn('Formulário de Upload (uploadForm) não encontrado.');
    }
    if (!nameSyncForm || !nameSyncButton) {
        console.warn('Formulário de Nome (nameSyncForm) não encontrado.');
    }

    /**
     * (NOVO) Helper para lidar com o envio de ambos os formulários
     * @param {Event} event O evento de submit
     * @param {HTMLFormElement} form O formulário sendo enviado
     * @param {HTMLButtonElement} button O botão de submit
     * @param {string} url A URL para onde enviar
     */
    const handleSyncSubmit = async (event, form, button, url) => {
        event.preventDefault();
        console.log(`Form submit interceptado para: ${url}`);

        if (form.id === 'nameSyncForm') {
            const productNameInput = form.querySelector('#productName');
            const productName = productNameInput ? productNameInput.value.trim() : '';

            // Padrão 1: "ESTOQUE" (case-insensitive)
            // Padrão 2: "V" (ou "v"), espaço, número, barra, número (ex: "V 1/2")
            // A regex /i torna a busca case-insensitive.
            const structurePattern = /(estoque|v \d+\/\d+)/i;

            if (structurePattern.test(productName)) {
                console.warn('Detecção de nome de estrutura. Bloqueando envio.');
                
                // "Avisar"
                ModalSystem.alert(
                    'O nome digitado parece ser de uma estrutura (contém "ESTOQUE" ou "V 1/2"). Por favor, digite o nome exato do produto principal.',
                    'Nome de Produto Inválido'
                );
                
                // "Impedir" - para a execução aqui e não envia o form.
                return; 
            }
        }

        button.disabled = true;
        const originalButtonText = button.innerHTML;
        button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sincronizando...';

        ModalSystem.showLoading(
            'Iniciando sincronização. Este processo pode demorar alguns minutos.',
            'Sincronização Iniciada'
        );

        const formData = new FormData(form);

        try {
            console.log(`Sending fetch request to ${url}`);
            
            // O backend responde com 204 (No Content) quase imediatamente.
            // O fetch vai terminar rápido, e o 'finally' será chamado.
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                headers: { 'Accept': 'application/json' }
            });

            console.log('Fetch response received, status:', response.status);

            // Se o backend falhar *antes* de iniciar o job (ex: 400, 409)
            if (!response.ok && response.status !== 204) {
                console.error('Sincronização falhou no backend, status:', response.status);
                // Tenta mostrar um erro se o backend enviou um JSON
                try {
                    const errResult = await response.json();
                    console.error('Detalhe do erro:', errResult.message);
                    // (Opcional) Mostrar erro ao usuário, mas o modal de loading já fechou
                    // ModalSystem.alert(errResult.message, 'Falha ao Iniciar'); 
                } catch (e) {
                    console.error('Não foi possível parsear o JSON do erro.');
                    // ModalSystem.alert('Ocorreu uma falha desconhecida ao iniciar.', 'Erro');
                }
            } else {
                console.log('Sincronização iniciada com sucesso (ou 204 recebido).');
            }

        } catch (networkError) {
            console.error('Erro de rede durante o fetch:', networkError);
            // (Opcional) Mostrar erro de rede
            // ModalSystem.alert(`Erro de rede: ${networkError.message}`, 'Erro de Conexão');
        
        } finally {
            // Este 'finally' executa assim que o fetch (rápido) termina.
            // O modal de loading fecha, e o usuário vê o form resetado,
            // enquanto o job continua rodando no backend.
            
            ModalSystem.hideLoading();

            button.disabled = false;
            button.innerHTML = originalButtonText;
            
            form.reset(); // Limpa o formulário
            
            console.log('Form submission handler finished.');
        }
    };

    // (MODIFICADO) Adiciona listener para o formulário de UPLOAD
    if (uploadForm && uploadButton) {
        uploadForm.addEventListener('submit', (event) => {
            handleSyncSubmit(event, uploadForm, uploadButton, '/product-sync/upload');
        });
        console.log('productSyncManager.js: Event listener ADICIONADO para uploadForm.');
    }

    // (MODIFICADO) Adiciona listener para o formulário de NOME
    if (nameSyncForm && nameSyncButton) {
        nameSyncForm.addEventListener('submit', (event) => {
            handleSyncSubmit(event, nameSyncForm, nameSyncButton, '/product-sync/by-name');
        });
        console.log('productSyncManager.js: Event listener ADICIONADO para nameSyncForm.');
    }
});