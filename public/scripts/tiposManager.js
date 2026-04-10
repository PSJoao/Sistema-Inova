// public/scripts/tiposManager.js
document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('tiposUploadForm');
    const individualForm = document.getElementById('individualForm');
    
    const fileInputMassa = document.getElementById('tiposPlanilha');
    const fileListMassa = document.getElementById('tiposFileList');

    /**
     * Helper para formatar a lista de SKUs não encontrados para texto plano.
     */
    function formatNotFoundList(listItems = []) {
        if (listItems.length === 0) {
            return '';
        }
        // Usa \n para quebra de linha no ModalSystem.alert
        let listString = '\n\nSKUs não encontrados (não atualizados):\n';
        listString += listItems.join('\n');
        return listString;
    }

    // Exibir nome do arquivo de upload
    if (fileInputMassa) {
        fileInputMassa.addEventListener('change', function() {
            // MODIFICADO: Gera uma lista <ul>
            if (this.files.length > 0) {
                fileListMassa.innerHTML = '<strong>Arquivo selecionado:</strong><ul><li><i class="fas fa-file-excel"></i> ' + this.files[0].name + '</li></ul>';
            } else {
                fileListMassa.innerHTML = '';
            }
        });
    }

    // Handler do Form de Upload em Massa
    if (uploadForm) {
        uploadForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (fileInputMassa.files.length === 0) {
                // MODIFICADO: Usa o ModalSystem
                ModalSystem.alert('Por favor, selecione uma planilha .xlsx para enviar.', 'Erro');
                return;
            }
            
            // MODIFICADO: Usa o ModalSystem
            ModalSystem.showLoading('Processando planilha...', 'Aguarde');
            
            const formData = new FormData(uploadForm);

            try {
                const response = await fetch('/tipos/upload', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                ModalSystem.hideLoading(); // Esconde o loading ANTES de mostrar o alerta

                if (data.success) {
                    const notFoundMessage = formatNotFoundList(data.notFound);
                    ModalSystem.alert(
                        `${data.updated} SKUs foram atualizados com sucesso.${notFoundMessage}`,
                        `Processamento concluído`
                    );
                    uploadForm.reset();
                    fileListMassa.innerHTML = '';
                } else {
                    throw new Error(data.message || 'Ocorreu um erro desconhecido');
                }

            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Não foi possível processar a planilha: ${error.message}`, 'Erro no upload');
            }
        });
    }

    // Handler do Form Individual
    if (individualForm) {
        individualForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // MODIFICADO: Usa o ModalSystem
            ModalSystem.showLoading('Salvando alteração...', 'Aguarde');
            
            const formData = new FormData(individualForm);
            
            try {
                const response = await fetch('/tipos/update-individual', {
                    method: 'POST',
                    body: new URLSearchParams(formData)
                });

                const data = await response.json();
                ModalSystem.hideLoading();

                if (data.success) {
                    ModalSystem.alert(data.message, 'Sucesso');
                    individualForm.reset();
                } else {
                    throw new Error(data.message || 'Ocorreu um erro desconhecido.');
                }

            } catch (error) {
                ModalSystem.hideLoading();
                ModalSystem.alert(`Não foi possível salvar a alteração: ${error.message}`, 'Erro na alteração');
            }
        });
    }
});