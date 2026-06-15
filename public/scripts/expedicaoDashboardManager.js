// public/scripts/expedicaoDashboardManager.js

let tabelaPendencias; // Variável global para armazenar a instância do DataTables
let tabelaBipagemPdfs; // Tabela de PDFs gerados pela bipagem
let tabelaGestaoConferencia; // Tabela de Gestão de Conferência

let selectedNFs = new Set();
let isMassaMode = false;

document.addEventListener('DOMContentLoaded', () => {
    initCarregadoresForm();
    initTabelas();
    initDashboardRealTime();
    carregarHistoricoExpedicoes();
    initExportButtons();
    setupMassaModeListeners(); // Novo painel
    initGestaoConferenciaListeners(); // Gestão de conferência
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

    // Tabela de PDFs de Bipagem (Hoje)
    tabelaBipagemPdfs = $('#tabela-bipagem-pdfs').DataTable({
        language: dataTablesLangBR,
        pageLength: 5,
        lengthChange: false,
        searching: false,
        ordering: false,
        info: false,
        columns: [
            {
                data: 'name',
                render: function (data) {
                    // Exibe nome mais curto (sem extensão)
                    const shortName = data.replace('.pdf', '').replace('Bipagem-Finalizada-', 'Bip-');
                    return `<span title="${data}" style="font-size: 0.85rem; font-weight: 500;">${shortName}</span>`;
                }
            },
            {
                data: 'hora',
                render: function (data) {
                    return `<span style="color: var(--accent-orange, #f07c00); font-weight: 600;">${data}</span>`;
                }
            },
            { data: 'tamanho' },
            {
                data: 'url',
                className: 'text-center',
                render: function (data) {
                    return `<a href="${data}" target="_blank" class="btn-action btn-action-print" style="display:inline-flex;text-decoration:none;" title="Baixar PDF"><i class="fas fa-download"></i></a>`;
                }
            }
        ]
    });

    // Tabela de Gestão de Conferência em Massa
    tabelaGestaoConferencia = $('#tabela-gestao-conferencia').DataTable({
        language: dataTablesLangBR,
        pageLength: 5,
        ordering: true,
        order: [[3, "desc"]], // Ordenar por data
        columns: [
            { data: 'nfe' },
            { data: 'pedido' },
            { data: 'conferente' },
            { data: 'data_hora' },
            { data: 'status_local' },
            { data: 'status_bling' },
            { data: 'erro_bling' },
            { data: 'acao', orderable: false, className: 'text-center' }
        ]
    });

    // Tabela de Pendências
    tabelaPendencias = $('#tabela-pendencias').DataTable({
        language: dataTablesLangBR,
        pageLength: 10,
        scrollX: true,
        ordering: true, // Mantém a ordem decrescente obrigatoriamente
        order: [[1, "desc"]], // Ordena pela Data Entrada (coluna 1) decrescente
        columns: [
            {
                data: null,
                visible: false, // escondido por padrão
                orderable: false,
                className: 'col-massa-check text-center',
                render: function (data, type, row) {
                    const nfBase = String(row.nf_numero);
                    const checked = selectedNFs.has(nfBase) ? 'checked' : '';
                    return `<input type="checkbox" class="chk-massa-row" value="${nfBase}" style="cursor: pointer; width: 16px; height: 16px; margin-top: 5px;" ${checked}>`;
                }
            },
            { 
                data: 'dataEntrada',
                render: function(data, type, row) {
                    if (type === 'sort' || type === 'type') {
                        return row.dataEntradaRaw || '';
                    }
                    return data;
                }
            },
            { data: 'nfHtml' },
            { data: 'pedidoId' },
            { data: 'numeroLoja' },
            { data: 'sku' },
            { data: 'estoque' },
            { data: 'localizacao' },
            { data: 'statusMlBadge' },
            { data: 'statusBadge' },
            { data: 'acoes' }
        ]
    });

    // Filtro de Data Global (Próximo à Busca Global)
    const searchWrapper = $('#tabela-pendencias_filter');
    if (searchWrapper.length) {
        // Aplica flexbox no wrapper do DataTables para garantir alinhamento perfeito na mesma linha
        searchWrapper.css({
            'display': 'flex',
            'align-items': 'center',
            'justify-content': 'flex-end',
            'gap': '15px'
        });
        
        // Remove a margem inferior padrão da label de busca do DataTables (Bootstrap as vezes adiciona)
        searchWrapper.find('label').css('margin-bottom', '0');

        // Estado Padrão do Filtro: Últimos 30 dias contados a partir da data atual
        const hoje = new Date();
        const trintaDiasAtras = new Date();
        trintaDiasAtras.setDate(hoje.getDate() - 30);
        
        const formatData = (d) => {
            const tzOffset = d.getTimezoneOffset() * 60000; // offset in milliseconds
            const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 10);
            return localISOTime;
        };
        
        const dateFilterHtml = `
            <div id="data-filter-wrapper" style="display:flex; align-items: center; gap: 5px;">
                <label style="margin: 0; font-size: 0.9rem; color: var(--text-secondary);">Período:</label>
                <input type="date" id="filtro-data-inicio" class="form-control form-control-sm" style="width:auto; background-color: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" value="${formatData(trintaDiasAtras)}">
                <span style="margin: 0; color: var(--text-secondary);">até</span>
                <input type="date" id="filtro-data-fim" class="form-control form-control-sm" style="width:auto; background-color: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-color);" value="${formatData(hoje)}">
            </div>
        `;
        searchWrapper.prepend(dateFilterHtml);
        
        // Recarregar os dados ao alterar a data
        $('#filtro-data-inicio, #filtro-data-fim').on('change', function() {
            carregarDadosDashboard();
            carregarGestaoConferencia();
        });
    }

    // Listener para o clique na checkbox da linha (DELEGAÇÃO DE EVENTO)
    $('#tabela-pendencias tbody').on('change', '.chk-massa-row', function () {
        const val = $(this).val();
        if (this.checked) {
            selectedNFs.add(val);
        } else {
            selectedNFs.delete(val);
        }
        updateMassaPanelCount();
    });

    // Listener Master Checkbox (DELEGAÇÃO DO CABEÇALHO)
    $(document).on('change', '#chk-master-massa', function () {
        const isChecked = this.checked;
        const dadosBuscaAplicada = tabelaPendencias.rows({ search: 'applied' }).data().toArray();

        dadosBuscaAplicada.forEach(row => {
            const nfBase = String(row.nf_numero);
            if (isChecked) {
                selectedNFs.add(nfBase);
            } else {
                selectedNFs.delete(nfBase);
            }
        });

        // Atualiza nativamente as caixas das instâncias DOM do DataTables (mesmo em paginas ocultas)
        $('input.chk-massa-row', tabelaPendencias.rows({ search: 'applied' }).nodes()).prop('checked', isChecked);

        updateMassaPanelCount();
    });

    // Evento de Filtro via Combobox
    $('#filtro-status-tabela').on('change', function () {
        // A coluna 9 é 'statusBadge'
        let val = this.value;
        if (val === 'Cancelado') {
            // Regex para buscar 'Cancelado' mas não 'Cancelado Efetivado'
            // O DataTables usa o texto puro sem HTML, então pode ter 'Cancelado Etiq. Impressa'
            tabelaPendencias.column(9).search('^Cancelado(?! Efetivado)', true, false).draw();
        } else if (val) {
            tabelaPendencias.column(9).search(val, false, false).draw();
        } else {
            tabelaPendencias.column(9).search('', false, false).draw();
        }
    });

    $('#filtro-status-ml-tabela').on('change', function () {
        // A coluna 8 é 'statusMlBadge'
        tabelaPendencias.column(8).search(this.value, false, false).draw();
    });

    // Evento de Clique nos Cards de Balanço do Dia (Filtro Rápido)
    $('.stat-card-clickable').on('click', function() {
        const filterValue = $(this).attr('data-filter-status') || '';
        
        // Atualiza visualmente o card ativo
        $('.stat-card-clickable').removeClass('stat-card-active');
        if (filterValue !== "") {
            $(this).addClass('stat-card-active');
        }
        
        // Atualiza o select do filtro interno e dispara o change para o DataTables
        $('#filtro-status-tabela').val(filterValue).trigger('change');
        
        // Reseta o filtro ML para não conflitar com o clique rápido (opcional)
        $('#filtro-status-ml-tabela').val('').trigger('change');
        
        // Rola a tela suavemente até a tabela
        $('html, body').animate({
            scrollTop: $('.table-toolbar').offset().top - 20
        }, 500);
    });
}

