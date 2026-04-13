document.addEventListener('DOMContentLoaded', () => {
    let gondolaItens = [];
    let hasUnsavedChanges = false;

    const inputCodigo = document.getElementById('codigo-bipagem');
    const formBipagem = document.getElementById('form-bipagem-gondola');
    const tbodyBipagem = document.querySelector('#tabela-bipagem-atual tbody');
    const btnSalvar = document.getElementById('btn-salvar-gondola');
    const btnLimpar = document.getElementById('btn-limpar-gondola');
    const tbodyHistorico = document.querySelector('#tabela-historico-gondola tbody');

    // Carrega histórico inicial
    carregarHistorico();

    window.addEventListener('beforeunload', function (e) {
        if (hasUnsavedChanges && gondolaItens.length > 0) {
            const msg = 'Você tem uma bipagem de gôndola em andamento. Se sair, perderá tudo. Deseja sair?';
            e.returnValue = msg;
            return msg;
        }
    });

    // Submissão da bipagem
    formBipagem.addEventListener('submit', async (e) => {
        e.preventDefault();
        const codigo = inputCodigo.value.trim();
        if (!codigo) return;

        inputCodigo.value = '';
        inputCodigo.focus();

        try {
            const response = await fetch('/api/gondola/buscar-estrutura', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ codigoBipado: codigo })
            });
            const data = await response.json();

            if (data.success) {
                adicionarItemNaMemoria(data.estrutura);
            } else {
                ModalSystem.alert(`Erro: ${data.message}`, 'Código não encontrado');
            }
        } catch (error) {
            console.error('Erro na requisição:', error);
            ModalSystem.alert('Erro de conexão ao buscar a estrutura.', 'Erro de Rede');
        }
    });

    function adicionarItemNaMemoria(estrutura) {
        hasUnsavedChanges = true;
        const index = gondolaItens.findIndex(item => item.component_sku === estrutura.component_sku);
        
        if (index !== -1) {
            gondolaItens[index].quantidade += 1; 
        } else {
            gondolaItens.push({
                component_sku: estrutura.component_sku,
                structure_name: estrutura.structure_name,
                quantidade: 1
            });
        }
        renderizarTabelaBipagem();
    }

    function renderizarTabelaBipagem() {
        tbodyBipagem.innerHTML = '';
        if (gondolaItens.length === 0) {
            tbodyBipagem.innerHTML = '<tr id="linha-vazia"><td colspan="3" class="text-center text-muted py-5">Nenhum item bipado ainda.</td></tr>';
            return;
        }

        [...gondolaItens].reverse().forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-weight-bold align-middle">${item.component_sku}</td>
                <td class="align-middle">${item.structure_name}</td>
                <td class="text-center align-middle h5 mb-0 text-primary font-weight-bold">${item.quantidade}</td>
            `;
            tbodyBipagem.appendChild(tr);
        });
    }

    // Botão Limpar com ModalSystem
    btnLimpar.addEventListener('click', () => {
        if (gondolaItens.length === 0) return;
        
        ModalSystem.confirm(
            'Tem certeza que deseja limpar e perder toda a bipagem atual?',
            'Atenção',
            function() { // onConfirm
                gondolaItens = [];
                hasUnsavedChanges = false;
                renderizarTabelaBipagem();
                inputCodigo.focus();
            },
            null, // onCancel
            { confirmText: 'Sim, limpar tudo', cancelText: 'Cancelar' }
        );
    });

    // Botão Finalizar com ModalSystem
    btnSalvar.addEventListener('click', () => {
        if (gondolaItens.length === 0) {
            ModalSystem.alert('Você precisa bipar ao menos uma estrutura para criar um relatório.', 'Aviso');
            return;
        }

        ModalSystem.confirm(
            'Finalizar e salvar este relatório de gôndola?',
            'Confirmar Salvamento',
            async function() { // onConfirm
                btnSalvar.disabled = true;
                ModalSystem.showLoading('Salvando relatório no sistema...', 'Aguarde');

                try {
                    const response = await fetch('/api/gondola/salvar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ state_json: { itens: gondolaItens } })
                    });
                    const data = await response.json();
                    
                    ModalSystem.hideLoading();

                    if (data.success) {
                        gondolaItens = [];
                        hasUnsavedChanges = false;
                        renderizarTabelaBipagem();
                        ModalSystem.alert('Relatório de Gôndola salvo com sucesso!', 'Sucesso');
                        carregarHistorico();
                    } else {
                        ModalSystem.alert(`Erro ao salvar: ${data.message}`, 'Erro');
                    }
                } catch (error) {
                    console.error('Erro:', error);
                    ModalSystem.hideLoading();
                    ModalSystem.alert('Erro de conexão ao salvar.', 'Erro de Rede');
                } finally {
                    btnSalvar.disabled = false;
                    inputCodigo.focus();
                }
            },
            null,
            { confirmText: 'Salvar Relatório', cancelText: 'Cancelar' }
        );
    });

    // Variáveis Globais de Paginação
    let relatoriosHistorico = [];
    let currentPage = 1;
    const itensPorPagina = 10;
    const ulPaginacao = document.getElementById('paginacao-historico');

    // Carregar histórico remotamente
    async function carregarHistorico() {
        try {
            const response = await fetch('/api/gondola/listar');
            const data = await response.json();

            if (data.success && data.relatorios.length > 0) {
                relatoriosHistorico = data.relatorios;
                renderizarPaginaHistorico();
            } else {
                relatoriosHistorico = [];
                tbodyHistorico.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-5">Nenhum relatório salvo no histórico.</td></tr>';
                if(ulPaginacao) ulPaginacao.innerHTML = '';
            }
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
        }
    }

    window.mudarPaginaHistorico = function(pagina) {
        currentPage = pagina;
        renderizarPaginaHistorico();
    };

    function renderizarPaginaHistorico() {
        tbodyHistorico.innerHTML = '';
        
        const totalPaginas = Math.ceil(relatoriosHistorico.length / itensPorPagina);
        if (currentPage > totalPaginas && totalPaginas > 0) currentPage = totalPaginas;
        
        const start = (currentPage - 1) * itensPorPagina;
        const end = start + itensPorPagina;
        const paginatedItems = relatoriosHistorico.slice(start, end);

        paginatedItems.forEach((rel, index) => {
            const indexGeral = start + index;
            const dataCriacao = new Date(rel.created_at).toLocaleString('pt-BR');
            const badgeRecente = indexGeral === 0 ? '<span class="badge badge-success ml-2">Mais Recente</span>' : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-weight-bold text-primary pl-4 align-middle">${rel.nome} ${badgeRecente}</td>
                <td class="align-middle">${dataCriacao}</td>
                <td class="text-center pr-4 align-middle">
                    <button class="btn btn-sm btn-outline-success btn-exportar" data-json='${JSON.stringify(rel.state_json.itens)}' data-nome="${rel.nome}" title="Exportar Excel">
                        <i class="fas fa-file-excel"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-excluir ml-1" data-id="${rel.id}" title="Excluir Relatório">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            `;
            tbodyHistorico.appendChild(tr);
        });

        document.querySelectorAll('.btn-exportar').forEach(btn => btn.addEventListener('click', exportarParaExcel));
        document.querySelectorAll('.btn-excluir').forEach(btn => btn.addEventListener('click', excluirRelatorio));

        renderizarPaginadores(totalPaginas);
    }

    function renderizarPaginadores(totalPaginas) {
        if(!ulPaginacao) return;
        ulPaginacao.innerHTML = '';
        if(totalPaginas <= 1) return;

        // Botão Anterior
        const liPrev = document.createElement('li');
        liPrev.className = `page-item ${currentPage === 1 ? 'disabled' : ''}`;
        liPrev.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="mudarPaginaHistorico(${currentPage - 1})">Anterior</a>`;
        ulPaginacao.appendChild(liPrev);

        // Numeros
        for (let i = 1; i <= totalPaginas; i++) {
            const liNum = document.createElement('li');
            liNum.className = `page-item ${currentPage === i ? 'active' : ''}`;
            liNum.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="mudarPaginaHistorico(${i})">${i}</a>`;
            ulPaginacao.appendChild(liNum);
        }

        // Botão Próximo
        const liNext = document.createElement('li');
        liNext.className = `page-item ${currentPage === totalPaginas ? 'disabled' : ''}`;
        liNext.innerHTML = `<a class="page-link" href="javascript:void(0)" onclick="mudarPaginaHistorico(${currentPage + 1})">Próxima</a>`;
        ulPaginacao.appendChild(liNext);
    }

    // Excluir com ModalSystem
    function excluirRelatorio(e) {
        const id = e.currentTarget.getAttribute('data-id');
        
        ModalSystem.confirm(
            'Deseja excluir definitivamente este relatório do histórico?',
            'Excluir Relatório',
            async function() { // onConfirm
                ModalSystem.showLoading('Excluindo relatório...', 'Aguarde');
                try {
                    const response = await fetch(`/api/gondola/${id}`, { method: 'DELETE' });
                    const data = await response.json();
                    ModalSystem.hideLoading();
                    
                    if (data.success) {
                        carregarHistorico();
                    } else {
                        ModalSystem.alert(`Erro ao excluir: ${data.message}`, 'Erro');
                    }
                } catch (error) {
                    ModalSystem.hideLoading();
                    console.error('Erro:', error);
                    ModalSystem.alert('Erro de conexão ao tentar excluir.', 'Erro de Rede');
                }
            },
            null,
            { confirmText: 'Sim, excluir', cancelText: 'Cancelar' }
        );
    }

    function exportarParaExcel(e) {
        const btn = e.currentTarget;
        const itens = JSON.parse(btn.getAttribute('data-json'));
        const nomeArquivo = btn.getAttribute('data-nome');

        const dadosPlanilha = itens.map(item => ({
            "SKU da Estrutura": item.component_sku,
            "Nome do Componente": item.structure_name,
            "Quantidade Gôndola": item.quantidade
        }));

        const worksheet = XLSX.utils.json_to_sheet(dadosPlanilha);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Itens Gôndola");

        XLSX.writeFile(workbook, `${nomeArquivo}.xlsx`);
    }

    // ==========================================
    // MÓDULO EXCEL: JÁ SEPARADOS
    // ==========================================
    const formExcel = document.getElementById('form-excel-separados');
    const inputExcel = document.getElementById('excel-separados-file');
    const nomeArquivoExcel = document.getElementById('nome-arquivo-excel');
    const btnEnviarExcel = document.getElementById('btn-enviar-excel');
    const areaPin = document.getElementById('area-pin-excel');
    const pinDisplay = document.getElementById('pin-display');

    if (inputExcel) {
        inputExcel.addEventListener('change', function() {
            if (this.files.length > 0) {
                nomeArquivoExcel.textContent = `Arquivo: ${this.files[0].name}`;
            } else {
                nomeArquivoExcel.textContent = '';
            }
        });
    }

    if (formExcel) {
        formExcel.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!inputExcel.files || inputExcel.files.length === 0) {
                ModalSystem.alert('Por favor, selecione um arquivo Excel primeiro.', 'Aviso');
                return;
            }

            const formData = new FormData();
            formData.append('excelFile', inputExcel.files[0]);

            btnEnviarExcel.disabled = true;
            // Removemos o areaPin.style.display = 'none'; pois o PIN fica sempre visível
            ModalSystem.showLoading('Processando planilha...', 'Aguarde');

            try {
                const response = await fetch('/api/separados-excel/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
                
                const data = await response.json();
                ModalSystem.hideLoading();

                if (data.success) {
                    ModalSystem.alert(data.message, 'Upload Concluído');
                    // O PIN já está no ecrã e não muda (gerido pelo cron), logo não precisamos de o injetar aqui
                    formExcel.reset();
                    nomeArquivoExcel.textContent = '';
                } else {
                    ModalSystem.alert(`Erro: ${data.message}`, 'Falha no Upload');
                }
            } catch (error) {
                ModalSystem.hideLoading();
                console.error('Erro no upload do Excel:', error);
                ModalSystem.alert('Erro de conexão ao enviar o arquivo Excel.', 'Erro de Rede');
            } finally {
                btnEnviarExcel.disabled = false;
            }
        });
    }
});