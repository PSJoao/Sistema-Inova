document.addEventListener('DOMContentLoaded', () => {
    const btnFaturar = document.getElementById('btnFaturarML');

    if (btnFaturar) {
        btnFaturar.addEventListener('click', (e) => {
            e.preventDefault();

            // 1. Monta o HTML para seleção de conta (estilo simples para caber no modal)
            const contentHtml = `
                <div style="text-align: left; padding: 10px;">
                    <p style="margin-bottom: 15px;">Selecione a conta para processar as notas fiscais pendentes do Mercado Livre:</p>
                    <div style="margin-bottom: 10px;">
                        <label style="cursor: pointer; display: flex; align-items: center;">
                            <input type="radio" name="contaFaturamento" value="lucas" style="margin-right: 10px; transform: scale(1.2);">
                            <span style="font-weight: bold;">Conta Lucas</span>
                        </label>
                    </div>
                    <div>
                        <label style="cursor: pointer; display: flex; align-items: center;">
                            <input type="radio" name="contaFaturamento" value="eliane" style="margin-right: 10px; transform: scale(1.2);">
                            <span style="font-weight: bold;">Conta Eliane</span>
                        </label>
                    </div>
                    <p style="margin-top: 15px; font-size: 0.9em; color: #666;">
                        <i class="fas fa-info-circle"></i> Notas com mais de 1 item serão puladas.
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
            ModalSystem.showLoading('Enviando comando ao servidor...', 'Iniciando');

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
                    `<div style="text-align: center; color: green; font-size: 1.2em;">
                        <i class="fas fa-check-circle"></i> ${result.message}
                     </div>`,
                    'Sucesso!',
                    null,
                    null,
                    { confirmText: 'OK', isHtml: true }
                );
            } else {
                ModalSystem.confirm(
                    `<div style="text-align: center; color: red;">
                        <i class="fas fa-exclamation-triangle"></i> ${result.message}
                     </div>`,
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