// ===============================================
// MODAL DE AÇÃO EM MASSA
// ===============================================
function setupMassaModeListeners() {
    const btnToggle = document.getElementById('btn-massa-modo');
    const panel = document.getElementById('massa-action-panel');
    const btnClear = document.getElementById('btn-massa-clear');
    const btnApply = document.getElementById('btn-massa-aplicar');

    // Liga/Desliga o modo
    btnToggle.addEventListener('click', () => {
        isMassaMode = !isMassaMode;
        if (isMassaMode) {
            btnToggle.classList.replace('outline', 'solid');
            btnToggle.innerHTML = '<i class="fas fa-times"></i> Fechar Seleção';
            panel.style.display = 'flex';
            tabelaPendencias.column(0).visible(true); // Mostra checkboxes
            $('#th-massa').show();
        } else {
            btnToggle.classList.replace('solid', 'outline');
            btnToggle.innerHTML = '<i class="fas fa-check-square"></i> Seleção em Massa';
            panel.style.display = 'none';
            tabelaPendencias.column(0).visible(false); // Esconde
            $('#th-massa').hide();
        }
    });

    // Limpar tudo
    btnClear.addEventListener('click', () => {
        selectedNFs.clear();
        $('#chk-master-massa').prop('checked', false);
        $('input.chk-massa-row', tabelaPendencias.rows().nodes()).prop('checked', false);
        updateMassaPanelCount();
    });

    // Aplicar aos selecionados
    btnApply.addEventListener('click', async () => {
        if (selectedNFs.size === 0) {
            return ModalSystem.alert('Nenhuma nota selecionada.', 'Aviso');
        }

        const targetStatus = document.getElementById('massa-acao-status').value;
        const nfsArray = Array.from(selectedNFs);

        ModalSystem.confirm(`Tem certeza que deseja forçar o status de ${nfsArray.length} pedidos para '${targetStatus.toUpperCase()}'?`, 'Confirmação', async () => {
            try {
                ModalSystem.showLoading('Aplicando status em lote...');
                const response = await fetch('/api/expedicao/dashboard-massa-update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nfList: nfsArray,
                        novoStatus: targetStatus
                    })
                });

                const data = await response.json();
                ModalSystem.hideLoading();

                if (!data.success) throw new Error(data.message);

                // Sucesso: Limpa e recarrega
                selectedNFs.clear();
                updateMassaPanelCount();
                $('#chk-master-massa').prop('checked', false);
                // Sai do modo? Ou continua pra ver as recarregadas? Vamos só recarregar.
                carregarDadosDashboard();

                ModalSystem.alert(data.message, 'Operação Concluída');

            } catch (e) {
                ModalSystem.hideLoading();
                ModalSystem.alert(e.message || 'Erro ao comunicar com o servidor da base.', 'Erro de Múltipla Ação');
            }
        });
    });
}

