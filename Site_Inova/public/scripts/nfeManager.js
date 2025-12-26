// public/scripts/nfeManagementManager.js

document.addEventListener('DOMContentLoaded', function() {
    console.log("nfeManagementManager.js: Iniciado.");

    const dtLucas = initializeDataTable('#nfeLucasTable');
    const dtEliane = initializeDataTable('#nfeElianeTable');
    const btnGerarEtiquetas = document.getElementById('btnGerarEtiquetas');

    const tables = [dtLucas, dtEliane];

    // Adiciona listeners para os checkboxes "Selecionar Todos"
    document.querySelectorAll('.select-all-checkbox').forEach(headerCheckbox => {
        headerCheckbox.addEventListener('change', function() {
            const tableId = this.dataset.tableId;
            const rows = document.querySelectorAll(`#${tableId} tbody tr`);
            rows.forEach(row => {
                const rowCheckbox = row.querySelector('.nfe-select-checkbox');
                if (rowCheckbox) rowCheckbox.checked = this.checked;
            });
            updateGerarEtiquetasButtonState();
        });
    });

    // Adiciona listeners para os checkboxes individuais
    document.querySelectorAll('.nfe-select-checkbox').forEach(rowCheckbox => {
        rowCheckbox.addEventListener('change', updateGerarEtiquetasButtonState);
    });

    function updateGerarEtiquetasButtonState() {
        const algumaSelecionada = document.querySelector('.nfe-select-checkbox:checked');
        if (btnGerarEtiquetas) {
            btnGerarEtiquetas.disabled = !algumaSelecionada;
        }
    }

    if (btnGerarEtiquetas) {
        btnGerarEtiquetas.addEventListener('click', function() {
            const selectedIds = [];
            document.querySelectorAll('.nfe-select-checkbox:checked').forEach(checkbox => {
                const nfeId = checkbox.closest('tr').dataset.nfeId;
                if (nfeId) selectedIds.push(nfeId);
            });

            if (selectedIds.length > 0) {
                // Abre a página de impressão em uma nova aba, passando os IDs na URL
                const url = `/emissao/print-labels?ids=${selectedIds.join(',')}`;
                window.open(url, '_blank');
            } else {
                ModalSystem.alert("Nenhuma nota fiscal selecionada.", "Aviso");
            }
        });
    }

    function initializeDataTable(tableSelector) {
        if (typeof $ === 'undefined' || !$.fn.dataTable) { return null; }
        return $(tableSelector).DataTable({
            "pageLength": 10,
            "searching": true, "paging": true, "info": true, "order": [[ 4, "desc" ]], // Ordena pela data
            "language": { /* ... suas traduções ... */ }
        });
    }
});