// services/gmailService.js

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const { poolInova, poolMonitora } = require('../config/db');

// Escopos de permissão: ler, enviar e modificar e-mails.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'config', 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'config', 'token.json');

const TRANSPORTADORA_APELIDOS_MAP = {
  'JEW TRANSPORTES LTDA': 'JEW',
  'DOMINALOG': 'DOMINALOG',
  'I. AMORIN TRANSPORTES EIRELI': 'LOG+',
  'I AMORIN TRANSPORTES EIRELLI': 'LOG+',
  'RISSO ENCOMENDAS CENTRO OESTE LTDA': 'RISSO',
  'MFA TRANSPORTES E LOGISTICA': 'MFA',
  'M F A TRANSPORTES E LOGISTICA LTDA': 'MFA',
  'MFA TRANSPORTES E LOGISTICA LTDA': 'MFA',
  'GAO LOG TRANSPORTES': 'GAOLOG',
  'ATUAL CARGAS E TRANSPORTES LTDA': 'ATUAL CARGAS',
  'FRENET': 'FRENET',
};

// --- MAPA DE E-MAILS DAS TRANSPORTADORAS ---
/*const CARRIER_EMAILS = {
    'ATUAL CARGAS': ['ocorrencias@atualcargas.com.br', 'tracking@atualcargas.com.br', 'faltas@atualcargas.com.br', 'adicionais@atualcargas.com.br', 'reversa@atualcargas.com.br'],
    'DOMINALOG': ['barrar.entrega@dominalog.com.br', 'atendimento@dominalog.com.br', 'recebe.reversa@dominalog.com.br', 'atendimento_reversa@dominalog.com.br'],
    'LOG+': ['devolucao@logmaistransportes.com.br', 'filialsjrp@logmaistransportes.com.br', 'sac2@logmaistransportes.com.br'],
    'GAOLOG': ['fabiogao.log@gmail.com', 'sac1amm@gaolog.com.br', 'operacionalvg@gaolog.com.br'],
    'MFA': {
        'SUL_SUDESTE': ['suporte.sjp02@lmslog.com.br', 'atendimento.sjp@lmslog.com.br', 'operacional.sjp@lmslog.com.br'], // PR, SC, RS, SP, RJ, MG, ES
        'NORDESTE': ['suporte.sjp@lmslog.com.br', 'atendimento.sjp@lmslog.com.br', 'operacional.sjp@lmslog.com.br'],    // MA, PI, CE, RN, PB, PE, AL, SE, BA
        'CENTRO_NORTE': ['atendimento.go@lmslog.com.br', 'suporte.go@lmslog.com.br', 'atendimento.sjp@lmslog.com.br', 'operacional.sjp@lmslog.com.br'] // MT, MS, GO, DF, AC, TO, PA, RO, AM, RR, AP
    }
};*/

const CARRIER_EMAILS = {
    'ATUAL CARGAS': ['joaoopedrosantos003@gmail.com'],
    'DOMINALOG': ['joaoopedrosantos003@gmail.com'],
    'LOG+': ['joaoopedrosantos003@gmail.com'],
    'GAOLOG': ['joaoopedrosantos003@gmail.com'],
    'MFA': {
        'SUL_SUDESTE': ['joaoopedrosantos003@gmail.com'], // PR, SC, RS, SP, RJ, MG, ES
        'NORDESTE': ['joaoopedrosantos003@gmail.com'],    // MA, PI, CE, RN, PB, PE, AL, SE, BA
        'CENTRO_NORTE': ['joaoopedrosantos003@gmail.com'] // MT, MS, GO, DF, AC, TO, PA, RO, AM, RR, AP
    }
};

function getApelidoFromNomeCompleto(nomeCompleto) {
    if (!nomeCompleto) return null;
    const nomeUpper = String(nomeCompleto).toUpperCase();
    for (const key in TRANSPORTADORA_APELIDOS_MAP) {
        // Usa 'includes' para flexibilidade (ex: "MFA TRANSPORTES" no DB e "MFA TRANSPORTES E LOGISTICA" no mapa)
        if (nomeUpper.includes(key.toUpperCase())) {
            return TRANSPORTADORA_APELIDOS_MAP[key];
        }
    }
    return null; // Retorna nulo se não encontrar um apelido
}

