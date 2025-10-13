// Exemplo de script para confirmação (ex: em public/scripts/mainTableActions.js ou similar)
document.addEventListener('DOMContentLoaded', function() {
    const removeForms = document.querySelectorAll('.form-remove-product'); // Adicione esta classe aos seus formulários de remoção

    removeForms.forEach(form => {
        form.addEventListener('submit', function(event) {
            event.preventDefault(); // Impede o envio imediato do formulário

            const message = 'Tem certeza que deseja remover este produto?';

            ModalSystem.confirm(
                message + " Esta ação não pode ser desfeita.",
                'Confirmar Remoção',
                function() { // onConfirm
                    form.submit(); // Prossegue com o envio do formulário original
                },
                function() { // onCancel
                    console.log('Remoção cancelada pelo usuário.');
                }
            );
        });
    });
});