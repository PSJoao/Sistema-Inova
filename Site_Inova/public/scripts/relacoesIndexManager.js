document.addEventListener('DOMContentLoaded', function() {
    // Este script só deve rodar na página principal de Relações para administradores.
    const justificadasTableEl = document.getElementById('justificadasTable');
    const salvasTableEl = document.getElementById('salvasTable');

    if (!justificadasTableEl || !salvasTableEl) {
        // Se as tabelas de admin não existem, o script não faz nada.
        return;
    }

    console.log("relacoesIndexManager.js: Tabelas de admin detectadas. Iniciando lógica.");

    const dtSalvas = initializeDataTable('#salvasTable', { 
        "order": [[3, "desc"]], // Mantém a ordenação inicial por data
        "columnDefs": [
            { "targets": 3, "type": "num" } // Diz que a 4ª coluna deve ser ordenada como número
        ]
    }); 

    carregarRelacoesSalvas(dtSalvas);

    /**
     * Inicializa uma tabela usando a biblioteca DataTables com configurações padrão.
     */
    function initializeDataTable(tableSelector, customOptions = {}) {
        if (typeof $ === 'undefined' || !$.fn.dataTable) { 
            console.error("jQuery ou DataTables não está definido. A funcionalidade da tabela será limitada."); 
            return null; 
        }
        
        const defaultOptions = {
            "pageLength": 10,
            "searching": true,
            "paging": true,
            "info": true,
            "scrollX": false,
            "language": {
                "search": "Pesquisar:",
                "lengthMenu": "Mostrar _MENU_ itens",
                "zeroRecords": "Nenhum resultado encontrado",
                "info": "Mostrando _START_ a _END_ de _TOTAL_ itens",
                "infoEmpty": "Mostrando 0 a 0 de 0 itens",
                "infoFiltered": "(filtrado de _MAX_ itens no total)",
                "paginate": { "first": "<<", "last": ">>", "next": ">", "previous": "<" }
            }
        };

        return $(tableSelector).DataTable({ ...defaultOptions, ...customOptions });
    }
    
    /**
     * Busca e popula a tabela de Relações Salvas.
     */
    async function carregarRelacoesSalvas(dataTableInstance) {
        if (!dataTableInstance) return;
        try {
            const response = await fetch('/api/relacoes/salvas/all');
            if (!response.ok) throw new Error(`Erro ao buscar dados: ${response.statusText}`);
            
            const data = await response.json();
            dataTableInstance.clear();

            const rowsToAdd = data.map(relacao => {
                // --- CORREÇÃO APLICADA AQUI ---
                // Trata datas nulas e cria um valor numérico (timestamp) para a ordenação correta.
                const dataObj = relacao.validated_at ? new Date(relacao.validated_at) : null;
                const timestamp = dataObj ? dataObj.getTime() : 0; // Datas pendentes terão valor 0.
                const dataFormatada = dataObj ? dataObj.toLocaleString('pt-BR') : 'Pendente de Validação';
                
                let acoesHtml = `<div class="table-actions">`;
                
                acoesHtml += `<a href="/relacoes/print/${relacao.id}" target="_blank" class="btn btn-sm btn-info-custom btn-icon" title="Visualizar / Imprimir Relação"><i class="fas fa-print"></i></a>`;
                
                acoesHtml += `<a href="/relacoes/download/${relacao.id}" class="btn btn-sm btn-success-alt btn-icon" title="Baixar Excel"><i class="fas fa-file-excel"></i></a>`;

                if (relacao.is_validated) {
                    acoesHtml += `<span class="badge status-validated" title="Esta relação foi validada e não pode ser alterada."><i class="fas fa-check-circle"></i> Validada</span>`;
                } else {
                    acoesHtml += `<a href="/relacoes/${relacao.transportadora_apelido}?edit_relation_id=${relacao.id}" class="btn btn-sm btn-secondary-custom btn-icon" title="Editar Relação"><i class="fas fa-pencil-alt"></i></a>`;
                    acoesHtml += `<button class="btn btn-sm btn-warning btn-icon btn-validate-relacao" data-relation-id="${relacao.id}" title="Validar Relação"><i class="fas fa-check"></i></button>`;
                }
                
                if (relacao.is_checked && relacao.is_validated) {
                    acoesHtml += `<span class="badge status-validated" style="color: #28a745;" title="Esta relação foi checada e não pode ser alterada."><i class="fas fa-check-circle"></i> Checada</span>`;
                } 
                else if (relacao.is_validated && !relacao.is_checked) {
                    acoesHtml += `<button class="btn btn-sm btn-warning btn-icon btn-check-relacao" data-relation-id="${relacao.id}" title="Checar Relação"><i class="fas fa-check"></i></button>`;
                }

                acoesHtml += `</div>`;

                return [
                    relacao.titulo_relacao,
                    relacao.transportadora_apelido,
                    relacao.gerada_por_username,
                    // O atributo 'data-order' fornece o valor numérico para o DataTables ordenar.
                    // O que fica dentro do <span> é o que o usuário vê na tela.
                    `<span data-order="${timestamp}">${dataFormatada}</span>`,
                    acoesHtml
                ];
            });

            dataTableInstance.rows.add(rowsToAdd).draw();
        } catch (error) {
            console.error("Erro ao carregar relações salvas:", error);
            dataTableInstance.clear().row.add([`Erro ao carregar dados: ${error.message}`, '', '', '', '']).draw();
        }
    }

    // --- LISTENERS DE EVENTO PARA AS AÇÕES NAS TABELAS ---
    if (justificadasTableEl) {
        justificadasTableEl.querySelector('tbody').addEventListener('change', async function(event) {
            const select = event.target;
            if (select.classList.contains('action-select-status') && select.value) {
                const nfeId = select.dataset.nfeId;
                const nfeNumero = select.dataset.nfeNumero;
                const selectedValue = select.value;
                const selectedText = select.options[select.selectedIndex].text; // Pega o texto da opção

                if (selectedValue === 'cancelada_permanente') {
                    // --- FLUXO DE EXCLUSÃO (como antes) ---
                    ModalSystem.confirm(
                        `Você tem certeza que deseja <strong>EXCLUIR PERMANENTEMENTE</strong> a NF Nº ${nfeNumero}?<br>Esta ação não pode ser desfeita.`,
                        "Confirmar Exclusão Irreversível",
                        async () => { // onConfirm
                            try {
                                const response = await fetch(`/api/relacoes/nfe/${nfeId}/delete-permanently`, {
                                    method: 'DELETE'
                                });
                                const result = await response.json();
                                if (!response.ok) throw new Error(result.message);
                                
                                ModalSystem.alert(result.message, "Sucesso");
                                carregarNfesJustificadas(dtJustificadas);
                            } catch (error) {
                                ModalSystem.alert(`Erro ao excluir: ${error.message}`, "Falha na Operação");
                                select.selectedIndex = 0;
                            }
                        },
                        () => { // onCancel
                            select.selectedIndex = 0;
                        }
                    );
                } else {
                    // --- NOVO FLUXO: ATUALIZAR A JUSTIFICATIVA ---
                    ModalSystem.confirm(
                        `Deseja definir a justificativa da NF Nº ${nfeNumero} como:<br><strong>"${selectedText}"</strong>?`,
                        "Confirmar Justificativa",
                        async () => { // onConfirm
                            try {
                                const response = await fetch(`/api/relacoes/nfe/${nfeId}/update-justification`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ justificativa: selectedText }) // Envia o texto como justificativa
                                });
                                const result = await response.json();
                                if (!response.ok) throw new Error(result.message);
                                
                                ModalSystem.alert(result.message, "Sucesso");
                                carregarNfesJustificadas(dtJustificadas); // Recarrega a tabela para mostrar a nova justificativa

                            } catch (error) {
                                ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação");
                                select.selectedIndex = 0;
                            }
                        },
                        () => { // onCancel
                            select.selectedIndex = 0;
                        }
                    );
                }
            }
        });
    }

    if (salvasTableEl) {
        salvasTableEl.querySelector('tbody').addEventListener('click', async function(event) {
            const validateButton = event.target.closest('.btn-validate-relacao');
            const checkButton = event.target.closest('.btn-check-relacao');
            const deleteButton = event.target.closest('.btn-delete-relacao');

            if (validateButton) {
                const relationId = validateButton.dataset.relationId;
                ModalSystem.confirm(
                    "Validar esta relação? Após a validação, ela não poderá mais ser excluída.", "Confirmar Validação",
                    async () => {
                        try {
                            const response = await fetch(`/api/relacoes/${relationId}/validate`, { method: 'POST' });
                            const result = await response.json();
                            if (!response.ok) throw new Error(result.message);
                            ModalSystem.alert(result.message, "Sucesso");
                            carregarRelacoesSalvas(dtSalvas);
                        } catch (error) { ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação"); }
                    }
                );
            }

            if (checkButton) {
                const relationId = checkButton.dataset.relationId;
                ModalSystem.confirm(
                    "Checar esta relação? Após a checagem, ela não poderá ser checada novamente.", "Confirmar Checagem",
                    async () => {
                        try {
                            const response = await fetch(`/api/relacoes/${relationId}/check`, { method: 'POST' });
                            const result = await response.json();
                            if (!response.ok) throw new Error(result.message);
                            ModalSystem.alert(result.message, "Sucesso");
                            carregarRelacoesSalvas(dtSalvas);
                        } catch (error) { ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação"); }
                    }
                );
            }

            if (deleteButton) {
                const relationId = deleteButton.dataset.relationId;
                const relationTitle = deleteButton.dataset.relationTitle;
                ModalSystem.confirm(
                    `Excluir a relação "${relationTitle}"? As notas fiscais retornarão ao status 'pendente'.`, "Confirmar Exclusão",
                    async () => {
                        try {
                            console.log(`Excluindo relação com ID: ${relationId}`);
                            const response = await fetch(`/api/relacoes/${relationId}/delete`, { method: 'DELETE' });
                            const result = await response.json();
                            if (!response.ok) throw new Error(result.message);
                            ModalSystem.alert(result.message, "Sucesso");
                            carregarRelacoesSalvas(dtSalvas);
                        } catch (error) { ModalSystem.alert(`Erro: ${error.message}`, "Falha na Operação"); }
                    }
                );
            }
        });
    }
});