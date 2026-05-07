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

        // Antes de submeter, verifica se existe um relatório de gôndola disponível
        let gondolaId = null;
        try {
            const gondolaRes = await fetch('/api/gondola/listar');
            const gondolaData = await gondolaRes.json();
            if (gondolaData.success && gondolaData.relatorios && gondolaData.relatorios.length > 0) {
                const ultimoGondola = gondolaData.relatorios[0]; // Já vem ordenado por created_at DESC
                gondolaId = await perguntarSobreGondola(ultimoGondola);
            }
        } catch (err) {
            // Falha silenciosa: se não conseguir buscar a gôndola, continua sem ela
            console.warn('[Relatório Tarde] Não foi possível buscar relatórios de gôndola:', err);
        }

        // Monta o FormData e envia
        await enviarRelatorioTarde(fileInput.files[0], gondolaId);
    });
});

/**
 * Exibe o modal de confirmação da gôndola e retorna uma Promise que resolve
 * com o gondolaId escolhido (string) ou null (se recusar).
 */
function perguntarSobreGondola(ultimoGondola) {
    return new Promise((resolve) => {
        const dataFormatada = new Date(ultimoGondola.created_at).toLocaleString('pt-BR');
        const mensagem = `
            <div style="line-height: 1.6;">
                <p>Foi encontrado um <strong>Relatório de Gôndola</strong> disponível:</p>
                <div style="background: rgba(255,165,0,0.08); border: 1px solid rgba(255,165,0,0.3); border-radius: 8px; padding: 12px 16px; margin: 12px 0;">
                    <div style="color: var(--accent-orange, #ffa500); font-weight: bold; font-size: 0.95rem;">${ultimoGondola.nome}</div>
                    <div style="color: var(--text-secondary, #aaa); font-size: 0.85rem; margin-top: 4px;">
                        <i class="fas fa-clock mr-1"></i> Gerado em: ${dataFormatada}
                    </div>
                </div>
                <p style="font-size: 0.92rem; color: var(--text-secondary, #aaa);">
                    Deseja usar este relatório para <strong>subtrair os itens já separados na gôndola</strong> do relatório da tarde?
                </p>
            </div>
        `;
        ModalSystem.confirm(
            mensagem,
            'Usar Relatório de Gôndola?',
            function() { resolve(String(ultimoGondola.id)); }, // Sim → usa a gôndola
            function() { resolve(null); },                      // Não → ignora
            { confirmText: 'Sim, subtrair gôndola', cancelText: 'Não, ignorar' }
        );
    });
}

/**
 * Envia o arquivo Excel para o servidor, com ou sem gondolaId.
 */
async function enviarRelatorioTarde(arquivo, gondolaId) {
    const btn = document.getElementById('btn-gerar-tarde');
    btn.disabled = true;
    ModalSystem.showLoading('Processando vendas e cruzando CEPs com as Ondas...', 'Aguarde');

    const formData = new FormData();
    formData.append('excelVendas', arquivo);
    if (gondolaId) {
        formData.append('gondolaId', gondolaId);
    }

    try {
        const response = await fetch('/api/relatorio-tarde/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        ModalSystem.hideLoading();

        if (data.success) {
            ModalSystem.alert(data.message, 'Sucesso');
            document.getElementById('relatorioTardeForm').reset();
            document.getElementById('nomeArquivoVendas').textContent = '';
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
}

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