async function getMessageDetails(messageId) {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full' // Pedimos o formato completo para ter acesso ao payload e headers
    });

    return res.data;
}

/**
 * Carrega as credenciais salvas do arquivo token.json.
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Salva as credenciais no arquivo token.json.
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Função principal de autorização. Tenta carregar as credenciais salvas,
 * se não conseguir, inicia o fluxo de autenticação local.
 */
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Garante que o marcador "Sistema" exista e retorna seu ID.
 */
async function ensureLabelExists(gmail) {
    const res = await gmail.users.labels.list({ userId: 'me' });
    const labels = res.data.labels;
    const systemLabel = labels.find(label => label.name === 'Sistema');

    if (systemLabel) {
        return systemLabel.id;
    } else {
        const newLabel = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
                name: 'Sistema',
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            },
        });
        return newLabel.data.id;
    }
}

/**
 * Determina os e-mails corretos da transportadora com base no nome e, se necessário, no estado.
 */
function getCarrierEmail(transportadora, uf) {
    const upperTransp = transportadora ? transportadora.toUpperCase() : '';

    const apelido = getApelidoFromNomeCompleto(transportadora);
    if (!apelido) {
        return null;
    }

    const emails = CARRIER_EMAILS[apelido];

    if (apelido === 'MFA') {
        if (!uf) return null; 
        const regioes = {
            SUL_SUDESTE: ['PR', 'SC', 'RS', 'SP', 'RJ', 'MG', 'ES'],
            NORDESTE: ['MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA'],
        };
        if (regioes.SUL_SUDESTE.includes(uf)) return emails.SUL_SUDESTE;
        if (regioes.NORDESTE.includes(uf)) return emails.NORDESTE;
        return emails.CENTRO_NORTE; // Restante dos estados
    }

    if (upperTransp.includes('RISSO ENCOMENDAS CENTRO OESTE LTDA')) {
        return [
            'joaoopedrosantos003@gmail.com'
        ];
    }

    if (upperTransp.includes('JEW TRANSPORTES LTDA')) {
        return [
            'joaoopedrosantos003@gmail.com'
        ];
    }

    
    return emails;
}

// services/gmailService.js

