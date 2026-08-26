document.addEventListener('DOMContentLoaded', () => {
    let globalData = [];
    const tableBody = document.getElementById('table-body');
    const inputDiasEstoque = document.getElementById('inputDiasEstoque');
    const filtroFornecedor = document.getElementById('filtroForncedor');
    const buscaGeral = document.getElementById('buscaGeral');
    
    // Configurações Modais
    const modalVendas = document.getElementById('modalVendas');
    const modalVendasOverlay = document.getElementById('modalVendasOverlay');
    const modalPedidos = document.getElementById('modalPedidos');
    const modalPedidosOverlay = document.getElementById('modalPedidosOverlay');

    init();

    function init() {
        carregarDados();
        
        // Event Listeners Globais
        inputDiasEstoque.addEventListener('input', renderTable);
        filtroFornecedor.addEventListener('change', carregarDados);
        buscaGeral.addEventListener('input', renderTable);

        // Upload de Vendas
        document.getElementById('btnImportarVendas').addEventListener('click', () => abrirModal(modalVendas, modalVendasOverlay));
        document.querySelectorAll('.fechar-modal-vendas').forEach(btn => btn.addEventListener('click', () => fecharModal(modalVendas, modalVendasOverlay)));
        document.getElementById('btnConfirmarUpload').addEventListener('click', handleUploadVendas);

        // Geração de Pedidos
        document.getElementById('btnGeracaoPedidos').addEventListener('click', () => abrirModal(modalPedidos, modalPedidosOverlay));
        document.querySelectorAll('.fechar-modal-pedidos').forEach(btn => btn.addEventListener('click', () => fecharModal(modalPedidos, modalPedidosOverlay)));
        document.getElementById('modalFiltroFornecedor').addEventListener('change', carregarItensPedido);
        document.getElementById('checkAllPedidos').addEventListener('change', toggleAllCheckboxes);
        document.getElementById('btnGerarPdfPedido').addEventListener('click', gerarPdfPedido);
    }

    async function carregarDados() {
        try {
            tableBody.innerHTML = '<tr><td colspan="13" class="text-center py-4"><div class="modal-spinner" style="display: inline-block;"></div> Carregando...</td></tr>';
            const fornecedorId = filtroFornecedor.value;
            let url = '/analise-compras/api/produtos';
            if (fornecedorId) url += `?fornecedorId=${fornecedorId}`;

            const res = await fetch(url);
            const json = await res.json();
            
            if (json.success) {
                globalData = json.data;
                renderTable();
            } else {
                tableBody.innerHTML = `<tr><td colspan="13" class="text-center text-danger">${json.message}</td></tr>`;
            }
        } catch (err) {
            console.error('Erro ao carregar produtos:', err);
            tableBody.innerHTML = `<tr><td colspan="13" class="text-center text-danger">Erro de conexão.</td></tr>`;
        }
    }

    function renderTable() {
        const diasEstoque = parseInt(inputDiasEstoque.value, 10) || 0;
        const termoBusca = buscaGeral.value.toLowerCase();
        
        tableBody.innerHTML = '';

        const filtrados = globalData.filter(p => {
            if (!termoBusca) return true;
            return p.produto_nome.toLowerCase().includes(termoBusca) || String(p.parent_product_bling_id).includes(termoBusca);
        });

        if (filtrados.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="13" class="text-center py-4 text-muted">Nenhum produto encontrado.</td></tr>`;
            return;
        }

        filtrados.forEach(p => {
            const estoque = parseInt(p.estoque_atual) || 0;
            const chegando = parseInt(p.chegando) || 0;
            const v3 = parseInt(p.vendas_3d) || 0;
            const v7 = parseInt(p.vendas_7d) || 0;
            const v15 = parseInt(p.vendas_15d) || 0;
            const v30 = parseInt(p.vendas_30d) || 0;

            const est15 = v15 * 2;
            const est7 = Math.round((v7 / 7) * 30);
            const est3 = v3 * 10;
            
            const media = Math.round((v30 + est15 + est7 + est3) / 4);
            const mediaDiaria = media / 30;

            let sugestao = 0;
            let tempoEst = 0;

            if (diasEstoque > 0) {
                sugestao = Math.round((mediaDiaria * diasEstoque) - estoque - chegando);
            }

            if (mediaDiaria > 0) {
                tempoEst = Math.round((estoque + chegando) / mediaDiaria);
            } else {
                tempoEst = '∞';
            }

            const tr = document.createElement('tr');
            
            let sugestaoHtml = '-';
            if (diasEstoque > 0) {
                if (sugestao > 0) {
                    sugestaoHtml = `<span class="sugestao-positiva">+${sugestao}</span>`;
                } else {
                    sugestaoHtml = `<span class="sugestao-negativa">${sugestao}</span>`;
                }
            }

            tr.innerHTML = `
                <td style="white-space: normal; font-size: 0.85rem;" title="${p.fornecedor_nome || 'Sem Fornecedor'}">
                    <strong>${p.produto_nome}</strong>
                    <div style="font-size: 0.75rem; color: #888;">ID: ${p.parent_product_bling_id}</div>
                </td>
                <td class="text-center align-middle">${estoque}</td>
                <td class="text-center align-middle">
                    <input type="number" class="input-chegando" data-id="${p.parent_product_bling_id}" value="${chegando}" min="0">
                </td>
                <td class="text-center align-middle col-venda-real">${v3}</td>
                <td class="text-center align-middle col-venda-real">${v7}</td>
                <td class="text-center align-middle col-venda-real">${v15}</td>
                <td class="text-center align-middle col-venda-real">${v30}</td>
                
                <td class="text-center align-middle col-venda-estimada">${est3}</td>
                <td class="text-center align-middle col-venda-estimada">${est7}</td>
                <td class="text-center align-middle col-venda-estimada">${est15}</td>
                
                <td class="text-center align-middle font-weight-bold">${media}</td>
                <td class="text-center align-middle">${sugestaoHtml}</td>
                <td class="text-center align-middle">${tempoEst}</td>
            `;

            tableBody.appendChild(tr);
        });

        // Adicionar eventos para o input chegando
        document.querySelectorAll('.input-chegando').forEach(input => {
            input.addEventListener('change', handleChegandoChange);
        });
    }

    async function handleChegandoChange(e) {
        const id = e.target.getAttribute('data-id');
        const novoValor = parseInt(e.target.value) || 0;
        
        // Atualizar o array local
        const p = globalData.find(item => String(item.parent_product_bling_id) === String(id));
        if (p) p.chegando = novoValor;
        
        // Renderizar para atualizar matemática
        renderTable();

        // Persistir no banco de dados
        try {
            const res = await fetch('/analise-compras/atualizar-chegando', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_product_bling_id: id, chegando: novoValor })
            });
            const json = await res.json();
            if (!json.success) alert('Erro ao salvar chegando: ' + json.message);
        } catch (err) {
            console.error('Erro de conexão ao atualizar chegando', err);
        }
    }

    // --- UPLOAD VENDAS ---
    async function handleUploadVendas(e) {
        e.preventDefault();
        const inputs = document.querySelectorAll('.input-venda-file');
        const formData = new FormData();
        const periodos = [];

        let invalid = false;
        inputs.forEach(input => {
            if (!input.files || input.files.length === 0) {
                invalid = true;
            } else {
                formData.append('files', input.files[0]);
                periodos.push(input.getAttribute('data-periodo'));
            }
        });

        if (invalid || periodos.length !== 4) {
            alert('Por favor, selecione os 4 arquivos corretamente.');
            return;
        }

        formData.append('periodos', JSON.stringify(periodos));

        const spinner = document.getElementById('importVendasSpinner');
        const statusMsg = document.getElementById('importVendasStatusMsg');
        const btn = document.getElementById('btnConfirmarUpload');
        
        btn.disabled = true;
        spinner.style.display = 'block';
        statusMsg.style.display = 'block';
        statusMsg.innerText = 'Enviando arquivos...';
        statusMsg.style.color = '#ccc';

        try {
            const res = await fetch('/analise-compras/upload-vendas', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();
            
            if (json.success) {
                statusMsg.innerText = 'Processado com sucesso!';
                statusMsg.style.color = '#4caf50';
                setTimeout(() => {
                    fecharModal(modalVendas, modalVendasOverlay);
                    carregarDados(); // Recarrega os dados com as novas vendas
                }, 1500);
            } else {
                statusMsg.innerText = 'Erro: ' + json.message;
                statusMsg.style.color = '#f44336';
                btn.disabled = false;
            }
        } catch (err) {
            statusMsg.innerText = 'Erro interno do servidor';
            statusMsg.style.color = '#f44336';
            btn.disabled = false;
        } finally {
            spinner.style.display = 'none';
        }
    }

    // --- GERAÇÃO DE PEDIDOS ---
    function carregarItensPedido() {
        const idFornecedor = document.getElementById('modalFiltroFornecedor').value;
        const divLista = document.getElementById('areaListaProdutosPedido');
        const tbody = document.getElementById('tbodyProdutosPedido');
        const btn = document.getElementById('btnGerarPdfPedido');
        
        if (!idFornecedor) {
            divLista.style.display = 'none';
            btn.disabled = true;
            return;
        }

        const produtos = globalData.filter(p => String(p.fornecedor_id) === String(idFornecedor));
        const diasEstoque = parseInt(inputDiasEstoque.value, 10) || 0;

        tbody.innerHTML = '';
        
        if (produtos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">Nenhum produto encontrado.</td></tr>';
            btn.disabled = true;
        } else {
            produtos.forEach(p => {
                const estoque = parseInt(p.estoque_atual) || 0;
                const chegando = parseInt(p.chegando) || 0;
                const media = Math.round(((parseInt(p.vendas_30d) || 0) + ((parseInt(p.vendas_15d) || 0)*2) + (((parseInt(p.vendas_7d) || 0)/7)*30) + ((parseInt(p.vendas_3d) || 0)*10)) / 4);
                let sugestao = 0;
                if (diasEstoque > 0) {
                    sugestao = Math.round(((media/30) * diasEstoque) - estoque - chegando);
                }
                
                // Só marcamos produtos que tem sugestão de comprar, por ex
                const defaultQtd = sugestao > 0 ? sugestao : 0;
                
                tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><input type="checkbox" class="check-pedido-item" value="${p.parent_product_bling_id}"></td>
                    <td style="font-size: 0.85rem;">${p.produto_nome}</td>
                    <td>
                        <input type="number" class="form-control form-control-sm input-qtd-pedido" data-id="${p.parent_product_bling_id}" value="${defaultQtd}" min="0">
                    </td>
                `;
                tbody.appendChild(tr);
            });
            btn.disabled = false;
        }
        
        divLista.style.display = 'block';
    }

    function toggleAllCheckboxes() {
        const isChecked = document.getElementById('checkAllPedidos').checked;
        document.querySelectorAll('.check-pedido-item').forEach(c => c.checked = isChecked);
    }

    async function gerarPdfPedido() {
        const idFornecedor = document.getElementById('modalFiltroFornecedor').value;
        const checks = document.querySelectorAll('.check-pedido-item:checked');
        
        if (!idFornecedor) return alert('Selecione um fornecedor.');
        if (checks.length === 0) return alert('Selecione ao menos um produto.');

        const items = [];
        checks.forEach(c => {
            const id = c.value;
            const qtdInput = document.querySelector(`.input-qtd-pedido[data-id="${id}"]`);
            items.push({ id_produto: id, quantidade: parseInt(qtdInput.value) || 0 });
        });

        try {
            const res = await fetch('/analise-compras/gerar-pedido', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fornecedor_id: idFornecedor, items })
            });
            const json = await res.json();
            
            if (json.success) {
                alert('Pedido engatilhado com sucesso!');
                fecharModal(modalPedidos, modalPedidosOverlay);
            } else {
                alert('Erro: ' + json.message);
            }
        } catch (err) {
            console.error('Erro ao gerar pedido:', err);
            alert('Erro de conexão ao gerar pedido.');
        }
    }

    // --- UTILS ---
    function abrirModal(modal, overlay) {
        modal.style.display = 'block';
        overlay.style.display = 'block';
    }

    function fecharModal(modal, overlay) {
        modal.style.display = 'none';
        overlay.style.display = 'none';
    }
});
