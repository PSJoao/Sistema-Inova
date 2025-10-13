const axios = require('axios');
const { Pool } = require('pg');
const qs = require('querystring'); // Usando qs que você tinha antes

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const BLING_OAUTH_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';

// Cache em memória para os tokens, para evitar buscas repetidas no banco
const tokenCache = {
    eliane: { accessToken: null, expiresAt: null },
    lucas: { accessToken: null, expiresAt: null }
};

/**
 * Sua função original para renovar o token, agora como uma função interna.
 * Ela é chamada apenas pela getValidBlingToken quando necessário.
 */
async function refreshBlingTokenForAccount(accountName) {
    console.log(`[Token Manager] Token para "${accountName}" expirado ou próximo. Tentando refresh.`);
    const client = await pool.connect();
    let newAccessToken;
    try {
        const dbResult = await client.query(
            `SELECT id, client_id, client_secret, refresh_token FROM bling_api_credentials WHERE account_name = $1`,
            [accountName]
        );

        if (dbResult.rows.length === 0) throw new Error(`Credenciais para "${accountName}" não encontradas no DB.`);
        const creds = dbResult.rows[0];
        if (!creds.refresh_token) throw new Error(`FALHA CRÍTICA: Refresh token ausente para "${accountName}".`);

        const basicAuthToken = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
        
        // Usando URLSearchParams como no seu código original que funcionava
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', creds.refresh_token);

        const refreshApiResponse = await axios.post(BLING_OAUTH_TOKEN_URL, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${basicAuthToken}`,
                'Accept': 'application/json'
            }
        });
        
        const newTokens = refreshApiResponse.data;
        if (!newTokens.access_token || !newTokens.refresh_token) throw new Error(`Resposta do refresh de token incompleta.`);

        await client.query(
            `UPDATE bling_api_credentials 
             SET access_token = $1, refresh_token = $2, token_type = $3, expires_in = $4, token_generated_at = NOW(), last_refresh_status = 'SUCCESS'
             WHERE id = $5`,
            [newTokens.access_token, newTokens.refresh_token, newTokens.token_type || 'Bearer', parseInt(newTokens.expires_in, 10), creds.id]
        );
        
        console.log(`   SUCCESS: Token para "${accountName}" atualizado no banco.`);
        newAccessToken = newTokens.access_token;

    } catch (refreshError) {
        const errorDetail = refreshError.response ? JSON.stringify(refreshError.response.data) : refreshError.message;
        console.error(`   ERRO no refresh do token Bling para "${accountName}": ${errorDetail}`);
        // Lançamos o erro para que a função que chamou saiba que falhou
        throw refreshError;
    } finally {
        if (client) client.release();
    }
    return newAccessToken; // Retorna o novo access_token
}

/**
 * NOVA FUNÇÃO "CHAVEIRO": Pega um token válido, usando o cache ou renovando se necessário.
 */
async function getValidBlingToken(accountType) {
    const now = new Date();
    const cache = tokenCache[accountType];

    // 1. Verifica o cache
    if (cache && cache.accessToken && cache.expiresAt > now) {
        return cache.accessToken;
    }

    // 2. Se o cache falhar, busca no banco
    const result = await pool.query('SELECT access_token, expires_in, token_generated_at FROM bling_api_credentials WHERE account_name = $1', [accountType]);
    if (result.rows.length === 0) throw new Error(`Nenhum credencial encontrada para a conta: ${accountType}`);
    
    const tokenData = result.rows[0];
    const tokenExpiresAt = new Date(new Date(tokenData.token_generated_at).getTime() + (tokenData.expires_in - 300) * 1000); // 5 min de margem

    // 3. Se o token do banco ainda estiver válido, usa e atualiza o cache
    if (tokenExpiresAt > now) {
        console.log(`[Token Manager] Token do DB para "${accountType}" ainda é válido. Atualizando cache.`);
        cache.accessToken = tokenData.access_token;
        cache.expiresAt = tokenExpiresAt;
        return cache.accessToken;
    }

    // 4. Se expirou, chama sua função de refresh original e robusta
    const newAccessToken = await refreshBlingTokenForAccount(accountType);
    
    // 5. Atualiza o cache com o token novo
    const newExpiresInSeconds = 3600; // O padrão do Bling é 1 hora
    cache.accessToken = newAccessToken;
    cache.expiresAt = new Date(new Date().getTime() + (newExpiresInSeconds - 300) * 1000);
    
    return newAccessToken;
}

/**
 * Função para o cron job, agora ela chama a nova função "chaveiro".
 */
async function runScheduledTokenRefresh() {
    console.log("[Token Manager] Executando verificação de token agendada...");
    try {
        await getValidBlingToken('eliane');
        await getValidBlingToken('lucas');
        console.log("[Token Manager] Verificação de token agendada concluída.");
    } catch (error) {
        console.error("[Token Manager] Erro durante a verificação de token agendada:", error.message);
    }
}

// Exporta as funções que precisam ser usadas externamente
module.exports = {
    getValidBlingToken,
    runScheduledTokenRefresh
};