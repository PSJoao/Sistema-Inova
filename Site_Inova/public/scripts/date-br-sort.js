(function($) {
    if (!$.fn.dataTable) {
        return;
    }

    // Função para converter a data DD/MM/YYYY para um formato que o DataTables consegue ordenar (YYYYMMDD)
    function dateToComparable(date) {
        if (!date || typeof date !== 'string') {
            return 0;
        }
        // Quebra a data em partes
        var dateParts = date.split('/');
        if (dateParts.length !== 3) {
            return 0;
        }
        // Retorna a data no formato YYYYMMDD
        return parseInt(dateParts[2] + dateParts[1] + dateParts[0], 10);
    }

    // Regista o novo tipo de ordenação
    $.fn.dataTable.ext.type.order['date-br-pre'] = dateToComparable;

}(jQuery));