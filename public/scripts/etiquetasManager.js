// public/scripts/etiquetasManager.js
document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('etiquetasUploadForm');
    const fileInput = document.getElementById('etiquetasPdfs');
    const fileListDiv = document.getElementById('etiquetasFileList');

    let allFiles = []; // Array para armazenar todos os arquivos

    /**
     * Atualiza a lista de arquivos na interface.
     */
    function renderFileList() {
        if (allFiles.length > 0) {
            let fileListHtml = '<strong>Arquivos selecionados:</strong><ul>';
            for (let i = 0; i < allFiles.length; i++) {
                const file = allFiles[i];
                const fileName = file.name.length > 50 ? 
                                 file.name.substring(0, 50) + '...' : 
                                 file.name;
                
                // Adiciona um botão para remover o arquivo
                fileListHtml += `
                    <li>
                        <span><i class="fas fa-file-pdf"></i> ${fileName}</span>
                        <button type="button" class="remove-file-btn" data-index="${i}" title="Remover">&times;</button>
                    </li>`;
            }
            fileListHtml += '</ul>';
            fileListDiv.innerHTML = fileListHtml;
        } else {
            fileListDiv.innerHTML = '';
        }
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', async function(e) {
            e.preventDefault(); // Impede o envio padrão

            if (allFiles.length === 0) {
                ModalSystem.alert('Nenhum arquivo PDF foi selecionado.', 'Erro');
                return;
            }

            if (allFiles.length > 500) {
                ModalSystem.alert('Você só pode enviar até 500 arquivos por vez.', 'Limite excedido');
                return;
            }

            ModalSystem.showLoading('Processando etiquetas. Isso pode demorar alguns minutos...', 'Aguarde');

            // Constrói o FormData manualmente a partir do array 'allFiles'
            const formData = new FormData();
            for (const file of allFiles) {
                // O 'etiquetasPdfs' deve bater com o nome no controller: .array('etiquetasPdfs', 20)
                formData.append('etiquetasPdfs', file, file.name);
            }

            try {
                // FASE 1: Pré-processar os PDFs
                const preResponse = await fetch('/etiquetas/pre-processar', {
                    method: 'POST',
                    body: formData
                });

                if (!preResponse.ok) {
                    let errorMsg = `Erro ${preResponse.status}: ${preResponse.statusText}`;
                    try { const errData = await preResponse.json(); errorMsg = errData.message || errorMsg; } catch (e) {}
                    throw new Error(errorMsg);
                }

                const preData = await preResponse.json();
                if (!preData.success) throw new Error(preData.message);

                ModalSystem.hideLoading();

                // INICIA O FLUXO DE FORMA INTELIGENTE
                if (preData.excelDisponivel) {
                    setTimeout(() => perguntarSobreExcel(), 300);
                } else {
                    setTimeout(() => abrirModalTabela(), 300);
                }

                // ==============================================
                // FUNÇÕES DO FLUXO (MODAIS SEPARADOS)
                // ==============================================

                async function perguntarSobreExcel() {
                    ModalSystem.showLoading('Buscando histórico de planilhas...', 'Aguarde');
                    try {
                        const res = await fetch('/api/separados-excel/historico');
                        const data = await res.json();
                        ModalSystem.hideLoading();

                        if (data.success && data.relatorios && data.relatorios.length > 0) {
                            let optionsHtml = '';
                            data.relatorios.forEach((rel, index) => {
                                // Formata a data de forma amigável
                                const dataFormatada = new Date(rel.created_at).toLocaleString('pt-BR');
                                // O primeiro (index 0) é o mais recente, logo fica como 'selected'
                                const selected = index === 0 ? 'selected' : '';
                                optionsHtml += `<option value="${rel.id}" ${selected}>${rel.nome}</option>`;
                            });

                            const htmlContent = `
                                <p class="mb-3 text-muted">Encontramos relatórios de separação recentes. Selecione qual deseja utilizar:</p>
                                <div class="form-group mb-0">
                                    <label for="select-historico-excel" class="font-weight-bold">Planilha de Separação:</label>
                                    <select id="select-historico-excel" class="form-control form-control-lg" style="border: 2px solid var(--primary-color);">
                                        ${optionsHtml}
                                    </select>
                                </div>
                            `;

                            setTimeout(() => {
                                ModalSystem.confirm(
                                    htmlContent,
                                    'Usar Relatório de Separados?',
                                    function() {
                                        // Captura o ID do histórico selecionado na combobox
                                        const historicoId = document.getElementById('select-historico-excel').value;
                                        setTimeout(() => pedirPinExcel(historicoId), 300);
                                    },
                                    function() {
                                        setTimeout(() => abrirModalTabela(), 300);
                                    },
                                    { confirmText: 'Sim, usar planilha selecionada', cancelText: 'Não usar', isHtml: true }
                                );
                            }, 300);
                        } else {
                            // Se não houver histórico, avança diretamente para a tabela manual
                            setTimeout(() => abrirModalTabela(), 300);
                        }
                    } catch (err) {
                        ModalSystem.hideLoading();
                        setTimeout(() => abrirModalTabela(), 300);
                    }
                }

                function pedirPinExcel(historicoId) {
                    const pinHtml = `
                        <div class="text-center">
                            <p class="text-muted mb-3">Digite o PIN de 3 dígitos do dia:</p>
                            <input type="password" id="excel-pin-input" class="form-control form-control-lg text-center mx-auto" style="width: 100%; font-size: 24px; letter-spacing: 10px;" maxlength="3" autocomplete="off">
                        </div>
                    `;
                    ModalSystem.confirm(
                        pinHtml,
                        'Confirmação de Segurança',
                        async function() {
                            const pin = document.getElementById('excel-pin-input').value;
                            if (!pin) {
                                setTimeout(() => abrirModalTabela(), 300);
                                return;
                            }

                            ModalSystem.showLoading('Validando PIN e buscando dados...', 'Aguarde');
                            try {
                                const res = await fetch('/api/separados-excel/validar-senha', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    // NOVO: Envia também o historicoId escolhido na combobox
                                    body: JSON.stringify({ senhaDigitada: pin, historicoId: historicoId })
                                });
                                const data = await res.json();
                                ModalSystem.hideLoading();

                                if (data.success) {
                                    // Cruzamento Flexível: Procura com e sem o TIPO, e cruza a ONDA!
                                    const dadosExcelUpper = data.dadosExcel || {};
                                    const abatimentosManuais = {};

                                    preData.resumoProdutos.forEach(prod => {
                                        const skuDisplayUpper = prod.sku.toUpperCase(); // Ex: CADEIRA-ABC
                                        const skuOriginalUpper = prod.skuOriginal ? prod.skuOriginal.toUpperCase() : ''; // Ex: ABC
                                        //const ondaUpper = prod.onda ? prod.onda.toUpperCase() : '-'; // NOVA ONDA

                                        // Cria as chaves exatas que vieram do Excel (SKU|ONDA)
                                        const chaveDisplay = `${skuDisplayUpper}`;
                                        const chaveOriginal = `${skuOriginalUpper}`;

                                        // Busca na planilha: 1º Tenta exato, 2º Tenta sem tipo
                                        const qtdNaPlanilha = dadosExcelUpper[chaveDisplay] || dadosExcelUpper[chaveOriginal] || 0;

                                        if (qtdNaPlanilha > 0) {
                                            const qtdSugerida = Math.min(qtdNaPlanilha, prod.quantidadeTotal);
                                            if (qtdSugerida > 0) {
                                                // O Backend agora vai exigir a chave composta para abater corretamente!
                                                abatimentosManuais[`${prod.sku}|${prod.onda || '-'}`] = qtdSugerida;
                                            }
                                        }
                                    });

                                    // PIN CORRETO: Pula a tabela manual e vai direto pra gôndola com os dados mapeados!
                                    setTimeout(() => prosseguirParaGondola(abatimentosManuais), 300);
                                } else {
                                    ModalSystem.alert(data.message, 'PIN Incorreto', () => {
                                        setTimeout(() => abrirModalTabela(), 300);
                                    });
                                }
                            } catch(e) {
                                ModalSystem.hideLoading();
                                setTimeout(() => abrirModalTabela(), 300);
                            }
                        },
                        function() { 
                            // Cancelou o PIN
                            setTimeout(() => abrirModalTabela(), 300); 
                        },
                        { confirmText: 'Validar PIN', cancelText: 'Cancelar', isHtml: true }
                    );
                }

                function abrirModalTabela() {
                    let abatimentoHtml = `
                        <p class="mb-3 text-muted">Informe a quantidade que <strong>já foi separada</strong> de cada produto (se houver):</p>
                        <div class="table-responsive modal-separacao-wrapper" style="max-height: 400px; overflow-y: auto;">
                            <table class="table modal-separacao-table">
                                <thead>
                                    <tr>
                                        <th>SKU</th>
                                        <th>Onda</th>
                                        <th>Loc</th>
                                        <th class="text-center">Total</th>
                                        <th width="110" class="text-center">Já Pego</th>
                                    </tr>
                                </thead>
                                <tbody>
                    `;
                    
                    preData.resumoProdutos.forEach((prod) => {
                        const ondaDisplay = (prod.onda && prod.onda !== '-') ? prod.onda.toUpperCase() : '-';
                        // A chave gravada no input passa a ser "SKU|Onda"
                        const chaveAbatimento = `${prod.sku}|${prod.onda || '-'}`;

                        abatimentoHtml += `
                            <tr>
                                <td class="font-weight-bold" style="font-size: 0.9em;">${prod.sku}</td>
                                <td class="font-weight-bold text-info" style="font-size: 0.9em;">${ondaDisplay}</td>
                                <td style="font-size: 0.9em;">${prod.loc || '-'}</td>
                                <td class="text-center">
                                    <span class="badge-total-modal">${prod.quantidadeTotal}</span>
                                </td>
                                <td>
                                    <input type="number" class="form-control form-control-sm abatimento-input" 
                                        data-chave="${chaveAbatimento}" min="0" max="${prod.quantidadeTotal}" value="0">
                                </td>
                            </tr>
                        `;
                    });
                    abatimentoHtml += `</tbody></table></div>`;

                    ModalSystem.confirm(
                        abatimentoHtml,
                        'Pré-visualização da Separação',
                        function() {
                            const abatimentosManuais = {};
                            document.querySelectorAll('.abatimento-input').forEach(input => {
                                const val = parseInt(input.value) || 0;
                                // Envia a chave completa para o Backend cruzar com os relatórios
                                if (val > 0) abatimentosManuais[input.getAttribute('data-chave')] = val;
                            });
                            setTimeout(() => prosseguirParaGondola(abatimentosManuais), 300);
                        },
                        function() {
                            setTimeout(() => prosseguirParaGondola({}), 300);
                        },
                        { confirmText: 'Confirmar e Avançar', cancelText: 'Pular (Não Abater)', isHtml: true }
                    );
                }

                async function prosseguirParaGondola(abatimentosManuais) {
                    ModalSystem.showLoading('Buscando histórico de gôndolas...', 'Aguarde');
                    try {
                        const gondolaRes = await fetch('/api/gondola/listar');
                        const gondolaData = await gondolaRes.json();
                        ModalSystem.hideLoading();

                        if (gondolaData.success && gondolaData.relatorios && gondolaData.relatorios.length > 0) {
                            const ultimaGondola = gondolaData.relatorios[0]; 
                            
                            setTimeout(() => {
                                ModalSystem.confirm(
                                    `Encontramos um relatório de gôndola recente:<br><br><h5 class="text-primary text-center">${ultimaGondola.nome}</h5><br>Deseja utilizá-lo para abater automaticamente as quantidades no relatório de separação?`,
                                    'Relatório de Gôndola Disponível',
                                    function() { 
                                        finalizarProcessamento(preData.batchId, abatimentosManuais, ultimaGondola.id); 
                                    },
                                    function() { 
                                        finalizarProcessamento(preData.batchId, abatimentosManuais, null); 
                                    },
                                    { confirmText: 'Sim, Usar Gôndola', cancelText: 'Não usar', isHtml: true }
                                );
                            }, 300);
                        } else {
                            finalizarProcessamento(preData.batchId, abatimentosManuais, null);
                        }
                    } catch (err) {
                        ModalSystem.hideLoading();
                        finalizarProcessamento(preData.batchId, abatimentosManuais, null); 
                    }
                }

                async function finalizarProcessamento(batchId, abatimentosManuais, gondolaId) {
                    ModalSystem.showLoading('Cruzando dados e gerando PDFs finais...', 'Finalizando');
                    try {
                        const response = await fetch('/etiquetas/finalizar-processamento', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ batchId, abatimentosManuais, gondolaId })
                        });

                        if (!response.ok) {
                            let errorMsg = `Erro ${response.status}: ${response.statusText}`;
                            try { const errData = await response.json(); errorMsg = errData.message || errorMsg; } catch (e) {}
                            throw new Error(errorMsg);
                        }

                        if (response.headers.get('Content-Type') === 'application/zip') {
                            ModalSystem.hideLoading();
                            const blob = await response.blob();
                            
                            const contentDisposition = response.headers.get('Content-Disposition');
                            let filename = 'Etiquetas_e_Relatorio.zip';
                            if (contentDisposition) {
                                const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                                if (filenameMatch && filenameMatch[1]) {
                                    filename = filenameMatch[1];
                                }
                            }

                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.style.display = 'none';
                            a.href = url;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            window.URL.revokeObjectURL(url);
                            a.remove();

                            setTimeout(() => {
                                ModalSystem.alert('Processamento concluído. O download do arquivo .zip foi iniciado.', 'Sucesso');
                            }, 300);

                            uploadForm.reset();
                            allFiles = [];
                            renderFileList();
                        } else {
                            throw new Error('O servidor não retornou um arquivo .zip final.');
                        }
                    } catch (error) {
                        ModalSystem.hideLoading();
                        setTimeout(() => {
                            ModalSystem.alert(`Ocorreu um erro na finalização: ${error.message}`, 'Erro Final');
                        }, 300);
                    }
                }

            } catch (error) {
                ModalSystem.hideLoading();
                setTimeout(() => {
                    ModalSystem.alert(`Ocorreu um erro: ${error.message}`, 'Erro de processamento');
                }, 300);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            // Adiciona os arquivos recém-selecionados ao array 'allFiles'
            for (const file of this.files) {
                // Evita duplicatas
                if (!allFiles.find(f => f.name === file.name && f.size === file.size)) {
                    allFiles.push(file);
                }
            }
            
            // Atualiza a lista na interface
            renderFileList();

            // Limpa o valor do input para permitir selecionar o "mesmo" arquivo se ele for removido
            this.value = null;
        });
    }

    // Adiciona o evento para os botões de remover
    fileListDiv.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('remove-file-btn')) {
            const indexToRemove = parseInt(e.target.getAttribute('data-index'), 10);
            
            // Remove o arquivo do array
            allFiles.splice(indexToRemove, 1);
            
            // Re-renderiza a lista
            renderFileList();
        }
    });

    const nfSearchInput = document.getElementById('nfSearchInput');
    const nfSearchButton = document.getElementById('nfSearchButton');
    const searchResultDiv = document.getElementById('searchResult');

    if (nfSearchButton) {
        nfSearchButton.addEventListener('click', async function() {
            const nfNumero = nfSearchInput.value.trim();
            searchResultDiv.innerHTML = '';

            if (!nfNumero || !/^\d+$/.test(nfNumero)) {
                // Usa o ModalSystem para alerta de erro
                ModalSystem.alert('Por favor, digite um número de NF válido.', 'Entrada Inválida');
                return;
            }

            // Usa o ModalSystem para loading
            ModalSystem.showLoading('Buscando etiqueta...');

            try {
                const response = await fetch('/etiquetas/buscar-nf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', },
                    body: JSON.stringify({ nfNumero: nfNumero })
                });

                ModalSystem.hideLoading(); // Esconde loading

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        // --- USA ModalSystem.confirm ---
                        ModalSystem.confirm(
                            `A etiqueta para a Nota Fiscal <strong>${data.nf}</strong> foi encontrada. Deseja baixar o PDF individual?`,
                            'Etiqueta Encontrada',
                            function() { // Função onConfirm
                                // Cria um link temporário e clica nele para iniciar o download
                                const downloadLink = document.createElement('a');
                                downloadLink.href = `/etiquetas/download-individual/${data.nf}`;
                                downloadLink.download = `Etiqueta-NF-${data.nf}.pdf`; // Nome do arquivo sugerido
                                document.body.appendChild(downloadLink);
                                downloadLink.click();
                                document.body.removeChild(downloadLink);
                            },
                            null, // Função onCancel (não faz nada)
                            { confirmText: "Baixar PDF", cancelText: "Cancelar", isHtml: true } // Opções do confirm
                        );
                        // --- FIM ModalSystem.confirm ---
                    }
                    // O else que tratava data.success false não é necessário aqui, pois response.ok já falharia
                } else {
                    const errorData = await response.json();
                    // Usa ModalSystem.alert para erro da busca
                    ModalSystem.alert(errorData.message || 'Erro ao buscar etiqueta.', 'Erro na Busca');
                }
            } catch (error) {
                 ModalSystem.hideLoading();
                 console.error('Erro na requisição de busca:', error);
                 // Usa ModalSystem.alert para erro de comunicação
                 ModalSystem.alert('Erro de comunicação com o servidor. Tente novamente.', 'Erro de Rede');
            }
        });
    }

    const nfBatchForm = document.getElementById('nfBatchUploadForm');
    const nfExcelInput = document.getElementById('nfExcelFile');
    const nfExcelFileName = document.getElementById('nfExcelFileName');

    if (nfExcelInput) {
        nfExcelInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                nfExcelFileName.textContent = `Arquivo selecionado: ${this.files[0].name}`;
            } else {
                nfExcelFileName.textContent = '';
            }
        });
    }

    if (nfBatchForm) {
        nfBatchForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (!nfExcelInput.files || nfExcelInput.files.length === 0) {
                ModalSystem.alert('Por favor, selecione um arquivo Excel para enviar.', 'Erro');
                return;
            }

            const file = nfExcelInput.files[0];
            const formData = new FormData();
            formData.append('nfExcelFile', file, file.name); // O name 'nfExcelFile' bate com o controller

            ModalSystem.showLoading('Processando lote de NFs... Isso pode demorar alguns instantes.', 'Aguarde');

            try {
                const response = await fetch('/etiquetas/buscar-nf-lote', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok && response.headers.get('Content-Type') === 'application/pdf') {
                    // SUCESSO - Download do PDF
                    ModalSystem.hideLoading();
                    const blob = await response.blob();
                    
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'Etiquetas_Lote.pdf';
                    if (contentDisposition) {
                        const filenameMatch = contentDisposition.match(/filename="?(.+?)"?$/);
                        if (filenameMatch && filenameMatch[1]) {
                            filename = filenameMatch[1];
                        }
                    }
                    
                    // Lógica de download (similar ao seu upload principal)
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();

                    // **IMPORTANTE**: Verifica o header customizado por NFs não encontradas
                    const notFoundHeader = response.headers.get('X-Not-Found-NFs');
                    if (notFoundHeader) {
                        const notFoundList = notFoundHeader.split(',');
                        let errorListHtml = '<ul>';
                        notFoundList.forEach(nf => { errorListHtml += `<li>NF: ${nf}</li>`; });
                        errorListHtml += '</ul>';
                        
                        ModalSystem.alert(
                            `PDF gerado com sucesso. As seguintes NFs não foram encontradas:<br>${errorListHtml}`, 
                            'Processo Concluído com Avisos',
                            null, // Sem callback
                            { isHtml: true } // Permite o HTML no modal
                        );
                    } else {
                        ModalSystem.alert('Processamento concluído. O download do PDF foi iniciado.', 'Sucesso');
                    }

                    // Limpa o formulário
                    nfBatchForm.reset();
                    nfExcelFileName.textContent = '';

                } else {
                    // ERRO - Resposta não foi OK (provavelmente um JSON de erro)
                    ModalSystem.hideLoading();
                    let errorMsg = 'Erro desconhecido no servidor.';
                    try {
                        const errData = await response.json();
                        errorMsg = errData.message;
                    } catch (jsonError) { /* Não era JSON */ }
                    
                    ModalSystem.alert(errorMsg, `Erro ${response.status}`);
                }

            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Ocorreu um erro de comunicação: ${error.message}`, 'Erro de Rede');
            }
        });
    }
    
});