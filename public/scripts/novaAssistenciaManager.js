document.addEventListener('DOMContentLoaded', function() {
    // Mapeamento dos elementos do formulário
    const elements = {
        form: document.getElementById('form-nova-assistencia'),
        produtosContainer: document.getElementById('produtos-container'),
        btnAddProduto: document.getElementById('btn-add-produto'),
        nfOrigemInput: document.getElementById('nf_origem'),
        solicitanteSelect: document.getElementById('solicitante_id'),
        fabricaSelect: document.getElementById('fabrica_id'),
        btnAddSolicitante: document.getElementById('btn-add-solicitante'),
        btnAddFabrica: document.getElementById('btn-add-fabrica'),
        dataSolicitacaoInput: document.getElementById('data_solicitacao')
    };

    let produtoIndex = 0;
    let nfDebounceTimer = null;

    /**
     * Carrega a lista de solicitantes da API e popula o select.
     */
    const loadSolicitantes = async () => {
        try {
            const response = await fetch('/assistencias/api/solicitantes');
            if (!response.ok) throw new Error('Falha ao carregar solicitantes.');
            
            const solicitantes = await response.json();
            elements.solicitanteSelect.innerHTML = '<option value="" disabled selected>Selecione um solicitante...</option>';
            solicitantes.forEach(s => {
                const option = new Option(s.nome, s.id);
                elements.solicitanteSelect.add(option);
            });
        } catch (error) {
            console.error(error);
            elements.solicitanteSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    };

    const showSuccessModal = (assistenciaId, hasNf) => {
        let buttonsHTML = '';

        // Adiciona o botão de PDF
        buttonsHTML += `<a href="/assistencias/pdf/${assistenciaId}" target="_blank" class="btn btn-success-alt">
                            <i class="fas fa-file-pdf me-2"></i>Gerar PDF
                        </a>`;

        const messageHTML = `
            <p>A assistência #${assistenciaId} foi cadastrada com sucesso!</p>
            <p>O que você gostaria de fazer agora?</p>
            <div style="margin-top: 20px;">
                ${buttonsHTML}
            </div>
        `;

        // Usa o seu ModalSystem.alert para exibir o conteúdo HTML
        ModalSystem.alert(
            messageHTML, 
            'Sucesso!', 
            () => {
                // Quando o usuário clicar em "OK" (o único botão do alert), redireciona para a lista.
                window.location.href = '/assistencias';
            }
        );
    };

    const serializeFormToJson = () => {
        const formData = new FormData(elements.form);
        const obj = {};
        formData.forEach((value, key) => {
            if (!key.startsWith('produtos')) {
                obj[key] = value;
            }
        });

        obj.produtos = [];
        const produtoBlocos = elements.produtosContainer.querySelectorAll('.produto-bloco');
        
        produtoBlocos.forEach(bloco => {
            const nomeProduto = bloco.querySelector('input[name*="[nome]"]')?.value;
            if (nomeProduto) {
                // [CORREÇÃO] Captura correta do valor de 'volume_qualidade'
                const qualidadeSelect = bloco.querySelector('select[name*="[volume_qualidade]"]');
                const produto = {
                    nome: nomeProduto,
                    status_volume: bloco.querySelector('input[name*="[status_volume]"]')?.value || 'Pendente',
                    volume_qualidade: qualidadeSelect ? qualidadeSelect.value : null, // Garante que o valor seja enviado
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

    const loadFabricas = async () => {
        try {
            const response = await fetch('/assistencias/api/fabricas');
            if (!response.ok) throw new Error('Falha ao carregar fábricas.');
            
            const fabricas = await response.json();
            elements.fabricaSelect.innerHTML = '<option value="" disabled selected>Selecione uma fábrica...</option>';
            fabricas.forEach(s => {
                const option = new Option(s.nome, s.id);
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
                    throw new Error(errorData.message || 'Falha ao salvar novo solicitante.');
                }

                const novoSolicitante = await response.json();
                
                const option = new Option(novoSolicitante.nome, novoSolicitante.id, true, true);
                elements.solicitanteSelect.add(option);

            } catch (error) {
                console.error(error);
                ModalSystem.alert(`Não foi possível adicionar o solicitante. Erro: ${error.message}`, 'Erro');
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
                    throw new Error(errorData.message || 'Falha ao salvar nova fábrica.');
                }

                const novaFabrica = await response.json();
                
                const option = new Option(novaFabrica.nome, novaFabrica.id, true, true);
                elements.fabricaSelect.add(option);

            } catch (error) {
                console.error(error);
                ModalSystem.alert(`Não foi possível adicionar a fábrica. Erro: ${error.message}`, 'Erro');
            }
        });
    };

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

    /**
     * Adiciona um bloco de HTML para um novo produto.
     * @param {object} produtoData - Dados opcionais para preencher o produto.
     */
    // SUBSTITUA A FUNÇÃO 'adicionarProduto' PELA VERSÃO ABAIXO
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
     * @param {string} pecaNome - Nome opcional para preencher o campo.
     */
    function adicionarPeca(produtoId, pecaNome = '') {
        const pecasContainer = document.getElementById(`pecas-container-${produtoId}`);
        const pecaIndex = pecasContainer.children.length;
        const pecaHTML = `
            <div class="input-group mb-2 peca-item">
                <input type="text" name="produtos[${produtoId}][pecas][]" class="form-control" placeholder="Descreva a peça ${pecaIndex + 1} e coloque a quantidade" value="${pecaNome}" required>
                <button class="btn btn-outline-danger btn-remove-peca" type="button">Remover Peça</button>
            </div>`;
        pecasContainer.insertAdjacentHTML('beforeend', pecaHTML);
    }

    // SUBSTITUA A FUNÇÃO 'handleNfFound' PELA VERSÃO ABAIXO
    function handleNfFound(data) {
        // Preenche os dados do cliente imediatamente
        document.getElementById('nome_pedido').value = data.nome_pedido || '';
        document.getElementById('documento_cliente').value = data.documento_cliente || '';
        document.getElementById('numero_pedido_venda').value = data.numero_pedido_venda || '';

        if (!data.produtos || data.produtos.length === 0) {
            ModalSystem.alert('A NF foi encontrada, mas não possui produtos vinculados para importar.', 'Aviso');
            elements.produtosContainer.innerHTML = ''; // Limpa a área de produtos
            produtoIndex = 0;
            return;
        }

        elements.produtosContainer.innerHTML = '';
        produtoIndex = 0;

        let productSelectionHtml = '<p>Clique na opção desejada para cada produto da NF:</p><ul class="list-group">';

        data.produtos.forEach((produto, index) => {
            // [ESTILIZAÇÃO] Adicionado btn-group e ícones
            productSelectionHtml += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span class="me-3">${produto.nome_produto || 'Produto sem nome'} (SKU: ${produto.sku || 'N/A'})</span>
                    <div class="btn-group btn-group-sm" role="group">
                        <button class="btn btn-outline-primary nf-action-btn" data-type="produto" data-index="${index}" title="Adicionar o produto como um volume único.">
                            <i class="fas fa-box me-1"></i> Produto
                        </button>
                        <button class="btn btn-outline-secondary nf-action-btn" data-type="estrutura" data-index="${index}" title="Adicionar cada componente da estrutura como um volume separado.">
                            <i class="fas fa-cogs me-1"></i> Estruturas
                        </button>
                    </div>
                </li>`;
        });
        productSelectionHtml += '</ul>';

        ModalSystem.confirm(
            productSelectionHtml,
            'Produtos Encontrados na NF',
            null,
            null,
            { confirmText: 'Concluir', isHtml: true, cancelText: 'Fechar' }
        );

        document.querySelectorAll('.nf-action-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const currentButton = e.currentTarget;
                const type = currentButton.dataset.type;
                const index = currentButton.dataset.index;
                const produto = data.produtos[index];
                const buttonGroup = currentButton.parentElement;

                buttonGroup.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;

                try {
                    if (type === 'produto') {
                        adicionarProduto({ nome: produto.nome_produto, sku: produto.sku });
                    } else if (type === 'estrutura') {
                        const response = await fetch(`/assistencias/api/product-structures/${produto.sku}`);
                        if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.message || 'Erro ao buscar estruturas.');
                        }
                        const estruturas = await response.json();
                        if (estruturas.length === 0) {
                            throw new Error('Nenhuma estrutura encontrada para este produto.');
                        }
                        estruturas.forEach(est => {
                            adicionarProduto({ nome: est.structure_name, sku: est.component_sku });
                        });
                    }
                    buttonGroup.innerHTML = `<span class="text-success fw-bold p-2"><i class="fas fa-check"></i> Adicionado</span>`;

                } catch (error) {
                    ModalSystem.alert(`Erro: ${error.message}`, 'Falha na Operação');
                    // Restaura os botões em caso de erro, mantendo a estilização
                    buttonGroup.innerHTML = `
                        <button class="btn btn-outline-primary nf-action-btn" data-type="produto" data-index="${index}" title="Adicionar o produto como um volume único.">
                            <i class="fas fa-box me-1"></i> Produto
                        </button>
                        <button class="btn btn-outline-secondary nf-action-btn" data-type="estrutura" data-index="${index}" title="Adicionar cada componente da estrutura como um volume separado.">
                            <i class="fas fa-cogs me-1"></i> Estruturas
                        </button>
                    `;
                }
            });
        });
    }

    /**
     * Preenche o formulário com os dados importados da NF.
     * @param {object} data - Os dados retornados pela API da NF.
     */
   /*function preencherFormularioComDadosNF(data) {
        document.getElementById('nome_pedido').value = data.nome_pedido || '';
        document.getElementById('documento_cliente').value = data.documento_cliente || '';
        document.getElementById('numero_pedido_venda').value = data.numero_pedido_venda || '';
        
        elements.produtosContainer.innerHTML = '';
        produtoIndex = 0;
    }*/

    /**
     * Configura todos os listeners de eventos do formulário.
     */
    function setupEventListeners() {
        elements.produtosContainer.addEventListener('click', function(e) {
            if (e.target.closest('.btn-add-peca')) {
                adicionarPeca(e.target.closest('.btn-add-peca').dataset.produtoId);
            }
            if (e.target.closest('.btn-remove-peca')) {
                e.target.closest('.peca-item').remove();
            }
            if (e.target.closest('.btn-remove-produto')) {
                e.target.closest('.produto-bloco').remove();
            }
        });

        elements.btnAddProduto.addEventListener('click', () => adicionarProduto());
        elements.btnAddSolicitante.addEventListener('click', addNewSolicitante);
        elements.btnAddFabrica.addEventListener('click', addNewFabrica);

        elements.nfOrigemInput.addEventListener('input', function() {
            const value = this.value.replace(/\s+/g, '');
            if (value.length === 44 && /^\d+$/.test(value)) {
                const nfNumber = parseInt(value.substring(25, 34), 10).toString();
                this.value = nfNumber;
                // Dispara o evento keyup manualmente para acionar a busca automática
                this.dispatchEvent(new Event('keyup'));
            }
        });

        elements.form.addEventListener('submit', async function(e) {
            e.preventDefault(); // Impede o envio tradicional
            const submitButton = e.submitter || elements.form.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Salvando...';

            const formDataObject = serializeFormToJson();

            try {
                const response = await fetch('/assistencias', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formDataObject)
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.message || 'Erro desconhecido do servidor.');
                }
                
                // Se chegou aqui, a assistência foi salva com sucesso
                showSuccessModal(result.newAssistenciaId, result.hasNf);

            } catch (error) {
                console.error('Erro ao enviar formulário:', error);
                ModalSystem.alert(`Erro ao salvar: ${error.message}`, 'Falha na Operação');
            } finally {
                // Habilita o botão novamente, independentemente do resultado
                submitButton.disabled = false;
                submitButton.innerHTML = 'Salvar Assistência';
            }
        });

        elements.produtosContainer.addEventListener('keyup', e => {
            if (e.target.classList.contains('sku-lookup')) {
                clearTimeout(e.target.debounceTimer);
                e.target.debounceTimer = setTimeout(() => handleSkuLookup(e.target), 800);
            }
        });

        elements.nfOrigemInput.addEventListener('keyup', e => {
            clearTimeout(nfDebounceTimer);
            const nfNumber = e.target.value.trim();
            if (!nfNumber || nfNumber.length < 3) return;

            nfDebounceTimer = setTimeout(async () => {
                try {
                    // 1. Tenta buscar no cache local primeiro
                    const cacheResponse = await fetch(`/assistencias/api/nf-origem/${nfNumber}`);
                    
                    if (cacheResponse.ok) {
                        const data = await cacheResponse.json();
                        handleNfFound(data); // Usa a função helper
                        return; // Encontrou no cache, encerra o fluxo
                    }

                    if (cacheResponse.status === 404) {
                        // 2. Se não encontrou no cache, busca no Bling
                        ModalSystem.showLoading('Nota não encontrada no cache local. Consultando Bling...', 'Aguarde');
                        
                        const blingResponse = await fetch(`/assistencias/api/find-nfe-bling/${nfNumber}`, { method: 'POST' });
                        
                        ModalSystem.hideLoading();

                        if (blingResponse.ok) {
                            const data = await blingResponse.json();
                            handleNfFound(data); // Usa a função helper
                        } else {
                            const errorData = await blingResponse.json();
                            ModalSystem.alert(errorData.message || `Nota Fiscal ${nfNumber} não foi encontrada no Bling.`, "Não Encontrado");
                        }
                    }

                } catch (error) {
                    ModalSystem.hideLoading();
                    console.error('Erro ao buscar NF de Origem:', error);
                    ModalSystem.alert('Ocorreu um erro de comunicação ao buscar a nota fiscal.', 'Erro');
                }
            }, 800);
        });
    }
    
    /**
     * Define o estado inicial do formulário.
     */
    function initializeForm() {
        elements.dataSolicitacaoInput.value = new Date().toISOString().split('T')[0];
        loadSolicitantes();
        loadFabricas();
    }

    // --- Inicialização ---
    initializeForm();
    setupEventListeners();
});