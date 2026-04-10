// public/scripts/shopeeEtiquetasManager.js
document.addEventListener('DOMContentLoaded', function() {
    const shopeeUploadForm = document.getElementById('shopeeEtiquetasUploadForm');
    const shopeeFileInput = document.getElementById('shopeeEtiquetasPdfs');
    const shopeeFileListDiv = document.getElementById('shopeeEtiquetasFileList');

    let shopeeAllFiles = [];

    // Atualiza a lista de ficheiros na interface (Tema Dark)
    function renderShopeeFileList() {
        if (shopeeAllFiles.length > 0) {
            let fileListHtml = '<strong style="color: #ee4d2d;">Arquivos selecionados:</strong><ul class="list-unstyled mt-2">';
            for (let i = 0; i < shopeeAllFiles.length; i++) {
                const file = shopeeAllFiles[i];
                const fileName = file.name.length > 50 ? file.name.substring(0, 50) + '...' : file.name;
                
                fileListHtml += `
                    <li class="mb-2 d-flex justify-content-between align-items-center p-2 rounded" style="background-color: #2c2c2c; border: 1px solid #444;">
                        <span style="color: #f1f1f1;"><i class="fas fa-file-pdf text-danger mr-2"></i> ${fileName}</span>
                        <button type="button" class="btn btn-sm btn-outline-danger remove-shopee-file-btn" data-index="${i}" title="Remover"><i class="fas fa-times"></i></button>
                    </li>`;
            }
            fileListHtml += '</ul>';
            shopeeFileListDiv.innerHTML = fileListHtml;

            const removeBtns = shopeeFileListDiv.querySelectorAll('.remove-shopee-file-btn');
            removeBtns.forEach(btn => {
                btn.addEventListener('click', function() {
                    const index = parseInt(this.getAttribute('data-index'), 10);
                    shopeeAllFiles.splice(index, 1);
                    renderShopeeFileList();
                });
            });
        } else {
            shopeeFileListDiv.innerHTML = '';
            shopeeFileInput.value = '';
        }
    }

    if (shopeeUploadForm) {
        shopeeFileInput.addEventListener('change', function() {
            for (let i = 0; i < this.files.length; i++) {
                const exists = shopeeAllFiles.some(f => f.name === this.files[i].name && f.size === this.files[i].size);
                if (!exists) {
                    shopeeAllFiles.push(this.files[i]);
                }
            }
            renderShopeeFileList();
            this.value = ''; 
        });

        // Envio do formulário com Processo Direto
        shopeeUploadForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (shopeeAllFiles.length === 0) {
                ModalSystem.alert('Por favor, selecione pelo menos um arquivo PDF da Shopee.', 'Aviso');
                return;
            }

            const formData = new FormData();
            for (let i = 0; i < shopeeAllFiles.length; i++) {
                formData.append('etiquetasPdfs', shopeeAllFiles[i]);
            }

            // Captura se a chave está ativada e envia para o backend
            const umaPorPagina = document.getElementById('shopeeUmaPorPagina').checked;
            formData.append('umaPorPagina', umaPorPagina);

            // Inicia o Loading indicando os passos
            ModalSystem.showLoading('Extraindo dados e cruzando com o Bling...', 'Processando Shopee (Etapa 1/2)');

            try {
                // Passo 1: Pré-processamento
                const response = await fetch('/shopee/pre-processar', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();

                if (data.success) {
                    
                    // Passo 2 DIRETO: Gerar PDFs (Sem modal de abatimentos/gôndola)
                    ModalSystem.showLoading('Organizando e gerando arquivos finais...', 'Criando PDF (Etapa 2/2)');

                    const finalRes = await fetch('/shopee/finalizar-processamento', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            batchId: data.batchId,
                            abatimentosManuais: {}, // Nenhum abatimento manual
                            gondolaId: ""           // Nenhuma gôndola selecionada
                        })
                    });

                    if (finalRes.ok) {
                        // Download do ZIP
                        const blob = await finalRes.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        
                        const contentDisposition = finalRes.headers.get('Content-Disposition');
                        let filename = `Etiquetas_Shopee_${Date.now()}.zip`;
                        if (contentDisposition && contentDisposition.includes('filename="')) {
                            filename = contentDisposition.split('filename="')[1].split('"')[0];
                        }
                        
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(url);

                        ModalSystem.hideLoading();
                        ModalSystem.alert('As etiquetas da Shopee foram organizadas e geradas com sucesso. O download do ZIP foi iniciado!', 'Processo Concluído!');
                        
                        // Resetar
                        shopeeAllFiles = [];
                        renderShopeeFileList();
                        shopeeUploadForm.reset();
                    } else {
                        ModalSystem.hideLoading();
                        const errData = await finalRes.json();
                        ModalSystem.alert(errData.message || 'Erro ao gerar o arquivo ZIP final.', 'Erro na Etapa 2');
                    }

                } else {
                    ModalSystem.hideLoading();
                    ModalSystem.alert(data.message, 'Erro na Etapa 1');
                }
            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Ocorreu um erro de comunicação: ${error.message}`, 'Erro de Rede');
            }
        });
    }
});