const axios = require('axios');
const { poolHub } = require('../config/database');

// Captura as credenciais do .env
const AMZ_CLIENT_ID = process.env.AMZ_CLIENT_ID;
const AMZ_CLIENT_SECRET = process.env.AMZ_CLIENT_SECRET;

// MAPA DE LOCK: Guarda as promessas de renovação em andamento (mesmo padrão do ML)
const activeRefreshes = new Map();

const hubAmazonTokenService = {
    /**
     * Verifica se o token da conta Amazon é válido. Se expirou, renova automaticamente.
     * A Amazon usa tokens LWA (Login With Amazon), com expiração de ~1h (3600s).
     * O refresh_token tem validade de 1 ano ou mais.
     * 
     * @param {object} conta - Objeto da linha do banco hub_amazon_contas
     * @returns {string} - O Access Token válido (novo ou antigo)
     */
    async getValidAccessToken(conta) {
        const now = new Date();
        const expiration = new Date(conta.token_expiration);
        const margin = 5 * 60 * 1000; // 5 minutos de margem (token da Amazon dura só 1h)

        // 1. Se o token ainda é válido, retorna de imediato
        if (expiration > new Date(now.getTime() + margin)) {
            return conta.lwa_access_token;
        }

        // --- INÍCIO DO CONTROLE DE CONCORRÊNCIA (LOCK) ---
        // 2. Se já existe uma renovação a decorrer para este ID, aguarda por ela
        if (activeRefreshes.has(conta.id)) {
            console.log(`[HUB Amazon Token] Renovação já em andamento para "${conta.nickname || conta.seller_id}". A aguardar...`);
            return await activeRefreshes.get(conta.id);
        }

        console.log(`[HUB Amazon Token] Token da conta "${conta.nickname || conta.seller_id}" expirado (ou quase). A renovar...`);

        // 3. Cria a Promessa de renovação e isola a lógica
        const refreshPromise = (async () => {
            try {
                const response = await axios.post('https://api.amazon.com/auth/o2/token', {
                    grant_type: 'refresh_token',
                    client_id: AMZ_CLIENT_ID,
                    client_secret: AMZ_CLIENT_SECRET,
                    refresh_token: conta.lwa_refresh_token
                });

                const { access_token, refresh_token, expires_in } = response.data;

                const newExpiration = new Date();
                newExpiration.setSeconds(newExpiration.getSeconds() + expires_in);

                // Atualiza na base de dados
                await poolHub.query(
                    `UPDATE hub_amazon_contas SET 
                        lwa_access_token = $1, 
                        lwa_refresh_token = $2, 
                        token_expiration = $3,
                        last_update = NOW()
                    WHERE id = $4`,
                    [access_token, refresh_token, newExpiration, conta.id]
                );

                console.log(`[HUB Amazon Token] Token renovado com sucesso para "${conta.nickname || conta.seller_id}".`);
                return access_token;

            } catch (error) {
                console.error(`[HUB Amazon Token] ERRO CRÍTICO ao renovar token para ${conta.nickname || conta.seller_id}:`, error.response?.data || error.message);
                
                if (error.response?.status === 400 || error.response?.status === 401) {
                     console.error('[HUB Amazon Token] A conexão foi revogada pelo vendedor ou o refresh_token expirou. Marcar conta como inativa?');
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

module.exports = hubAmazonTokenService;