function updateMassaPanelCount() {
    const display = document.getElementById('massa-count-display');
    if (display) {
        display.innerText = `${selectedNFs.size} selecionadas`;
        if (selectedNFs.size > 0) {
            display.style.color = '#fff';
            display.style.background = 'var(--accent-orange)';
            display.style.padding = '2px 8px';
            display.style.borderRadius = '5px';
        } else {
            display.style.color = 'var(--accent-orange)';
            display.style.background = 'transparent';
        }
    }
}

/**
 * Inicializa a busca de dados do dashboard e define o intervalo de atualização
 */
function initDashboardRealTime() {
    carregarDadosDashboard();
    carregarGestaoConferencia();
    setInterval(() => {
        carregarDadosDashboard();
        carregarGestaoConferencia();
    }, 30000); // Atualiza a cada 30 segundos
}

/**
 * Faz o fetch na API e popula os cards e a tabela DataTables
 */
async function carregarDadosDashboard() {
    try {
        let url = '/api/expedicao/dashboard-dados';
        const dataInicioEl = document.getElementById('filtro-data-inicio');
        const dataFimEl = document.getElementById('filtro-data-fim');
        
        if (dataInicioEl && dataFimEl && dataInicioEl.value && dataFimEl.value) {
            url += `?dataInicio=${dataInicioEl.value}&dataFim=${dataFimEl.value}`;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error('Erro na rede ao buscar dados do dashboard.');
        const data = await response.json();

        if (document.getElementById('dash-checados')) {
            document.getElementById('dash-checados').innerText = data.stats.checados || 0;
        }
        const totalPendentes = (parseInt(data.stats.heranca) || 0) + (parseInt(data.stats.novos_hoje) || 0);
        if (document.getElementById('dash-pendentes')) {
            document.getElementById('dash-pendentes').innerText = totalPendentes;
        }
        document.getElementById('dash-subtracoes').innerText = data.stats.subtracoes || 0;
        if (document.getElementById('dash-sem-nota')) {
            document.getElementById('dash-sem-nota').innerText = data.stats.sem_nota || 0;
        }
        if (document.getElementById('dash-conf-envio')) {
            document.getElementById('dash-conf-envio').innerText = data.stats.conf_envio || 0;
        }
        document.getElementById('dash-total').innerText = data.stats.saldo_real || 0;
        if (document.getElementById('dash-expedidos')) {
            document.getElementById('dash-expedidos').innerText = data.stats.expedidos_hoje || 0;
        }

        const linhasFormatadas = data.pendencias.map(item => {
            const dataFmt = new Date(item.created_at).toLocaleString('pt-BR');
            const herancaIcon = item.heranca_ontem ? '<i class="fas fa-history" title="Herança" style="color:var(--color-warning); margin-left: 5px;"></i>' : '';

            let statusMlBadge = '-';
            if (item.status_ml) {
                if (item.status_ml === 'Pronto para enviar') {
                    statusMlBadge = '<span class="badge" style="background-color: #28a745; color: #fff;">Pronto para enviar</span>';
                } else if (item.status_ml === 'Enviado') {
                    statusMlBadge = '<span class="badge" style="background-color: #007bff; color: #fff;">Enviado</span>';
                } else if (item.status_ml === 'Entregue') {
                    statusMlBadge = '<span class="badge" style="background-color: #17a2b8; color: #fff;">Entregue</span>';
                } else if (item.status_ml === 'Cancelado') {
                    statusMlBadge = '<span class="badge" style="background-color: #dc3545; color: #fff;">Cancelado</span>';
                } else {
                    statusMlBadge = `<span class="badge badge-secondary">${item.status_ml}</span>`;
                }
            }

            let statusBadge = '';
            if (item.status === 'pendente') statusBadge = '<span class="badge badge-orange">Pendente</span>';
            else if (item.status === 'hub') statusBadge = '<span class="badge" style="background-color: #7f00ff; color: #fff; font-weight: bold;">Hub</span>';
            else if (item.status === 'sem_nota' || item.status === 'bip_sem_etiq') statusBadge = '<span class="badge" style="background-color: #6c757d; color: #fff;">Pego, Sem Etiquetar</span>';
            else if (item.status === 'conf_envio') statusBadge = '<span class="badge" style="background-color: #6f42c1; color: #fff;">Conferência Envio</span>';
            else if (item.status === 'checado') statusBadge = '<span class="badge" style="background-color: #0dcaf0; color: #1e1e2f;">Checado</span>';
            else if (item.status === 'sem_estoque') statusBadge = '<span class="badge" style="background-color: var(--color-warning); color: #1e1e2f;">Sem Estoque</span>';
            else if (item.status === 'cancelamento') statusBadge = '<span class="badge" style="background-color: var(--color-danger); color: #fff;">Cancelado</span>';
            else if (item.status === 'cancelado') statusBadge = '<span class="badge" style="background-color: #8b0000; color: #fff;">Cancelado Efetivado</span>';
            else if (item.status === 'impresso') statusBadge = '<span class="badge" style="background-color: #4CAF50; color: #fff;">Expedido</span>';

            // Flag visual: etiqueta impressa pela bipagem de produtos (situacao=impresso mas status NÃO é impresso/expedido)
            if (item.situacao === 'impresso' && item.status !== 'impresso') {
                statusBadge += ' <span title="Etiqueta impressa pela Bipagem de Produtos" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#9C27B0;margin-left:4px;vertical-align:middle;"><i class="fas fa-print" style="color:#fff;font-size:0.6rem;"></i></span><span style="display:none;">Etiq. Impressa</span>';
            }

            const nfNumero = item.nfe_numero || '';
            const acoes = `
                <div style="display:flex;gap:4px;align-items:center;justify-content:center;">
                ${item.status !== 'impresso' ? `
                    ${(item.status !== 'pendente' && item.status !== 'hub')
                        ? `<button class="btn-action btn-action-accent" onclick="alterarStatusEtiqueta(${item.id}, '${item.origem === 'hub' ? 'hub' : 'pendente'}')" title="Retomar / Despausar"><i class="fas fa-play"></i></button>`
                        : `<button class="btn-action btn-action-warning" onclick="alterarStatusEtiqueta(${item.id}, 'sem_estoque')" title="Pausar (Sem Estoque)"><i class="fas fa-pause"></i></button>`
                    }
                    <button class="btn-action btn-action-danger" onclick="confirmarCancelamento(${item.id})" title="Cancelar"><i class="fas fa-times"></i></button>
                ` : `
                    <button class="btn-action btn-action-disabled" title="Expedido"><i class="fas fa-play"></i></button>
                    <button class="btn-action btn-action-disabled" title="Expedido"><i class="fas fa-times"></i></button>
                `}
                    <button class="btn-action btn-action-print" onclick="imprimirEtiquetaIndividual('${nfNumero}')" title="Imprimir Etiqueta"><i class="fas fa-print"></i></button>
                </div>
            `;

            let skuFormatted = '-';
            let estoqueFormatted = '-';
            if (item.skus) {
                if (Array.isArray(item.skus)) {
                    // Extract the values
                    skuFormatted = item.skus.map(s => s.display || s.original || s).join(', ');
                    estoqueFormatted = item.skus.map(s => s.estoque !== undefined ? s.estoque : '-').join(', ');
                } else if (typeof item.skus === 'string') {
                    // It might be a stringified JSON
                    try {
                        const parsed = JSON.parse(item.skus);
                        skuFormatted = Array.isArray(parsed) ? parsed.map(s => s.display || s.original || s).join(', ') : item.skus;
                        estoqueFormatted = Array.isArray(parsed) ? parsed.map(s => s.estoque !== undefined ? s.estoque : '-').join(', ') : '-';
                    } catch (e) {
                        skuFormatted = item.skus;
                    }
                }
            } else if (item.sku) {
                skuFormatted = item.sku;
            }

            return {
                nf_numero: item.nfe_numero || item.nf || '-',
                dataEntrada: `${dataFmt} ${herancaIcon}`,
                dataEntradaRaw: item.created_at,
                nfHtml: `<strong>${item.nfe_numero || item.nf || '-'}</strong>`,
                pedidoId: item.pedido_numero || item.pack_id || '-',
                numeroLoja: item.numero_loja_calc || item.numero_loja || '-',
                sku: skuFormatted,
                estoque: estoqueFormatted,
                localizacao: item.locations || '-',
                skusOriginal: item.skus,
                statusMlBadge: statusMlBadge,
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

        // Carrega PDFs de bipagem do dia
        carregarBipagemPdfs();

    } catch (error) {
        console.error('Falha ao atualizar dashboard:', error);
    }
}

// ==========================================
// CARREGAMENTO DE PDFs DE BIPAGEM (HOJE)
// ==========================================
async function carregarBipagemPdfs() {
    try {
        const response = await fetch('/api/expedicao/bipagem-pdfs');
        const data = await response.json();
        if (data.success && tabelaBipagemPdfs) {
            tabelaBipagemPdfs.clear().rows.add(data.pdfs).draw();
        }
    } catch (err) {
        console.warn('Falha ao carregar PDFs de bipagem:', err);
    }
}

// ==========================================
// GESTÃO DE CONFERÊNCIA
// ==========================================

async function carregarGestaoConferencia() {
    try {
        const response = await fetch('/api/expedicao/conferencia-gestao');
        const data = await response.json();

        if (tabelaGestaoConferencia) {
            const formatado = data.map(item => {
                const isPendingSync = item.bling_sync_status === 'pending';
                const isErrorSync = item.bling_sync_status === 'error';
                const isSuccessSync = item.bling_sync_status === 'success';

                let syncBadge = '';
                if (isPendingSync) syncBadge = '<span class="badge badge-warning text-dark">Pendente Envio</span>';
                else if (isErrorSync) syncBadge = '<span class="badge badge-danger">Erro no Envio</span>';
                else if (isSuccessSync) syncBadge = '<span class="badge badge-success">Enviado</span>';
                else syncBadge = `<span class="badge badge-secondary">${item.bling_sync_status || 'N/A'}</span>`;

                let localStatus = '';
                if (item.status_ml === 'checado') localStatus = '<span class="badge badge-info">Checado</span>';
                else if (item.status_ml === 'impresso') localStatus = '<span class="badge badge-success">Expedido</span>';
                else localStatus = `<span class="badge badge-secondary">${item.status_ml || 'Desconhecido'}</span>`;

                // Botão de ação individual
                let acaoHtml = '';
                if (isPendingSync || isErrorSync) {
                    acaoHtml = `<button class="btn-action btn-action-accent btn-sync-individual" data-nfe="${item.nfe_numero}" title="Enviar ao Bling" style="min-width:32px;"><i class="fas fa-cloud-upload-alt"></i></button>`;
                } else if (isSuccessSync) {
                    acaoHtml = `<span class="btn-action btn-action-disabled" title="Já enviado" style="min-width:32px;"><i class="fas fa-check"></i></span>`;
                } else {
                    acaoHtml = '-';
                }

                return {
                    nfe: `<strong>${item.nfe_numero || '-'}</strong>`,
                    pedido: item.pedido_numero || '-',
                    conferente: item.conferente || 'N/A',
                    data_hora: item.conferido_em ? new Date(item.conferido_em).toLocaleString('pt-BR') : '-',
                    status_local: localStatus,
                    status_bling: syncBadge,
                    erro_bling: isErrorSync && item.bling_error_msg ? `<span class="text-danger small" style="word-break: break-word;" title="${item.bling_error_msg}">${item.bling_error_msg}</span>` : '-',
                    acao: acaoHtml,
                    _rawItem: item
                };
            });
            tabelaGestaoConferencia.clear().rows.add(formatado).draw(false);
        }
    } catch (error) {
        console.error('Falha ao atualizar gestão de conferência:', error);
    }
}

// ==========================================
// ENVIO INDIVIDUAL AO BLING
// ==========================================
window.enviarIndividualBling = async function(nfeNumero) {
    // Já temos referência indireta. Mas pra facilitar delegação de evento:
};

function initGestaoConferenciaListeners() {
    // --- Delegação de Evento: Envio Individual ---
    $('#tabela-gestao-conferencia tbody').on('click', '.btn-sync-individual', async function (e) {
        e.preventDefault();
        const btn = $(this);
        const nfeNumero = btn.data('nfe');
        if (!nfeNumero) return;

        // Desabilita o botão e mostra spinner
        const originalHtml = btn.html();
        btn.html('<i class="fas fa-spinner fa-spin"></i>').prop('disabled', true).css('pointer-events', 'none');

        try {
            const res = await fetch('/api/expedicao/conferencia-sync-bling-individual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nfeNumero })
            });
            const data = await res.json();

            if (data.success) {
                ToastSystem.success(`NFe ${nfeNumero} sincronizada com sucesso!`);
            } else {
                ToastSystem.error(`Erro na NFe ${nfeNumero}: ${data.message || 'Falha desconhecida'}`);
            }
        } catch (err) {
            ToastSystem.error('Erro de rede ao sincronizar.');
        }

        // Recarrega a tabela para refletir o status atualizado
        await carregarGestaoConferencia();
        carregarDadosDashboard();
    });

    // --- Envio em Lote Inteligente ---
    const btnSync = document.getElementById('btn-sync-conferencia-bling');
    if (btnSync) {
        btnSync.addEventListener('click', async () => {
            if (!tabelaGestaoConferencia) return;

            // Conta quantas pendentes/erro existem na tabela
            const todasLinhas = tabelaGestaoConferencia.rows().data().toArray();
            const pendentesCount = todasLinhas
                .filter(row => row._rawItem && (row._rawItem.bling_sync_status === 'pending' || row._rawItem.bling_sync_status === 'error'))
                .length;

            if (pendentesCount === 0) {
                ToastSystem.info('Não há notas pendentes ou com erro para sincronizar com o Bling.');
                return;
            }

            ModalSystem.confirm(
                `<div style="line-height:1.6;">
                    <p>Serão processados até <strong>500 pedidos</strong> com status pendente ou erro.</p>
                    <p style="font-size:0.9rem; color: var(--text-secondary);">O processamento será feito em <strong>blocos de 100</strong>, com <strong>2 pedidos em paralelo</strong>. Erros serão retentados automaticamente ao final de cada bloco.</p>
                    <p style="font-size:0.9rem; color: var(--text-secondary);">Você poderá acompanhar o progresso em tempo real.</p>
                </div>`,
                'Envio em Lote Inteligente',
                async () => {
                    await iniciarEnvioLoteInteligente();
                }
            );
        });
    }
}

// ==========================================
// ENVIO EM LOTE INTELIGENTE — Modal de Progresso
// ==========================================
let _lotePollingInterval = null;

async function iniciarEnvioLoteInteligente() {
    try {
        // 1. Dispara o job no backend
        const res = await fetch('/api/expedicao/conferencia-sync-bling-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (!data.success || !data.jobId) {
            ToastSystem.error(data.message || 'Erro ao iniciar processamento em lote.');
            return;
        }

        const jobId = data.jobId;

        // 2. Abre o modal de progresso
        abrirModalProgressoLote(jobId);

    } catch (err) {
        ToastSystem.error('Erro de rede ao iniciar processamento em lote.');
    }
}

function abrirModalProgressoLote(jobId) {
    // Cria o overlay e modal
    const overlay = document.createElement('div');
    overlay.id = 'lote-progress-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
        <div style="background:var(--bg-secondary, #1e1e2f);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:2rem;width:90%;max-width:550px;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <h4 style="margin:0 0 1.5rem;font-size:1.2rem;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-cloud-upload-alt" style="color:var(--accent-orange,#ff9800);"></i> Envio em Lote — Progresso
            </h4>

            <div id="lote-status-text" style="font-size:0.95rem;margin-bottom:1rem;color:var(--text-secondary,#aaa);">
                Iniciando processamento...
            </div>

            <div style="background:rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;height:24px;margin-bottom:0.8rem;border:1px solid rgba(255,255,255,0.08);">
                <div id="lote-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#ff9800,#ff5722);transition:width 0.4s ease;border-radius:10px;display:flex;align-items:center;justify-content:center;">
                    <span id="lote-progress-pct" style="font-size:0.7rem;font-weight:bold;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.5);"></span>
                </div>
            </div>

            <div style="display:flex;gap:1.5rem;margin-bottom:1rem;">
                <div style="flex:1;background:rgba(76,175,80,0.08);border:1px solid rgba(76,175,80,0.2);border-radius:8px;padding:0.6rem;text-align:center;">
                    <div id="lote-sucessos" style="font-size:1.4rem;font-weight:bold;color:#4CAF50;">0</div>
                    <div style="font-size:0.75rem;color:#aaa;">Sucessos</div>
                </div>
                <div style="flex:1;background:rgba(244,67,54,0.08);border:1px solid rgba(244,67,54,0.2);border-radius:8px;padding:0.6rem;text-align:center;">
                    <div id="lote-erros" style="font-size:1.4rem;font-weight:bold;color:#f44336;">0</div>
                    <div style="font-size:0.75rem;color:#aaa;">Erros</div>
                </div>
                <div style="flex:1;background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.2);border-radius:8px;padding:0.6rem;text-align:center;">
                    <div id="lote-bloco" style="font-size:1.4rem;font-weight:bold;color:#ff9800;">-</div>
                    <div style="font-size:0.75rem;color:#aaa;">Bloco</div>
                </div>
            </div>

            <div id="lote-log-container" style="display:none;max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.3);border-radius:8px;padding:0.6rem;margin-bottom:1rem;font-size:0.8rem;font-family:monospace;">
                <div style="color:#f44336;font-weight:bold;margin-bottom:4px;">Erros encontrados:</div>
                <div id="lote-log-erros"></div>
            </div>

            <div style="text-align:right;">
                <button id="btn-lote-fechar" class="btn-premium orange" style="padding:0.4rem 1.2rem;font-size:0.9rem;border-radius:6px;display:none;">
                    Fechar
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Botão Fechar
    document.getElementById('btn-lote-fechar').addEventListener('click', () => {
        fecharModalProgressoLote();
    });

    // 3. Inicia polling a cada 2 segundos
    _lotePollingInterval = setInterval(() => pollStatusLote(jobId), 2000);
    // Faz a primeira checagem imediata
    setTimeout(() => pollStatusLote(jobId), 500);
}

async function pollStatusLote(jobId) {
    try {
        const res = await fetch(`/api/expedicao/conferencia-sync-bling-lote/status?jobId=${encodeURIComponent(jobId)}`);
        if (!res.ok) {
            console.warn('Polling: resposta não ok', res.status);
            return;
        }
        const status = await res.json();

        // Atualiza UI
        const totalProcessados = status.sucessos + status.erros;
        const pct = status.totalPedidos > 0 ? Math.round((totalProcessados / status.totalPedidos) * 100) : 0;

        const barEl = document.getElementById('lote-progress-bar');
        const pctEl = document.getElementById('lote-progress-pct');
        const statusEl = document.getElementById('lote-status-text');
        const sucessosEl = document.getElementById('lote-sucessos');
        const errosEl = document.getElementById('lote-erros');
        const blocoEl = document.getElementById('lote-bloco');

        if (barEl) barEl.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (sucessosEl) sucessosEl.textContent = status.sucessos;
        if (errosEl) errosEl.textContent = status.erros;
        if (blocoEl) blocoEl.textContent = status.totalBlocos > 0 ? `${status.blocoAtual}/${status.totalBlocos}` : '-';

        if (status.status === 'running') {
            if (statusEl) statusEl.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i> Processando bloco ${status.blocoAtual} de ${status.totalBlocos} — ${status.processadosNoBloco}/${status.tamanhoBloco} no bloco atual (${totalProcessados}/${status.totalPedidos} total)`;
        } else if (status.status === 'completed' || status.status === 'error') {
            // Finalizado!
            clearInterval(_lotePollingInterval);
            _lotePollingInterval = null;

            if (barEl) barEl.style.width = '100%';
            if (pctEl) pctEl.textContent = '100%';

            if (status.status === 'completed') {
                if (statusEl) statusEl.innerHTML = `<i class="fas fa-check-circle" style="color:#4CAF50;margin-right:6px;"></i> Processamento concluído! ${status.sucessos} com sucesso, ${status.erros} com erro.`;
                if (barEl) barEl.style.background = 'linear-gradient(90deg, #4CAF50, #66BB6A)';
            } else {
                if (statusEl) statusEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#f44336;margin-right:6px;"></i> Processamento encerrado com erro fatal.`;
                if (barEl) barEl.style.background = 'linear-gradient(90deg, #f44336, #e53935)';
            }

            // Mostra log de erros se houver
            if (status.logErros && status.logErros.length > 0) {
                const logContainer = document.getElementById('lote-log-container');
                const logErros = document.getElementById('lote-log-erros');
                if (logContainer && logErros) {
                    logContainer.style.display = 'block';
                    logErros.innerHTML = status.logErros.map(e => `<div style="margin-bottom:3px;"><span style="color:#ff9800;">NFe ${e.nfe}:</span> ${e.message}</div>`).join('');
                }
            }

            // Mostra botão fechar
            const btnFechar = document.getElementById('btn-lote-fechar');
            if (btnFechar) btnFechar.style.display = 'inline-block';

            // Recarrega as tabelas
            carregarGestaoConferencia();
            carregarDadosDashboard();
        }

    } catch (err) {
        console.error('Polling erro:', err);
    }
}

function fecharModalProgressoLote() {
    if (_lotePollingInterval) {
        clearInterval(_lotePollingInterval);
        _lotePollingInterval = null;
    }
    const overlay = document.getElementById('lote-progress-overlay');
    if (overlay) overlay.remove();
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
        () => alterarStatusEtiqueta(id, 'cancelamento')
    );
}

window.imprimirEtiquetaIndividual = async function (nfNumero) {
    if (!nfNumero || nfNumero === '-') {
        return ModalSystem.alert('NF não identificada para impressão.', 'Erro');
    }
    try {
        ModalSystem.showLoading('Buscando etiqueta...');
        const response = await fetch(`/etiquetas/download-individual/${nfNumero}`);
        ModalSystem.hideLoading();
        if (!response.ok) {
            throw new Error(response.status === 404 ? 'Etiqueta não encontrada nos arquivos armazenados.' : `Erro ${response.status}`);
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Etiqueta-NF-${nfNumero}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
    } catch (err) {
        ModalSystem.hideLoading();
        ModalSystem.alert(err.message, 'Erro ao Imprimir');
    }
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
    const btnRestante = document.getElementById('btn-exportar-tabela-restante');

    if (btnFull) {
        btnFull.addEventListener('click', () => solicitarPlanilhaDinamica('full'));
    }

    if (btnAgrupado) {
        btnAgrupado.addEventListener('click', () => solicitarPlanilhaDinamica('grouped'));
    }

    if (btnRestante) {
        btnRestante.addEventListener('click', () => solicitarPlanilhaDinamica('grouped-remaining'));
    }

    const btnImprimirPendencias = document.getElementById('btn-imprimir-pendencias');
    if (btnImprimirPendencias) {
        btnImprimirPendencias.addEventListener('click', imprimirPendenciasLote);
    }
}

async function solicitarPlanilhaDinamica(type) {
    if (!tabelaPendencias) return;

    // Obtém as linhas visíveis da tabela, já filtradas pela pesquisa e select!
    const dadosVisiveis = tabelaPendencias.rows({ search: 'applied' }).data().toArray();

    if (dadosVisiveis.length === 0) {
        ModalSystem.alert('A tabela atual não possui dados com os filtros aplicados para poder exportar.', 'Tabela Vazia');
        return;
    }

    const htmlStripper = /(<([^>]+)>)/gi;

    // Constrói o payload limpo das classes HTML
    const payloadExtraido = dadosVisiveis.map(row => {
        let pureSkus = row.sku;
        let skuArray = [];

        if (row.skusOriginal) {
            if (Array.isArray(row.skusOriginal)) {
                skuArray = row.skusOriginal.map(s => s.original || s.display || s);
                pureSkus = skuArray.join(', ');
            } else if (typeof row.skusOriginal === 'string') {
                try {
                    const parsed = JSON.parse(row.skusOriginal);
                    if (Array.isArray(parsed)) {
                        skuArray = parsed.map(s => s.original || s.display || s);
                        pureSkus = skuArray.join(', ');
                    } else {
                        skuArray = [row.skusOriginal];
                        pureSkus = row.skusOriginal;
                    }
                } catch (e) {
                    skuArray = [row.skusOriginal];
                    pureSkus = row.skusOriginal;
                }
            }
        } else {
            skuArray = [row.sku];
        }

        return {
            dataEntrada: row.dataEntrada ? row.dataEntrada.replace(htmlStripper, "").trim() : "",
            nota_fiscal: row.nfHtml ? row.nfHtml.replace(htmlStripper, "").trim() : "",
            pedido: row.pedidoId ? row.pedidoId.replace(htmlStripper, "").trim() : "",
            numero_loja: row.numeroLoja ? row.numeroLoja.replace(htmlStripper, "").trim() : "",
            skuArray: skuArray.map(s => s ? String(s).replace(htmlStripper, "").trim() : ""),
            sku: pureSkus ? pureSkus.replace(htmlStripper, "").trim() : "",
            status: row.statusBadge ? row.statusBadge.replace(htmlStripper, "").trim() : ""
        };
    });

    // Para o tipo 'grouped', verificar se existe gôndola disponível
    let gondolaId = null;
    if (type === 'grouped') {
        try {
            const gondolaRes = await fetch('/api/gondola/listar');
            const gondolaData = await gondolaRes.json();
            if (gondolaData.success && gondolaData.relatorios && gondolaData.relatorios.length > 0) {
                const ultimoGondola = gondolaData.relatorios[0];
                gondolaId = await new Promise((resolve) => {
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
                                Deseja usar este relatório para <strong>subtrair os itens já separados na gôndola</strong> da contagem?
                            </p>
                        </div>
                    `;
                    ModalSystem.confirm(
                        mensagem,
                        'Usar Relatório de Gôndola?',
                        function () { resolve(String(ultimoGondola.id)); },
                        function () { resolve(null); },
                        { confirmText: 'Sim, subtrair gôndola', cancelText: 'Não, ignorar' }
                    );
                });
            }
        } catch (err) {
            console.warn('[Contagem SKU] Não foi possível buscar relatórios de gôndola:', err);
        }
    }

    const bodyData = {
        tipo: type,
        linhas: payloadExtraido,
        gondolaId: gondolaId
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
        if (type === 'full') {
            a.download = 'Relatorio_Completo_Expedicao.xlsx';
        } else if (type === 'grouped') {
            a.download = 'Contagem_SKU_Agrupada.xlsx';
        } else if (type === 'grouped-remaining') {
            a.download = 'Faltantes_Ja_Separados.xlsx';
        }

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

    if (dadosVisiveis.length === 0) {
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

    if (nfsExtraidas.length === 0) {
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