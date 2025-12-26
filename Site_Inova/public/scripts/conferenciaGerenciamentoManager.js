// public/scripts/conferenciaGerenciamentoManager.js

document.addEventListener('DOMContentLoaded', () => {

    // --- ELEMENTOS ---
    const tableEl = $('#table-gerenciamento-codigos');
    const filterVisibility = $('#filter-visibility');
    const searchInput = $('#search-input');

    // --- INICIALIZAÇÃO DO DATATABLES ---
    const table = tableEl.DataTable({
        processing: true,
        serverSide: true, // Importante: Paginação no Backend
        ajax: {
            url: '/conferencia/api/produtos-sem-ean',
            type: 'GET',
            data: function (d) {
                // Adiciona nossos filtros customizados aos parâmetros enviados
                d.filterOption = filterVisibility.val();
                d.search.value = searchInput.val(); // Sobrescreve busca padrão se usar input externo
            },
            error: function (xhr, error, thrown) {
                console.error("Erro no DataTables:", error);
                ModalSystem.alert("Erro ao carregar dados dos produtos.", "Erro");
            }
        },
        columns: [
            { 
                data: 'escondido',
                orderable: false,
                className: 'text-center',
                render: function(data, type, row) {
                    const isChecked = data === true || data === 'true';
                    return `<input type="checkbox" class="chk-escondido" data-id="${row.id}" ${isChecked ? 'checked' : ''} title="Esconder produto">`;
                }
            },
            { data: 'component_sku', name: 'component_sku' },
            { 
                data: 'structure_name', 
                name: 'structure_name',
                render: function(data) {
                    return `<span title="${data}">${data.length > 50 ? data.substring(0, 50) + '...' : data}</span>`;
                }
            },
            { 
                data: 'codigo_fabrica', 
                name: 'codigo_fabrica',
                className: 'col-codigo-fabrica', // Classe para facilitar seleção na edição
                render: function(data) {
                    return data ? data : '<span class="text-muted small">--</span>';
                }
            },
            { 
                data: 'gtin', 
                name: 'gtin',
                className: 'col-gtin', // Classe para facilitar seleção na edição
                render: function(data) {
                    return data ? data : '<span class="text-muted small">--</span>';
                }
            },
            {
                data: null,
                orderable: false,
                className: 'text-center',
                render: function(data, type, row) {
                    // Botões de Ação: Editar (Lápis)
                    return `
                        <div class="action-btn-group" data-id="${row.id}">
                            <button class="btn btn-sm btn-outline-warning btn-edit" title="Editar Códigos">
                                <i class="fas fa-pencil-alt"></i>
                            </button>
                            
                            <button class="btn btn-sm btn-success btn-save" style="display:none;" title="Salvar">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn btn-sm btn-danger btn-cancel" style="display:none;" title="Cancelar">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `;
                }
            }
        ],
        order: [[1, 'asc']], // Ordenar por SKU
        pageLength: 25,
        dom: 'rtip', // Esconde a busca padrão e controles padrão, usamos os nossos
        language: {
            sEmptyTable: "Nenhum registro encontrado",
            sInfo: "Mostrando de _START_ até _END_ de _TOTAL_ registros",
            sInfoEmpty: "Mostrando 0 até 0 de 0 registros",
            sInfoFiltered: "(Filtrados de _MAX_ registros)",
            sLoadingRecords: "Carregando...",
            sProcessing: "Processando...",
            sZeroRecords: "Nenhum registro encontrado",
            oPaginate: {
                sNext: "Próximo",
                sPrevious: "Anterior",
                sFirst: "Primeiro",
                sLast: "Último"
            }
        },
        createdRow: function(row, data) {
            if (data.escondido) {
                $(row).addClass('hidden-row');
            }
        }
    });

    // --- EVENTOS DE FILTRO ---
    
    // Recarrega tabela ao mudar filtro de visibilidade
    filterVisibility.on('change', () => {
        table.draw();
    });

    // Debounce para busca textual
    let searchTimeout;
    searchInput.on('keyup', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            table.draw();
        }, 400);
    });

    // --- LÓGICA DE EDIÇÃO INLINE (ROW ACTION) ---

    // 1. Clicar no Lápis (Entrar em modo edição)
    tableEl.on('click', '.btn-edit', function() {
        const row = $(this).closest('tr');
        const container = $(this).closest('.action-btn-group');
        
        // Pega valores atuais
        const cellFabrica = row.find('.col-codigo-fabrica');
        const cellGtin = row.find('.col-gtin');
        
        const currentFabrica = cellFabrica.text().trim() === '--' ? '' : cellFabrica.text().trim();
        const currentGtin = cellGtin.text().trim() === '--' ? '' : cellGtin.text().trim();

        // Salva valores originais para cancelar depois
        row.data('original-fabrica', currentFabrica);
        row.data('original-gtin', currentGtin);

        // Substitui por Inputs
        cellFabrica.html(`<input type="text" class="editing-input input-fabrica" value="${currentFabrica}" placeholder="Cód. Fábrica">`);
        cellGtin.html(`<input type="text" class="editing-input input-gtin" value="${currentGtin}" placeholder="EAN Transformado">`);

        // Troca botões
        container.find('.btn-edit').hide();
        container.find('.btn-save, .btn-cancel').show();
        
        // Foco no primeiro input
        cellFabrica.find('input').focus();
    });

    // 2. Clicar em Cancelar (Reverter)
    tableEl.on('click', '.btn-cancel', function() {
        const row = $(this).closest('tr');
        const container = $(this).closest('.action-btn-group');

        const originalFabrica = row.data('original-fabrica');
        const originalGtin = row.data('original-gtin');

        // Restaura texto
        row.find('.col-codigo-fabrica').html(originalFabrica || '<span class="text-muted small">--</span>');
        row.find('.col-gtin').html(originalGtin || '<span class="text-muted small">--</span>');

        // Troca botões
        container.find('.btn-save, .btn-cancel').hide();
        container.find('.btn-edit').show();
    });

    // 3. Clicar em Salvar (Enviar AJAX)
    tableEl.on('click', '.btn-save', async function() {
        const row = $(this).closest('tr');
        const container = $(this).closest('.action-btn-group');
        const id = container.data('id');

        const newFabrica = row.find('.input-fabrica').val().trim();
        const newGtin = row.find('.input-gtin').val().trim();
        const isHidden = row.find('.chk-escondido').is(':checked');

        ModalSystem.showLoading("Salvando alterações...", "Processando");

        try {
            const response = await fetch('/conferencia/api/structure/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: id,
                    codigo_fabrica: newFabrica,
                    gtin: newGtin,
                    escondido: isHidden
                })
            });

            const result = await response.json();
            ModalSystem.hideLoading();

            if (!response.ok) {
                throw new Error(result.message || "Erro ao salvar.");
            }

            // Sucesso: Atualiza visualmente (sem reload completo da tabela para não perder posição)
            row.find('.col-codigo-fabrica').html(newFabrica || '<span class="text-muted small">--</span>');
            row.find('.col-gtin').html(newGtin || '<span class="text-muted small">--</span>');

            // Troca botões de volta
            container.find('.btn-save, .btn-cancel').hide();
            container.find('.btn-edit').show();

            // Opcional: Feedback visual rápido (verde)
            row.css('background-color', 'rgba(40, 167, 69, 0.1)');
            setTimeout(() => { row.css('background-color', ''); }, 1000);

        } catch (error) {
            ModalSystem.alert(error.message, "Erro ao Salvar");
        }
    });

    // 4. Alterar Checkbox "Escondido"
    tableEl.on('change', '.chk-escondido', async function() {
        const checkbox = $(this);
        const row = checkbox.closest('tr');
        const id = checkbox.data('id');
        const isChecked = checkbox.is(':checked');

        // Pega valores atuais das colunas (texto puro) para mandar junto, 
        // pois a API updateStructureInfo espera o objeto completo ou atualiza tudo.
        // Se a API suportasse PATCH parcial seria melhor, mas vamos mandar o que está na tela.
        // CUIDADO: Se estiver em modo edição, pegar do input. Se não, pegar do texto.
        
        let currentFabrica, currentGtin;
        if (row.find('input.editing-input').length > 0) {
            // Está editando
            currentFabrica = row.find('.input-fabrica').val();
            currentGtin = row.find('.input-gtin').val();
        } else {
            // Texto estático
            const txtF = row.find('.col-codigo-fabrica').text().trim();
            const txtG = row.find('.col-gtin').text().trim();
            currentFabrica = txtF === '--' ? '' : txtF;
            currentGtin = txtG === '--' ? '' : txtG;
        }

        try {
            const response = await fetch('/conferencia/api/structure/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: id,
                    escondido: isChecked,
                    codigo_fabrica: currentFabrica,
                    gtin: currentGtin
                })
            });

            if (!response.ok) throw new Error("Falha ao atualizar status.");

            // Atualiza estilo da linha
            if (isChecked) row.addClass('hidden-row');
            else row.removeClass('hidden-row');

        } catch (error) {
            console.error(error);
            checkbox.prop('checked', !isChecked); // Reverte
            ModalSystem.alert("Não foi possível alterar o status de visibilidade.", "Erro");
        }
    });

});