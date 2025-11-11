document.addEventListener('DOMContentLoaded', function() {
    // Mapeamento dos elementos do formulário
    const elements = {
        form: document.getElementById('form-edit-assistencia'),
        produtosContainer: document.getElementById('produtos-container'),
        btnAddProduto: document.getElementById('btn-add-produto'),
        solicitanteSelect: document.getElementById('solicitante_id'),
        fabricaSelect: document.getElementById('fabrica_id'),
        btnAddSolicitante: document.getElementById('btn-add-solicitante'),
        btnAddFabrica: document.getElementById('btn-add-fabrica'),
        nfOrigemInput: document.getElementById('nf_origem')
    };

    // Pega o ID do solicitante que já está salvo na assistência (passado pelo Handlebars)
    const currentSolicitanteId = elements.solicitanteSelect.dataset.selected;
    const currentFabricaId = elements.fabricaSelect.dataset.selected;
    let produtoIndex = elements.produtosContainer.querySelectorAll('.produto-bloco').length;

    const serializeFormToJson = () => {
        const formData = new FormData(elements.form);
        const obj = {};
        for (let [key, value] of formData.entries()) {
            if (!key.startsWith('produtos')) {
                obj[key] = value;
            }
        }
        
        obj.produtos = [];
        const produtoBlocos = elements.produtosContainer.querySelectorAll('.produto-bloco');
        
        produtoBlocos.forEach(bloco => {
            const nomeProduto = bloco.querySelector('input[name*="[nome]"]')?.value;
            if (nomeProduto) {
                // [CORREÇÃO] Adicionada a leitura do campo 'volume_qualidade'
                const produto = {
                    nome: nomeProduto,
                    status_volume: bloco.dataset.statusVolume || 'Pendente',
                    volume_qualidade: bloco.querySelector('select[name*="[volume_qualidade]"]')?.value, // Lê o valor do seletor de qualidade
                    sku: bloco.querySelector('input[name*="[sku]"]')?.value,
                    pecas: []
                };
                
                const pecaInputs = bloco.querySelectorAll('input[name*="[pecas]"]');
                pecaInputs.forEach(input => {
                    if (input.value) produto.pecas.push(input.value);
                });
                obj.produtos.push(produto);
            }
        });
        return obj;
    };

    /**
     * Carrega a lista de solicitantes e seleciona o que já estava salvo.
     */
    const loadAndSetSolicitantes = async () => {
        try {
            const response = await fetch('/assistencias/api/solicitantes');
            if (!response.ok) throw new Error('Falha ao carregar solicitantes.');
            
            const solicitantes = await response.json();
            elements.solicitanteSelect.innerHTML = '<option value="" disabled>Selecione...</option>';
            
            solicitantes.forEach(s => {
                const option = new Option(s.nome, s.id);
                // Verifica se o ID do solicitante na lista é o mesmo salvo na assistência
                if (s.id == currentSolicitanteId) {
                    option.selected = true;
                }
                elements.solicitanteSelect.add(option);
            });
        } catch (error) {
            console.error(error);
            elements.solicitanteSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    };

    const loadAndSetFabricas = async () => {
        try {
            const response = await fetch('/assistencias/api/fabricas');
            if (!response.ok) throw new Error('Falha ao carregar fábricas.');
            
            const fabricas = await response.json();
            elements.fabricaSelect.innerHTML = '<option value="" disabled>Selecione...</option>';
            
            fabricas.forEach(s => {
                const option = new Option(s.nome, s.id);
                // Verifica se o ID do solicitante na lista é o mesmo salvo na assistência
                if (s.id == currentFabricaId) {
                    option.selected = true;
                }
                elements.fabricaSelect.add(option);
            });
        } catch (error) {
            console.error(error);
            elements.fabricaSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    };

    /**
     * Usa o ModalSystem.prompt para adicionar um novo solicitante.
     */
    const addNewSolicitante = () => {
        ModalSystem.prompt('Digite o nome do novo solicitante:', 'Adicionar Solicitante', async (nome) => {
            if (!nome || nome.trim() === '') return;
            try {
                const response = await fetch('/assistencias/api/solicitantes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome: nome.trim() })
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Falha ao salvar.');
                }
                const novoSolicitante = await response.json();
                const option = new Option(novoSolicitante.nome, novoSolicitante.id, true, true);
                elements.solicitanteSelect.add(option);
            } catch (error) {
                ModalSystem.alert(`Não foi possível adicionar. Erro: ${error.message}`, 'Erro');
            }
        });
    };

    const addNewFabrica = () => {
        ModalSystem.prompt('Digite o nome da nova fábrica:', 'Adicionar Fábrica', async (nome) => {
            if (!nome || nome.trim() === '') return;
            try {
                const response = await fetch('/assistencias/api/fabricas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome: nome.trim() })
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Falha ao salvar.');
                }
                const novaFabrica = await response.json();
                const option = new Option(novaFabrica.nome, novaFabrica.id, true, true);
                elements.fabricaSelect.add(option);
            } catch (error) {
                ModalSystem.alert(`Não foi possível adicionar. Erro: ${error.message}`, 'Erro');
            }
        });
    };

    // SUBSTITUA A FUNÇÃO 'handleSkuLookup' PELA VERSÃO ABAIXO
    const handleSkuLookup = async (inputElement) => {
        const sku = inputElement.value.trim();
        if (sku.length < 3) return;

        try {
            const productResponse = await fetch(`/assistencias/api/sku/${sku}`);
            if (!productResponse.ok) return;
            const productData = await productResponse.json();

            const structuresResponse = await fetch(`/assistencias/api/product-structures/${sku}`);
            const structuresData = structuresResponse.ok ? await structuresResponse.json() : [];

            let choiceHtml = `<p>O que você deseja adicionar para o SKU <strong>${sku}</strong>?</p>`;
            
            // [ESTILIZAÇÃO] HTML dos botões atualizado com btn-group e ícones
            let buttonsHtml = `<div class="d-flex justify-content-end mt-3 btn-group" role="group">
                <button id="modalBtnProduto" class="btn btn-outline-primary" title="Adicionar o produto como um volume único.">
                    <i class="fas fa-box me-1"></i> Produto (${productData.nome})
                </button>`;

            if (structuresData.length > 0) {
                buttonsHtml += `<button id="modalBtnEstrutura" class="btn btn-outline-secondary" title="Selecionar um componente da estrutura para este volume.">
                    <i class="fas fa-cogs me-1"></i> Selecionar Estrutura
                </button>`;
            } else {
                buttonsHtml += `<button class="btn btn-outline-secondary" disabled>
                    <i class="fas fa-cogs me-1"></i> Nenhuma Estrutura
                </button>`;
            }
            buttonsHtml += `</div>`;

            ModalSystem.alert(choiceHtml + buttonsHtml, 'Produto Encontrado', null, { hideDefaultButtons: true });

            document.getElementById('modalBtnProduto').addEventListener('click', () => {
                const blocoAtual = inputElement.closest('.produto-bloco');
                adicionarProduto({ nome: productData.nome, sku: productData.sku });
                if (blocoAtual) blocoAtual.remove();
                ModalSystem.hideLoading();
            });

            if (structuresData.length > 0) {
                document.getElementById('modalBtnEstrutura').addEventListener('click', () => {
                    let structureSelectionHtml = `<p>Selecione a estrutura desejada para o produto <strong>${productData.nome}</strong>:</p>
                        <select id="structure-select" class="form-select mt-2">`;
                    structuresData.forEach(s => {
                        structureSelectionHtml += `<option value="${s.structure_name}" data-sku="${s.component_sku}">${s.structure_name} (SKU: ${s.component_sku})</option>`;
                    });
                    structureSelectionHtml += `</select>`;

                    ModalSystem.confirm(
                        structureSelectionHtml,
                        'Selecionar Estrutura',
                        () => {
                            const select = document.getElementById('structure-select');
                            const selectedOption = select.options[select.selectedIndex];
                            const nomeEstrutura = selectedOption.value;
                            const skuEstrutura = selectedOption.dataset.sku;

                            const cardBody = inputElement.closest('.card-body');
                            cardBody.querySelector('input[name*="[nome]"]').value = nomeEstrutura;
                            cardBody.querySelector('input[name*="[sku]"]').value = skuEstrutura;
                            // O título agora é mais robusto para evitar erros se não encontrar o elemento
                            const titleEl = cardBody.querySelector('.card-title');
                            if(titleEl) {
                                const volumeNum = (parseInt(cardBody.closest('.produto-bloco').id.split('-').pop(), 10) + 1) || '';
                                titleEl.textContent = `Volume ${volumeNum} - SKU: ${skuEstrutura}`;
                            }
                        },
                        null,
                        { isHtml: true }
                    );
                });
            }

        } catch (error) {
            console.log('SKU não encontrado ou erro na busca, continuando digitação manual.', error);
        }
    };

    /*const initializeExistingProducts = () => {
        const produtoBlocos = elements.produtosContainer.querySelectorAll('.produto-bloco');
        produtoBlocos.forEach(bloco => {
            const totalVolumes = parseInt(bloco.dataset.totalVolumes, 10);
            const selectedVolume = bloco.dataset.selectedVolume;
            const statusVolume = bloco.dataset.statusVolume;

            const volumeSelect = bloco.querySelector('.volume-select');
            const statusSelect = bloco.querySelector('.status-volume-select');

            if (volumeSelect) {
                volumeSelect.innerHTML = ''; // Limpa o "Carregando..."
                for (let i = 1; i <= totalVolumes; i++) {
                    const option = new Option(i, i);
                    if (i == selectedVolume) {
                        option.selected = true;
                    }
                    volumeSelect.add(option);
                }
            }

            if (statusSelect && statusVolume) {
                statusSelect.value = statusVolume;
            }
        });
    };*/

    /**
     * Adiciona um bloco de HTML para um novo produto.
    **/
    function adicionarProduto(produtoData = { nome: '', sku: '', pecas: [] }) {
        const produtoId = produtoIndex++;
        // [CORREÇÃO] Garante que o nome do produto seja usado corretamente
        const nomeProduto = produtoData.nome || '';
        const skuProduto = produtoData.sku || '';

        const cardTitle = `Volume ${produtoId + 1}` + (skuProduto ? ` - SKU: ${skuProduto}` : '');

        const isEstoque = ['PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE'].includes(document.getElementById('descricao')?.value);
        let qualidadeHtml = '';
        if (isEstoque) {
            qualidadeHtml = `
            <div class="col-md-4" style="margin-top: 10px;">
                <label class="form-label">Qualidade do Volume</label>
                <select name="produtos[${produtoId}][volume_qualidade]" class="form-select form-select-sm">
                    <option value="Volume Bom" selected>Volume Bom</option>
                    <option value="Volume Ruim">Volume Ruim</option>
                </select>
            </div>`;
        }

        const produtoHTML = `
            <div class="card mb-3 produto-bloco" id="produto-bloco-${produtoId}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="card-title mb-0">${cardTitle}</h5>
                        <button type="button" class="btn btn-outline-danger btn-sm btn-remove-produto">Remover Volume</button>
                    </div>

                    <div class="row align-items-end">
                        <div class="col-md-6">
                            <label class="form-label">Nome do Produto (ou SKU) <span class="text-danger">*</span></label>
                            <input type="text" name="produtos[${produtoId}][nome]" class="form-control sku-lookup" value="${nomeProduto}" required>
                            <input type="hidden" name="produtos[${produtoId}][sku]" value="${skuProduto}">
                            <input type="hidden" name="produtos[${produtoId}][status_volume]" value="Pendente">
                        </div>
                        ${qualidadeHtml}
                    </div>
                    <div class="mt-3">
                        <label class="form-label">Peças</label>
                        <div class="pecas-container" id="pecas-container-${produtoId}"></div>
                        <button type="button" class="btn btn-outline-primary btn-sm mt-2 btn-add-peca" data-produto-id="${produtoId}">+ Peça</button>
                    </div>
                </div>
            </div>`;
        elements.produtosContainer.insertAdjacentHTML('beforeend', produtoHTML);
        
        adicionarPeca(produtoId);
    }

    /**
     * Adiciona um campo de input para uma nova peça.
     * @param {number} produtoId - O índice do produto pai.
     */
    function adicionarPeca(produtoId) {
        const pecasContainer = document.getElementById(`pecas-container-${produtoId}`);
        const pecaIndex = pecasContainer.children.length;
        const pecaHTML = `
            <div class="input-group mb-2 peca-item">
                <input type="text" name="produtos[${produtoId}][pecas][]" class="form-control" placeholder="Descreva a peça ${pecaIndex + 1}" required>
                <button class="btn btn-outline-danger btn-remove-peca" type="button">Remover Peça</button>
            </div>`;
        pecasContainer.insertAdjacentHTML('beforeend', pecaHTML);
    }

    function preencherFormularioComDadosNF(data) {
        document.getElementById('nome_pedido').value = data.nome_pedido || '';
        document.getElementById('documento_cliente').value = data.documento_cliente || '';
        document.getElementById('numero_pedido_venda').value = data.numero_pedido_venda || '';
        
        // Limpa o container de produtos caso o usuário queira adicionar manualmente depois
        elements.produtosContainer.innerHTML = '';
        produtoIndex = 0;
    }

    /**
     * Configura todos os listeners de eventos.
     */
    function setupEventListeners() {
        elements.produtosContainer.addEventListener('click', function(e) {
            const btnAddPeca = e.target.closest('.btn-add-peca');
            if (btnAddPeca) {
                adicionarPeca(btnAddPeca.dataset.produtoId);
            }
            if (e.target.closest('.btn-remove-peca')) {
                e.target.closest('.peca-item').remove();
            }
            if (e.target.closest('.btn-remove-produto')) {
                e.target.closest('.produto-bloco').remove();
            }
        });

        elements.btnAddProduto.addEventListener('click', adicionarProduto);
        elements.btnAddSolicitante.addEventListener('click', addNewSolicitante);
        elements.btnAddFabrica.addEventListener('click', addNewFabrica);

        elements.form.addEventListener('submit', function(e) {
            // Prepara os dados para serem enviados, mas deixa o navegador fazer o envio
            const formData = serializeFormToJson();

            // Limpa o container de produtos para não enviar dados duplicados da view
            elements.produtosContainer.innerHTML = '';

            // Adiciona os produtos serializados como campos hidden para serem enviados
            formData.produtos.forEach((produto, index) => {
                for (const key in produto) {
                    if (key !== 'pecas') {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = `produtos[${index}][${key}]`;
                        input.value = produto[key];
                        elements.form.appendChild(input);
                    }
                }
                produto.pecas.forEach(peca => {
                     const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = `produtos[${index}][pecas][]`;
                        input.value = peca;
                        elements.form.appendChild(input);
                });
            });
        });

        let nfDebounceTimer = null;
        elements.nfOrigemInput.addEventListener('keyup', function() {
            clearTimeout(nfDebounceTimer);
            const numeroNF = this.value.trim();
            if (numeroNF.length < 3) return;

            nfDebounceTimer = setTimeout(async () => {
                try {
                    const response = await fetch(`/assistencias/api/nf-origem/${numeroNF}`);
                    if (response.ok) {
                        const data = await response.json();
                        const htmlMessage = `NF encontrada para o cliente: <strong>${data.nome_pedido}</strong>.<br><br>Deseja importar os dados? <br><small>AVISO: Os produtos atuais serão substituídos.</small>`;
                        
                        ModalSystem.confirm(
                            htmlMessage,
                            'NF Encontrada',
                            () => { // onConfirm
                                preencherFormularioComDadosNF(data);
                            },
                            null, // onCancel
                            { isHtml: true }
                        );
                    }
                } catch (error) { 
                    console.error('Nenhuma NF encontrada ou erro na busca:', error); 
                }
            }, 800);
        });

        elements.produtosContainer.addEventListener('keyup', e => {
            if (e.target.classList.contains('sku-lookup')) {
                clearTimeout(e.target.debounceTimer);
                e.target.debounceTimer = setTimeout(() => handleSkuLookup(e.target), 800);
            }
        });

        elements.nfOrigemInput.addEventListener('input', function() {
            const value = this.value.replace(/\s+/g, '');
            if (value.length === 44 && /^\d+$/.test(value)) {
                const nfNumber = parseInt(value.substring(25, 34), 10).toString();
                this.value = nfNumber;
            }
        });
    }

    // --- Inicialização ---
    loadAndSetSolicitantes();
    loadAndSetFabricas();
    setupEventListeners();
});