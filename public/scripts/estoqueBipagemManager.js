/**
 * estoqueBipagemManager.js
 * Gerenciamento do fluxo de bipagem de peças para entrada e saída rápida no estoque.
 */
document.addEventListener('DOMContentLoaded', function() {
    const inputCodigo = document.getElementById('bipagemCodigo');
    const logsList = document.getElementById('logsList');
    const logsPlaceholder = document.getElementById('logsPlaceholder');
    const btnClearLogs = document.getElementById('btnClearLogs');
    const radioModes = document.querySelectorAll('input[name="bipagem_mode"]');

    // === Sons ===
    const soundSuccess = new Audio('/public/sounds/notification.mp3');
    const soundError = new Audio('/public/sounds/error.mp3');

    // =============================================
    // === MANUTENÇÃO DO FOCO ===
    // =============================================

    // Garante que o input mantenha sempre o foco, mesmo se o usuário clicar fora
    const forceFocus = () => {
        // Apenas foca se não houver um modal ou prompt ativo do ModalSystem
        const activeModal = document.getElementById('customModal');
        if (!activeModal || activeModal.style.display === 'none') {
            inputCodigo.focus();
        }
    };

    // Foco inicial
    forceFocus();

    // Foco ao clicar em qualquer lugar da página (exceto se for em botões/links)
    document.addEventListener('click', (e) => {
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'INPUT' && !e.target.closest('.btn') && !e.target.closest('a')) {
            forceFocus();
        }
    });

    // =============================================
    // === PROCESSAMENTO DO BIP ===
    // =============================================

    inputCodigo.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const codigo = inputCodigo.value.trim();
            if (!codigo) return;

            // Pega o modo selecionado
            let tipo = 'entrada';
            radioModes.forEach(r => {
                if (r.checked) tipo = r.value;
            });

            await processarBip(codigo, tipo);
        }
    });

    /**
     * Envia o código bipado para o backend e atualiza a interface.
     */
    const processarBip = async (codigo, tipo) => {
        // Limpa o input imediatamente para a próxima bipagem
        inputCodigo.value = '';
        
        try {
            const response = await fetch('/estoque/api/bipar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo, tipo })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Erro ao processar movimentação.');
            }

            // Reproduz som de sucesso
            tocarSom(soundSuccess);

            // Adiciona o log de sucesso na tela
            adicionarLog(tipo, result.peca, result.message);

        } catch (error) {
            // Reproduz som de erro
            tocarSom(soundError);

            // Adiciona log de erro na tela
            adicionarLog('erro', { sku: codigo.toUpperCase(), nome_peca: 'Código não reconhecido ou erro de saldo' }, error.message);
        } finally {
            forceFocus();
        }
    };

    // =============================================
    // === AUXILIARES DE AUDIO E INTERFACE ===
    // =============================================

    /**
     * Toca um áudio reiniciando o tempo para permitir toques sucessivos rápidos.
     */
    const tocarSom = (audio) => {
        try {
            audio.currentTime = 0;
            audio.play().catch(err => console.warn('Erro ao tocar áudio:', err));
        } catch (e) {
            console.error('Falha de áudio:', e);
        }
    };

    /**
     * Adiciona um item no painel de log da tela.
     */
    const adicionarLog = (tipo, peca, mensagem) => {
        // Remove placeholder no primeiro bip
        if (logsPlaceholder) {
            logsPlaceholder.remove();
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString('pt-BR');

        let logClass = 'log-entrada';
        let iconClass = 'fa-arrow-circle-down';
        let actionLabel = 'ENTRADA';

        if (tipo === 'saida') {
            logClass = 'log-saida';
            iconClass = 'fa-arrow-circle-up';
            actionLabel = 'SAÍDA';
        } else if (tipo === 'erro') {
            logClass = 'log-erro';
            iconClass = 'fa-exclamation-triangle';
            actionLabel = 'ERRO';
        }

        const logItem = document.createElement('div');
        logItem.className = `bipagem-log-item ${logClass}`;
        
        let contentHtml = '';
        if (tipo === 'erro') {
            contentHtml = `
                <div class="bipagem-log-icon"><i class="fas ${iconClass}"></i></div>
                <div class="bipagem-log-content">
                    <strong>[${actionLabel}] Código: ${escapeHtml(peca.sku)}</strong> — <span class="text-danger">${escapeHtml(mensagem)}</span>
                </div>
                <div class="bipagem-log-time">${timeStr}</div>
            `;
        } else {
            const localizacao = (peca.coluna_localizacao || peca.linha_localizacao)
                ? `[Localização: ${peca.coluna_localizacao || '-'}/${peca.linha_localizacao || '-'}]`
                : '';
            
            contentHtml = `
                <div class="bipagem-log-icon"><i class="fas ${iconClass}"></i></div>
                <div class="bipagem-log-content">
                    <strong>[${actionLabel}] ${escapeHtml(peca.sku)}</strong> — ${escapeHtml(peca.nome_peca)} (${escapeHtml(peca.fabrica_nome || 'Sem Fábrica')})
                    <br>
                    <span style="color: var(--text-muted); font-size: 0.85rem;">
                        Novo Saldo: <strong>${peca.quantidade}</strong> ${localizacao}
                    </span>
                </div>
                <div class="bipagem-log-time">${timeStr}</div>
            `;
        }

        logItem.innerHTML = contentHtml;

        // Insere sempre no topo
        logsList.insertBefore(logItem, logsList.firstChild);
    };

    // Limpar logs visualmente
    btnClearLogs.addEventListener('click', () => {
        logsList.innerHTML = `
            <div class="bipagem-logs-placeholder" id="logsPlaceholder">
                <i class="fas fa-barcode"></i>
                <p>Nenhuma movimentação realizada nesta sessão.</p>
                <p style="font-size: 0.8rem;">Bipe um produto acima para registrar a entrada ou saída.</p>
            </div>
        `;
        forceFocus();
    });

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
