const axios = require('axios');
const { poolHub } = require('../config/database');

const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET_KEY = process.env.ML_SECRET_KEY;

const REDIRECT_URI = 'https://inovaxpress.org/hub/auth/mercadolibre/callback';

exports.iniciarAuth = (req, res) => {
    const { cliente_id } = req.query;
    
    if(!cliente_id) return res.send('Erro: cliente_id necessário para iniciar integração.');

    const url = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${ML_APP_ID}&redirect_uri=${REDIRECT_URI}&state=${cliente_id}`;
    res.redirect(url);
};

exports.processarCallback = async (req, res) => {
    const { code, state } = req.query; // state é o cliente_id que passamos antes
    const clienteId = state;

    if (!code) return res.status(400).send('Código de autorização não recebido.');

    try {
        // Troca o CODE pelo TOKEN
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
            grant_type: 'authorization_code',
            client_id: ML_APP_ID,
            client_secret: ML_SECRET_KEY,
            code: code,
            redirect_uri: REDIRECT_URI
        });

        const { access_token, refresh_token, user_id, expires_in } = response.data;

        // Calcula data de expiração (normalmente 6 horas)
        const expirationDate = new Date();
        expirationDate.setSeconds(expirationDate.getSeconds() + expires_in);

        // Salva ou Atualiza no Banco
        const query = `
            INSERT INTO hub_ml_contas (cliente_id, seller_id, access_token, refresh_token, token_expiration, nickname, ativo)
            VALUES ($1, $2, $3, $4, $5, 'Conta ML Nova', TRUE)
            ON CONFLICT (seller_id) DO UPDATE SET
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            token_expiration = EXCLUDED.token_expiration,
            cliente_id = EXCLUDED.cliente_id; -- Vincula ao novo cliente se mudar
        `;

        await poolHub.query(query, [clienteId, user_id, access_token, refresh_token, expirationDate]);

        res.send('<h1>Integração realizada com sucesso!</h1><p>O Hub já começará a capturar seus pedidos.</p>');

    } catch (error) {
        console.error('Erro no callback OAuth:', error.response?.data || error.message);
        res.status(500).send('Erro ao autenticar com o Mercado Livre.');
    }
};