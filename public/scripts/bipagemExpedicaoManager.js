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
}

function validarDestino() {
    const area = document.getElementById('area-bipagem');
    const status = document.getElementById('status-configuracao');
    const input = document.getElementById('input-bipagem');
    const btnDelColeta = document.getElementById('btn-delete-coleta');
    const btnDelPalete = document.getElementById('btn-delete-palete');

    if (btnDelColeta) btnDelColeta.disabled = !estadoAtual.coletaId;

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
            ModalSystem.alert(apiData.message, 'Não reconhecido');
            return;
        }

        if (apiData.type === 'carregador') {
            const carregadorEncontrado = apiData.data;
            if (!estadoAtual.nf) {
                tocarErro();
                ModalSystem.alert('Você precisa bipar uma NF antes de bipar os carregadores.', 'Aviso');
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
        ModalSystem.alert('Erro de conexão ao identificar código.', 'Erro de Rede');
    }
}

async function encerrarESalvarNfAtual(explicit = false) {
    if (!estadoAtual.nf) return;

    if (estadoAtual.carregadoresBipados.length === 0) {
        // Agora o erro e o modal disparam sempre, seja clicando no botão ou bipando uma nova NF
        tocarErro();
        ModalSystem.alert(
            `A NF ${estadoAtual.nf} não foi dada como expedida, pois nenhum carregador foi bipado.`,
            'Aviso: NF Não Expedida'
        );

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
        ModalSystem.alert('Erro ao salvar a NF no banco de dados.', 'Falha na Gravação');
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
            const isFirst = i === 0;
            let nfsColetaCount = 0;
            let htmlPaletes = '';

            coleta.paletes.forEach(palete => {
                const totalNfPalete = palete.registros.length;
                nfsColetaCount += totalNfPalete;

                let badgesNfs = palete.registros.map(r => {
                    const extraClass = r.is_kit ? ' kit' : '';
                    const icon = r.is_kit ? '<i class="fas fa-boxes" style="margin-right: 4px;"></i>' : '<i class="fas fa-box" style="margin-right: 4px;"></i>';
                    return `<div class="h-nf-tag${extraClass}">${icon} ${r.nf}</div>`;
                }).join('');

                if (palete.registros.length === 0) {
                    badgesNfs = '<div style="color: var(--text-muted); font-size: 0.85rem;">Palete vazio</div>';
                }

                htmlPaletes += `
                    <div class="h-palete-box">
                        <div class="h-palete-title">
                            <span><i class="fas fa-pallet" style="margin-right: 6px; color: var(--text-muted);"></i> ${palete.nome}</span>
                            <span style="color: var(--accent-orange);">${totalNfPalete} vol</span>
                        </div>
                        <div class="h-nf-tags">
                            ${badgesNfs}
                        </div>
                    </div>
                `;
            });

            totalNfsGeral += nfsColetaCount;

            html += `
                <div class="h-coleta-card">
                    <div class="h-coleta-header" onclick="this.nextElementSibling.classList.toggle('open')">
                        <div class="h-coleta-title"><i class="fas fa-truck"></i> ${coleta.nome}</div>
                        <div class="h-coleta-stats">${nfsColetaCount} Expedições</div>
                    </div>
                    <div class="h-coleta-content ${isFirst ? 'open' : ''}">
                        ${htmlPaletes || '<div style="text-align: center; color: var(--text-muted); padding: 1rem;">Nesta coleta os paletes estão vazios.</div>'}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        badgeTotal.innerText = `${totalNfsGeral} NFs expedidas`;
    } catch (e) {
        console.error('Erro na hierarquia', e);
        container.innerHTML = '<div class="alert-custom"><i class="fas fa-wifi"></i> Falha de conexão ao baixar hierarquia.</div>';
    }
}