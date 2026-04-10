const { poolHub } = require('./hub/config/database');
const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

//https://inovaxpress.org/hub/auth/mercadolibre?cliente_id={ID_DO_CLIENTE}

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function createClient() {
    console.log('--- CRIAR NOVO CLIENTE HUB ---');
    
    try {
        const empresa = await ask('Nome da Empresa: ');
        const email = await ask('Email de Login: ');
        const senha = await ask('Senha: ');

        if (!empresa || !email || !senha) {
            console.error('Todos os campos são obrigatórios.');
            process.exit(1);
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha, salt);

        const res = await poolHub.query(
            'INSERT INTO hub_clientes (nome_empresa, email, senha_hash) VALUES ($1, $2, $3) RETURNING id',
            [empresa, email, hash]
        );

        console.log(`\nSucesso! Cliente criado com ID: ${res.rows[0].id}`);
        console.log('Agora esse cliente pode acessar a API e vincular contas do ML.');

    } catch (error) {
        if (error.code === '23505') {
            console.error('\nErro: Este email já está cadastrado.');
        } else {
            console.error('\nErro ao criar cliente:', error);
        }
    } finally {
        rl.close();
        process.exit(0);
    }
}

createClient();