const axios = require('axios');
const { getValidBlingToken } = require('./blingTokenManager');

const lucasRequestQueue = [];
let lucasIsProcessing = false;

const processLucasQueue = async () => {
    if (lucasIsProcessing || lucasRequestQueue.length === 0) return;
    lucasIsProcessing = true;

    const { url, resolve, reject } = lucasRequestQueue.shift();

    try {
        const accessToken = await getValidBlingToken('lucas');
        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        console.log(`[Bling API GET] -> LUCAS: ${url}`);
        const response = await axios.get(url, config);
        resolve(response.data);
    } catch (error) {
        let errorMessage = `Erro na chamada API Bling para a conta 'lucas'.`;

        if (error.response) {
            console.error(`[Bling API Error] Status: ${error.response.status}, Data:`, error.response.data);
            const blingError = error.response.data?.error?.description || JSON.stringify(error.response.data);
            errorMessage += ` Detalhe do Bling: ${blingError}`;
        } else if (error.request) {
            console.error('[Bling API Error] Nenhuma resposta recebida do Bling.');
            errorMessage += ' O servidor do Bling não respondeu.';
        } else {
            console.error('[Bling API Error] Erro de configuração da chamada:', error.message);
            errorMessage += ` Detalhe: ${error.message}`;
        }

        reject(new Error(errorMessage));
    }

    // Aguarda 350ms antes de processar a próxima requisição
    setTimeout(() => {
        lucasIsProcessing = false;
        processLucasQueue();
    }, 350);
};

const blingApiGet = async (url, accountType) => {
    if (accountType === 'lucas') {
        return new Promise((resolve, reject) => {
            lucasRequestQueue.push({ url, resolve, reject });
            processLucasQueue();
        });
    }

    // Para outras contas, executa direto
    try {
        const accessToken = await getValidBlingToken(accountType);
        const config = {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        console.log(`[Bling API GET] -> ${accountType.toUpperCase()}: ${url}`);
        const response = await axios.get(url, config);
        return response.data;
    } catch (error) {
        let errorMessage = `Erro na chamada API Bling para a conta '${accountType}'.`;

        if (error.response) {
            console.error(`[Bling API Error] Status: ${error.response.status}, Data:`, error.response.data);
            const blingError = error.response.data?.error?.description || JSON.stringify(error.response.data);
            errorMessage += ` Detalhe do Bling: ${blingError}`;
        } else if (error.request) {
            console.error('[Bling API Error] Nenhuma resposta recebida do Bling.');
            errorMessage += ' O servidor do Bling não respondeu.';
        } else {
            console.error('[Bling API Error] Erro de configuração da chamada:', error.message);
            errorMessage += ` Detalhe: ${error.message}`;
        }

        throw new Error(errorMessage);
    }
};

module.exports = {
    blingApiGet
};