async function sendPositionRequestEmail(pedido) {
    // Validação para garantir que temos os dados necessários
    if (!pedido || !pedido.transportadora || !pedido.nfe_numero) {
        throw new Error('Dados insuficientes no pedido para enviar e-mail de cobrança.');
    }
    
    const toEmails = getCarrierEmail(pedido.transportadora, pedido.etiqueta_uf);
    if (!toEmails) {
        throw new Error(`E-mails de destino não configurados para a transportadora: ${pedido.transportadora}`);
    }

    const saudaçao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
    const emailSubject = `Posição de Entrega - NF ${pedido.nfe_numero} - Inova Móveis`;
    const emailBody = `
        <p>${saudaçao}, equipe ${pedido.transportadora},</p>
        <p>Venho por meio deste e-mail solicitar, por gentileza, uma posição de entrega referente à <strong>Nota Fiscal nº ${pedido.nfe_numero}</strong>.</p>
        <p><strong>Detalhes do Destinatário:</strong></p>
        <ul>
            <li><strong>Cliente:</strong> ${pedido.etiqueta_nome || 'Não informado'}</li>
            ${pedido.documento_cliente ? `<li><strong>CPF/CNPJ:</strong> ${pedido.documento_cliente}</li>` : ''}
            <li><strong>Cidade/UF:</strong> ${pedido.etiqueta_municipio || 'Não informada'} - ${pedido.etiqueta_uf || 'N/D'}</li>
        </ul>
        <p>Agradecemos a atenção e aguardamos o retorno.</p>
        <p>Atenciosamente,<br>Equipe de Rastreio - Inova Móveis</p>
    `;

    // A função 'sendEmail' já existe e faz o envio. Vamos reutilizá-la.
    const sentMessage = await sendEmail(toEmails, emailSubject, emailBody);

    if (!sentMessage || !sentMessage.threadId) {
        throw new Error('Falha ao enviar o e-mail pela API do Gmail.');
    }

    // --- Lógica de Banco de Dados ---
    const client = await poolInova.connect();
    try {
        await client.query('BEGIN');

        // 1. Atualiza o pedido principal com o status e a thread do e-mail
        await client.query(
            `UPDATE pedidos_em_rastreamento SET email_status = 'Email - Em Andamento', email_thread_id = $1 WHERE id = $2`,
            [sentMessage.threadId, pedido.id]
        );

        // 2. Salva o e-mail que acabamos de enviar no histórico
        const messageDetails = await getMessageDetails(sentMessage.id);
        const headers = messageDetails.payload.headers;
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
        await client.query(
            `INSERT INTO email_history (pedido_rastreamento_id, message_id, thread_id, from_address, subject, snippet, sent_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [pedido.id, sentMessage.id, sentMessage.threadId, fromHeader ? fromHeader.value : 'N/D', subjectHeader ? subjectHeader.value : 'N/D', messageDetails.snippet || '']
        );

        await client.query('COMMIT');
        console.log(`[Gmail Service] E-mail para NFe ${pedido.nfe_numero} enviado e salvo no histórico.`);
        return { success: true, message: 'E-mail enviado e registrado com sucesso!' };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Gmail Service] Erro na transação do banco de dados para NFe ${pedido.nfe_numero}:`, error);
        throw error; // Propaga o erro para a função que chamou
    } finally {
        client.release();
    }
}

async function getThreadDetails(threadId) {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata', // Só precisamos dos metadados (cabeçalhos)
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
    });

    return res.data;
}

async function sendEmail(toEmails, subject, body) {
    const auth = await authorize();
    const gmail = google.gmail({version: 'v1', auth});
    const systemLabelId = await ensureLabelExists(gmail);

    const emailContent = [
        `Content-Type: text/html; charset="UTF--8"`,
        `MIME-Version: 1.0`,
        `Content-Transfer-Encoding: 7bit`,
        `To: ${Array.isArray(toEmails) ? toEmails.join(', ') : toEmails}`, // Aceita um array ou uma string
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        '',
        body
    ].join('\n');

    const encodedMessage = Buffer.from(emailContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
                labelIds: ['SENT', systemLabelId]
            },
        });
        console.log(`[Gmail Service] E-mail com assunto "${subject}" enviado com sucesso. Message ID: ${res.data.id}`);
        return res.data; // Retorna o objeto da mensagem enviada
    } catch (error) {
        console.error('[Gmail Service] Falha ao enviar e-mail:', error);
        throw new Error('Falha ao enviar o e-mail pela API do Gmail.');
    }
}

