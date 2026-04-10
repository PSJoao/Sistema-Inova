// public/scripts/relatorioTarde.js
document.addEventListener('DOMContentLoaded', function() {
    // Carrega a tabela assim que a página abrir
    carregarHistoricoTarde();

    const fileInput = document.getElementById('excelVendas');
    const fileNameDisplay = document.getElementById('nomeArquivoVendas');
    const form = document.getElementById('relatorioTardeForm');

    fileInput.addEventListener('change', function() {
        fileNameDisplay.textContent = this.files.length > 0 ? 'Arquivo Selecionado: ' + this.files[0].name : '';
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!fileInput.files || fileInput.files.length === 0) {
            ModalSystem.alert('Por favor, selecione a planilha de Vendas do Mercado Livre primeiro.', 'Aviso');
            return;
        }

        const formData = new FormData();
        formData.append('excelVendas', fileInput.files[0]);

        const btn = document.getElementById('btn-gerar-tarde');
        btn.disabled = true;
        ModalSystem.showLoading('Processando vendas e cruzando CEPs com as Ondas...', 'Aguarde');

        try {
            const response = await fetch('/api/relatorio-tarde/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            ModalSystem.hideLoading();

            if (data.success) {
                ModalSystem.alert(data.message, 'Sucesso');
                form.reset();
                fileNameDisplay.textContent = '';
                carregarHistoricoTarde(); // Atualiza a tabela na tela
            } else {
                ModalSystem.alert(data.message, 'Erro ao Gerar');
            }
        } catch (err) {
            ModalSystem.hideLoading();
            ModalSystem.alert('Erro de conexão ao enviar a planilha.', 'Erro de Rede');
        } finally {
            btn.disabled = false;
        }
    });
});

async function carregarHistoricoTarde() {
    const tbody = document.getElementById('tabela-historico-tarde');
    try {
        const res = await fetch('/api/relatorio-tarde/historico');
        const data = await res.json();
        
        if (data.success) {
            if (data.relatorios.length === 0) {
                tbody.innerHTML = '<tr id="linha-vazia"><td colspan="3" class="text-center text-muted" style="padding: 2rem 0;">Nenhum relatório da tarde gerado ainda.</td></tr>';
                return;
            }

            let html = '';
            data.relatorios.forEach(rel => {
                const dataFormatada = new Date(rel.created_at).toLocaleString('pt-BR');
                html += `
                    <tr>
                        <td class="align-middle font-weight-bold" style="color: var(--accent-orange);">${rel.nome}</td>
                        <td class="align-middle" style="color: var(--text-secondary);">${dataFormatada}</td>
                        <td class="text-center">
                            <a href="/api/relatorio-tarde/download/${rel.id}" class="btn btn-sm btn-success mr-2" title="Baixar Excel">
                                <i class="fas fa-file-excel mr-1"></i> Baixar
                            </a>
                            <button class="btn btn-sm btn-outline-danger" onclick="excluirRelatorioTarde(${rel.id})" title="Excluir">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }
    } catch (err) {
        tbody.innerHTML = '<tr id="linha-vazia"><td colspan="3" class="text-center text-danger" style="padding: 2rem 0;">Erro ao carregar o histórico.</td></tr>';
    }
}

function excluirRelatorioTarde(id) {
    ModalSystem.confirm(
        'Tem certeza que deseja excluir este relatório do histórico?',
        'Confirmar Exclusão',
        async function() {
            ModalSystem.showLoading('Excluindo relatório...', 'Aguarde');
            try {
                const res = await fetch(`/api/relatorio-tarde/${id}`, { method: 'DELETE' });
                const data = await res.json();
                ModalSystem.hideLoading();
                
                if (data.success) {
                    carregarHistoricoTarde();
                } else {
                    ModalSystem.alert(data.message, 'Erro');
                }
            } catch (err) {
                ModalSystem.hideLoading();
                ModalSystem.alert('Erro ao excluir o relatório.', 'Erro');
            }
        }
    );
}