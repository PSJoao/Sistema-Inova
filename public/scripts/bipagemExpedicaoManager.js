// public/scripts/bipagemExpedicaoManager.js

let carregadoresAtivos = {}; // Dicionário { "EMP-001": { id: 1, nome: "João" } }
let estadoAtual = {
    coletaId: null,
    paleteId: null,
    nf: null,
    carregadoresBipados: [] // array de IDs
};

document.addEventListener('DOMContentLoaded', async () => {
    await carregarDicionarioCarregadores();
    await carregarColetas();
    await carregarHierarquiaHoje();
    setupEventListeners();
});

// ==========================================
// 1. CARREGAMENTO INICIAL E COMBOS
// ==========================================
async function carregarDicionarioCarregadores() {
    try {
        const res = await fetch('/api/expedicao/carregadores/ativos');
        const data = await res.json();
        data.forEach(c => {
            carregadoresAtivos[c.codigo_barras] = c;
        });
    } catch (e) {
        console.error('Erro ao buscar dicionário de carregadores', e);
    }
}

async function carregarColetas() {
    try {
        const res = await fetch('/api/expedicao/coletas');
        const coletas = await res.json();
        const select = document.getElementById('select-coleta');
        select.innerHTML = '<option value="">Selecione uma Coleta...</option>';
        coletas.forEach(c => {
            select.innerHTML += `<option value="${c.id}">${c.identificacao} (${new Date(c.data_criacao).toLocaleDateString()})</option>`;
        });
    } catch (e) {
        console.error('Erro ao carregar coletas', e);
    }
}

async function carregarPaletes(coletaId) {
    if (!coletaId) return;
    try {
        const res = await fetch(`/api/expedicao/paletes/${coletaId}`);
        const paletes = await res.json();
        const select = document.getElementById('select-palete');
        select.innerHTML = '<option value="">Selecione um Palete...</option>';
        paletes.forEach(p => {
            select.innerHTML += `<option value="${p.id}">${p.identificacao}</option>`;
        });
        select.disabled = false;
        document.getElementById('btn-novo-palete').disabled = false;
    } catch (e) {
        console.error('Erro ao carregar paletes', e);
    }
}

