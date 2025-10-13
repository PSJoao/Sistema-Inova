// authorizeGmail.js - Script de autorização única

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// As mesmas constantes do seu gmailService.js
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'config', 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'config', 'token.json');

/**
 * Salva as credenciais no arquivo token.json.
 */
async function saveCredentials(client) {
    try {
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
        console.log('Token salvo com sucesso em:', TOKEN_PATH);
    } catch (error) {
        console.error('Erro ao salvar as credenciais:', error);
        throw error;
    }
}

/**
 * Função principal que executa o fluxo de autorização.
 */
async function authorize() {
    console.log('Iniciando processo de autorização...');
    console.log('Seu navegador será aberto para que você possa dar permissão.');

    let client;
    try {
        client = await authenticate({
            scopes: SCOPES,
            keyfilePath: CREDENTIALS_PATH,
        });
    } catch (error) {
        console.error('Falha na autenticação:', error.message);
        return;
    }
    
    if (client.credentials) {
        await saveCredentials(client);
        console.log('\nAutorização concluída com sucesso!');
        console.log('O arquivo "token.json" foi criado na pasta "config".');
        console.log('Agora você pode iniciar seu site normalmente.');
    } else {
        console.log('Não foi possível obter as credenciais. Tente novamente.');
    }
}

// Executa a função principal
authorize().catch(console.error);