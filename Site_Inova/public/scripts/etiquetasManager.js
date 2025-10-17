// public/scripts/etiquetasManager.js
document.addEventListener('DOMContentLoaded', function() {
    const uploadForm = document.getElementById('uploadForm');
    const loadingOverlay = document.getElementById('loading-overlay');
    const fileInput = document.getElementById('etiquetasPdfs');
    const fileListDiv = document.getElementById('file-list');

    if (uploadForm) {
        uploadForm.addEventListener('submit', function() {
            // Verifica se algum arquivo foi selecionado
            if (fileInput.files.length > 0) {
                loadingOverlay.style.display = 'flex';
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            let fileNames = [];
            for (let i = 0; i < this.files.length; i++) {
                fileNames.push(this.files[i].name);
            }
            fileListDiv.innerHTML = fileNames.length > 0 ? `Arquivo(s) selecionado(s): ${fileNames.join(', ')}` : '';
        });
    }
});