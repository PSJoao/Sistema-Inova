document.addEventListener('DOMContentLoaded', () => {
    let gondolaItens = [];
    let hasUnsavedChanges = false;
    let editandoGondolaId = null;

    const inputCodigo = document.getElementById('codigo-bipagem');
    const formBipagem = document.getElementById('form-bipagem-gondola');
    const tbodyBipagem = document.querySelector('#tabela-bipagem-atual tbody');
    const btnSalvar = document.getElementById('btn-salvar-gondola');
    const spanBtnSalvar = btnSalvar.querySelector('span');
    const btnLimpar = document.getElementById('btn-limpar-gondola');
    const btnCancelarEdicao = document.getElementById('btn-cancelar-edicao');
    const badgeEditando = document.getElementById('badge-editando');
    const tituloPainelBipagem = document.getElementById('titulo-painel-bipagem');
    const nomeRelatorioEditando = document.getElementById('nome-relatorio-editando');
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
                if (typeof ToastSystem !== 'undefined') {
                    ToastSystem.success(`Bipado: ${data.estrutura.component_sku}`);
                }
            } else {
                if (typeof ToastSystem !== 'undefined') {
                    ToastSystem.error(`Erro: ${data.message}`);
                } else {
                    ModalSystem.alert(`Erro: ${data.message}`, 'Código não encontrado');
                }
            }
        } catch (error) {
            console.error('Erro na requisição:', error);
            if (typeof ToastSystem !== 'undefined') {
                ToastSystem.error('Erro de conexão ao buscar a estrutura.');
            } else {
                ModalSystem.alert('Erro de conexão ao buscar a estrutura.', 'Erro de Rede');
            }
        }
    });

    function adicionarItemNaMemoria(estrutura) {
        hasUnsavedChanges = true;
        const index = gondolaItens.findIndex(item => item.component_sku === estrutura.component_sku);
        
        if (index !== -1) {
            // Remove da posição atual e coloca no final para subir ao topo após o reverse()
            const item = gondolaItens.splice(index, 1)[0];
            item.quantidade += 1;
            gondolaItens.push(item);
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
                <td class="font-weight-bold align-middle" style="word-break: break-word; white-space: normal;">${item.component_sku}</td>
                <td class="align-middle" style="word-break: break-word; white-space: normal;">${item.structure_name}</td>
                <td class="text-center align-middle font-weight-bold" style="color: var(--accent-orange); font-size: 1rem;">${item.quantidade}</td>
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

    // Função para sair do modo de edição
    function sairModoEdicao() {
        editandoGondolaId = null;
        gondolaItens = [];
        hasUnsavedChanges = false;
        
        // Reseta UI
        btnCancelarEdicao.style.display = 'none';
        badgeEditando.style.display = 'none';
        tituloPainelBipagem.style.display = 'inline';
        spanBtnSalvar.textContent = 'Finalizar Relatório';
        btnSalvar.classList.remove('btn-warning');
        btnSalvar.classList.add('btn-primary');
        
        renderizarTabelaBipagem();
        inputCodigo.focus();
    }

    if(btnCancelarEdicao) {
        btnCancelarEdicao.addEventListener('click', () => {
            if (hasUnsavedChanges) {
                ModalSystem.confirm(
                    'Você tem alterações não salvas. Deseja cancelar a edição mesmo assim?',
                    'Cancelar Edição',
                    sairModoEdicao,
                    null,
                    { confirmText: 'Sim, cancelar', cancelText: 'Continuar editando' }
                );
            } else {
                sairModoEdicao();
            }
        });
    }

    // Botão Finalizar com ModalSystem
    btnSalvar.addEventListener('click', () => {
        if (gondolaItens.length === 0) {
            ModalSystem.alert('Você precisa bipar ao menos uma estrutura para criar um relatório.', 'Aviso');
            return;
        }

        ModalSystem.confirm(
            editandoGondolaId ? 'Salvar alterações neste relatório de gôndola?' : 'Finalizar e salvar este novo relatório de gôndola?',
            editandoGondolaId ? 'Confirmar Edição' : 'Confirmar Salvamento',
            async function() { // onConfirm
                btnSalvar.disabled = true;
                ModalSystem.showLoading(editandoGondolaId ? 'Atualizando relatório...' : 'Salvando relatório no sistema...', 'Aguarde');

                try {
                    let url = '/api/gondola/salvar';
                    let method = 'POST';
                    if (editandoGondolaId) {
                        url = `/api/gondola/${editandoGondolaId}`;
                        method = 'PUT';
                    }

                    const response = await fetch(url, {
                        method: method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ state_json: { itens: gondolaItens } })
                    });
                    const data = await response.json();
                    
                    ModalSystem.hideLoading();

                    if (data.success) {
                        ModalSystem.alert(editandoGondolaId ? 'Relatório atualizado com sucesso!' : 'Relatório de Gôndola salvo com sucesso!', 'Sucesso');
                        sairModoEdicao(); // Já limpa tudo e reseta UI
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
            // Data compacta: apenas dd/mm HH:MM para caber na coluna
            const d = new Date(rel.created_at);
            const dataCriacao = `${d.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'})} ${d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}`;
            const badgeRecente = indexGeral === 0 ? '<span class="badge badge-success ml-1" style="font-size:0.65rem;">Recente</span>' : '';
            
            // Botão de editar apenas para o mais recente (indexGeral === 0)
            const btnEditarHTML = indexGeral === 0 ? `
                <button class="btn-action btn-action-warning btn-editar" data-id="${rel.id}" data-json='${JSON.stringify(rel.state_json.itens)}' data-nome="${rel.nome}" title="Editar Relatório">
                    <i class="fas fa-edit"></i>
                </button>
            ` : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-weight-bold align-middle" style="color: #fff; word-break: break-word; white-space: normal;">${rel.nome} ${badgeRecente}</td>
                <td class="align-middle" style="font-size: 0.82rem; color: var(--text-secondary); white-space: nowrap;">${dataCriacao}</td>
                <td class="align-middle" style="text-align: center; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: center;">
                        ${btnEditarHTML}
                        <button class="btn-action btn-action-success btn-exportar" data-json='${JSON.stringify(rel.state_json.itens)}' data-nome="${rel.nome}" title="Exportar Excel">
                            <i class="fas fa-file-excel"></i>
                        </button>
                        <button class="btn-action btn-action-danger btn-excluir" data-id="${rel.id}" title="Excluir Relatório">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            `;
            tbodyHistorico.appendChild(tr);
        });

        document.querySelectorAll('.btn-editar').forEach(btn => btn.addEventListener('click', entrarModoEdicao));
        document.querySelectorAll('.btn-exportar').forEach(btn => btn.addEventListener('click', exportarParaExcel));
        document.querySelectorAll('.btn-excluir').forEach(btn => btn.addEventListener('click', excluirRelatorio));

        renderizarPaginadores(totalPaginas);
    }

    function entrarModoEdicao(e) {
        const btn = e.currentTarget;
        const id = btn.getAttribute('data-id');
        const nome = btn.getAttribute('data-nome');
        const itensStr = btn.getAttribute('data-json');

        const iniciarEdicao = () => {
            editandoGondolaId = id;
            gondolaItens = JSON.parse(itensStr) || [];
            hasUnsavedChanges = false;

            // Atualiza UI
            tituloPainelBipagem.style.display = 'none';
            badgeEditando.style.display = 'inline-block';
            nomeRelatorioEditando.textContent = nome;
            btnCancelarEdicao.style.display = 'inline-block';
            
            spanBtnSalvar.textContent = 'Salvar Alterações';
            btnSalvar.classList.remove('btn-primary');
            btnSalvar.classList.add('btn-warning');

            renderizarTabelaBipagem();
            inputCodigo.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        if (hasUnsavedChanges || gondolaItens.length > 0) {
            ModalSystem.confirm(
                'Você tem uma bipagem em andamento que não foi salva. Deseja descartá-la para editar o relatório selecionado?',
                'Atenção',
                iniciarEdicao,
                null,
                { confirmText: 'Sim, descartar e editar', cancelText: 'Cancelar' }
            );
        } else {
            iniciarEdicao();
        }
    }

    function renderizarPaginadores(totalPaginas) {
        if(!ulPaginacao) return;
        ulPaginacao.innerHTML = '';
        if(totalPaginas <= 1) return;

        ulPaginacao.innerHTML = `
            <button type="button" class="btn btn-sm btn-outline-warning" onclick="mudarPaginaHistorico(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
            <span style="color: #aaa; align-self: center; font-size: 0.9rem;">Página ${currentPage} de ${totalPaginas}</span>
            <button type="button" class="btn btn-sm btn-outline-warning" onclick="mudarPaginaHistorico(${currentPage + 1})" ${currentPage === totalPaginas ? 'disabled' : ''}>Próxima</button>
        `;
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