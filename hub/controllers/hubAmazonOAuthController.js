const axios = require('axios');
const { poolHub } = require('../config/database');

const AMZ_CLIENT_ID = process.env.AMZ_CLIENT_ID;
const AMZ_CLIENT_SECRET = process.env.AMZ_CLIENT_SECRET;

// URL de Callback registrada no Developer Central da Amazon
const REDIRECT_URI = 'https://inovaxpress.org/hub/auth/amazon/callback';

/**
 * Inicia o fluxo de autorização OAuth para a Amazon SP-API.
 * 
 * NOTA: Na Amazon, o fluxo OAuth pode ser iniciado de duas formas:
 * 1. O vendedor vai ao Seller Central → Aplicativos → Autoriza o seu app (recomendado)
 * 2. Você gera um link direto para a página de autorização (o que esta rota faz)
 * 
 * O parâmetro `state` carrega o cliente_id do hub para vincular após o callback.
 */
exports.iniciarAuth = (req, res) => {
    const { cliente_id } = req.query;
    
    if (!cliente_id) return res.send('Erro: cliente_id necessário para iniciar integração.');

    // URL de autorização do Seller Central Brasil
    const url = `https://sellercentral.amazon.com.br/apps/authorize/consent?application_id=${AMZ_CLIENT_ID}&state=${cliente_id}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(url);
};

/**
 * Processa o callback de autorização da Amazon.
 * 
 * Quando o vendedor autoriza o app no Seller Central, a Amazon redireciona para cá
 * com os parâmetros: spapi_oauth_code, state (cliente_id), selling_partner_id
 */
exports.processarCallback = async (req, res) => {
    const { spapi_oauth_code, state, selling_partner_id } = req.query;
    const clienteId = state; // O ID do nosso cliente no Hub

    if (!spapi_oauth_code) return res.status(400).send('Código de autorização não recebido.');
    if (!selling_partner_id) return res.status(400).send('ID do vendedor Amazon não recebido.');

    try {
        // 1. Troca o código pelo Access e Refresh Token no LWA (Login With Amazon)
        const response = await axios.post('https://api.amazon.com/auth/o2/token', {
            grant_type: 'authorization_code',
            code: spapi_oauth_code,
            client_id: AMZ_CLIENT_ID,
            client_secret: AMZ_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI
        });

        const { access_token, refresh_token, expires_in } = response.data;
        
        // Calcula expiração (na Amazon é ~1 hora / 3600 seg)
        const expirationDate = new Date();
        expirationDate.setSeconds(expirationDate.getSeconds() + expires_in);

        // 2. Salva ou Atualiza no Banco (mesmo padrão do ML - UPSERT por seller_id)
        const query = `
            INSERT INTO hub_amazon_contas (cliente_id, seller_id, lwa_access_token, lwa_refresh_token, token_expiration, nickname, ativo)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE)
            ON CONFLICT (seller_id) DO UPDATE SET
            lwa_access_token = EXCLUDED.lwa_access_token,
            lwa_refresh_token = EXCLUDED.lwa_refresh_token,
            token_expiration = EXCLUDED.token_expiration,
            cliente_id = EXCLUDED.cliente_id;
        `;
        
        await poolHub.query(query, [
            clienteId, 
            selling_partner_id, 
            access_token, 
            refresh_token, 
            expirationDate,
            'Conta Amazon Nova' // Nickname padrão (pode ser atualizado depois)
        ]);
        
        console.log(`[HUB Amazon OAuth] Nova conta autorizada! Seller ID: ${selling_partner_id}, Cliente Hub: ${clienteId}`);
        
        res.send('<h1>Integração com Amazon realizada com sucesso!</h1><p>O Hub já começará a capturar seus pedidos da Amazon.</p>');

    } catch (error) {
        console.error('[HUB Amazon OAuth] Erro no callback LWA:', error.response?.data || error.message);
        res.status(500).send('Erro ao autenticar com a Amazon.');
    }
};
