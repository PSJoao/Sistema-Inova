const { Pool } = require("pg");
const bcrypt = require("bcrypt");

// Configuração do banco de dados
const pool = new Pool({
    user: 'admininova',
    host: '177.84.208.81',
    database: 'inovamonitoramento',
    password: 'SenhaMAGNIFICA_Forte@9050!',
    port: '5432',
});

async function adicionarUsuario(username, password) {
    try {
        // Criptografar senha
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Inserir usuário no banco de dados
        await pool.query(
            "INSERT INTO users (username, password) VALUES ($1, $2)",
            [username, hashedPassword]
        );

        console.log("✅ Usuário cadastrado com sucesso!");
    } catch (error) {
        console.error("❌ Erro ao adicionar usuário:", error.message);
    }
}



// Exemplo de uso
adicionarUsuario("Rafaela","Rafaela123@");