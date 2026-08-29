/**
 * importarVendasManager.js
 * Gerenciador da página de importação dos 4 relatórios de vendas Excel.
 */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('formUploadVendas');
    const cards = document.querySelectorAll('.upload-periodo-card');
    const btnProcessar = document.getElementById('btnProcessarVendas');
    const btnLimpar = document.getElementById('btnLimparArquivos');
    const feedbackBox = document.getElementById('uploadFeedbackBox');
    const spinner = document.getElementById('uploadSpinner');
    const statusMsg = document.getElementById('uploadStatusMsg');

    // Mapeamento dos arquivos selecionados por período
    const selectedFiles = {
        '3': null,
        '7': null,
        '15': null,
        '30': null
    };

    // Configuração de cada card de upload
    cards.forEach(card => {
        const periodo = card.getAttribute('data-periodo');
        const fileInput = card.querySelector('.input-venda-file');
        const fileNameEl = card.querySelector('.upload-file-name');
        const fileSizeEl = card.querySelector('.upload-file-size');

        // Clique no card abre o seletor de arquivo
        card.addEventListener('click', (e) => {
            if (e.target !== fileInput) {
                fileInput.click();
            }
        });

        // Evento de seleção de arquivo
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                setCardFile(card, periodo, file, fileNameEl, fileSizeEl);
            } else {
                clearCardFile(card, periodo, fileInput, fileNameEl, fileSizeEl);
            }
            checkAllFilesSelected();
        });

        // Drag and Drop
        ['dragenter', 'dragover'].forEach(eventName => {
            card.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                card.style.borderColor = 'var(--accent-orange, #f07c00)';
                card.style.transform = 'scale(1.02)';
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            card.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                card.style.borderColor = '';
                card.style.transform = '';
            });
        });

        card.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                const file = dt.files[0];
                fileInput.files = dt.files;
                setCardFile(card, periodo, file, fileNameEl, fileSizeEl);
                checkAllFilesSelected();
            }
        });
    });

    function setCardFile(card, periodo, file, fileNameEl, fileSizeEl) {
        selectedFiles[periodo] = file;
        card.classList.add('has-file');
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatBytes(file.size);
    }

    function clearCardFile(card, periodo, fileInput, fileNameEl, fileSizeEl) {
        selectedFiles[periodo] = null;
        card.classList.remove('has-file');
        fileInput.value = '';
        fileNameEl.textContent = '';
        fileSizeEl.textContent = '';
    }

    function checkAllFilesSelected() {
        const allPresent = selectedFiles['3'] && selectedFiles['7'] && selectedFiles['15'] && selectedFiles['30'];
        const anyPresent = selectedFiles['3'] || selectedFiles['7'] || selectedFiles['15'] || selectedFiles['30'];

        btnProcessar.disabled = !allPresent;
        btnLimpar.style.display = anyPresent ? 'inline-flex' : 'none';
    }

    btnLimpar.addEventListener('click', () => {
        cards.forEach(card => {
            const periodo = card.getAttribute('data-periodo');
            const fileInput = card.querySelector('.input-venda-file');
            const fileNameEl = card.querySelector('.upload-file-name');
            const fileSizeEl = card.querySelector('.upload-file-size');
            clearCardFile(card, periodo, fileInput, fileNameEl, fileSizeEl);
        });
        checkAllFilesSelected();
        feedbackBox.style.display = 'none';
    });

    // Submissão do Formulário
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (!selectedFiles['3'] || !selectedFiles['7'] || !selectedFiles['15'] || !selectedFiles['30']) {
            showFeedback('Erro: Todos os 4 arquivos (3, 7, 15 e 30 dias) são obrigatórios.', 'danger');
            return;
        }

        const formData = new FormData();
        const periodos = ['3', '7', '15', '30'];

        periodos.forEach(p => {
            formData.append('files', selectedFiles[p]);
        });
        formData.append('periodos', JSON.stringify(periodos));

        // Feedback de carregamento
        btnProcessar.disabled = true;
        btnLimpar.disabled = true;
        feedbackBox.style.display = 'block';
        feedbackBox.style.backgroundColor = 'rgba(240, 124, 0, 0.1)';
        feedbackBox.style.border = '1px solid rgba(240, 124, 0, 0.4)';
        spinner.style.display = 'block';
        statusMsg.style.color = '#fff';
        statusMsg.textContent = 'Processando e sincronizando vendas dos 4 relatórios... Aguarde.';

        try {
            const res = await fetch('/analise-compras/upload-vendas', {
                method: 'POST',
                body: formData
            });

            const json = await res.json();

            if (json.success) {
                spinner.style.display = 'none';
                feedbackBox.style.backgroundColor = 'rgba(76, 175, 80, 0.15)';
                feedbackBox.style.border = '1px solid rgba(76, 175, 80, 0.5)';
                statusMsg.style.color = '#4caf50';
                statusMsg.innerHTML = '<i class="fas fa-check-circle me-2"></i> Relatórios de vendas importados com sucesso! Redirecionando para a análise...';

                setTimeout(() => {
                    window.location.href = '/analise-compras';
                }, 1800);
            } else {
                spinner.style.display = 'none';
                feedbackBox.style.backgroundColor = 'rgba(244, 67, 54, 0.15)';
                feedbackBox.style.border = '1px solid rgba(244, 67, 54, 0.5)';
                statusMsg.style.color = '#f44336';
                statusMsg.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i> Erro: ' + (json.message || 'Falha ao processar arquivos.');
                btnProcessar.disabled = false;
                btnLimpar.disabled = false;
            }
        } catch (err) {
            console.error('Erro no upload de vendas:', err);
            spinner.style.display = 'none';
            feedbackBox.style.backgroundColor = 'rgba(244, 67, 54, 0.15)';
            feedbackBox.style.border = '1px solid rgba(244, 67, 54, 0.5)';
            statusMsg.style.color = '#f44336';
            statusMsg.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i> Erro de conexão ou falha interna do servidor.';
            btnProcessar.disabled = false;
            btnLimpar.disabled = false;
        }
    });

    function showFeedback(msg, type) {
        feedbackBox.style.display = 'block';
        spinner.style.display = 'none';
        if (type === 'danger') {
            feedbackBox.style.backgroundColor = 'rgba(244, 67, 54, 0.15)';
            feedbackBox.style.border = '1px solid rgba(244, 67, 54, 0.5)';
            statusMsg.style.color = '#f44336';
        }
        statusMsg.textContent = msg;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
});
