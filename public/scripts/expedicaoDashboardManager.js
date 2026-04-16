// public/scripts/expedicaoDashboardManager.js

let tabelaPendencias; // Variável global para armazenar a instância do DataTables

document.addEventListener('DOMContentLoaded', () => {
    initCarregadoresForm();
    initTabelas();
    initDashboardRealTime();
    carregarHistoricoExpedicoes();
    initExportButtons();
});

/**
 * Gerencia o formulário de geração de etiquetas dos carregadores
 */
function initCarregadoresForm() {
    const container = document.getElementById('carregadores-container');
    const btnAdd = document.getElementById('btn-add-carregador');
    const form = document.getElementById('form-etiquetas-carregadores');

    let currentPage = 1;
    const itemsPerPage = 5;

    function renderPaginationControls(totalItems) {
        // Remover controles antigos se houver
        const oldControls = document.getElementById('carregadores-pagination');
        if (oldControls) oldControls.remove();

        const totalPages = Math.ceil(totalItems / itemsPerPage);
        if (totalPages <= 1) return;

        const pagHtml = `
            <div id="carregadores-pagination" style="display: flex; justify-content: center; gap: 10px; margin-top: 10px;">
                <button type="button" class="btn btn-sm btn-outline-warning" id="btn-prev-page" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
                <span style="color: #aaa; align-self: center;">Página ${currentPage} de ${totalPages}</span>
                <button type="button" class="btn btn-sm btn-outline-warning" id="btn-next-page" ${currentPage === totalPages ? 'disabled' : ''}>Próxima</button>
            </div>
        `;
        container.insertAdjacentHTML('afterend', pagHtml);

        document.getElementById('btn-prev-page')?.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; applyPaginationDisplay(); }
        });
        document.getElementById('btn-next-page')?.addEventListener('click', () => {
            if (currentPage < totalPages) { currentPage++; applyPaginationDisplay(); }
        });
    }

    function applyPaginationDisplay() {
        const rows = container.querySelectorAll('.carregador-row');
        rows.forEach((row, index) => {
            if (index >= (currentPage - 1) * itemsPerPage && index < currentPage * itemsPerPage) {
                row.style.display = 'flex';
            } else {
                row.style.display = 'none';
            }
        });
        renderPaginationControls(rows.length);

        // Cuidar dos labels apenas na primeira linha visível
        rows.forEach(r => {
            const labels = r.querySelectorAll('.form-label-dark');
            labels.forEach(l => l.style.display = 'none');
        });
        const firstVisible = Array.from(rows).find(r => r.style.display !== 'none');
        if (firstVisible) {
            firstVisible.querySelectorAll('.form-label-dark').forEach(l => l.style.display = 'block');
        }
    }

    async function loadCarregadores() {
        container.innerHTML = '<p style="color:#aaa;">Carregando...</p>';
        try {
            const res = await fetch('/api/expedicao/carregadores/ativos');
            const lista = await res.json();
            container.innerHTML = '';

            if (lista.length === 0) {
                container.innerHTML = '<p style="color:#aaa;">Nenhum carregador cadastrado no sistema.</p>';
            }

            lista.forEach((c, index) => {
                const rowTemplate = `
                    <div class="carregador-row" data-id="${c.id}" style="display: flex; gap: 10px; align-items: flex-end; margin-bottom: 10px;">
                        <div class="form-group" style="flex: 2; margin-bottom: 0;">
                            <label class="form-label-dark" style="display:none; color: #ff9800;">Nome</label>
                            <input type="text" class="form-control form-control-dark input-nome" name="nomes[]" value="${c.nome}" readonly>
                        </div>
                        <div class="form-group" style="flex: 2; margin-bottom: 0;">
                            <label class="form-label-dark" style="display:none; color: #ff9800;">Código</label>
                            <input type="text" class="form-control form-control-dark input-codigo" name="codigos[]" value="${c.codigo_barras}" readonly>
                        </div>
                        <div class="form-group" style="flex: 1; margin-bottom: 0;">
                            <label class="form-label-dark" style="display:none; color: #ff9800;">Qtd Etiquetas</label>
                            <input type="number" class="form-control form-control-dark input-qtd" name="quantidades[]" value="50" min="1" required>
                        </div>
                        <button type="button" class="btn btn-outline-danger" onclick="deletarCarregadorDB(${c.id})" style="margin-bottom: 2px;" title="Remover do Banco de Dados">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', rowTemplate);
            });

            currentPage = 1;
            applyPaginationDisplay();

        } catch (e) {
            container.innerHTML = '<p style="color:#f44;">Erro ao carregar carregadores: ' + e.message + '</p>';
        }
    }

    // Criar um novo carregador
    btnAdd.addEventListener('click', () => {
        ModalSystem.prompt("Nome Completo do Carregador:", "Novo Carregador", (nome) => {
            if (!nome) return;
            ModalSystem.prompt("Código/Matrícula do Carregador (Ex: JORGE02):", "Novo Carregador", async (codigo) => {
                if (!codigo) return;
                try {
                    ModalSystem.showLoading('Salvando...');
                    const response = await fetch('/api/expedicao/carregadores', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nome, codigo_barras: codigo })
                    });
                    ModalSystem.hideLoading();
                    if (response.ok) {
                        await loadCarregadores();
                    } else {
                        ModalSystem.alert('Erro ao salvar carregador. Talvez este código já exista.', 'Erro');
                    }
                } catch (e) { ModalSystem.hideLoading(); console.error(e); }
            });
        });
    });

    // Função exposta no escopo global para deleção
    window.deletarCarregadorDB = (id) => {
        ModalSystem.confirm('Tem certeza que deseja desativar este carregador do sistema?', 'Deletar Carregador', async () => {
            try {
                ModalSystem.showLoading('Deletando...');
                await fetch('/api/expedicao/carregadores/' + id, { method: 'DELETE' });
                ModalSystem.hideLoading();
                await loadCarregadores();
            } catch (e) { ModalSystem.hideLoading(); console.error(e); }
        });
    };

    // Submissão do formulário para baixar o ZIP
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btnSubmit = document.getElementById('btn-gerar-zip');
        const originalText = btnSubmit.innerHTML;
        btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';
        btnSubmit.disabled = true;

        try {
            const rows = container.querySelectorAll('.carregador-row');
            if (rows.length === 0) {
                ModalSystem.alert('Nenhum carregador ativo para gerar PDF.', 'Aviso');
                return;
            }

            const nomes = Array.from(document.querySelectorAll('.input-nome')).map(inp => inp.value);
            const codigos = Array.from(document.querySelectorAll('.input-codigo')).map(inp => inp.value);
            const quantidades = Array.from(document.querySelectorAll('.input-qtd')).map(inp => parseInt(inp.value));

            const carregadores = nomes.map((nome, index) => ({
                nome, codigo_barras: codigos[index], quantidade: quantidades[index]
            }));

            const response = await fetch('/etiquetas/carregadores/gerar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ carregadores })
            });

            if (!response.ok) throw new Error('Falha ao gerar o arquivo ZIP');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'etiquetas_carregadores.zip';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);
            ModalSystem.hideLoading();
            ModalSystem.alert('Erro ao gerar as etiquetas dos carregadores.', 'Erro');
        } finally {
            btnSubmit.innerHTML = originalText;
            btnSubmit.disabled = false;
        }
    });

    // Inicia a carga quando amarra o form
    loadCarregadores();
}

/**
 * Inicializa as instâncias das DataTables
 */
function initTabelas() {
    const dataTablesLangBR = {
        "sEmptyTable": "Nenhum registro encontrado",
        "sProcessing": "Processando...",
        "sLengthMenu": "Mostrar _MENU_ registros",
        "sZeroRecords": "Não foram encontrados resultados",
        "sInfo": "Mostrando de _START_ até _END_ de _TOTAL_ registros",
        "sInfoEmpty": "Mostrando 0 até 0 de 0 registros",
        "sInfoFiltered": "(filtrado de _MAX_ registros no total)",
        "sInfoPostFix": "",
        "sSearch": "Buscar:",
        "sUrl": "",
        "oPaginate": { "sFirst": "Primeiro", "sPrevious": "Anterior", "sNext": "Próxima", "sLast": "Último" },
        "oAria": { "sSortAscending": ": Ordenar colunas de forma ascendente", "sSortDescending": ": Ordenar colunas de forma descendente" }
    };

    // Tabela de Produtividade (Será alimentada depois na tela de bipagem)
    tabelaProdutividade = $('#tabela-produtividade').DataTable({
        language: dataTablesLangBR,
        pageLength: 5,
        lengthChange: false,
        searching: false,
        ordering: true,
        info: false,
        columns: [
            { data: 'carregador' },
            { data: 'kits_separados' },
            { data: 'itens_unitarios' }
        ]
    });

    // Tabela de Pendências
    tabelaPendencias = $('#tabela-pendencias').DataTable({
        language: dataTablesLangBR,
        pageLength: 10,
        ordering: false, // Mantém a ordem decrescente do banco de dados (created_at DESC)
        columns: [
            { data: 'dataEntrada' },
            { data: 'nfHtml' },
            { data: 'pedidoId' },
            { data: 'numeroLoja' },
            { data: 'sku' },
            { data: 'statusBadge' },
            { data: 'acoes' }
        ]
    });

    // Evento de Filtro via Combobox
    $('#filtro-status-tabela').on('change', function () {
        tabelaPendencias.column(5).search(this.value, false, false).draw();
    });
}

/**
 * Inicializa a busca de dados do dashboard e define o intervalo de atualização
 */
function initDashboardRealTime() {
    carregarDadosDashboard();
    setInterval(carregarDadosDashboard, 30000); // Atualiza a cada 30 segundos
}

/**
 * Faz o fetch na API e popula os cards e a tabela DataTables
 */
async function carregarDadosDashboard() {
    try {
        const response = await fetch('/api/expedicao/dashboard-dados');
        if (!response.ok) throw new Error('Erro na rede ao buscar dados do dashboard.');
        const data = await response.json();

        if (document.getElementById('dash-checados')) {
            document.getElementById('dash-checados').innerText = data.stats.checados || 0;
        }
        document.getElementById('dash-heranca').innerText = data.stats.heranca || 0;
        document.getElementById('dash-novos').innerText = data.stats.novos_hoje || 0;
        document.getElementById('dash-subtracoes').innerText = data.stats.subtracoes || 0;
        document.getElementById('dash-total').innerText = data.stats.saldo_real || 0;
        if (document.getElementById('dash-expedidos')) {
            document.getElementById('dash-expedidos').innerText = data.stats.expedidos_hoje || 0;
        }

        // 2. Prepara os dados formatados para o DataTables
        const linhasFormatadas = data.pendencias.map(item => {
            const dataFmt = new Date(item.created_at).toLocaleString('pt-BR');
            const herancaIcon = item.heranca_ontem ? '<i class="fas fa-history" title="Herança" style="color:var(--color-warning); margin-left: 5px;"></i>' : '';

            let statusBadge = '';
            if (item.status === 'pendente') statusBadge = '<span class="badge badge-orange">Pendente</span>';
            else if (item.status === 'checado') statusBadge = '<span class="badge" style="background-color: #0dcaf0; color: #1e1e2f;">Checado</span>';
            else if (item.status === 'sem_estoque') statusBadge = '<span class="badge" style="background-color: var(--color-warning); color: #1e1e2f;">Sem Estoque</span>';
            else if (item.status === 'cancelado') statusBadge = '<span class="badge" style="background-color: var(--color-danger); color: #fff;">Cancelado</span>';
            else if (item.status === 'impresso') statusBadge = '<span class="badge" style="background-color: #4CAF50; color: #fff;">Expedido</span>';

            const acoes = `
                ${item.status !== 'impresso' ? `
                    ${item.status !== 'pendente'
                        ? `<button class="btn btn-icon btn-outline-accent" onclick="alterarStatusEtiqueta(${item.id}, 'pendente')" title="Retomar / Despausar"><i class="fas fa-play"></i></button>`
                        : `<button class="btn btn-icon btn-outline-warning" onclick="alterarStatusEtiqueta(${item.id}, 'sem_estoque')" title="Pausar (Sem Estoque)"><i class="fas fa-pause"></i></button>`
                    }
                    <button class="btn btn-icon btn-outline-danger" onclick="confirmarCancelamento(${item.id})" title="Cancelar"><i class="fas fa-times"></i></button>
                ` : `
                    <button class="btn btn-icon disabled" style="color:#555; border-color:#333; cursor:not-allowed;" title="Ação boqueada (Expedido)"><i class="fas fa-play"></i></button>
                    <button class="btn btn-icon disabled" style="color:#555; border-color:#333; cursor:not-allowed;" title="Ação boqueada (Expedido)"><i class="fas fa-times"></i></button>
                `}
            `;

            let skuFormatted = '-';
            if (item.skus) {
                if (Array.isArray(item.skus)) {
                    // Extract the values
                    skuFormatted = item.skus.map(s => s.display || s.original || s).join(', ');
                } else if (typeof item.skus === 'string') {
                    // It might be a stringified JSON
                    try {
                        const parsed = JSON.parse(item.skus);
                        skuFormatted = Array.isArray(parsed) ? parsed.map(s => s.display || s.original || s).join(', ') : item.skus;
                    } catch (e) {
                        skuFormatted = item.skus;
                    }
                }
            } else if (item.sku) {
                skuFormatted = item.sku;
            }

            return {
                dataEntrada: `${dataFmt} ${herancaIcon}`,
                nfHtml: `<strong>${item.nfe_numero || item.nf || '-'}</strong>`,
                pedidoId: item.pedido_numero || item.pack_id || '-',
                numeroLoja: item.numero_loja_calc || item.numero_loja || '-',
                sku: skuFormatted,
                statusBadge: statusBadge,
                acoes: acoes
            };
        });

        // Limpa a tabela e adiciona os novos dados renderizando corretamente
        // Limpa a tabela e adiciona os novos dados mantendo a página atual (draw(false))
        tabelaPendencias.clear().rows.add(linhasFormatadas).draw(false);

        // Renderiza produtividade
        if (data.produtividade) {
            tabelaProdutividade.clear().rows.add(data.produtividade).draw();
        }

    } catch (error) {
        console.error('Falha ao atualizar dashboard:', error);
    }
}

// ==========================================
// FUNÇÕES DE AÇÃO RÁPIDA (TABELA)
// ==========================================

async function alterarStatusEtiqueta(id, novoStatus) {
    try {
        const response = await fetch('/api/expedicao/atualizar-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status: novoStatus })
        });

        if (response.ok) {
            carregarDadosDashboard(); // Recarrega a tabela imediatamente após sucesso
        } else {
            throw new Error('Falha na resposta da API.');
        }
    } catch (error) {
        ModalSystem.alert('Não foi possível atualizar o status desta etiqueta.', 'Erro');
    }
}

window.confirmarCancelamento = function (id) {
    ModalSystem.confirm(
        'Tem certeza que deseja cancelar esta etiqueta? Ela não irá mais compor o saldo a expedir do dia.',
        'Cancelar Etiqueta',
        () => alterarStatusEtiqueta(id, 'cancelado')
    );
}

// ==========================================
// FUNÇÕES DE HISTÓRICO DE EXPEDIÇÕES
// ==========================================

let historicoGlobal = [];
let currentPageHistorico = 1;
const itemsPerPageHistorico = 10;

async function carregarHistoricoExpedicoes() {
    const container = document.getElementById('historico-container');
    if (!container) return;

    try {
        const response = await fetch('/api/expedicao/historico');
        historicoGlobal = await response.json();

        if (historicoGlobal.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 1rem;">Nenhuma expedição passada foi encontrada no sistema.</div>';
            return;
        }

        renderHistoricoPage(1);
    } catch (error) {
        console.error('Erro ao carregar historico:', error);
        container.innerHTML = '<div style="color: #f44336; padding: 1rem;"><i class="fas fa-exclamation-circle"></i> Erro ao carregar as expedições em histórico.</div>';
    }
}

function renderHistoricoPage(page) {
    const container = document.getElementById('historico-container');
    currentPageHistorico = page;

    const startIndex = (page - 1) * itemsPerPageHistorico;
    const endIndex = startIndex + itemsPerPageHistorico;
    const itemsToShow = historicoGlobal.slice(startIndex, endIndex);

    let html = '';
    itemsToShow.forEach(item => {
        html += `
            <div class="stat-card" style="flex: 1 1 calc(50% - 15px); min-width: 280px; text-align: left; background: var(--bg-primary); border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: space-between; padding: 1.25rem;">
                <div>
                    <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 1.1rem; font-weight: 700;"><i class="fas fa-calendar-check" style="color: var(--accent-orange); margin-right: 6px;"></i> ${item.titulo}</h4>
                </div>
                <button type="button" class="btn-premium orange" onclick="window.location.href='/api/expedicao/historico/relatorio/${item.dataRaw}'" style="border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.9rem;">
                    <i class="fas fa-file-excel"></i> Relatório
                </button>
            </div>
        `;
    });

    const totalPages = Math.ceil(historicoGlobal.length / itemsPerPageHistorico);
    if (totalPages > 1) {
        html += `
            <div style="width: 100%; display: flex; justify-content: center; gap: 10px; margin-top: 15px;">
                <button type="button" class="btn btn-sm" style="background: var(--bg-tertiary); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 5px 15px; border-radius: 5px;" onclick="renderHistoricoPage(${currentPageHistorico - 1})" ${currentPageHistorico === 1 ? 'disabled' : ''}>Anterior</button>
                <span style="color: #aaa; align-self: center; font-size: 0.9rem;">Página ${currentPageHistorico} de ${totalPages}</span>
                <button type="button" class="btn btn-sm" style="background: var(--bg-tertiary); color: #fff; border: 1px solid rgba(255,255,255,0.1); padding: 5px 15px; border-radius: 5px;" onclick="renderHistoricoPage(${currentPageHistorico + 1})" ${currentPageHistorico === totalPages ? 'disabled' : ''}>Próxima</button>
            </div>
        `;
    }

    container.innerHTML = html;
}

// ==========================================
// FUNÇÕES DE EXPORTAÇÃO EXCEL DA FILA DATA TABLES
// ==========================================

function initExportButtons() {
    const btnFull = document.getElementById('btn-exportar-tabela-full');
    const btnAgrupado = document.getElementById('btn-exportar-tabela-agrupada');

    if(btnFull) {
        btnFull.addEventListener('click', () => solicitarPlanilhaDinamica('full'));
    }
    
    if(btnAgrupado) {
        btnAgrupado.addEventListener('click', () => solicitarPlanilhaDinamica('grouped'));
    }

    const btnImprimirPendencias = document.getElementById('btn-imprimir-pendencias');
    if(btnImprimirPendencias) {
        btnImprimirPendencias.addEventListener('click', imprimirPendenciasLote);
    }
}

async function solicitarPlanilhaDinamica(type) {
    if (!tabelaPendencias) return;

    // Obtém as linhas visíveis da tabela, já filtradas pela pesquisa e select!
    const dadosVisiveis = tabelaPendencias.rows({ search: 'applied' }).data().toArray();
    
    if(dadosVisiveis.length === 0) {
        ModalSystem.alert('A tabela atual não possui dados com os filtros aplicados para poder exportar.', 'Tabela Vazia');
        return;
    }

    const htmlStripper = /(<([^>]+)>)/gi;

    // Constrói o payload limpo das classes HTML
    const payloadExtraido = dadosVisiveis.map(row => {
        return {
            dataEntrada: row.dataEntrada ? row.dataEntrada.replace(htmlStripper, "").trim() : "",
            nota_fiscal: row.nfHtml ? row.nfHtml.replace(htmlStripper, "").trim() : "",
            pedido: row.pedidoId ? row.pedidoId.replace(htmlStripper, "").trim() : "",
            numero_loja: row.numeroLoja ? row.numeroLoja.replace(htmlStripper, "").trim() : "",
            sku: row.sku ? row.sku.replace(htmlStripper, "").trim() : "",
            status: row.statusBadge ? row.statusBadge.replace(htmlStripper, "").trim() : ""
        };
    });

    const bodyData = { 
        tipo: type, 
        linhas: payloadExtraido 
    };

    try {
        ModalSystem.showLoading('Construindo relatório inteligente...', 'Gerando Planilha');
        
        const response = await fetch('/api/expedicao/exportar-dinamico', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) throw new Error('Falha na geração do arquivo');

        // Cria e faz download do Blob streamado
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = type === 'full' ? 'Relatorio_Completo_Expedicao.xlsx' : 'Contagem_SKU_Agrupada.xlsx';
        
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        ModalSystem.hideLoading();
    } catch (err) {
        console.error(err);
        ModalSystem.hideLoading();
        ModalSystem.alert('Não foi possível realizar o download.', 'Erro na Geração Excel');
    }
}

async function imprimirPendenciasLote() {
    if (!tabelaPendencias) return;
    const dadosVisiveis = tabelaPendencias.rows({ search: 'applied' }).data().toArray();
    
    if(dadosVisiveis.length === 0) {
        ModalSystem.alert('A tabela atual não possui dados aplicáveis para impressão.', 'Tabela Vazia');
        return;
    }

    const htmlStripper = /(<([^>]+)>)/gi;
    const nfsExtraidas = [];
    dadosVisiveis.forEach(row => {
        const identificador = row.nfHtml ? row.nfHtml.replace(htmlStripper, "").trim() : "";
        if (identificador && identificador !== "-") {
            nfsExtraidas.push(identificador);
        }
    });

    if(nfsExtraidas.length === 0) {
        ModalSystem.alert('Não foram encontrados NFs processáveis nos dados atuais.', 'Sem Dados');
        return;
    }

    try {
        ModalSystem.showLoading('Montando arquivo unificado de etiquetas...', 'Aguarde');
        
        const response = await fetch('/api/expedicao/imprimir-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nfs: nfsExtraidas })
        });

        if (!response.ok) {
            const errJson = await response.json().catch(() => ({}));
            throw new Error(errJson.message || 'Falha ao compilar arquivo em lote PDF');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Etiquetas_Lote_${new Date().getTime()}.pdf`;
        
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        ModalSystem.hideLoading();
    } catch (err) {
        console.error(err);
        ModalSystem.hideLoading();
        ModalSystem.alert(err.message, 'Erro na Geração PDF');
    }
}