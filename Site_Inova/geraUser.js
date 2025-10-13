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
adicionarUsuario("Jesus","Jesus123@");



const mainQuery = `
            SELECT 
                a.id,
                CASE 
                    WHEN a.descricao = ANY(${addParam(ABA_MAP['aba2'])}) AND (SELECT COUNT(id) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1 THEN
                        CASE 
                            WHEN (SELECT COUNT(DISTINCT ap.status_volume) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id) > 1 THEN 'Múltiplo'
                            ELSE (SELECT MIN(ap.status_volume) FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id)
                        END
                    ELSE a.situacao
                END as situacao,
                a.nf_origem, a.nome_pedido, s.nome as solicitante, a.fabrica, 
                to_char(a.data_acao, 'DD/MM/YYYY HH24:MI:SS') as data_acao_fmt, 
                a.data_solicitacao, a.marcar_como_alerta, a.observacoes, 
                a.coluna_estoque AS coluna, a.linha_estoque AS linha,
                (SELECT ap.nome_produto FROM assistencia_produtos ap WHERE ap.assistencia_id = a.id ORDER BY ap.id LIMIT 1) as primeiro_produto
            FROM assistencias a
            LEFT JOIN solicitantes s ON a.solicitante_id = s.id
            ${whereCondition}
        `;