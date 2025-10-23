// public/scripts/productSyncManager.js
document.addEventListener('DOMContentLoaded', () => {
    console.log('productSyncManager.js: DOMContentLoaded'); // Log para verificar execução

    const syncForm = document.getElementById('productSyncForm');
    const submitButton = syncForm ? syncForm.querySelector('button[type="submit"]') : null;

    if (!syncForm || !submitButton) {
        console.error('ERRO CRÍTICO: Formulário de sincronização (id="productSyncForm") ou botão de submit não encontrado.');
        // Tenta alertar o usuário se o ModalSystem estiver disponível
        if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
             ModalSystem.alert('<p class="text-danger">Erro interno na página. Não foi possível encontrar o formulário de envio. Recarregue a página ou contate o suporte.</p>', 'Erro de Interface');
        }
        return; // Impede a execução do resto do script
    }

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
        // *** PASSO CRÍTICO: Impedir o envio padrão IMEDIATAMENTE ***
        event.preventDefault();
        console.log('Form submit intercepted, default prevented.');

        // Desabilita o botão e mostra estado de carregamento
        submitButton.disabled = true;
        const originalButtonText = submitButton.innerHTML;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sincronizando...';

        // Mostra o modal de carregamento
        ModalSystem.showLoading('Iniciando sincronização das planilhas...', 'Aguarde');

        const formData = new FormData(syncForm);

        try {
            console.log('Sending fetch request to /product-sync/upload');
            const response = await fetch('/product-sync/upload', {
                method: 'POST',
                body: formData,
                // headers: { 'Accept': 'application/json' } // Garante que o frontend espera JSON
            });
            console.log('Fetch response received, status:', response.status);

            ModalSystem.hideLoading(); // Esconde o modal de carregamento

            // Tenta parsear JSON independentemente do status (para pegar mensagens de erro)
            let result;
            try {
                 result = await response.json();
                 console.log('Response JSON parsed:', result);
            } catch (jsonError) {
                 console.error('Erro ao parsear resposta JSON:', jsonError);
                 // Cria um objeto de erro padrão se o JSON falhar
                 result = { success: false, message: `Erro ao processar resposta do servidor (Status: ${response.status}). Verifique o console para detalhes.` };
                 // Define um status HTTP de erro se não for um sucesso
                 if (!response.ok) {
                     response.status = response.status || 500; // Garante um status de erro
                 }
            }


            // Prepara a mensagem de resultado para o modal
            let resultMessageHtml = `<h4>Resultado da Sincronização:</h4>`;

            // Função auxiliar para formatar resultados de uma conta
            const formatAccountResult = (accountName, accountResult) => {
                // Adiciona verificações defensivas para cada propriedade
                let html = `<h5>Conta ${accountName.charAt(0).toUpperCase() + accountName.slice(1)}:</h5>`;
                if (accountResult && accountResult.error) {
                    html += `<p class="text-danger">Erro geral: ${accountResult.error}</p>`;
                } else if (accountResult && (accountResult.successCount > 0 || accountResult.errorCount > 0 || (Array.isArray(accountResult.errors) && accountResult.errors.length > 0))) {
                    const successCount = accountResult.successCount || 0;
                    const errorCount = accountResult.errorCount || 0;
                    html += `<p class="text-success">Sucesso: ${successCount} SKU(s)</p>`;
                    html += `<p class="text-${errorCount > 0 ? 'danger' : 'muted'}">Falhas: ${errorCount} SKU(s)</p>`;
                    if (Array.isArray(accountResult.errors) && accountResult.errors.length > 0) {
                        html += `<small>Detalhes das falhas:</small><ul>`;
                        accountResult.errors.forEach(err => {
                            html += `<li>SKU ${err.sku || 'N/A'}: ${err.message || 'Erro desconhecido'}</li>`;
                        });
                        html += `</ul>`;
                    }
                } else {
                    // Caso onde não houve erro geral, mas também não houve sucesso/falha (planilha vazia/não enviada)
                    html += `<p>Nenhum SKU processado (planilha vazia ou não enviada).</p>`
                }
                return html;
            };

            // Adiciona resultados das contas se existirem no objeto 'result'
            if (result.results && result.results.lucas) {
                resultMessageHtml += formatAccountResult('Lucas', result.results.lucas);
            } else if (skusLucas.length > 0){ // Adiciona mensagem se a planilha foi enviada mas não houve resultado (erro?)
                 resultMessageHtml += `<h5>Conta Lucas:</h5><p class="text-warning">Nenhum resultado retornado para Lucas.</p>`;
            }

            if (result.results && result.results.eliane) {
                resultMessageHtml += formatAccountResult('Eliane', result.results.eliane);
             } else if (skusEliane.length > 0){ // Adiciona mensagem se a planilha foi enviada mas não houve resultado (erro?)
                 resultMessageHtml += `<h5>Conta Eliane:</h5><p class="text-warning">Nenhum resultado retornado para Eliane.</p>`;
            }

            // Define o título do modal
            const modalTitle = result.message || (response.ok ? 'Processo Concluído' : 'Falha na Sincronização');

            // Mostra o modal final
            ModalSystem.alert(resultMessageHtml, modalTitle);

        } catch (networkError) {
            // Erro de rede ou fetch falhou completamente
            console.error('Erro de rede durante o fetch:', networkError);
            ModalSystem.hideLoading();
            ModalSystem.alert(`<p class="text-danger">Não foi possível conectar ao servidor para iniciar a sincronização: ${networkError.message}</p>`, 'Erro de Rede');
        } finally {
            // Reabilita o botão e restaura o texto original, independentemente do resultado
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
            // Limpa os campos de arquivo para evitar reenvio acidental
            syncForm.reset();
            console.log('Form submission handler finished.');
        }
    });

    console.log('productSyncManager.js: Event listeners added.');
});

