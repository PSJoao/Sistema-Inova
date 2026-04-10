const axios = require('axios');
const { poolHub } = require('../config/database');

// Captura as credenciais do .env
const ML_APP_ID = process.env.ML_APP_ID;
const ML_SECRET_KEY = process.env.ML_SECRET_KEY;

// MAPA DE LOCK: Guarda as promessas de renovação em andamento
const activeRefreshes = new Map();

const hubTokenService = {
    /**
     * Verifica se o token da conta é válido. Se expirou, renova automaticamente.
     * @param {object} conta - Objeto da linha do banco hub_ml_contas
     * @returns {string} - O Access Token válido (novo ou antigo)
     */
    async getValidAccessToken(conta) {
        const now = new Date();
        const expiration = new Date(conta.token_expiration);
        const margin = 10 * 60 * 1000; // 10 minutos de margem de segurança

        // 1. Se o token ainda é válido, retorna de imediato
        if (expiration > new Date(now.getTime() + margin)) {
            return conta.access_token;
        }

        // --- INÍCIO DO CONTROLE DE CONCORRÊNCIA (LOCK) ---
        // 2. Se já existe uma renovação a decorrer para este ID, aguarda por ela
        if (activeRefreshes.has(conta.id)) {
            console.log(`[HUB Token] Renovação já em andamento para "${conta.nickname}". A aguardar...`);
            return await activeRefreshes.get(conta.id);
        }

        console.log(`[HUB Token] Token da conta "${conta.nickname}" expirado (ou quase). A renovar...`);

        // 3. Cria a Promessa de renovação e isola a lógica
        const refreshPromise = (async () => {
            try {
                const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
                    grant_type: 'refresh_token',
                    client_id: ML_APP_ID,
                    client_secret: ML_SECRET_KEY,
                    refresh_token: conta.refresh_token
                });

                const { access_token, refresh_token, expires_in } = response.data;

                const newExpiration = new Date();
                newExpiration.setSeconds(newExpiration.getSeconds() + expires_in);

                // Atualiza na base de dados
                await poolHub.query(
                    `UPDATE hub_ml_contas SET 
                        access_token = $1, 
                        refresh_token = $2, 
                        token_expiration = $3 
                    WHERE id = $4`,
                    [access_token, refresh_token, newExpiration, conta.id]
                );

                console.log(`[HUB Token] Token renovado com sucesso para "${conta.nickname}".`);
                return access_token;

            } catch (error) {
                console.error(`[HUB Token] ERRO CRÍTICO ao renovar token para ${conta.nickname}:`, error.response?.data || error.message);
                
                if (error.response?.status === 400 || error.response?.status === 401) {
                     console.error('[HUB Token] A conexão foi revogada pelo utilizador. Marcar conta como inativa?');
                }
                throw error; 
            } finally {
                // 4. Independentemente de sucesso ou erro, remove o Lock no final
                activeRefreshes.delete(conta.id);
            }
        })();

        // 5. Guarda a promessa no Map para que outros pedidos concorrentes aguardem
        activeRefreshes.set(conta.id, refreshPromise);

        // 6. Aguarda a resolução da promessa que acabámos de criar e devolve o token
        return await refreshPromise;
    }
};

module.exports = hubTokenService;