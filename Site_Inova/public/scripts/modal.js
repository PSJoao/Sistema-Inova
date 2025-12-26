// public/scripts/modal.js
const ModalSystem = (function() {
    let modalOverlayEl, modalEl, modalTitleEl, modalMessageEl; // Removido modalCloseBtnEl
    let btnOkEl, btnConfirmEl, btnCancelEl;
    let modalSpinnerEl;
    
    let currentOnOk = null;
    let currentOnConfirm = null;
    let currentOnCancel = null;

    function init() {
        modalOverlayEl = document.getElementById('customModalOverlay');
        modalEl = document.getElementById('customModal');
        modalTitleEl = document.getElementById('customModalTitle');
        modalMessageEl = document.getElementById('customModalMessage');
        // modalCloseBtnEl = document.getElementById('customModalCloseBtn'); // REMOVIDO
        btnOkEl = document.getElementById('customModalBtnOk');
        btnConfirmEl = document.getElementById('customModalBtnConfirm');
        btnCancelEl = document.getElementById('customModalBtnCancel');
        modalSpinnerEl = document.getElementById('customModalSpinner');

        if (!modalEl || !modalOverlayEl || !btnOkEl || !btnConfirmEl || !btnCancelEl || 
            /* !modalCloseBtnEl || */ !modalTitleEl || !modalMessageEl || !modalSpinnerEl) { // Removida checagem de modalCloseBtnEl
            console.error("ModalSystem: Elementos HTML essenciais do modal (ou spinner) não encontrados!");
            return false;
        }

        // REMOVIDOS OS EVENT LISTENERS PARA FECHAR NO OVERLAY E NO BOTÃO X
        // modalOverlayEl.addEventListener('click', closeRequestHandler);
        // modalCloseBtnEl.addEventListener('click', closeRequestHandler); 
        
        btnOkEl.addEventListener('click', () => {
            if (typeof currentOnOk === 'function') {
                currentOnOk();
            }
            closeModalInternal();
        });
        
        btnConfirmEl.addEventListener('click', () => {
            if (typeof currentOnConfirm === 'function') {
                currentOnConfirm();
            }
            closeModalInternal();
        });

        btnCancelEl.addEventListener('click', () => { // Botão Cancelar do Confirm
            if (typeof currentOnCancel === 'function') {
                currentOnCancel();
            }
            closeModalInternal();
        });
        
        console.log("Sistema de Modal (sem X/overlay close) Inicializado.");
        return true;
    }

    // A função closeRequestHandler não é mais necessária se apenas o botão Cancelar chama currentOnCancel
    // A lógica dela foi incorporada ao listener do btnCancelEl.

    function closeModalInternal() {
        if (modalEl && modalOverlayEl) {
            modalEl.classList.remove('visible');
            modalOverlayEl.classList.remove('visible');
            if(modalSpinnerEl) modalSpinnerEl.style.display = 'none';
            
            setTimeout(() => {
                if (modalEl && !modalEl.classList.contains('visible')) modalEl.style.display = 'none';
                if (modalOverlayEl && !modalOverlayEl.classList.contains('visible')) modalOverlayEl.style.display = 'none';
            }, 200); 
        }
        currentOnOk = null;
        currentOnConfirm = null;
        currentOnCancel = null;
    }

    function showModalBase(title, message, showSpinner = false) {
        if (!modalEl || !modalOverlayEl || !modalTitleEl || !modalMessageEl || !modalSpinnerEl) {
            console.error("ModalSystem: showModalBase chamado com elementos faltando.");
            return;
        }
        modalTitleEl.textContent = title || 'Atenção';
        modalMessageEl.innerHTML = message || ''; 

        modalSpinnerEl.style.display = showSpinner ? 'block' : 'none';
        modalMessageEl.style.display = showSpinner && !message ? 'none' : 'block';

        modalOverlayEl.style.display = 'block';
        modalEl.style.display = 'block'; 
        void modalEl.offsetHeight; 
        modalOverlayEl.classList.add('visible');
        modalEl.classList.add('visible');
    }


    return {
        initialize: function() {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        },
        alert: function(message, title = 'Aviso', onOkCallback) {
            if (!btnOkEl || !btnConfirmEl || !btnCancelEl) {
                window.alert((title !== 'Aviso' ? title + ":\n" : "") + message);
                if (typeof onOkCallback === 'function') onOkCallback();
                return;
            }
            showModalBase(title, message, false);
            currentOnOk = typeof onOkCallback === 'function' ? onOkCallback : null;
            currentOnConfirm = null; currentOnCancel = null;

            btnOkEl.style.display = 'inline-flex';
            btnConfirmEl.style.display = 'none';
            btnCancelEl.style.display = 'none';
            // modalCloseBtnEl não existe mais, então não precisa controlar seu display
        },
        confirm: function(message, title = 'Confirmação', onConfirmCallback, onCancelCallback) {
            if (!btnOkEl || !btnConfirmEl || !btnCancelEl) {
                if (window.confirm((title !== 'Confirmação' ? title + ":\n" : "") + message)) {
                    if(typeof onConfirmCallback === 'function') onConfirmCallback();
                } else {
                    if(typeof onCancelCallback === 'function') onCancelCallback();
                }
                return;
            }
            showModalBase(title, message, false);
            currentOnConfirm = typeof onConfirmCallback === 'function' ? onConfirmCallback : null;
            currentOnCancel = typeof onCancelCallback === 'function' ? onCancelCallback : null;
            currentOnOk = null;

            btnOkEl.style.display = 'none';
            btnConfirmEl.style.display = 'inline-flex';
            btnCancelEl.style.display = 'inline-flex';
            // modalCloseBtnEl não existe mais
        },
        prompt: function(message, title = "Entrada", onConfirm, inputType = 'text', defaultValue = '', inputOptions = {}) {
            // Cria o HTML do conteúdo, incluindo o campo de input.
            const promptContent = `
                <p>${message}</p>
                <input type="${inputType}" id="modalPromptInput" class="form-control" value="${defaultValue}" style="margin-top: 10px;"
                    ${inputOptions.maxLength ? `maxlength="${inputOptions.maxLength}"` : ''}
                >
            `;
            
            // Reutiliza a função 'confirm', mas passando o HTML e uma lógica de callback diferente
            this.confirm(
                promptContent,
                title,
                () => { // onConfirm do prompt
                    // A correção de buscar o elemento ANTES de fechar o modal é aplicada aqui
                    const modal = document.getElementById('customModal');
                    const input = modal.querySelector('#modalPromptInput');
                    if (onConfirm) {
                        onConfirm(input ? input.value : null);
                    }
                },
                null, // onCancel não faz nada
                { confirmText: "OK", isHtml: true } // Opções para o 'confirm'
            );
            
            // Foco no campo de input após o modal ser exibido
            setTimeout(() => {
                const input = document.getElementById('modalPromptInput');
                if (input) input.focus();
            }, 10); // Pequeno delay para garantir que o modal está visível
        },
        showLoading: function(message = 'Carregando...', title = 'Processando') {
            if (!modalEl || !btnOkEl || !btnConfirmEl || !btnCancelEl || !modalSpinnerEl) {
                console.warn("ModalSystem.showLoading: Elementos do modal não disponíveis.");
                return;
            }
            showModalBase(title, message, true);
            
            btnOkEl.style.display = 'none';
            btnConfirmEl.style.display = 'none';
            btnCancelEl.style.display = 'none';
            // modalCloseBtnEl não existe mais
        },
        hideLoading: function() {
            closeModalInternal();
            // modalCloseBtnEl não existe mais
        }
    };
})();

ModalSystem.initialize();