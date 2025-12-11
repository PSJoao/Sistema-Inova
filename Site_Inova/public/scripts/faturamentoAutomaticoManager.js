document.addEventListener('DOMContentLoaded', () => {
    const btnFaturar = document.getElementById('btnFaturarML');

    if (btnFaturar) {
        btnFaturar.addEventListener('click', (e) => {
            e.preventDefault();

            // 1. Monta o HTML para seleção de conta (estilo simples para caber no modal)
            const contentHtml = `
                <div class="modal-form-content">
                    <p class="modal-description">Selecione a conta para processar as notas fiscais pendentes do Mercado Livre:</p>
                    
                    <div class="modal-radio-group">
                        <label class="radio-option">
                            <input type="radio" name="contaFaturamento" value="lucas">
                            <span class="radio-label">Conta Lucas</span>
                        </label>
                    </div>
                    <br>
                    <p class="modal-helper-text">
                        <i class="fas fa-info-circle"></i> O processo será executado em segundo plano e pode levar alguns minutos.
                    </p>
                </div>
            `;

            // 2. Abre o Modal do Sistema
            ModalSystem.confirm(
                contentHtml, 
                'Faturamento Automático ML', 
                async () => {
                    // Callback de Confirmação (Botão OK/Confirmar clicado)
                    
                    // Busca qual radio foi marcado
                    const selectedEl = document.querySelector('input[name="contaFaturamento"]:checked');
                    
                    if (!selectedEl) {
                        // Se nada foi selecionado, alerta e para.
                        // Como o modal já fechou, usamos um alert simples ou reabrimos o modal.
                        alert('Por favor, selecione uma conta (Lucas ou Eliane) para continuar.');
                        return;
                    }

                    const accountName = selectedEl.value;
                    iniciarFaturamento(accountName);
                },
                null, // Callback de Cancelar (opcional)
                { 
                    confirmText: 'Iniciar Processo', 
                    isHtml: true 
                }
            );
        });
    }

    async function iniciarFaturamento(accountName) {
        try {
            // Usa o Loading do próprio sistema
            ModalSystem.showLoading('Iniciando o faturamento...', 'Iniciando');

            const response = await fetch('/faturamento-automatico/iniciar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ accountName })
            });

            const result = await response.json();

            // Fecha o loading
            ModalSystem.hideLoading();

            // Mostra o resultado usando o ModalSystem (reaproveitando o confirm como alerta)
            // Passamos null no onConfirm e onCancel para fechar apenas.
            if (result.success) {
                ModalSystem.confirm(
                    `${result.message}`,
                    'Sucesso!',
                    null,
                    null,
                    { confirmText: 'OK', isHtml: true }
                );
            } else {
                ModalSystem.confirm(
                    `${result.message}`,
                    'Erro',
                    null,
                    null,
                    { confirmText: 'Fechar', isHtml: true }
                );
            }

        } catch (error) {
            console.error('Erro no front-end:', error);
            ModalSystem.hideLoading();
            ModalSystem.confirm('Falha de comunicação com o servidor.', 'Erro Crítico', null, null, { confirmText: 'OK' });
        }
    }
});