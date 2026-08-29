// public/scripts/pesosComprasManager.js
document.addEventListener('DOMContentLoaded', () => {
    let pesosList = [];
    let filteredList = [];
    let searchTerm = '';
    let currentSort = 'sku_asc';
    let pageSize = 50;
    let currentPage = 1;
    let isAddingRow = false;

    // Elementos do DOM principais
    const table = document.getElementById('tabela-estoque');
    const tableBody = document.getElementById('table-body');
    const paginationContainer = document.getElementById('pagination-container');
    const emptyState = document.getElementById('empty-state');
    const emptyTitle = document.getElementById('empty-state-title');
    const emptySubtitle = document.getElementById('empty-state-sub');
    const buscaInput = document.getElementById('buscaGeral');
    const selectOrdenacao = document.getElementById('selectOrdenacaoPesos');
    const filtroLimite = document.getElementById('filtroLimite');

    // Botões do Cabeçalho
    const btnAbrirModalUpload = document.getElementById('btnAbrirModalUpload');
    const btnAdicionarLinhaSku = document.getElementById('btnAdicionarLinhaSku');

    // =============================================
    // === CARREGAMENTO INICIAL ===
    // =============================================

    async function carregarPesos() {
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-4 text-muted">
                        <div class="modal-spinner" style="display: inline-block;"></div> Carregando pesos dos produtos...
                    </td>
                </tr>
            `;
        }

        try {
            const res = await fetch('/analise-compras/api/pesos');
            const data = await res.json();

            if (data.success) {
                pesosList = data.data || [];
                isAddingRow = false;
                filtrarEOrdenar();
            } else {
                throw new Error(data.message || 'Erro ao buscar pesos');
            }
        } catch (error) {
            console.error('Erro ao carregar pesos:', error);
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center py-4" style="color: var(--color-danger, #dc3545);">
                            <i class="fas fa-exclamation-triangle me-2"></i> Erro ao carregar pesos. Tente recarregar a página.
                        </td>
                    </tr>
                `;
            }
        }
    }

    // =============================================
    // === FILTRAGEM, ORDENAÇÃO E PAGINAÇÃO ===
    // =============================================

    function normalizarTexto(txt) {
        if (!txt) return '';
        return String(txt).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    }

    function parseValorInputPeso(str) {
        if (!str) return 0;
        let limpo = String(str).toLowerCase().replace(/kg|kgs|quilos|kilos/g, '').trim().replace(',', '.');
        limpo = limpo.replace(/[^0-9.]/g, '');
        const num = parseFloat(limpo);
        return isNaN(num) ? 0 : Math.max(0, num);
    }

    function filtrarEOrdenar() {
        const termo = normalizarTexto(searchTerm);

        filteredList = pesosList.filter(p => {
            if (!termo) return true;
            const skuNorm = normalizarTexto(p.sku || '');
            return skuNorm.includes(termo);
        });

        // Ordenação
        filteredList.sort((a, b) => {
            const skuA = String(a.sku || '').toUpperCase();
            const skuB = String(b.sku || '').toUpperCase();
            const pesoA = parseFloat(a.peso) || 0;
            const pesoB = parseFloat(b.peso) || 0;

            if (currentSort === 'sku_desc') {
                return skuB.localeCompare(skuA);
            } else if (currentSort === 'peso_desc') {
                return pesoB - pesoA;
            } else if (currentSort === 'peso_asc') {
                return pesoA - pesoB;
            } else {
                // sku_asc padrão
                return skuA.localeCompare(skuB);
            }
        });

        renderTabela();
    }

    function renderTabela() {
        if (!tableBody) return;

        if (filteredList.length === 0 && !isAddingRow) {
            tableBody.innerHTML = '';
            if (emptyState) {
                emptyState.style.display = 'block';
                if (searchTerm) {
                    if (emptyTitle) emptyTitle.textContent = `Nenhum SKU correspondente a "${searchTerm}"`;
                    if (emptySubtitle) emptySubtitle.textContent = "Tente ajustar sua busca ou clique em 'Adicionar SKU'.";
                } else {
                    if (emptyTitle) emptyTitle.textContent = 'Nenhum SKU com peso cadastrado.';
                    if (emptySubtitle) emptySubtitle.textContent = "Faça o upload de uma planilha Excel ou clique em 'Adicionar SKU'.";
                }
            }
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        // Paginação
        let totalItems = filteredList.length;
        let effectivePageSize = pageSize === 'todos' ? totalItems : parseInt(pageSize, 10) || 50;
        let totalPages = Math.ceil(totalItems / effectivePageSize) || 1;

        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        let startIndex = (currentPage - 1) * effectivePageSize;
        let endIndex = Math.min(startIndex + effectivePageSize, totalItems);
        let itemsPagina = filteredList.slice(startIndex, endIndex);

        let rowsHtml = '';

        // Se o usuário clicou em "Adicionar SKU", insere a linha de novo cadastro no topo
        if (isAddingRow) {
            rowsHtml += `
                <tr id="linhaNovoSku" style="background: rgba(240, 124, 0, 0.08); border-left: 3px solid var(--accent-orange, #f07c00);">
                    <td class="text-center align-middle">
                        <div style="display: inline-flex; align-items: center; justify-content: center; width: 100%; max-width: 220px; margin: 0 auto;">
                            <input type="text" id="inputNovoSku" class="form-control form-control-sm" 
                                   placeholder="Digite o SKU (ex: E-8494-1)" 
                                   style="text-transform: uppercase; font-family: monospace; font-weight: 700; color: #fff; background: var(--bg-secondary, #1a1a20); border: 1px solid var(--accent-orange, #f07c00); text-align: center; width: 100%;" />
                        </div>
                    </td>
                    <td class="text-center align-middle">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 100%; max-width: 160px; margin: 0 auto;">
                            <input type="text" id="inputNovoPeso" class="form-control form-control-sm input-chegando" 
                                   placeholder="0,30" 
                                   style="width: 90px; text-align: center; font-weight: 700; color: var(--accent-orange, #f07c00);" />
                            <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600;">kg</span>
                        </div>
                    </td>
                    <td class="text-center align-middle">
                        <div style="display: inline-flex; gap: 6px; justify-content: center; align-items: center;">
                            <button type="button" class="btn btn-sm btn-accent" id="btnSalvarNovoSku" title="Salvar SKU (Enter)" style="padding: 3px 10px; font-size: 0.78rem;">
                                <i class="fas fa-check me-1"></i>Salvar
                            </button>
                            <button type="button" class="btn btn-sm btn-secondary" id="btnCancelarNovoSku" title="Cancelar (Esc)" style="padding: 3px 8px; font-size: 0.78rem;">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        // Renderiza as linhas existentes
        rowsHtml += itemsPagina.map((item, idx) => {
            const pesoNum = parseFloat(item.peso) || 0;
            const pesoFormatado = pesoNum.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
            const copySkuBtnHtml = `<button class="btn-copy-sku" data-sku="${escapeHtml(item.sku)}" title="Copiar SKU"><i class="far fa-copy"></i></button>`;

            return `
                <tr data-sku="${escapeHtml(item.sku)}">
                    <td class="text-center align-middle" style="font-weight: 700; color: #fff; font-family: monospace; font-size: 0.9rem;">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <span>${escapeHtml(item.sku)}</span>
                            ${copySkuBtnHtml}
                        </div>
                    </td>
                    <td class="text-center align-middle">
                        <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                            <input type="text" class="input-chegando input-peso-inline" 
                                   data-sku="${escapeHtml(item.sku)}" 
                                   data-original-val="${pesoFormatado}"
                                   value="${pesoFormatado}" 
                                   style="width: 90px; text-align: center; font-weight: 700; color: var(--accent-orange, #f07c00);" 
                                   title="Clique para editar o peso" />
                            <span style="font-size: 0.82rem; color: var(--text-muted); font-weight: 600;">kg</span>
                        </div>
                    </td>
                    <td class="text-center align-middle">
                        <div style="display: inline-flex; gap: 6px; justify-content: center; align-items: center;">
                            <button type="button" class="btn-remove-item btn-excluir-sku" data-sku="${escapeHtml(item.sku)}" title="Excluir SKU da tabela">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tableBody.innerHTML = rowsHtml;

        vincularEventosTabela();
        renderPaginacao(totalItems, totalPages, startIndex, endIndex);
    }

    function vincularEventosTabela() {
        // Eventos da linha de Novo SKU
        if (isAddingRow) {
            const inputSku = document.getElementById('inputNovoSku');
            const inputPeso = document.getElementById('inputNovoPeso');
            const btnSalvar = document.getElementById('btnSalvarNovoSku');
            const btnCancelar = document.getElementById('btnCancelarNovoSku');

            if (inputSku) setTimeout(() => inputSku.focus(), 50);

            if (btnCancelar) {
                btnCancelar.addEventListener('click', () => {
                    isAddingRow = false;
                    renderTabela();
                });
            }

            if (btnSalvar) {
                btnSalvar.addEventListener('click', () => {
                    salvarNovoSkuAction(inputSku.value, inputPeso.value);
                });
            }

            if (inputSku) {
                inputSku.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (inputPeso) inputPeso.focus();
                    } else if (e.key === 'Escape') {
                        isAddingRow = false;
                        renderTabela();
                    }
                });
            }

            if (inputPeso) {
                inputPeso.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        salvarNovoSkuAction(inputSku.value, inputPeso.value);
                    } else if (e.key === 'Escape') {
                        isAddingRow = false;
                        renderTabela();
                    }
                });
            }
        }

        // Copiar SKU com delegação e feedback
        document.querySelectorAll('.btn-copy-sku').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const skuToCopy = btn.dataset.sku;
                if (skuToCopy) {
                    navigator.clipboard.writeText(skuToCopy).then(() => {
                        showToast(`SKU copiado: ${skuToCopy}`);
                        const icon = btn.querySelector('i');
                        if (icon) {
                            icon.className = 'fas fa-check';
                            icon.style.color = '#2e7d32';
                            setTimeout(() => {
                                icon.className = 'far fa-copy';
                                icon.style.color = '#888';
                            }, 1500);
                        }
                    }).catch(err => console.error('Erro ao copiar SKU:', err));
                }
            });
        });

        // Edição inline de peso diretamente na célula
        document.querySelectorAll('.input-peso-inline').forEach(input => {
            const sku = input.getAttribute('data-sku');
            const originalVal = input.getAttribute('data-original-val');

            const salvarAlteracao = () => {
                const novoValStr = input.value.trim();
                if (novoValStr !== originalVal) {
                    salvarPesoInline(sku, novoValStr, input);
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    input.value = originalVal;
                    input.blur();
                }
            });

            input.addEventListener('change', salvarAlteracao);
        });

        // Botão Excluir SKU da tabela
        document.querySelectorAll('.btn-excluir-sku').forEach(btn => {
            btn.addEventListener('click', () => {
                const sku = btn.getAttribute('data-sku');
                if (sku) {
                    excluirSkuAction(sku);
                }
            });
        });
    }

    // =============================================
    // === AÇÕES DE CRUD INLINE ===
    // =============================================

    async function salvarNovoSkuAction(skuRaw, pesoRaw) {
        const sku = String(skuRaw || '').trim().toUpperCase();
        const pesoValor = parseValorInputPeso(pesoRaw);

        if (!sku) {
            showToast('Por favor, informe o SKU da estrutura.');
            const inputSku = document.getElementById('inputNovoSku');
            if (inputSku) inputSku.focus();
            return;
        }

        if (pesoValor <= 0) {
            showToast('Por favor, informe um peso válido maior que zero.');
            const inputPeso = document.getElementById('inputNovoPeso');
            if (inputPeso) inputPeso.focus();
            return;
        }

        try {
            const res = await fetch('/analise-compras/api/pesos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, peso: pesoValor })
            });

            const data = await res.json();

            if (data.success) {
                showToast(`SKU ${sku} salvo com sucesso!`);
                isAddingRow = false;
                carregarPesos();
            } else {
                throw new Error(data.message || 'Erro ao salvar SKU');
            }
        } catch (error) {
            console.error('Erro ao salvar SKU:', error);
            if (typeof ModalSystem !== 'undefined' && ModalSystem.alert) {
                ModalSystem.alert('Erro ao salvar SKU: ' + error.message, 'Erro');
            } else {
                showToast('Erro ao salvar SKU: ' + error.message);
            }
        }
    }

    async function salvarPesoInline(sku, valorStr, inputEl) {
        const pesoValor = parseValorInputPeso(valorStr);
        if (pesoValor <= 0) {
            showToast('Informe um peso válido maior que zero.');
            if (inputEl) inputEl.value = inputEl.getAttribute('data-original-val');
            return;
        }

        try {
            const res = await fetch('/analise-compras/api/pesos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sku, peso: pesoValor })
            });
            const data = await res.json();

            if (data.success) {
                const pesoFormatado = pesoValor.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
                if (inputEl) {
                    inputEl.setAttribute('data-original-val', pesoFormatado);
                    inputEl.value = pesoFormatado;
                }
                // Atualiza na memória local
                const item = pesosList.find(p => p.sku === sku);
                if (item) item.peso = pesoValor;

                showToast(`Peso de ${sku} atualizado para ${pesoFormatado} kg!`);
            } else {
                throw new Error(data.message || 'Erro ao salvar peso');
            }
        } catch (err) {
            console.error('Erro ao salvar peso inline:', err);
            showToast('Erro ao salvar peso: ' + err.message);
            if (inputEl) inputEl.value = inputEl.getAttribute('data-original-val');
        }
    }

    function excluirSkuAction(sku) {
        const mensagem = `Deseja realmente excluir o SKU <strong>${escapeHtml(sku)}</strong> da tabela de pesos?`;

        if (typeof ModalSystem !== 'undefined' && ModalSystem.confirm) {
            ModalSystem.confirm(
                mensagem,
                'Excluir SKU',
                async () => {
                    try {
                        const res = await fetch(`/analise-compras/api/pesos/${encodeURIComponent(sku)}`, {
                            method: 'DELETE'
                        });
                        const data = await res.json();

                        if (data.success) {
                            showToast(`SKU ${sku} excluído com sucesso!`);
                            carregarPesos();
                        } else {
                            throw new Error(data.message || 'Erro ao excluir');
                        }
                    } catch (err) {
                        console.error('Erro ao excluir:', err);
                        showToast('Erro ao excluir SKU: ' + err.message);
                    }
                },
                null,
                { confirmText: 'Sim, Excluir', cancelText: 'Cancelar' }
            );
        } else {
            if (confirm(`Deseja realmente excluir o SKU ${sku}?`)) {
                fetch(`/analise-compras/api/pesos/${encodeURIComponent(sku)}`, { method: 'DELETE' })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) {
                            showToast(`SKU ${sku} excluído com sucesso!`);
                            carregarPesos();
                        }
                    });
            }
        }
    }

    // Botão Adicionar SKU no Topo
    if (btnAdicionarLinhaSku) {
        btnAdicionarLinhaSku.addEventListener('click', () => {
            isAddingRow = true;
            renderTabela();
            const inputSku = document.getElementById('inputNovoSku');
            if (inputSku) {
                inputSku.scrollIntoView({ behavior: 'smooth', block: 'center' });
                inputSku.focus();
            }
        });
    }

    // =============================================
    // === MODAL DE UPLOAD USANDO ModalSystem ===
    // =============================================

    if (btnAbrirModalUpload) {
        btnAbrirModalUpload.addEventListener('click', () => {
            let arquivoSelecionado = null;

            const modalHtml = `
                <div style="text-align: left;">
                    <div class="upload-info-box" style="margin-bottom: 14px; padding: 10px 14px;">
                        <h4 style="margin-bottom: 6px; font-size: 0.88rem;">
                            <i class="fas fa-info-circle me-1"></i> Formato da Planilha (Excel ou CSV)
                        </h4>
                        <ul style="font-size: 0.8rem; margin: 4px 0 6px 18px; color: #d1d5db;">
                            <li><strong>Coluna A:</strong> SKU da Estrutura (ex: <code>E-8494-1</code>, <code>e-8174-1</code>)</li>
                            <li><strong>Coluna B:</strong> Peso em KG (ex: <code>0,30</code>, <code>0.5</code>, <code>1,48kg</code>)</li>
                        </ul>
                        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 4px; padding: 6px 8px; color: #fca5a5; font-size: 0.76rem; font-weight: 600;">
                            <i class="fas fa-exclamation-triangle me-1"></i> Atenção: A importação limpará os dados anteriores da tabela de pesos e inserirá os novos.
                        </div>
                    </div>

                    <div id="modalDropzoneContainer" style="background: var(--bg-secondary, #1e1e24); border: 2px dashed rgba(255, 255, 255, 0.2); border-radius: 8px; padding: 18px 14px; text-align: center; cursor: pointer; transition: all 0.2s;">
                        <input type="file" id="modalFileInput" accept=".xlsx, .xls, .csv" style="display: none;" />
                        <i class="fas fa-cloud-upload-alt fa-2x mb-2" style="color: var(--accent-orange, #f07c00);"></i>
                        <div id="modalDropzoneText" style="font-size: 0.82rem; color: #e5e7eb;">
                            <strong>Clique aqui para escolher a planilha</strong> ou arraste o arquivo<br>
                            <span style="font-size: 0.74rem; color: #9ca3af;">Suporta .xlsx, .xls e .csv</span>
                        </div>
                        <div id="modalFileInfo" style="display: none; margin-top: 8px; font-weight: 700; color: #4caf50; font-size: 0.84rem;"></div>
                    </div>
                </div>
            `;

            if (typeof ModalSystem !== 'undefined' && ModalSystem.confirm) {
                ModalSystem.confirm(
                    modalHtml,
                    'Subir Planilha de Pesos',
                    async () => {
                        if (!arquivoSelecionado) {
                            if (ModalSystem.alert) {
                                ModalSystem.alert('Nenhum arquivo foi selecionado para upload.', 'Atenção');
                            } else {
                                showToast('Selecione uma planilha para upload.');
                            }
                            return;
                        }

                        if (ModalSystem.showLoading) {
                            ModalSystem.showLoading('Lendo e importando pesos da planilha...', 'Processando Upload');
                        }

                        try {
                            const formData = new FormData();
                            formData.append('file', arquivoSelecionado);

                            const res = await fetch('/analise-compras/upload-pesos', {
                                method: 'POST',
                                body: formData
                            });

                            const data = await res.json();

                            if (ModalSystem.hideLoading) {
                                ModalSystem.hideLoading();
                            }

                            if (data.success) {
                                if (ModalSystem.alert) {
                                    ModalSystem.alert(data.message || 'Planilha importada com sucesso!', 'Sucesso!', () => {
                                        carregarPesos();
                                    });
                                } else {
                                    showToast(data.message || 'Pesos importados!');
                                    carregarPesos();
                                }
                            } else {
                                throw new Error(data.message || 'Erro ao processar planilha');
                            }
                        } catch (error) {
                            if (ModalSystem.hideLoading) {
                                ModalSystem.hideLoading();
                            }
                            console.error('Erro no upload de pesos:', error);
                            if (ModalSystem.alert) {
                                ModalSystem.alert('Erro ao importar planilha: ' + error.message, 'Erro');
                            } else {
                                showToast('Erro ao importar planilha: ' + error.message);
                            }
                        }
                    },
                    null,
                    { confirmText: 'Importar Planilha', cancelText: 'Cancelar' }
                );

                // Configura eventos do seletor dentro do modal
                setTimeout(() => {
                    const dropContainer = document.getElementById('modalDropzoneContainer');
                    const fileInput = document.getElementById('modalFileInput');
                    const dropText = document.getElementById('modalDropzoneText');
                    const fileInfo = document.getElementById('modalFileInfo');

                    if (dropContainer && fileInput) {
                        dropContainer.addEventListener('click', () => fileInput.click());

                        dropContainer.addEventListener('dragover', (e) => {
                            e.preventDefault();
                            dropContainer.style.borderColor = 'var(--accent-orange, #f07c00)';
                            dropContainer.style.background = 'rgba(240, 124, 0, 0.08)';
                        });

                        dropContainer.addEventListener('dragleave', () => {
                            dropContainer.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            dropContainer.style.background = 'var(--bg-secondary, #1e1e24)';
                        });

                        dropContainer.addEventListener('drop', (e) => {
                            e.preventDefault();
                            dropContainer.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                            dropContainer.style.background = 'var(--bg-secondary, #1e1e24)';
                            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                processarArquivoModal(e.dataTransfer.files[0]);
                            }
                        });

                        fileInput.addEventListener('change', () => {
                            if (fileInput.files && fileInput.files.length > 0) {
                                processarArquivoModal(fileInput.files[0]);
                            }
                        });

                        function processarArquivoModal(file) {
                            const ext = file.name.split('.').pop().toLowerCase();
                            if (!['xlsx', 'xls', 'csv'].includes(ext)) {
                                alert('Por favor, selecione um arquivo .xlsx, .xls ou .csv.');
                                return;
                            }
                            arquivoSelecionado = file;
                            dropContainer.style.borderColor = '#4caf50';
                            dropContainer.style.background = 'rgba(76, 175, 80, 0.06)';
                            if (dropText) dropText.style.display = 'none';
                            if (fileInfo) {
                                const kb = (file.size / 1024).toFixed(1);
                                fileInfo.innerHTML = `<i class="fas fa-file-excel me-1"></i> ${escapeHtml(file.name)} (${kb} KB)`;
                                fileInfo.style.display = 'block';
                            }
                        }
                    }
                }, 50);
            }
        });
    }

    // =============================================
    // === PAGINAÇÃO & FILTROS ===
    // =============================================

    function renderPaginacao(totalItems, totalPages, startIndex, endIndex) {
        if (!paginationContainer) return;

        if (totalPages <= 1) {
            paginationContainer.innerHTML = `
                <div style="font-size: 0.8rem; color: var(--text-muted); padding: 8px 0;">
                    Mostrando todos os ${totalItems} SKUs
                </div>
            `;
            return;
        }

        let buttonsHtml = '';

        // Botão Anterior
        buttonsHtml += `
            <button class="btn-page ${currentPage === 1 ? 'disabled' : ''}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
        `;

        // Lógica de páginas visíveis
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        if (startPage > 1) {
            buttonsHtml += `<button class="btn-page" data-page="1">1</button>`;
            if (startPage > 2) buttonsHtml += `<span class="page-ellipsis">...</span>`;
        }

        for (let p = startPage; p <= endPage; p++) {
            buttonsHtml += `
                <button class="btn-page ${p === currentPage ? 'active' : ''}" data-page="${p}">
                    ${p}
                </button>
            `;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) buttonsHtml += `<span class="page-ellipsis">...</span>`;
            buttonsHtml += `<button class="btn-page" data-page="${totalPages}">${totalPages}</button>`;
        }

        // Botão Próximo
        buttonsHtml += `
            <button class="btn-page ${currentPage === totalPages ? 'disabled' : ''}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 8px;">
                <div style="font-size: 0.8rem; color: var(--text-muted);">
                    Mostrando <strong>${startIndex + 1}</strong> a <strong>${endIndex}</strong> de <strong>${totalItems}</strong> SKUs
                </div>
                <div class="pagination-buttons" style="display: flex; gap: 4px;">
                    ${buttonsHtml}
                </div>
            </div>
        `;

        paginationContainer.querySelectorAll('.btn-page:not(.disabled)').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetPage = parseInt(btn.getAttribute('data-page'), 10);
                if (targetPage && targetPage !== currentPage) {
                    currentPage = targetPage;
                    renderTabela();
                    const tbl = document.getElementById('tabela-estoque');
                    if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    // =============================================
    // === LISTENERS DOS FILTROS ===
    // =============================================

    if (buscaInput) {
        buscaInput.addEventListener('input', () => {
            searchTerm = buscaInput.value;
            currentPage = 1;
            filtrarEOrdenar();
        });
    }

    if (selectOrdenacao) {
        selectOrdenacao.addEventListener('change', () => {
            currentSort = selectOrdenacao.value || 'sku_asc';
            filtrarEOrdenar();
        });
    }

    if (filtroLimite) {
        filtroLimite.addEventListener('change', () => {
            pageSize = filtroLimite.value || 50;
            currentPage = 1;
            renderTabela();
        });
    }

    // =============================================
    // === UTILITÁRIOS E TOAST ===
    // =============================================

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(message) {
        const oldToast = document.querySelector('.column-reorder-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'column-reorder-toast';
        toast.innerHTML = `<i class="fas fa-check-circle"></i> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // Inicialização
    carregarPesos();
});
