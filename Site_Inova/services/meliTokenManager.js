const { Pool } = require('pg');
const axios = require('axios');
const querystring = require('querystring');

// Supondo que você tenha uma pool de conexão. 
// Use a mesma configuração do seu blingSyncService.
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const MELI_AUTH_URL = 'https://api.mercadolibre.com/oauth/token';
const MELI_APP_ID = process.env.MELI_APP_ID;
const MELI_SECRET_KEY = process.env.MELI_SECRET_KEY;
// A URL que você cadastrou no DevCenter do MELI
const MELI_REDIRECT_URI = process.env.MELI_REDIRECT_URI; 

/**
 * Troca o código inicial (do callback) por tokens.
 */
async function exchangeCodeForTokens(code, codeVerifier, accountName = 'DEFAULT_ACCOUNT') {
    console.log(`[MELI Token] Trocando código por tokens (PKCE) para: ${accountName}`);
    try {
        // 2. Adicione o code_verifier ao corpo da requisição
        const requestBody = {
            grant_type: 'authorization_code',
            client_id: MELI_APP_ID,
            client_secret: MELI_SECRET_KEY,
            code: code,
            redirect_uri: MELI_REDIRECT_URI,
            code_verifier: codeVerifier // <-- O PARÂMETRO QUE FALTAVA
        };

        const response = await axios.post(MELI_AUTH_URL, querystring.stringify(requestBody), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // ... (o resto da função continua igual)
        const { access_token, refresh_token, expires_in } = response.data;

        const userMe = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { 'Authorization': `Bearer ${access_token}` }
        });
        const sellerId = userMe.data.id;

        await saveTokensToDB(accountName, access_token, refresh_token, expires_in, sellerId);
        console.log(`[MELI Token] Tokens salvos com sucesso para Seller ID: ${sellerId}`);
        
        return { access_token, sellerId };

    } catch (error) {
        // Agora, se der erro, o log será mais detalhado
        console.error('[MELI Token] Erro ao trocar código por tokens:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Atualiza os tokens usando o refresh_token.
 */
async function refreshAccessToken(accountName, currentRefreshToken) {
    console.log(`[MELI Token] Dando refresh no token para: ${accountName}`);
    try {
        const response = await axios.post(MELI_AUTH_URL, querystring.stringify({
            grant_type: 'refresh_token',
            client_id: MELI_APP_ID,
            client_secret: MELI_SECRET_KEY,
            refresh_token: currentRefreshToken,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token, refresh_token, expires_in } = response.data;
        
        // Pega o seller_id que já estava salvo
        const creds = await getCredentialsFromDB(accountName);
        
        await saveTokensToDB(accountName, access_token, refresh_token, expires_in, creds.seller_id);
        console.log(`[MELI Token] Refresh de token salvo com sucesso.`);

        return { accessToken: access_token, sellerId: creds.seller_id };

    } catch (error) {
        console.error('[MELI Token] Erro ao dar refresh no token:', error.response?.data || error.message);
        // Se o refresh token falhar, é um erro crítico. Requer re-autorização manual.
        // Aqui você pode implementar um alerta (email, etc.)
        throw new Error('Falha crítica no refresh do token MELI. Requer re-autorização.');
    }
}

/**
 * Busca credenciais do banco.
 */
async function getCredentialsFromDB(accountName) {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM meli_auth_credentials WHERE account_name = $1', [accountName]);
        return res.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Salva (INSERT/UPDATE) tokens no banco.
 */
async function saveTokensToDB(accountName, accessToken, refreshToken, expiresIn, sellerId) {
    const client = await pool.connect();
    // Calcula a data de expiração (com 60s de margem de segurança)
    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000);

    const query = `
        INSERT INTO meli_auth_credentials 
            (account_name, access_token, refresh_token, expires_at, seller_id, last_updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (account_name) DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            seller_id = EXCLUDED.seller_id,
            last_updated_at = CURRENT_TIMESTAMP;
    `;
    
    try {
        await client.query(query, [accountName, accessToken, refreshToken, expiresAt, sellerId]);
    } finally {
        client.release();
    }
}

/**
 * Função principal: Obtém um token válido, dando refresh se necessário.
 */
async function getValidAccessToken(accountName = 'DEFAULT_ACCOUNT') {
    const creds = await getCredentialsFromDB(accountName);

    if (!creds) {
        throw new Error(`Nenhuma credencial MELI encontrada para a conta: ${accountName}. Por favor, autorize a aplicação.`);
    }

    // Verifica se o token expirou (ou está prestes a expirar)
    if (new Date() >= new Date(creds.expires_at)) {
        console.log(`[MELI Token] Token expirado para ${accountName}. Iniciando refresh...`);
        return await refreshAccessToken(accountName, creds.refresh_token);
    }

    // Token ainda é válido
    return { accessToken: creds.access_token, sellerId: creds.seller_id };
}

module.exports = {
    getValidAccessToken,
    exchangeCodeForTokens,
    MELI_APP_ID,
    MELI_REDIRECT_URI
};