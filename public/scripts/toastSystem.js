/**
 * Sistema de Notificações Não Bloqueantes (Toast - Baseado no SweetAlert2)
 * Usado para não atrapalhar o fluxo contínuo de bipagens/trabalhos.
 */
const ToastSystem = {
    /**
     * Exibe um Toast (Pop-up lateral superior)
     * @param {string} msg Mensagem a ser exibida
     * @param {string} type Tipo: 'success', 'error', 'warning', 'info'
     * @param {number} duration Duração em milissegundos (padrão 2000ms)
     */
    show: function(msg, type = 'info', duration = 2000) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: type,
                title: msg,
                showConfirmButton: false,
                timer: duration,
                timerProgressBar: true,
                customClass: {
                    container: 'toast-custom-container' 
                }
            });
        } else {
            console.warn('SweetAlert2 não está carregado. Fallback para alert.');
            alert(msg);
        }
    },

    error: function(msg, duration = 3000) {
        this.show(msg, 'error', duration);
    },

    success: function(msg, duration = 2000) {
        this.show(msg, 'success', duration);
    },

    warning: function(msg, duration = 2500) {
        this.show(msg, 'warning', duration);
    },

    info: function(msg, duration = 2000) {
        this.show(msg, 'info', duration);
    }
};

// Caso seja usado modularmente
if (typeof module !== 'undefined') module.exports = ToastSystem;
