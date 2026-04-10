const tokenManager = require('../services/meliTokenManager');
const crypto = require('crypto'); // <-- 1. ADICIONE ISSO

// --- Funções de Ajuda para o PKCE ---
// (Pode colar isso no topo do arquivo, abaixo dos requires)

function base64URLEncode(str) {
    return str.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest();
}
// --- Fim das Funções de Ajuda ---


// 1. Rota para iniciar a autorização
exports.authorize = (req, res) => {
    
    // 2. Gere o 'verifier' e o 'challenge'
    const codeVerifier = base64URLEncode(crypto.randomBytes(32));
    const codeChallenge = base64URLEncode(sha256(codeVerifier));
    const codeChallengeMethod = 'S256';

    // 3. Salve o 'verifier' na sessão do usuário
    req.session.meli_code_verifier = codeVerifier;

    // 4. Modifique a URL de autorização para incluir o challenge
    const authUrl = `https://auth.mercadolibre.com/authorization?response_type=code&client_id=${tokenManager.MELI_APP_ID}&redirect_uri=${tokenManager.MELI_REDIRECT_URI}&code_challenge=${codeChallenge}&code_challenge_method=${codeChallengeMethod}`;
    
    res.redirect(authUrl);
};

// 2. Rota de Callback (que você cadastrou no DevCenter)
exports.handleCallback = async (req, res) => {
    const { code, error } = req.query;

    // 5. Pegue o 'verifier' da sessão
    const codeVerifier = req.session.meli_code_verifier;

    if (error) {
        console.error('[MELI Auth] Erro no callback:', error);
        req.flash('error_msg', 'Ocorreu um erro ao autorizar com o Mercado Livre.');
        return res.redirect('/main-menu');
    }

    if (!code) {
        req.flash('error_msg', 'Código de autorização não recebido.');
        return res.redirect('/main-menu');
    }

    // 6. Verifique se o verifier existe (ex: sessão não expirou)
    if (!codeVerifier) {
        console.error('[MELI Auth] Erro: code_verifier não encontrado na sessão.');
        req.flash('error_msg', 'Sua sessão expirou durante a autorização. Tente novamente.');
        return res.redirect('/main-menu');
    }

    try {
        // 7. Envie o code E o codeVerifier para o tokenManager
        await tokenManager.exchangeCodeForTokens(code, codeVerifier, 'DEFAULT_ACCOUNT');
        
        req.flash('success_msg', 'Mercado Livre conectado com sucesso!');
        
    } catch (err) {
        // O erro que você viu (400) acontece aqui
        console.error('[MELI Auth] Erro ao salvar tokens:', err.response?.data || err.message);
        req.flash('error_msg', 'Erro interno ao processar a autorização do MELI.');
        
    } finally {
        // 8. Limpe o verifier da sessão, quer tenha dado certo ou errado
        delete req.session.meli_code_verifier;
        res.redirect('/main-menu');
    }
};