let nfsBipadas = [];
const barcodeInput = document.getElementById('massa-barcode-input');
const statusSelect = document.getElementById('massa-status-select');
const listContainer = document.getElementById('massa-list-container');
const emptyState = document.getElementById('massa-empty-state');
const totalCountElement = document.getElementById('massa-total-count');
const btnFinalizar = document.getElementById('btn-massa-finalizar');

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
        btnFinalizar.disabled = false;
    } else {
        emptyState.style.display = 'block';
        btnFinalizar.disabled = true;
    }
}

function renderList() {
    // Limpa a lista mantendo o emptyState
    Array.from(listContainer.children).forEach(child => {
        if (child.id !== 'massa-empty-state') {
            listContainer.removeChild(child);
        }
    });

    nfsBipadas.forEach((nfInfo, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'massa-item';
        itemDiv.innerHTML = `
            <div class="massa-item-info">
                <span class="massa-item-nf">${nfInfo.nfe}</span>
                <span class="massa-item-status">Status Atual: <b>${nfInfo.status_atual || 'Pendente'}</b></span>
            </div>
            <button class="massa-item-action" onclick="removerNF(${index})" title="Remover da lista">
                <i class="fas fa-trash"></i>
            </button>
        `;
        listContainer.appendChild(itemDiv);
    });

    updateUI();
    // Faz o scroll ir para o final onde o novo item foi inserido
    listContainer.scrollTop = listContainer.scrollHeight;
}

window.removerNF = function(index) {
    const nfInfo = nfsBipadas[index];
    ModalSystem.confirm(
        `Tem certeza que deseja de fato remover a <b>NF ${nfInfo.nfe}</b> e ignorar a mudança de status dessa nota?`,
        'Remover da Lista',
        () => {
            nfsBipadas.splice(index, 1);
            renderList();
            focusInput();
        },
        () => {
            focusInput();
        }
    );
}

barcodeInput.addEventListener('keydown', async function(e) {
    if (e.key === 'Enter') {
        const codigo = this.value.trim();
        this.value = ''; // Limpa rápido para o próximo bip
        
        if (!codigo) return;

        // Se já foi bipada nesta sessão (pra não mandar req à toa)
        if (nfsBipadas.some(nf => nf.nfe === codigo || (codigo.length >= 44 && codigo.includes(nf.nfe)))) {
            playError();
            Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Nota já está na lista atual.', showConfirmButton: false, timer: 2000 });
            return;
        }

        try {
            const tempToast = Swal.fire({ toast: true, position: 'top-end', title: 'Validando...', showConfirmButton: false });
            
            const req = await fetch('/api/expedicao/bipagem-massa/validar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigo })
            });
            const res = await req.json();

            if (res.success) {
                // Previne re-adicionar caso API traga o nfe_numero formatado limpo e já o tenhamos
                if (nfsBipadas.some(nf => nf.nfe === res.nfe)) {
                     playError();
                     Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Nota já lista.', showConfirmButton: false, timer: 1500 });
                     return;
                }
                playSuccess();
                nfsBipadas.push({ nfe: res.nfe, status_atual: res.status_atual });
                renderList();
                Swal.close();
            } else {
                playError();
                Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: res.message, showConfirmButton: false, timer: 3000 });
            }
        } catch (error) {
            playError();
            Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Erro de conexão.', showConfirmButton: false, timer: 2000 });
            console.error('Erro na validação da NF', error);
        }
        
        focusInput();
    }
});

btnFinalizar.addEventListener('click', function() {
    if (nfsBipadas.length === 0) return;

    const novoStatus = statusSelect.value;
    const nomesStatus = {
        'sem_estoque': 'Sem Estoque (Pausado)',
        'cancelado': 'Cancelado',
        'pendente': 'Pendente (Retomar)'
    };

    ModalSystem.confirm(
        `Deseja realmente alterar ${nfsBipadas.length} notas para <b>${nomesStatus[novoStatus]}</b>?`,
        'Confirmar Atualização Lote',
        async () => {
            // Callback: Confirmado
            try {
                ModalSystem.showLoading('Aguarde enquanto os status são salvos.', 'Aplicando...');

                const nfeList = nfsBipadas.map(n => n.nfe);

                const req = await fetch('/api/expedicao/bipagem-massa/atualizar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nfList: nfeList, novoStatus })
                });
                const res = await req.json();
                
                ModalSystem.hideLoading();

                if (res.success) {
                    ModalSystem.alert(res.message, 'Sucesso!', () => {
                        nfsBipadas = []; // Limpa
                        renderList();
                        focusInput();
                    });
                } else {
                    ModalSystem.alert(res.message, 'Falha', focusInput);
                }
            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert('Não foi possível conectar ao servidor.', 'Erro', focusInput);
                console.error(error);
            }
        },
        () => {
            // Callback: Cancelado
            focusInput();
        }
    );
});

// Força foco ao carregar a página e clicar na área vazia das listas
document.addEventListener('DOMContentLoaded', focusInput);
listContainer.addEventListener('click', focusInput);
