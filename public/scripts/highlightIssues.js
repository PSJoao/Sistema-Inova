// public/scripts/highlightIssues.js
function highlightIssues(tableSelector) { // Aceita o seletor da tabela (ex: '#minhaTabela')
  if (!tableSelector) { // Fallback se nenhum seletor for passado
    console.warn('highlightIssues foi chamado sem um tableSelector.');
    return;
  }
  $(tableSelector + ' tbody tr').each(function() {
    const marginCell = $(this).find('.margin-cell');
    if (marginCell.length > 0) { // Verifica se a célula de margem existe
      const marginText = marginCell.text().trim().replace('%', '');
      const margin = parseFloat(marginText);

      if (!isNaN(margin) && margin < 30) {
        marginCell.addClass('highlight-red');
      } else {
        marginCell.removeClass('highlight-red');
      }
    }
  });
}