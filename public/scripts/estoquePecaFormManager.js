/**
 * estoquePecaFormManager.js
 * Gerencia o formulário de cadastro e edição de peças no estoque.
 * 
 * Funcionalidades:
 * - Carregamento de fábricas (combobox com busca)
 * - Inserção rápida de fábricas
 * - Busca preditiva assíncrona para Produto Pai
 * - Autocompletar para Nome da Peça baseado em histórico
 * - Validação de unicidade de SKU e Número da Peça em tempo real
 * - Validação de campos obrigatórios
 * - Submissão via AJAX
 */
document.addEventListener('DOMContentLoaded', function() {
    const isEditMode = window.ESTOQUE_MODE === 'edit';
    const pecaId = window.ESTOQUE_PECA_ID;
    const fabricaIdToSelect = window.ESTOQUE_FABRICA_ID || null;

    // === Mapeamento de Elementos ===
    const elements = {
        form: document.getElementById('form-nova-peca'),
        skuInput: document.getElementById('sku'),
        numeroPecaInput: document.getElementById('numero_peca'),
        fabricaSelect: document.getElementById('fabrica_id'),
        btnAddFabrica: document.getElementById('btn-add-fabrica'),
        produtoPaiInput: document.getElementById('produto_pai_input'),
        produtoPaiPanel: document.getElementById('produto-pai-panel'),
        produtoPaiSkuHidden: document.getElementById('produto_pai_sku'),
        produtoPaiNomeHidden: document.getElementById('produto_pai_nome'),
        produtoPaiSelected: document.getElementById('produto-pai-selected'),
        ppSkuDisplay: document.getElementById('pp-sku-display'),
        ppNomeDisplay: document.getElementById('pp-nome-display'),
        btnClearPP: document.getElementById('btn-clear-pp'),
        nomePecaInput: document.getElementById('nome_peca'),
        nomePecaPanel: document.getElementById('nome-peca-panel'),
        alturaInput: document.getElementById('altura'),
        larguraInput: document.getElementById('largura'),
        profundidadeInput: document.getElementById('profundidade'),
        quantidadeInput: document.getElementById('quantidade'),
        skuValidation: document.getElementById('sku-validation'),
        numeroPecaValidation: document.getElementById('numero-peca-validation'),
        btnSalvar: document.getElementById('btn-salvar-peca')
    };

    // === Timers para debounce ===
    let produtoPaiTimer = null;
    let nomePecaTimer = null;
    let skuTimer = null;
    let activeAutocompleteIndex = -1;

    // =============================================
    // === FÁBRICAS ===
    // =============================================

    /**
     * Carrega a lista de fábricas e popula o select.
     */
    const loadFabricas = async () => {
        try {
            const response = await fetch('/estoque/api/fabricas');
            if (!response.ok) throw new Error('Falha ao carregar fábricas.');
            
            const fabricas = await response.json();
            elements.fabricaSelect.innerHTML = '<option value="" disabled selected>Selecione uma fábrica...</option>';
            fabricas.forEach(f => {
                const option = new Option(f.nome, f.id);
                elements.fabricaSelect.add(option);
            });

            // Selecionar a fábrica se houver uma pré-especificada (edição ou clonagem)
            if (fabricaIdToSelect) {
                elements.fabricaSelect.value = fabricaIdToSelect;
            }
        } catch (error) {
            console.error('[Estoque] Erro ao carregar fábricas:', error);
            elements.fabricaSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    };

    /**
     * Inserção rápida de nova fábrica via ModalSystem.prompt.
     */
    const addNewFabrica = () => {
        ModalSystem.prompt('Digite o nome da nova fábrica:', 'Adicionar Fábrica', async (nome) => {
            if (!nome || nome.trim() === '') return;

            try {
                const response = await fetch('/estoque/api/fabricas', {
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

    // =============================================
    // === BUSCA PREDITIVA — PRODUTO PAI ===
    // =============================================

    /**
     * Busca produtos na cached_products com debounce.
     */
    const searchProdutoPai = async (query) => {
        if (query.length < 2) {
            hideProdutoPaiPanel();
            return;
        }

        // Mostra loading
        elements.produtoPaiPanel.innerHTML = '<div class="autocomplete-loading">Buscando</div>';
        elements.produtoPaiPanel.classList.add('visible');

        try {
            const response = await fetch(`/estoque/api/search-produto-pai?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Erro na busca');
            
            const results = await response.json();
            renderProdutoPaiResults(results);
        } catch (error) {
            console.error('[Estoque] Erro na busca de produto pai:', error);
            elements.produtoPaiPanel.innerHTML = '<div class="autocomplete-no-results">Erro na busca</div>';
        }
    };

    /**
     * Renderiza os resultados da busca de Produto Pai.
     */
    const renderProdutoPaiResults = (results) => {
        activeAutocompleteIndex = -1;

        if (results.length === 0) {
            elements.produtoPaiPanel.innerHTML = '<div class="autocomplete-no-results">Nenhum produto encontrado</div>';
            elements.produtoPaiPanel.classList.add('visible');
            return;
        }

        let html = '';
        results.forEach((item, index) => {
            html += `
                <div class="autocomplete-item" data-index="${index}" data-sku="${item.sku}" data-nome="${escapeHtml(item.nome || '')}">
                    <span class="ac-sku">${escapeHtml(item.sku)}</span>
                    <span class="ac-nome">${escapeHtml(item.nome || 'Sem nome')}</span>
                </div>
            `;
        });

        elements.produtoPaiPanel.innerHTML = html;
        elements.produtoPaiPanel.classList.add('visible');

        // Adicionar event listeners aos itens
        elements.produtoPaiPanel.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                selectProdutoPai(item.dataset.sku, item.dataset.nome);
            });
        });
    };

    /**
     * Seleciona um produto pai e atualiza os campos hidden e o display.
     */
    const selectProdutoPai = (sku, nome) => {
        elements.produtoPaiSkuHidden.value = sku;
        elements.produtoPaiNomeHidden.value = nome;
        elements.ppSkuDisplay.textContent = sku;
        elements.ppNomeDisplay.textContent = nome;
        elements.produtoPaiSelected.classList.add('visible');
        elements.produtoPaiInput.value = '';
        hideProdutoPaiPanel();
    };

    /**
     * Limpa a seleção do Produto Pai.
     */
    const clearProdutoPai = () => {
        elements.produtoPaiSkuHidden.value = '';
        elements.produtoPaiNomeHidden.value = '';
        elements.ppSkuDisplay.textContent = '';
        elements.ppNomeDisplay.textContent = '';
        elements.produtoPaiSelected.classList.remove('visible');
        elements.produtoPaiInput.value = '';
        elements.produtoPaiInput.focus();
    };

    const hideProdutoPaiPanel = () => {
        elements.produtoPaiPanel.classList.remove('visible');
        elements.produtoPaiPanel.innerHTML = '';
        activeAutocompleteIndex = -1;
    };

    // =============================================
    // === AUTOCOMPLETAR — NOME DA PEÇA ===
    // =============================================

    /**
     * Busca nomes de peças no histórico com debounce.
     */
    const searchNomePeca = async (query) => {
        if (query.length < 2) {
            hideNomePecaPanel();
            return;
        }

        try {
            const response = await fetch(`/estoque/api/search-nome-peca?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Erro na busca');
            
            const results = await response.json();
            renderNomePecaResults(results);
        } catch (error) {
            console.error('[Estoque] Erro na busca de nomes:', error);
            hideNomePecaPanel();
        }
    };

    /**
     * Renderiza os resultados do autocompletar de nomes.
     */
    const renderNomePecaResults = (results) => {
        if (results.length === 0) {
            hideNomePecaPanel();
            return;
        }

        let html = '';
        results.forEach(nome => {
            html += `<div class="autocomplete-item" data-nome="${escapeHtml(nome)}">
                        <span class="ac-nome" style="color: var(--text-primary);">${escapeHtml(nome)}</span>
                     </div>`;
        });

        elements.nomePecaPanel.innerHTML = html;
        elements.nomePecaPanel.classList.add('visible');

        elements.nomePecaPanel.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                elements.nomePecaInput.value = item.dataset.nome;
                hideNomePecaPanel();
            });
        });
    };

    const hideNomePecaPanel = () => {
        elements.nomePecaPanel.classList.remove('visible');
        elements.nomePecaPanel.innerHTML = '';
    };

    // =============================================
    // === VALIDAÇÃO DE UNICIDADE ===
    // =============================================

    /**
     * Verifica unicidade do SKU em tempo real.
     */
    const validateSkuUniqueness = async (sku) => {
        if (!sku || sku.trim().length === 0) {
            setValidationState(elements.skuInput, elements.skuValidation, null);
            return;
        }

        try {
            let url = `/estoque/api/verificar-sku/${encodeURIComponent(sku.trim())}`;
            if (isEditMode && pecaId) url += `?excludeId=${pecaId}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.exists) {
                setValidationState(elements.skuInput, elements.skuValidation, 'error', 'Este SKU já está cadastrado.');
            } else {
                setValidationState(elements.skuInput, elements.skuValidation, 'success', 'SKU disponível.');
            }
        } catch (error) {
            console.error('[Estoque] Erro ao verificar SKU:', error);
        }
    };



    /**
     * Define o estado visual de validação de um campo.
     */
    const setValidationState = (input, msgElement, state, message = '') => {
        input.classList.remove('input-valid', 'input-error');
        msgElement.classList.remove('visible', 'error', 'success');
        msgElement.textContent = '';

        if (state === 'error') {
            input.classList.add('input-error');
            msgElement.classList.add('visible', 'error');
            msgElement.textContent = message;
        } else if (state === 'success') {
            input.classList.add('input-valid');
            msgElement.classList.add('visible', 'success');
            msgElement.textContent = message;
        }
    };

    // =============================================
    // === VALIDAÇÃO DO FORMULÁRIO ===
    // =============================================

    /**
     * Valida todos os campos obrigatórios antes do submit.
     * Retorna true se tudo estiver válido.
     */
    const validateForm = () => {
        const errors = [];

        // SKU
        if (!elements.skuInput.value.trim()) {
            errors.push('SKU é obrigatório.');
            elements.skuInput.classList.add('input-error');
        }
        // SKU já em uso
        if (elements.skuInput.classList.contains('input-error') && elements.skuValidation.classList.contains('error')) {
            errors.push('O SKU informado já está em uso.');
        }

        // Fábrica
        if (!elements.fabricaSelect.value) {
            errors.push('Fábrica é obrigatória.');
            elements.fabricaSelect.classList.add('input-error');
        }

        // Produto Pai
        if (!elements.produtoPaiSkuHidden.value && !elements.produtoPaiNomeHidden.value) {
            errors.push('Produto Pai é obrigatório. Selecione um produto da busca.');
        }

        // Nome da Peça
        if (!elements.nomePecaInput.value.trim()) {
            errors.push('Nome da Peça é obrigatório.');
            elements.nomePecaInput.classList.add('input-error');
        }

        // Medidas
        const altura = parseFloat(elements.alturaInput.value);
        const largura = parseFloat(elements.larguraInput.value);
        const profundidade = parseFloat(elements.profundidadeInput.value);

        if (!altura || altura <= 0) {
            errors.push('Altura deve ser um valor positivo.');
            elements.alturaInput.classList.add('input-error');
        }
        if (!largura || largura <= 0) {
            errors.push('Largura deve ser um valor positivo.');
            elements.larguraInput.classList.add('input-error');
        }
        if (!profundidade || profundidade <= 0) {
            errors.push('Profundidade deve ser um valor positivo.');
            elements.profundidadeInput.classList.add('input-error');
        }

        // Quantidade (somente no cadastro)
        if (!isEditMode) {
            const qtd = elements.quantidadeInput.value;
            if (qtd === '' || qtd === null || parseInt(qtd) < 0 || !Number.isInteger(Number(qtd))) {
                errors.push('Quantidade deve ser um número inteiro não negativo.');
                elements.quantidadeInput.classList.add('input-error');
            }
        }



        if (errors.length > 0) {
            ModalSystem.alert(errors.join('<br>'), 'Campos Inválidos');
            return false;
        }
        return true;
    };

    // =============================================
    // === SUBMISSÃO ===
    // =============================================

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateForm()) return;

        // Desabilita o botão durante o envio
        elements.btnSalvar.disabled = true;
        elements.btnSalvar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

        const payload = {
            sku: elements.skuInput.value.trim(),
            numero_peca: elements.numeroPecaInput.value.trim(),
            fabrica_id: elements.fabricaSelect.value,
            produto_pai_sku: elements.produtoPaiSkuHidden.value,
            produto_pai_nome: elements.produtoPaiNomeHidden.value,
            nome_peca: elements.nomePecaInput.value.trim(),
            observacao: document.getElementById('observacao').value.trim(),
            cor: document.getElementById('cor').value.trim(),
            altura: document.getElementById('altura').value,
            largura: document.getElementById('largura').value,
            profundidade: document.getElementById('profundidade').value,
            coluna_localizacao: document.getElementById('coluna_localizacao').value.trim(),
            linha_localizacao: document.getElementById('linha_localizacao').value.trim()
        };

        // Adiciona quantidade apenas no cadastro
        if (!isEditMode) {
            payload.quantidade = document.getElementById('quantidade').value;
        }

        const url = isEditMode ? `/estoque/update/${pecaId}` : '/estoque';
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Erro desconhecido ao salvar.');
            }

            ModalSystem.alert(
                result.message,
                'Sucesso!',
                () => { window.location.href = '/estoque'; }
            );
        } catch (error) {
            console.error('[Estoque] Erro ao salvar:', error);
            ModalSystem.alert(error.message || 'Erro interno ao salvar a peça.', 'Erro');
        } finally {
            elements.btnSalvar.disabled = false;
            elements.btnSalvar.innerHTML = isEditMode
                ? '<i class="fas fa-save"></i> Atualizar Peça'
                : '<i class="fas fa-save"></i> Salvar Peça';
        }
    };

    // =============================================
    // === UTILITIES ===
    // =============================================

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =============================================
    // === EVENT LISTENERS ===
    // =============================================

    // Fábricas
    elements.btnAddFabrica.addEventListener('click', addNewFabrica);

    // Busca Produto Pai (debounce 300ms)
    elements.produtoPaiInput.addEventListener('input', (e) => {
        clearTimeout(produtoPaiTimer);
        produtoPaiTimer = setTimeout(() => searchProdutoPai(e.target.value.trim()), 300);
    });

    // Navegação no autocomplete de Produto Pai com teclado
    elements.produtoPaiInput.addEventListener('keydown', (e) => {
        const items = elements.produtoPaiPanel.querySelectorAll('.autocomplete-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeAutocompleteIndex = Math.min(activeAutocompleteIndex + 1, items.length - 1);
            updateActiveItem(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeAutocompleteIndex = Math.max(activeAutocompleteIndex - 1, 0);
            updateActiveItem(items);
        } else if (e.key === 'Enter' && activeAutocompleteIndex >= 0) {
            e.preventDefault();
            items[activeAutocompleteIndex].click();
        } else if (e.key === 'Escape') {
            hideProdutoPaiPanel();
        }
    });

    const updateActiveItem = (items) => {
        items.forEach(i => i.classList.remove('active'));
        if (items[activeAutocompleteIndex]) {
            items[activeAutocompleteIndex].classList.add('active');
            items[activeAutocompleteIndex].scrollIntoView({ block: 'nearest' });
        }
    };

    // Limpar seleção Produto Pai
    elements.btnClearPP.addEventListener('click', clearProdutoPai);

    // Autocompletar Nome da Peça (debounce 300ms)
    elements.nomePecaInput.addEventListener('input', (e) => {
        clearTimeout(nomePecaTimer);
        nomePecaTimer = setTimeout(() => searchNomePeca(e.target.value.trim()), 300);
    });

    // Validação SKU (debounce 500ms)
    elements.skuInput.addEventListener('input', (e) => {
        elements.skuInput.classList.remove('input-error', 'input-valid');
        clearTimeout(skuTimer);
        skuTimer = setTimeout(() => validateSkuUniqueness(e.target.value), 500);
    });



    // Limpa erro ao focar nos inputs obrigatórios
    [elements.skuInput, elements.fabricaSelect, elements.nomePecaInput,
     elements.alturaInput, elements.larguraInput, elements.profundidadeInput,
     elements.quantidadeInput].forEach(el => {
        if (el) {
            el.addEventListener('focus', () => {
                el.classList.remove('input-error');
            });
        }
    });

    // Fechar autocompletes ao clicar fora
    document.addEventListener('click', (e) => {
        if (!elements.produtoPaiInput.contains(e.target) && !elements.produtoPaiPanel.contains(e.target)) {
            hideProdutoPaiPanel();
        }
        if (!elements.nomePecaInput.contains(e.target) && !elements.nomePecaPanel.contains(e.target)) {
            hideNomePecaPanel();
        }
    });

    // Evitar submissão com a tecla "Enter" nos inputs
    elements.form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const target = e.target;
            // Bloqueia o Enter em inputs de texto e número para evitar submissão indesejada,
            // mas permite se for em um botão, link ou se houver um item ativo de autocomplete (tratado separadamente).
            if (target.tagName === 'INPUT' && target.type !== 'submit' && target.type !== 'button') {
                // Se for Produto Pai e houver algum item selecionado no autocomplete, deixa o autocomplete processar.
                // Caso contrário, impede a submissão.
                if (target === elements.produtoPaiInput && activeAutocompleteIndex >= 0) {
                    return; // Permite que o keydown do autocomplete trate a seleção
                }
                e.preventDefault();
            }
        }
    });

    // Submit do formulário
    elements.form.addEventListener('submit', handleSubmit);

    // =============================================
    // === INICIALIZAÇÃO ===
    // =============================================

    loadFabricas();

    // Se em modo de edição e tem produto pai, exibir o display
    if (isEditMode) {
        const ppSku = elements.produtoPaiSkuHidden.value;
        const ppNome = elements.produtoPaiNomeHidden.value;
        if (ppSku || ppNome) {
            elements.ppSkuDisplay.textContent = ppSku || '';
            elements.ppNomeDisplay.textContent = ppNome || '';
            elements.produtoPaiSelected.classList.add('visible');
        }
    }
});
