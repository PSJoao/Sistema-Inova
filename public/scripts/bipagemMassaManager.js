let nfsBipadas = [];
const barcodeInput = document.getElementById('massa-barcode-input');
const statusSelect = document.getElementById('massa-status-select');
const listContainer = document.getElementById('massa-list-container');
const emptyState = document.getElementById('massa-empty-state');
const totalCountElement = document.getElementById('massa-total-count');

const audioSuccess = document.getElementById('audio-success');
const audioError = document.getElementById('audio-error');

function playSuccess() {
    if (audioSuccess) {
        audioSuccess.currentTime = 0;
        audioSuccess.play().catch(e => console.warn('Audio play failed:', e));
    }
}

function playError() {
    if (audioError) {
        audioError.currentTime = 0;
        audioError.play().catch(e => console.warn('Audio play failed:', e));
    }
}

function focusInput() {
    barcodeInput.focus();
}

function updateUI() {
    totalCountElement.textContent = nfsBipadas.length;
    if (nfsBipadas.length > 0) {
        emptyState.style.display = 'none';
    } else {
        emptyState.style.display = 'block';
    }
}

function appendToLog(nfCode, statusNome, success, message) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'massa-item';
    itemDiv.style.borderLeft = success ? '4px solid #4CAF50' : '4px solid var(--color-danger)';
    
    const timeNow = new Date().toLocaleTimeString('pt-BR');

    itemDiv.innerHTML = `
        <div class="massa-item-info">
            <span class="massa-item-nf">${nfCode}</span>
            <span class="massa-item-status" style="color: ${success ? '#4CAF50' : 'var(--color-danger)'};">
                <b>${success ? `Atualizado para ${statusNome}` : 'Falha ao atualizar'}</b> - ${timeNow}
            </span>
            ${!success ? `<span style="display:block; font-size: 0.8rem; opacity: 0.8; margin-top: 5px;">${message}</span>` : ''}
        </div>
        <div style="font-size: 1.5rem; color: ${success ? '#4CAF50' : 'var(--color-danger)'}; margin-right: 10px;">
            <i class="fas ${success ? 'fa-check-circle' : 'fa-times-circle'}"></i>
        </div>
    `;
    
    // Add inside list but keep emptyState untouched
    listContainer.appendChild(itemDiv);
    updateUI();
    listContainer.scrollTop = listContainer.scrollHeight;
}

barcodeInput.addEventListener('keydown', async function(e) {
    if (e.key === 'Enter') {
        let codigo = this.value.trim();
        this.value = ''; // Limpa rápido
        
        if (!codigo) return;

        const novoStatus = statusSelect.value;
        const nomesStatus = {
            'checado': 'Checado',
            'sem_estoque': 'Sem Estoque (Pausado)',
            'cancelado': 'Cancelado',
            'pendente': 'Pendente (Retomar)'
        };
        const statusNome = nomesStatus[novoStatus];

        if (nfsBipadas.includes(codigo)) {
            playError();
            Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Código já bipado nesta sessão.', showConfirmButton: false, timer: 1500 });
            return;
        }

        try {
            // 1. Validar e formatar NF
            const reqVal = await fetch('/api/expedicao/bipagem-massa/validar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo })
            });
            const resVal = await reqVal.json();

            if (!resVal.success) {
                playError();
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: resVal.message, showConfirmButton: false, timer: 3000 });
                focusInput();
                return;
            }

            const nfeFinal = resVal.nfe;

            // 2. Imediatamente Atualizar Status
            const reqUpd = await fetch('/api/expedicao/bipagem-massa/atualizar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nfList: [nfeFinal], novoStatus })
            });
            const resUpd = await reqUpd.json();

            if (resUpd.success) {
                playSuccess();
                nfsBipadas.push(codigo); // Trava re-bipagem
                if (nfeFinal !== codigo && !nfsBipadas.includes(nfeFinal)) {
                    nfsBipadas.push(nfeFinal); 
                }
                appendToLog(nfeFinal, statusNome, true, '');
            } else {
                playError();
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: resUpd.message, showConfirmButton: false, timer: 3000 });
            }
        } catch (error) {
            playError();
            Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Erro de conexão HTTP.', showConfirmButton: false, timer: 3000 });
        }
        
        focusInput();
    }
});

// Força foco
document.addEventListener('DOMContentLoaded', focusInput);
listContainer.addEventListener('click', () => {
    // If not clicking inner child texts, focus inputs
    focusInput();
});
