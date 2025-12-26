// public/scripts/modal.js

const ModalSystem = {
    modal: null,
    overlay: null,
    title: null,
    message: null,
    modalBody: null,
    btnOk: null,
    btnConfirm: null,
    btnCancel: null,
    spinner: null,

    init(options = {}) {
        this.modal = document.getElementById('customModal');
        this.overlay = document.getElementById('customModalOverlay');
        this.title = document.getElementById('customModalTitle');
        this.message = document.getElementById('customModalMessage');
        this.modalBody = this.modal ? this.modal.querySelector('.custom-modal-body') : null;
        this.btnOk = document.getElementById('customModalBtnOk');
        this.btnConfirm = document.getElementById('customModalBtnConfirm');
        this.btnCancel = document.getElementById('customModalBtnCancel');
        this.spinner = document.getElementById('customModalSpinner');

        if (!this.modal || !this.overlay) {
            console.error("ModalSystem: Elementos essenciais do modal não encontrados no DOM.");
            return;
        }

        if (!options.preventOverlayClose) {
            this.overlay.addEventListener('click', () => this.hide());
        }

        console.log("Sistema de Modal" + (options.preventOverlayClose ? " (sem overlay close)" : "") + " Inicializado.");
    },

    show() {
        this.overlay.style.display = 'block';
        this.modal.style.display = 'block';
        setTimeout(() => {
            this.overlay.classList.add('visible');
            this.modal.classList.add('visible');
        }, 10);
    },

    hide() {
        this.overlay.classList.remove('visible');
        this.modal.classList.remove('visible');
        setTimeout(() => {
            this.overlay.style.display = 'none';
            this.modal.style.display = 'none';
            // Garante que qualquer input dinâmico seja removido ao fechar
            const dynamicInput = this.modalBody.querySelector('.modal-dynamic-input');
            if (dynamicInput) {
                dynamicInput.remove();
            }
            this.message.style.display = 'block'; // Mostra a mensagem de volta
            this.spinner.style.display = 'none';
        }, 300);
    },

    alert(message, title = "Atenção", onOk = null, options = {}) { // Adiciona o parâmetro 'options'
        // Garante que o modal esteja no estado correto (sem spinner)
        if (this.spinner) this.spinner.style.display = 'none';
        
        if (this.message) {
            this.message.style.display = 'block';

            // [MUDANÇA PRINCIPAL]
            // Verifica se a opção 'isHtml' foi passada
            if (options.isHtml) {
                // Se sim, usa .innerHTML para renderizar o HTML
                this.message.innerHTML = message;
            } else {
                // Se não, usa .textContent para o comportamento padrão (texto seguro)
                this.message.textContent = message;
            }
        }
        
        this.title.textContent = title;
        
        this.btnConfirm.style.display = 'none';
        this.btnCancel.style.display = 'none';
        this.btnOk.style.display = 'inline-block';

        this.btnOk.onclick = () => {
            this.hide();
            if (onOk) onOk();
        };
        
        if (this.modal.style.display !== 'block') {
            this.show();
        }
    },
    
    confirm(message, title = "Confirmação", onConfirm, onCancel = null, options = {}) {
        this.title.textContent = title;

        // Limpa a mensagem antiga para evitar duplicatas
        this.message.innerHTML = ''; 

        // [MUDANÇA PRINCIPAL]
        // Verificamos se a opção isHtml é verdadeira.
        if (options.isHtml) {
            // Se for, usamos .innerHTML para que o navegador renderize o HTML.
            this.message.innerHTML = message;
        } else {
            // Caso contrário, usamos .textContent para o comportamento padrão (texto seguro).
            this.message.textContent = message;
        }

        // Configuração dos botões continua a mesma
        this.btnOk.style.display = 'none';
        this.btnConfirm.style.display = 'inline-block';
        this.btnCancel.style.display = 'inline-block';

        // Atribui as funções aos botões
        // [MELHORIA] Atribuímos uma nova função anônima para evitar problemas de referência
        const confirmHandler = () => {
            if (onConfirm) onConfirm();
            this.hide();
        };

        const cancelHandler = () => {
            if (onCancel) onCancel();
            this.hide();
        };
        
        // Remove listeners antigos para evitar chamadas múltiplas
        this.btnConfirm.removeEventListener('click', this.btnConfirm._currentHandler);
        this.btnCancel.removeEventListener('click', this.btnCancel._currentHandler);
        
        this.btnConfirm.addEventListener('click', confirmHandler);
        this.btnCancel.addEventListener('click', cancelHandler);

        // Armazena a referência para poder remover depois
        this.btnConfirm._currentHandler = confirmHandler;
        this.btnCancel._currentHandler = cancelHandler;


        this.show();
    },

    showLoading(message = "Carregando...") {
        this.title.textContent = "Processando...";
        
        // Esconde a área de mensagem e mostra o spinner
        if (this.message) this.message.style.display = 'none';
        if (this.spinner) {
            this.spinner.style.display = 'block';
            // Tenta encontrar um elemento de texto dentro do spinner para atualizar
            const spinnerText = this.spinner.querySelector('.spinner-text');
            if (spinnerText) spinnerText.textContent = message;
        }

        // Esconde todos os botões
        this.btnOk.style.display = 'none';
        this.btnConfirm.style.display = 'none';
        this.btnCancel.style.display = 'none';

        // Garante que o modal esteja visível
        if (this.modal.style.display !== 'block') {
            this.show();
        }
    },

    hideLoading() {
        this.hide();
    },

    /**
     * [NOVA FUNÇÃO ADICIONADA]
     * Exibe um modal com um campo de input para entrada de dados.
     */
    prompt(message, title = "Entrada", onConfirm, inputType = 'text', defaultValue = '', inputOptions = {}) {
        this.title.textContent = title;
        this.message.textContent = message;

        // Remove qualquer input antigo para garantir que não haja duplicatas
        const oldInput = this.modalBody.querySelector('.modal-dynamic-input');
        if (oldInput) oldInput.remove();
        
        // Cria o novo elemento de input
        const input = document.createElement(inputType === 'textarea' ? 'textarea' : 'input');
        input.id = 'modal-prompt-input'; // ID para estilização se necessário
        input.className = 'form-control modal-dynamic-input'; // Classe para remoção e estilo
        
        if (inputType !== 'textarea') {
            input.type = inputType;
        }
        
        input.value = defaultValue;

        if (inputOptions.maxLength) {
            input.maxLength = inputOptions.maxLength;
        }
        if (inputType === 'textarea') {
            input.rows = 3;
        }

        // Adiciona o input ao corpo do modal
        this.modalBody.appendChild(input);

        this.btnOk.style.display = 'none';
        this.btnConfirm.style.display = 'inline-block';
        this.btnCancel.style.display = 'inline-block';

        this.btnConfirm.onclick = () => {
            const inputValue = input.value;
            this.hide();
            if (onConfirm) onConfirm(inputValue);
        };
        
        this.btnCancel.onclick = () => {
            this.hide();
            // Nenhuma ação no cancelamento por padrão
        };

        this.show();
        input.focus();
    }
};

// A inicialização permanece a mesma
document.addEventListener('DOMContentLoaded', () => {
    ModalSystem.init();
});