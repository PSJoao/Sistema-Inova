const axios = require('axios');
const { poolHub } = require('./hub/config/database');
const hubTokenService = require('./hub/services/hubTokenService'); // <--- Importando a inteligência

// Captura o ID do pedido passado na linha de comando
const pedidoId = process.argv[2];

if (!pedidoId) {
    console.error('\n❌ Erro: Você precisa fornecer o ID do pedido.');
    console.log('👉 Uso correto: node consultar_pedido_ml.js <NUMERO_DO_PEDIDO>\n');
    process.exit(1);
}

const ML_API_URL = 'https://api.mercadolibre.com';

async function consultarPedido() {
    console.log(`\n🔍 Iniciando busca detalhada pelo pedido: ${pedidoId}...\n`);

    try {
        // 1. Busca TODAS as informações da conta (precisamos do refresh_token e id para o serviço funcionar)
        const contasResult = await poolHub.query('SELECT * FROM hub_ml_contas WHERE ativo = FALSE');
        const contas = contasResult.rows;

        if (contas.length === 0) {
            console.error('❌ Nenhuma conta ativa encontrada no banco de dados.');
            process.exit(1);
        }

        let pedidoEncontrado = null;
        let tokenUsado = null;
        let contaDona = null;

        // 2. Tenta encontrar o pedido varrendo as contas
        for (const conta of contas) {
            try {
                process.stdout.write(`Tentando conta "${conta.nickname}"... `);

                // --- INTELIGÊNCIA DE TOKEN AQUI ---
                // Verifica se o token está válido ou renova antes de usar
                let accessToken;
                try {
                    accessToken = await hubTokenService.getValidAccessToken(conta);
                } catch (tokenErr) {
                    console.log(`(Pulei: Falha ao renovar token - ${tokenErr.message})`);
                    continue;
                }
                // ----------------------------------

                const pack = await axios.get(`${ML_API_URL}/packs/${pedidoId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                console.log(JSON.stringify(pack.data, null, 2));

                const response = await axios.get(`${ML_API_URL}/orders/search?seller=${conta.seller_id}&q=${pedidoId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                /*const resp = await axios.get(`${ML_API_URL}/users/617566696/shipping/schedule/cross_docking`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });*/

                const nota = await axios.get(`${ML_API_URL}/users/${conta.seller_id}/invoices/orders/${pedidoId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });

                console.log(JSON.stringify(nota.data, null, 2));

                console.log('✅ ENCONTRADO!');
                pedidoEncontrado = response.data;
                tokenUsado = accessToken; // Guardamos o token válido para usar na busca do envio
                contaDona = conta.nickname;

                break; // Paramos na primeira conta que encontrar

            } catch (error) {
                // Se der 404 é normal (pedido não é desta conta)
                if (error.response && error.response.status === 404) {
                    console.log('❌ Não encontrado nesta conta.');
                } else {
                    console.log(`❌ Erro: ${error.message}`);
                }
            }
        }

        if (!pedidoEncontrado) {
            console.log('\n⚠️  Pedido não encontrado em nenhuma das contas cadastradas.');
            process.exit(0);
        }

        // --- EXIBIÇÃO DOS DADOS ---     

        console.log('\n' + '='.repeat(60));
        console.log(`📦 DADOS DO PEDIDO (Order) - Conta: ${contaDona}`);
        console.log('='.repeat(60));
        console.log(JSON.stringify(pedidoEncontrado, null, 2));

        // 3. Busca dados do Envio (Shipping) se existir
        const shippingId = 47289377234;

        if (shippingId) {
            console.log('\n' + '='.repeat(60));
            console.log(`🚚 DADOS DO ENVIO (Shipment ID: ${shippingId})`);
            console.log('='.repeat(60));

            try {
                // Reutiliza o token válido que já garantimos acima
                const shipResponse = await axios.get(`${ML_API_URL}/shipments/${shippingId}`, {
                    headers: { 'Authorization': `Bearer ${tokenUsado}` }
                });

                console.log(JSON.stringify(shipResponse.data, null, 2));

            } catch (shipError) {
                console.error(`\n❌ Erro ao buscar envio: ${shipError.message}`);
            }
        } else {
            console.log('\n⚠️  Este pedido não possui ID de envio vinculado (shipping.id é null).');
        }

        console.log('\n' + '='.repeat(60));
        console.log('🏁 Fim da Análise');
        console.log('='.repeat(60) + '\n');

    } catch (err) {
        console.error('\n❌ Erro crítico no script:', err.message);
    } finally {
        poolHub.end();
    }
}

consultarPedido();