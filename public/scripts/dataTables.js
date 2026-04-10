$(document).ready(function() {
  function initializeTable(tableId) {
    // Verifica se o elemento da tabela realmente existe na página atual antes de tentar inicializar
    if (!document.querySelector(tableId)) {
      // console.log(`Tabela com ID ${tableId} não encontrada nesta página.`);
      return; // Sai da função se a tabela não existir na DOM
    }

    if ($.fn.dataTable.isDataTable(tableId)) {
      $(tableId).DataTable().destroy();
    }
    $(tableId).DataTable({
      "pageLength": 10,
      "searching": true,
      "paging": true,
      "info": false, 
      "scrollX": true,
      "scrollCollapse": true,
      "language": {
        "search": "Pesquisar:",
        "lengthMenu": "Mostrar _MENU_ registros por página",
        "zeroRecords": "Nada encontrado",
        "info": "Mostrando _PAGE_ de _PAGES_", // Será oculto devido a "info": false
        "infoEmpty": "Nenhum registro disponível",
        "infoFiltered": "(filtrado de _MAX_ registros no total)",
        "paginate": {
          "first": "Primeiro",
          "last": "Último",
          "next": ">",
          "previous": "<"
        }
      },
      "drawCallback": function() {
          if (typeof highlightIssues === 'function') {
              highlightIssues(tableId); // Passa o ID da tabela atual
          }
      }
    });

    var filter = document.querySelector(tableId + '_filter');
    var lengthMenu = document.querySelector(tableId + '_length');

    if (filter) {
      filter.style.float = 'left';
      filter.style.marginLeft = '0px'; // Ajustado para não ter margem extra à esquerda do wrapper
      filter.style.paddingLeft = '0px'; // Ajustado
      filter.style.boxSizing = 'border-box';
      filter.style.paddingTop = '10px';
      filter.style.paddingBottom = '15px';
    }
    if (lengthMenu) {
      lengthMenu.style.float = 'right';
      lengthMenu.style.marginRight = '0px'; // Ajustado
      lengthMenu.style.paddingRight = '0px'; // Ajustado
      lengthMenu.style.boxSizing = 'border-box';
      lengthMenu.style.paddingTop = '10px';
    }
  }

  // --- LISTA DE INICIALIZAÇÃO DE TODAS AS SUAS TABELAS ---
  // Módulo MadeiraMadeira (monitoring)
  initializeTable('#urlTable'); // Gerenciar Produtos (MadeiraMadeira)
  initializeTable('#productTable'); // Monitorar Produtos (MadeiraMadeira) - *Verifique se este ID ainda é usado ou se foi unificado com outro*
  initializeTable('#nonCompetitiveProductTable'); // P. Sem Concorrentes (MadeiraMadeira)
  initializeTable('#productsOutOfPromotionTable'); // Produtos Sem Promoção (MadeiraMadeira) - *Você precisará me confirmar o ID exato desta tabela na view refatorada*

  // Módulo ViaVarejo
  initializeTable('#viaVarejoUrlTable'); // Gerenciar Produtos (ViaVarejo)
  initializeTable('#viaVarejoMonitoringTable'); // Monitorar Produtos (ViaVarejo)
  initializeTable('#viaVarejoEmptyProductsTable'); // P. Sem Estoque (ViaVarejo)
  initializeTable('#viaVarejoNonCompetitiveTable'); // P. Sem Concorrentes (ViaVarejo)

  initializeTable('#canceladasTable');
  
  // Módulo MercadoLivre (adicione os IDs das tabelas deste módulo quando refatorarmos)
  // initializeTable('#mercadolivreUrlTable'); 
  // initializeTable('#mercadolivreMonitoringTable');
  // ... e assim por diante

  // Outras tabelas
  // initializeTable('#idDaSuaTabelaDeEmissao'); // Se a lista de emissões se tornar uma DataTable
});