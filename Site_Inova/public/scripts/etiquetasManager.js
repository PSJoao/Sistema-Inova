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

            if (allFiles.length > 50) {
                ModalSystem.alert('Você só pode enviar até 50 arquivos por vez.', 'Limite excedido');
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
                const response = await fetch('/etiquetas/processar', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    let errorMsg = `Erro ${response.status}: ${response.statusText}`;
                    try {
                        const errData = await response.json();
                        errorMsg = errData.message || errorMsg;
                    } catch (jsonError) { /* Não era JSON */ }
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

                    ModalSystem.alert('Processamento concluído. O download do arquivo .zip foi iniciado.', 'Sucesso');

                    // Limpa o formulário e a lista
                    uploadForm.reset();
                    allFiles = [];
                    renderFileList();

                } else {
                    throw new Error('O servidor não retornou um arquivo .zip.');
                }

            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Ocorreu um erro: ${error.message}`, 'Erro de processamento');
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