// ==========================================
// 2. EVENT LISTENERS E MÁQUINA DE ESTADO
// ==========================================
function setupEventListeners() {
    const inputBipagem = document.getElementById('input-bipagem');
    const selectColeta = document.getElementById('select-coleta');
    const selectPalete = document.getElementById('select-palete');

    // Mudança de Coleta
    selectColeta.addEventListener('change', (e) => {
        estadoAtual.coletaId = e.target.value;
        estadoAtual.paleteId = null;
        if (estadoAtual.coletaId) carregarPaletes(estadoAtual.coletaId);
        validarDestino();
    });

    // Mudança de Palete
    selectPalete.addEventListener('change', (e) => {
        estadoAtual.paleteId = e.target.value;
        validarDestino();
    });

    // Bipagem (Tecla ENTER)
    inputBipagem.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const lido = e.target.value.trim();
            if (!lido) return;
            e.target.value = '';
            await processarBipagem(lido);
        }
    });

    // Botão Encerrar NF (Explicito)
    document.getElementById('btn-encerrar-nf').addEventListener('click', () => {
        if (estadoAtual.nf) encerrarESalvarNfAtual(true);
    });

    // Criação Rápida de Coleta/Palete (Automática com incremento)
    document.getElementById('btn-nova-coleta').addEventListener('click', async () => {
        try {
            ModalSystem.showLoading('Criando nova Coleta...');
            const res = await fetch('/api/expedicao/coletas', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const novaColeta = await res.json();
            await carregarColetas();
            document.getElementById('select-coleta').value = novaColeta.id;
            estadoAtual.coletaId = novaColeta.id;
            estadoAtual.paleteId = null;
            await carregarPaletes(novaColeta.id);
            validarDestino();
            await carregarHierarquiaHoje();
            ModalSystem.hideLoading();
        } catch (e) { console.error(e); ModalSystem.hideLoading(); ModalSystem.alert('Erro ao criar coleta', 'Erro'); }
    });

    document.getElementById('btn-delete-coleta').addEventListener('click', () => {
        if (!estadoAtual.coletaId) return;
        ModalSystem.confirm("Tem certeza que deseja deletar esta coleta (e todos os paletes vazios dela)?", "Excluir Coleta", () => {
            ModalSystem.prompt("Digite a Senha Diária (PIN) de separação:", "Autenticação Necessária", async (pin) => {
                if (!pin) return;
                try {
                    ModalSystem.showLoading('Validando PIN...');
                    const resPin = await fetch('/api/expedicao/validar-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senhaDigitada: pin }) });
                    const pinData = await resPin.json();
                    if (!pinData.success) {
                        ModalSystem.hideLoading();
                        return ModalSystem.alert(pinData.message, 'Acesso Negado');
                    }
                    // Pin OK, avança exclusão
                    const delRes = await fetch(`/api/expedicao/coletas/${estadoAtual.coletaId}`, { method: 'DELETE' });
                    const delData = await delRes.json();

                    if (!delRes.ok || !delData.success) {
                        ModalSystem.hideLoading();
                        return ModalSystem.alert(delData.message || 'Erro ao deletar coleta.', 'Ação Negada');
                    }

                    estadoAtual.coletaId = null;
                    estadoAtual.paleteId = null;
                    await carregarColetas();
                    await carregarHierarquiaHoje();

                    document.getElementById('select-palete').innerHTML = '<option value="">Selecione uma coleta primeiro</option>';
                    document.getElementById('select-palete').disabled = true;
                    document.getElementById('btn-novo-palete').disabled = true;
                    validarDestino();
                    ModalSystem.hideLoading();
                } catch (e) { console.error(e); ModalSystem.hideLoading(); ModalSystem.alert('Erro fatal ao deletar coleta.', 'Erro'); }
            }, 'password');
        });
    });

    document.getElementById('btn-novo-palete').addEventListener('click', async () => {
        if (estadoAtual.coletaId) {
            try {
                ModalSystem.showLoading('Criando novo Palete...');
                const res = await fetch('/api/expedicao/paletes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coleta_id: estadoAtual.coletaId }) });
                const novoPalete = await res.json();
                await carregarPaletes(estadoAtual.coletaId);
                document.getElementById('select-palete').value = novoPalete.id;
                estadoAtual.paleteId = novoPalete.id;
                validarDestino();
                await carregarHierarquiaHoje();
                ModalSystem.hideLoading();
            } catch (e) { console.error(e); ModalSystem.hideLoading(); ModalSystem.alert('Erro ao criar palete', 'Erro'); }
        }
    });

    // Botão rápido (duplicata de conveniência na área de bipagem)
    document.getElementById('btn-novo-palete-quick').addEventListener('click', () => {
        document.getElementById('btn-novo-palete').click();
    });

    document.getElementById('btn-delete-palete').addEventListener('click', () => {
        if (!estadoAtual.paleteId) return;
        ModalSystem.confirm("Tem certeza que deseja deletar este palete?", "Excluir Palete", () => {
            ModalSystem.prompt("Digite a Senha Diária (PIN) de separação:", "Autenticação Necessária", async (pin) => {
                if (!pin) return;
                try {
                    ModalSystem.showLoading('Validando PIN...');
                    const resPin = await fetch('/api/expedicao/validar-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senhaDigitada: pin }) });
                    const pinData = await resPin.json();
                    if (!pinData.success) {
                        ModalSystem.hideLoading();
                        return ModalSystem.alert(pinData.message, 'Acesso Negado');
                    }
                    // Pin OK, avança
                    const delRes = await fetch(`/api/expedicao/paletes/${estadoAtual.paleteId}`, { method: 'DELETE' });
                    const delData = await delRes.json();

                    if (!delRes.ok || !delData.success) {
                        ModalSystem.hideLoading();
                        return ModalSystem.alert(delData.message || 'Erro ao deletar palete.', 'Ação Negada');
                    }

                    estadoAtual.paleteId = null;
                    await carregarPaletes(estadoAtual.coletaId);
                    await carregarHierarquiaHoje();
                    validarDestino();
                    ModalSystem.hideLoading();
                } catch (e) { console.error(e); ModalSystem.hideLoading(); ModalSystem.alert('Erro fatal ao deletar palete.', 'Erro'); }
            }, 'password');
        });
    });

    const btnImprimirResumo = document.getElementById('btn-imprimir-resumo');
    if (btnImprimirResumo) {
        btnImprimirResumo.addEventListener('click', () => {
            imprimirResumoVisual();
        });
    }
}

function validarDestino() {
    const area = document.getElementById('area-bipagem');
    const status = document.getElementById('status-configuracao');
    const input = document.getElementById('input-bipagem');
    const btnDelColeta = document.getElementById('btn-delete-coleta');
    const btnDelPalete = document.getElementById('btn-delete-palete');
    const btnNovoPaleteQuick = document.getElementById('btn-novo-palete-quick');
    const paleteLabel = document.getElementById('palete-indicator-label');

    if (btnDelColeta) btnDelColeta.disabled = !estadoAtual.coletaId;

    // Atualizar indicador de palete
    if (btnNovoPaleteQuick) btnNovoPaleteQuick.disabled = !estadoAtual.coletaId;
    if (paleteLabel) {
        const selectPalete = document.getElementById('select-palete');
        if (estadoAtual.paleteId && selectPalete) {
            const selectedOption = selectPalete.options[selectPalete.selectedIndex];
            paleteLabel.textContent = selectedOption ? selectedOption.text : 'Palete selecionado';
            paleteLabel.style.color = 'var(--accent-orange)';
            paleteLabel.style.fontWeight = '700';
        } else {
            paleteLabel.textContent = 'Nenhum palete selecionado';
            paleteLabel.style.color = 'var(--text-secondary)';
            paleteLabel.style.fontWeight = '400';
        }
    }

    if (estadoAtual.coletaId && estadoAtual.paleteId) {
        area.style.opacity = '1';
        area.style.pointerEvents = 'auto';
        status.style.display = 'none';
        if (btnDelPalete) btnDelPalete.disabled = false;
        input.focus();
    } else {
        area.style.opacity = '0.5';
        area.style.pointerEvents = 'none';
        status.style.display = 'block';
        if (btnDelPalete) btnDelPalete.disabled = true;
    }

    // Atualiza badge de volumes do palete ativo
    atualizarContadorVolumes(null, estadoAtual.paleteId);
}

// ==========================================
// 3. LÓGICA DE INTERPRETAÇÃO (NF vs CARREGADOR)
// ==========================================
async function processarBipagem(codigoLido) {
    if (!codigoLido) return;

    try {
        const res = await fetch('/api/expedicao/identificar-codigo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: codigoLido })
        });
        const apiData = await res.json();

        if (!apiData.success) {
            tocarErro();
            ToastSystem.warning(apiData.message, 3500);
            return;
        }

        if (apiData.type === 'carregador') {
            const carregadorEncontrado = apiData.data;
            if (!estadoAtual.nf) {
                tocarErro();
                ToastSystem.warning('Você precisa bipar uma NF antes de bipar os carregadores.', 3500);
                return;
            }

            if (estadoAtual.carregadoresBipados.includes(carregadorEncontrado.id)) {
                tocarNotificacao();
                return;
            }

            estadoAtual.carregadoresBipados.push(carregadorEncontrado.id);
            // Armazenar temporariamente dados visuais
            carregadoresAtivos[carregadorEncontrado.codigo_barras] = carregadorEncontrado;
            atualizarUI();
            tocarNotificacao();

        } else if (apiData.type === 'nfe') {
            if (estadoAtual.nf) {
                await encerrarESalvarNfAtual();
            }

            estadoAtual.nf = apiData.nfe;
            estadoAtual.carregadoresBipados = [];
            atualizarUI();
            tocarNotificacao();
        }

    } catch (err) {
        console.error(err);
        tocarErro();
        ToastSystem.error('Erro de conexão ao identificar código.', 3500);
    }
}

async function encerrarESalvarNfAtual(explicit = false) {
    if (!estadoAtual.nf) return;

    if (estadoAtual.carregadoresBipados.length === 0) {
        // Agora o erro e o modal disparam sempre, seja clicando no botão ou bipando uma nova NF
        tocarErro();
        ToastSystem.warning(`A NF ${estadoAtual.nf} não foi dada como expedida, pois nenhum carregador foi bipado.`, 4000);

        // Descarta localmente e aborta o salvamento
        estadoAtual.nf = null;
        estadoAtual.carregadoresBipados = [];
        atualizarUI();
        return;
    }

    try {
        const bodyData = {
            palete_id: estadoAtual.paleteId,
            nf: estadoAtual.nf,
            carregadores: estadoAtual.carregadoresBipados // Array de IDs
        };

        const response = await fetch('/api/expedicao/registrar-bipagem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) throw new Error('Erro ao salvar bipagem.');

        // Sucesso! Limpa o estado da NF
        estadoAtual.nf = null;
        estadoAtual.carregadoresBipados = [];
        atualizarUI();
        await carregarHierarquiaHoje(); // Atualiza a tabela na nuvem local!

    } catch (e) {
        console.error(e);
        tocarErro();
        ToastSystem.error('Falha na Gravação: Erro ao salvar a NF no banco.', 4000);
    }
}

function atualizarUI() {
    const displayNf = document.getElementById('display-nf');
    const ulCarregadores = document.getElementById('lista-carregadores-bipados');
    const btnEncerrar = document.getElementById('btn-encerrar-nf');

    if (estadoAtual.nf) {
        displayNf.innerText = estadoAtual.nf;
        btnEncerrar.style.display = 'block';
        document.getElementById('box-nf-atual').style.borderColor = 'var(--accent-orange)';
    } else {
        displayNf.innerText = 'Nenhuma';
        btnEncerrar.style.display = 'none';
        document.getElementById('box-nf-atual').style.borderColor = 'var(--bg-tertiary)';
    }

    ulCarregadores.innerHTML = '';
    if (estadoAtual.carregadoresBipados.length === 0) {
        ulCarregadores.innerHTML = '<li class="text-muted" style="font-weight: normal; font-size: 0.9rem;">Nenhum bipado ainda.</li>';
    } else {
        estadoAtual.carregadoresBipados.forEach(id => {
            // Busca o nome pelo ID no dicionário
            const obj = Object.values(carregadoresAtivos).find(c => c.id === id);
            if (obj) {
                ulCarregadores.innerHTML += `<li style="margin-bottom: 5px;"><i class="fas fa-user-check" style="color: var(--color-success); margin-right: 5px;"></i> ${obj.nome}</li>`;
            }
        });
    }
}

function tocarNotificacao() {
    const audio = document.getElementById('audio-success');
    if (audio) { audio.currentTime = 0; audio.play().catch(e => console.log('Audio error:', e)); }
}

function tocarErro() {
    const audio = document.getElementById('audio-error'); // Idealmente você teria um error.mp3
    if (audio) { audio.currentTime = 0; audio.play().catch(e => console.log('Audio error:', e)); }
}

// ==========================================
// 4. HIERARQUIA EM TEMPO REAL
// ==========================================
async function carregarHierarquiaHoje() {
    const container = document.getElementById('hierarquia-container');
    const badgeTotal = document.getElementById('badge-total-nfs');
    if (!container || !badgeTotal) return;

    try {
        const req = await fetch('/api/expedicao/hierarquia-hoje');
        const res = await req.json();

        if (!res.success) {
            container.innerHTML = '<div class="alert-custom"><i class="fas fa-times-circle"></i> Erro ao carregar a hierarquia.</div>';
            return;
        }

        const coletas = res.data;
        if (coletas.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhuma expedição efetuada hoje.</div>';
            badgeTotal.innerText = '0 NFs expedidas';
            return;
        }

        let html = '';
        let totalNfsGeral = 0;

        coletas.forEach((coleta, i) => {
            let nfsColetaCount = 0;
            let htmlPaletes = '';

            const jsonOutrosPaletes = JSON.stringify(coleta.paletes.map(p => ({ id: p.id, nome: p.nome }))).replace(/"/g, '&quot;');

            coleta.paletes.forEach(palete => {
                const totalNfPalete = palete.registros.length;
                nfsColetaCount += totalNfPalete;

                let badgesNfs = palete.registros.map(r => {
                    const extraClass = r.is_kit ? ' kit' : '';
                    const icon = r.is_kit ? '<i class="fas fa-boxes" style="margin-right: 4px;"></i>' : '<i class="fas fa-box" style="margin-right: 4px;"></i>';
                    return `<div class="h-nf-tag${extraClass}" style="cursor: pointer;" onclick="window.abrirAcoesNf('${r.nf}', ${coleta.id}, ${palete.id}, '${jsonOutrosPaletes}')">${icon} ${r.nf}</div>`;
                }).join('');

                if (palete.registros.length === 0) {
                    badgesNfs = '<div style="color: var(--text-muted); font-size: 0.85rem;">Palete vazio</div>';
                }

                const paleteId = `palete-content-${coleta.id}-${palete.id}`;

                htmlPaletes += `
                    <div class="h-palete-box" data-palete-id="${palete.id}">
                        <div class="h-palete-title" style="cursor: pointer; user-select: none;" onclick="document.getElementById('${paleteId}').classList.toggle('open'); this.querySelector('.palete-chevron').classList.toggle('rotated');">
                            <span><i class="fas fa-pallet" style="margin-right: 6px; color: var(--text-muted);"></i> ${palete.nome} <i class="fas fa-chevron-down palete-chevron" style="font-size: 0.7rem; margin-left: 6px; transition: transform 0.2s ease; color: var(--text-muted);"></i></span>
                            <span style="color: var(--accent-orange);">${totalNfPalete} vol</span>
                        </div>
                        <div class="h-nf-tags h-palete-collapsible" id="${paleteId}" data-palete-id="${palete.id}">
                            ${badgesNfs}
                        </div>
                    </div>
                `;
            });

            totalNfsGeral += nfsColetaCount;

            html += `
                <div class="h-coleta-card" data-coleta-id="${coleta.id}">
                    <div class="h-coleta-header" onclick="this.nextElementSibling.classList.toggle('open')">
                        <div class="h-coleta-title"><i class="fas fa-truck"></i> ${coleta.nome}</div>
                        <div class="h-coleta-stats">${nfsColetaCount} Expedições</div>
                    </div>
                    <div class="h-coleta-content" data-coleta-id="${coleta.id}">
                        ${htmlPaletes || '<div style="text-align: center; color: var(--text-muted); padding: 1rem;">Nesta coleta os paletes estão vazios.</div>'}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        badgeTotal.innerText = `${totalNfsGeral} NFs expedidas`;

        // Focaliza a coleta/palete ativo automaticamente
        focalizarHierarquia();
    } catch (e) {
        console.error('Erro na hierarquia', e);
        container.innerHTML = '<div class="alert-custom"><i class="fas fa-wifi"></i> Falha de conexão ao baixar hierarquia.</div>';
    }
}

/**
 * Colapsa todas as coletas/paletes e expande SOMENTE a coleta e palete
 * que o operador está usando no momento (baseado em estadoAtual).
 */
function focalizarHierarquia() {
    const container = document.getElementById('hierarquia-container');
    if (!container) return;

    const activeColetaId = estadoAtual.coletaId;
    const activePaleteId = estadoAtual.paleteId;

    // 1. Colapsa TODAS as coletas
    container.querySelectorAll('.h-coleta-content').forEach(el => {
        el.classList.remove('open');
    });

    // 2. Colapsa TODOS os paletes e reseta setas
    container.querySelectorAll('.h-palete-collapsible').forEach(el => {
        el.classList.remove('open');
    });
    container.querySelectorAll('.palete-chevron').forEach(el => {
        el.classList.remove('rotated');
    });

    // 3. Abre SOMENTE a coleta ativa
    if (activeColetaId) {
        const coletaContent = container.querySelector(`.h-coleta-content[data-coleta-id="${activeColetaId}"]`);
        if (coletaContent) {
            coletaContent.classList.add('open');
        }
    }

    // 4. Abre SOMENTE o palete ativo e rotaciona sua seta
    if (activePaleteId) {
        const paleteContent = container.querySelector(`.h-palete-collapsible[data-palete-id="${activePaleteId}"]`);
        if (paleteContent) {
            paleteContent.classList.add('open');
            const title = paleteContent.previousElementSibling;
            if (title) {
                const chevron = title.querySelector('.palete-chevron');
                if (chevron) chevron.classList.add('rotated');
            }
        }
    }

    // 5. Atualiza contador de volumes do palete ativo
    atualizarContadorVolumes(container, activePaleteId);
}

function atualizarContadorVolumes(container, activePaleteId) {
    const badge = document.getElementById('palete-vol-count');
    if (!badge) return;

    if (!activePaleteId) {
        badge.style.display = 'none';
        return;
    }

    if (!container) container = document.getElementById('hierarquia-container');

    let count = 0;
    if (container) {
        const paleteContent = container.querySelector(`.h-palete-collapsible[data-palete-id="${activePaleteId}"]`);
        if (paleteContent) {
            count = paleteContent.querySelectorAll('.h-nf-tag').length;
        }
    }

    badge.textContent = `${count} vol`;
    badge.style.display = 'inline-block';
}

// ==========================================
// 5. EXPORTAÇÃO VISUAL (PDF)
// ==========================================
function imprimirResumoVisual() {
    const container = document.getElementById('hierarquia-container');
    if (!container) return;

    ModalSystem.showLoading('Preparando PDF Documental...');

    // Força a abertura de todos os acordeões para o PDF registrar todas NFs
    const conteudos = container.querySelectorAll('.h-coleta-content');
    const paleteConteudos = container.querySelectorAll('.h-palete-collapsible');
    
    conteudos.forEach(c => c.classList.add('open'));
    paleteConteudos.forEach(p => p.classList.add('open'));

    // Configuração do html2pdf
    const element = document.querySelector('.hierarchy-panel');
    const opt = {
        margin:       10,
        filename:     `Resumo_Expedicao_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
            scale: 2, 
            useCORS: true,
            scrollY: 0,
            scrollX: 0,
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: element.scrollHeight
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: 'css', inside: 'avoid' } // Garante que a quebra não corte um palete na metade se possível
    };

    setTimeout(() => {
        html2pdf().set(opt).from(element).save().then(() => {
            ModalSystem.hideLoading();
        }).catch(err => {
            console.error(err);
            ModalSystem.hideLoading();
            ModalSystem.alert('Erro ao gerar o PDF documental.', 'Erro');
        });
    }, 500); // 500ms para aguardar a renderização do CSS 'open'
}

// ==========================================
// 6. AÇÕES GLOBAIS NA HIERARQUIA DA NOTA FISCAL
// ==========================================
window.abrirAcoesNf = function(nf, coletaId, paleteIdAtual, jsonPaletes) {
    const paletesAll = JSON.parse(jsonPaletes);
    const paletesDiferentes = paletesAll.filter(p => p.id !== paleteIdAtual);

    let selectorHtml = '';
    if (paletesDiferentes.length > 0) {
        let options = paletesDiferentes.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
        selectorHtml = `
            <div style="background: rgba(255,255,255,0.02); border-radius: 8px; padding: 12px; margin: 15px 0; border: 1px solid rgba(255,255,255,0.05);">
                <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 8px; font-weight: 600;"><i class="fas fa-pallet"></i> Mover para Palete Existente:</label>
                <div style="display: flex; gap: 8px;">
                    <select id="select-acao-palete" class="form-control" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid rgba(255,255,255,0.1); flex: 1; border-radius: 6px; outline: none;">
                        ${options}
                    </select>
                    <button type="button" class="btn-premium orange" style="padding: 0 15px; border-radius: 6px;" onclick="window.executarAcaoNf('mover_existente', '${nf}', ${coletaId})">
                        <i class="fas fa-check"></i> Mover
                    </button>
                </div>
            </div>
        `;
    } else {
        selectorHtml = `
            <div style="background: rgba(255,255,255,0.02); border-radius: 8px; padding: 12px; margin: 15px 0; border: 1px solid rgba(255,255,255,0.05); opacity: 0.5;">
                <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-bottom: 8px; font-weight: 600;"><i class="fas fa-pallet"></i> Mover para Palete Existente:</label>
                <div style="display: flex; gap: 8px;">
                    <select id="select-acao-palete" class="form-control" disabled style="background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.1); flex: 1; border-radius: 6px; outline: none;">
                        <option value="">Não há outros paletes nesta coleta</option>
                    </select>
                    <button type="button" disabled class="btn-premium orange" style="padding: 0 15px; border-radius: 6px; opacity: 0.5; cursor: not-allowed;">
                        <i class="fas fa-check"></i> Mover
                    </button>
                </div>
            </div>
        `;
    }

    const modalHtml = `
        <div style="text-align: left; padding: 5px 10px;">
            <div style="text-align: center; margin-bottom: 20px; background: rgba(240, 124, 0, 0.05); padding: 10px; border-radius: 8px; border: 1px dashed rgba(240, 124, 0, 0.3);">
                <span style="color: var(--accent-orange); font-size: 0.85rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 5px;">Nota Fiscal Selecionada</span>
                <strong style="color:var(--text-primary); font-size: 1.4rem; letter-spacing: 1px;">${nf}</strong>
            </div>

            <button type="button" style="width: 100%; cursor: pointer; margin-bottom: 15px; padding: 12px; font-size: 1rem; border-radius: 8px; display: flex; justify-content: center; align-items: center; gap: 10px; background: rgba(220, 53, 69, 0.1); color: #ff6b6b; border: 1px solid rgba(220, 53, 69, 0.3); transition: 0.2s;" onmouseover="this.style.background='rgba(220, 53, 69, 0.2)'" onmouseout="this.style.background='rgba(220, 53, 69, 0.1)'" onclick="window.executarAcaoNf('retirar', '${nf}', ${coletaId})">
                <i class="fas fa-trash-alt"></i> Remover da Expedição
            </button>

            ${selectorHtml}

            <button type="button" style="width: 100%; cursor: pointer; margin-top: 10px; padding: 12px; font-size: 1rem; border-radius: 8px; display: flex; justify-content: center; align-items: center; gap: 10px; background: transparent; border: 1px dashed var(--accent-orange); color: var(--accent-orange); transition: 0.2s;" onmouseover="this.style.background='rgba(240, 124, 0, 0.1)'" onmouseout="this.style.background='transparent'" onclick="window.executarAcaoNf('mover_novo', '${nf}', ${coletaId})">
                <i class="fas fa-plus-circle"></i> Enviar para Novo Palete
            </button>

            <button type="button" style="width: 100%; cursor: pointer; margin-top: 20px; padding: 10px; font-size: 0.95rem; border-radius: 8px; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid rgba(255,255,255,0.1); transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'" onclick="document.getElementById('customModalBtnCancel').click()">
                Fechar Menu
            </button>
        </div>
    `;

    // Usaremos ModalSystem.confirm para suportar os cliques, mas com controles nativos ocultos
    ModalSystem.confirm(
        modalHtml,
        `Ações Disponíveis`,
        () => {}, 
        () => {} 
    );
    
    // Escondemos os controles nativos para usar apenas o nosso modal customizado
    setTimeout(() => {
        const btnConfirm = document.getElementById('customModalBtnConfirm');
        if (btnConfirm) btnConfirm.style.display = 'none';
        const btnCancel = document.getElementById('customModalBtnCancel');
        if (btnCancel) btnCancel.style.display = 'none';
        // Garantindo limpeza de inline styles velhos se existiam:
        if (btnCancel) {
            btnCancel.style.width = '';
            btnCancel.innerText = 'Cancelar'; 
        }
    }, 10);
};

window.executarAcaoNf = function(action, nf, coletaId) {
    let targetPaleteId = null;

    if (action === 'mover_existente') {
        const sel = document.getElementById('select-acao-palete');
        targetPaleteId = sel ? sel.value : null;
        if (!targetPaleteId) return;
    }

    // Função que efetua o fetch em si
    const triggerMovimentacaoFetch = async () => {
        try {
            ModalSystem.showLoading('Processando movimentação...');
            const res = await fetch('/api/expedicao/nf/movimentar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, nf, coletaId, targetPaleteId })
            });
            const data = await res.json();
            
            ModalSystem.hideLoading();

            if (data.success) {
                if (typeof ToastSystem !== 'undefined') {
                    ToastSystem.success(data.message, 3000);
                } else {
                    alert(data.message);
                }
                await carregarHierarquiaHoje();
                
                if (action === 'mover_novo') {
                     await carregarPaletes(coletaId);
                }
            } else {
                ModalSystem.alert(data.message, 'Falha na Operação');
            }
        } catch (e) {
            console.error(e);
            ModalSystem.hideLoading();
            ModalSystem.alert('Erro ao se conectar ao servidor.', 'Erro');
        }
    };

    // Fecha o popup do menu de opções principal primeiro
    const cancelBtn = document.getElementById('customModalBtnCancel');
    if (cancelBtn) cancelBtn.click();

    // Se for 'retirar', pedimos confirmação extra DEPOIS que o primeiro modal se ocultar
    if (action === 'retirar') {
        setTimeout(() => {
            ModalSystem.confirm(
                `Remover esta nota anulará a expedição dela e removerá os pontos rateados dos carregadores.<br>Tem certeza que deseja remover a NF <strong>${nf}</strong>?`,
                'Remover NF',
                () => { triggerMovimentacaoFetch(); },
                () => {} // Cancel, do nothing
            );
        }, 300); // 300ms de delay para evitar colisão entre fechar um modal e abrir o outro imediatamente
    } else {
        triggerMovimentacaoFetch();
    }
};