async function enviarEmailCobrancaManual(pedido) {
    if (!pedido || !pedido.nfe_numero) {
        throw new Error('Dados do pedido inválidos para enviar e-mail.');
    }

    if (pedido.email_thread_id) {
        return { message: 'Este pedido já possui uma conversa por e-mail em andamento.' };
    }

    // A função getCarrierEmail já lida com Risso e Jew, vamos reutilizá-la.
    const toEmails = getCarrierEmail(pedido.transportadora, pedido.etiqueta_uf);
    if (!toEmails) {
        throw new Error(`E-mails de destino não configurados para a transportadora: ${pedido.transportadora}`);
    }

    // --- [LÓGICA REPLICADA EXATAMENTE IGUAL] ---
    const saudaçao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
    const emailSubject = `Posição de Entrega - NF ${pedido.nfe_numero} - Inova Móveis`;
    const emailBody = `
        <p>${saudaçao}, equipe ${pedido.transportadora},</p>
        <p>Venho por meio deste e-mail solicitar, por gentileza, uma posição de entrega referente à <strong>Nota Fiscal nº ${pedido.nfe_numero}</strong>.</p>
        <p><strong>Detalhes do Destinatário:</strong></p>
        <ul>
            <li><strong>Cliente:</strong> ${pedido.etiqueta_nome || 'Não informado'}</li>
            ${pedido.documento_cliente ? `<li><strong>CPF/CNPJ:</strong> ${pedido.documento_cliente}</li>` : ''}
            <li><strong>Cidade/UF:</strong> ${pedido.etiqueta_municipio || 'Não informada'} - ${pedido.etiqueta_uf || 'N/D'}</li>
        </ul>
        <p>Agradecemos a atenção e aguardamos o retorno.</p>
        <p>Atenciosamente,<br>Equipe de Rastreio - Inova Móveis</p>
    `;
    
    // Utiliza a mesma função interna de envio que a automática usa
    const sentMessage = await sendEmail(toEmails, emailSubject, emailBody);

    if (!sentMessage || !sentMessage.threadId) {
        throw new Error('Falha ao enviar o e-mail pela API do Gmail.');
    }

    // Atualiza o banco de dados com o status e o ID da thread
    await poolInova.query(
        `UPDATE pedidos_em_rastreamento SET email_status = 'Email - Em Andamento', email_thread_id = $1 WHERE id = $2`,
        [sentMessage.threadId, pedido.id]
    );

    try {
        const messageDetails = await getMessageDetails(sentMessage.id);
        const headers = messageDetails.payload.headers;
        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');

        await poolInova.query(
            `INSERT INTO email_history 
            (pedido_rastreamento_id, message_id, thread_id, from_address, subject, snippet, sent_at) 
            VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
                pedido.id,
                sentMessage.id,
                sentMessage.threadId,
                fromHeader ? fromHeader.value : 'N/D',
                subjectHeader ? subjectHeader.value : 'N/D',
                messageDetails.snippet || ''
            ]
        );
        console.log(`[Gmail Service] E-mail manual para NFe ${pedido.nfe_numero} salvo no histórico.`);
    } catch (historyError) {
        console.error(`[Gmail Service] Falha ao salvar e-mail no histórico para NFe ${pedido.nfe_numero}:`, historyError);
        // Não lança o erro para não quebrar a operação principal, apenas registra o log.
    }

    console.log(`[Gmail Service] E-mail de cobrança MANUAL enviado para a NFe ${pedido.nfe_numero}. Thread ID: ${sentMessage.threadId}`);
    return { message: 'E-mail de cobrança enviado com sucesso!' };
}

// services/gmailService.js

async function verificarRespostas(pedido) {
    if (!pedido.email_thread_id) {
        //console.log(`[Gmail Service] Pedido ${pedido.numero_nfe} não possui thread de e-mail para verificar.`);
        return;
    }

    try {
        const auth = await authorize();
        const gmail = google.gmail({ version: 'v1', auth });

        const thread = await gmail.users.threads.get({
            userId: 'me',
            id: pedido.email_thread_id,
        });

        const messages = thread.data.messages;
        if (!messages || messages.length === 0) {
            return; // Nenhuma mensagem na thread
        }

        // Pega a última mensagem da conversa
        const ultimaMensagem = messages[messages.length - 1];
        const headers = ultimaMensagem.payload.headers;
        const fromHeader = headers.find(header => header.name === 'From');

        // Se o remetente da última mensagem NÃO for a sua própria conta, é uma resposta.
        if (fromHeader && !fromHeader.value.includes('sacinovamoveis@gmail.com')) { // <-- IMPORTANTE: Use o seu e-mail de envio aqui

            // Verifica se esta resposta específica já foi salva no histórico
            const checkHistoryQuery = `SELECT 1 FROM email_history WHERE message_id = $1`;
            const historyResult = await poolInova.query(checkHistoryQuery, [ultimaMensagem.id]);

            // Se a resposta ainda não existe no nosso banco (rowCount === 0), nós a adicionamos.
            if (historyResult.rowCount === 0) {
                console.log(`[Gmail Service] Nova resposta detectada para NFe ${pedido.numero_nfe}. Salvando no histórico.`);

                const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
                const snippet = ultimaMensagem.snippet || '';
                // Pega a data e hora em que o e-mail foi realmente enviado
                const sentAt = new Date(parseInt(ultimaMensagem.internalDate, 10));

                const client = await poolInova.connect();
                try {
                    // Usa uma transação para garantir que ambas as operações (INSERT e UPDATE) funcionem
                    await client.query('BEGIN');

                    // 1. Insere a nova resposta no histórico de e-mails
                    const insertQuery = `
                        INSERT INTO email_history
                        (pedido_rastreamento_id, message_id, thread_id, from_address, subject, snippet, sent_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `;
                    await client.query(insertQuery, [
                        pedido.id,
                        ultimaMensagem.id,
                        pedido.email_thread_id,
                        fromHeader.value,
                        subjectHeader ? subjectHeader.value : 'Sem assunto',
                        snippet,
                        sentAt // Salva com a data correta
                    ]);

                    // 2. Atualiza o status do pedido para 'Respondido'
                    const updateQuery = `
                        UPDATE pedidos_em_rastreamento
                        SET email_status = 'Email - Respondido', notificado_por_email = false
                        WHERE id = $1
                    `;
                    await client.query(updateQuery, [pedido.id]);

                    await client.query('COMMIT'); // Confirma as alterações
                } catch (e) {
                    await client.query('ROLLBACK'); // Desfaz em caso de erro
                    throw e;
                } finally {
                    client.release(); // Libera a conexão
                }
            }
        }
    } catch (error) {
        console.error(`[Gmail Service] Erro ao verificar respostas para thread ${pedido.email_thread_id}:`, error);
    }
}

async function enviarEmailComprovanteEntrega(pedido) {
    if (!pedido || !pedido.transportadora || !pedido.nfe_numero) {
        throw new Error('Dados insuficientes para solicitar comprovante de entrega.');
    }

    const toEmails = getCarrierEmail(pedido.transportadora, pedido.etiqueta_uf);
    if (!toEmails) {
        // Para este caso, não lançamos um erro, apenas avisamos.
        console.warn(`E-mails de destino não configurados para a transportadora: ${pedido.transportadora}. Não foi possível solicitar o comprovante.`);
        return { success: false, message: 'E-mails não configurados para a transportadora.' };
    }

    const saudaçao = new Date().getHours() < 12 ? 'Bom dia' : 'Boa tarde';
    const emailSubject = `Solicitação de Comprovante de Entrega - NF ${pedido.nfe_numero} - Inova Móveis`;
    const emailBody = `
        <p>${saudaçao}, equipe ${pedido.transportadora},</p>
        <p>Gostaríamos de solicitar, por gentileza, o <strong>comprovante de entrega (canhoto)</strong> referente à Nota Fiscal nº <strong>${pedido.nfe_numero}</strong>.</p>
        <p><strong>Destinatário:</strong> ${pedido.etiqueta_nome || 'Não informado'}</p>
        <p><strong>Documento:</strong> ${pedido.documento_cliente || 'Não informado'}</p>
        <p>Agradecemos a colaboração.</p>
        <p>Atenciosamente,<br>Equipe de Rastreio - Inova Móveis</p>
    `;

    // Reutiliza a função de envio base
    await sendEmail(toEmails, emailSubject, emailBody);
    console.log(`[Gmail Service] E-mail de solicitação de comprovante para NF-e ${pedido.nfe_numero} enviado.`);
    return { success: true, message: 'E-mail de solicitação de comprovante enviado com sucesso!' };
}


module.exports = {
    sendPositionRequestEmail,
    getThreadDetails,
    getMessageDetails,
    enviarEmailCobrancaManual,
    verificarRespostas,
    enviarEmailComprovanteEntrega
};