// public/scripts/productSyncManager.js
document.addEventListener('DOMContentLoaded', () => {
    console.log('productSyncManager.js: DOMContentLoaded'); // Log para verificar execução

    const syncForm = document.getElementById('productSyncForm');
    const submitButton = syncForm ? syncForm.querySelector('button[type="submit"]') : null;

    //if (!syncForm || !submitButton) {
    /*    console.error('ERRO CRÍTICO: Formulário de sincronização (id="productSyncForm") ou botão de submit não encontrado.');
        // Tenta alertar o usuário se o ModalSystem estiver disponível
        if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
             ModalSystem.alert('<p class="text-danger">Erro interno na página. Não foi possível encontrar o formulário de envio. Recarregue a página ou contate o suporte.</p>', 'Erro de Interface');
        }
        return; // Impede a execução do resto do script
    }*/

    // Verifica se ModalSystem está disponível logo no início
    if (typeof ModalSystem === 'undefined' || !ModalSystem.showLoading || !ModalSystem.hideLoading || !ModalSystem.alert) {
        console.error('ERRO CRÍTICO: ModalSystem não está definido ou inicializado corretamente. Verifique a inclusão e ordem dos scripts (modal.js deve vir antes).');
        // Desabilita o botão para evitar envio padrão que mostraria JSON
        submitButton.disabled = true;
        submitButton.textContent = 'Erro de Interface';
         // Tenta alertar o usuário de forma nativa como último recurso
        alert('Erro crítico: O sistema de modais não carregou corretamente. A funcionalidade de sincronização está desabilitada.');
        return; // Impede a execução do resto do script
    } else {
        // Se ModalSystem existe, tenta inicializar (caso ainda não tenha sido)
        if (ModalSystem.initialize) ModalSystem.initialize();
        console.log('ModalSystem verificado e pronto.');
    }


    syncForm.addEventListener('submit', async (event) => {
        // *** 1. Impedir o envio padrão IMEDIATAMENTE ***
        event.preventDefault();
        console.log('Form submit intercepted, default prevented.');

        // Desabilita o botão e mostra estado de carregamento
        submitButton.disabled = true;
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sincronizando...';

        // *** 2. Mostra o modal de carregamento com a mensagem solicitada ***
        ModalSystem.showLoading(
            'Iniciando sincronização. Este processo pode demorar alguns minutos.', 
            'Sincronização Iniciada'
        );

        const formData = new FormData(syncForm);

        try {
            console.log('Sending fetch request to /product-sync/upload');
            
            // *** 3. Executa a sincronização e ESPERA ela terminar ***
            const response = await fetch('/product-sync/upload', {
                method: 'POST',
                body: formData,
                headers: { 'Accept': 'application/json' } 
            });
            
            console.log('Fetch response received, status:', response.status);

            // *** 4. Lógica de sucesso/erro REMOVIDA ***
            // Não fazemos nada com a resposta, apenas logamos no console para debug.
            if (!response.ok) {
                 console.error('Sincronização falhou no backend, status:', response.status);
                 try {
                     const errResult = await response.json();
                     console.error('Detalhe do erro:', errResult.message);
                 } catch (e) {
                     console.error('Não foi possível parsear o JSON do erro.');
                 }
            } else {
                 console.log('Sincronização concluída no backend.');
            }

        } catch (networkError) {
            // Erro de rede ou fetch falhou completamente
            // Loga no console, mas não mostra modal de erro ao usuário
            console.error('Erro de rede durante o fetch:', networkError);
        
        } finally {
            // *** 5. SEMPRE executa isso quando o fetch termina (sucesso ou erro) ***
            
            // Esconde o modal de carregamento
            ModalSystem.hideLoading();

            // Reabilita o botão e restaura o texto original
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
            
            // Limpa os campos de arquivo para evitar reenvio acidental
            syncForm.reset();
            
            console.log('Form submission handler finished.');
        }
    });

    console.log('productSyncManager.js: Event listeners ADDED.');
});