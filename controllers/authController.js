const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const session = require('express-session');

const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// Configuração da sessão
const sessionMiddleware = session({
  secret: 'chave-secreta-segura', // Mude para uma chave longa e aleatória em produção
  resave: false,
  saveUninitialized: false, // True se quiser salvar sessões anônimas, false se só após login
  cookie: { 
    secure: false, // Em produção, com HTTPS, mude para true
    httpOnly: true,
    maxAge: 480 * 60 * 1000 // 8 horas
  }
});

exports.sessionMiddleware = sessionMiddleware;

// Função de login com limite de tentativas
exports.login = async (req, res) => {
  const { username, password } = req.body;

  // Inicializa tentativas de login na sessão, se não existirem
  if (req.session.loginAttempts === undefined) { // Checagem mais robusta
    req.session.loginAttempts = 0;
  }
  if (req.session.lockUntil === undefined) {
    req.session.lockUntil = null;
  }

  // Verifica se o usuário está bloqueado
  if (req.session.lockUntil && Date.now() < req.session.lockUntil) {
    // const remainingTime = Math.ceil((req.session.lockUntil - Date.now()) / 1000); // Para mostrar tempo restante
    return res.render('login', { 
      title: 'Login', 
      errorMessage: `Muitas tentativas! Conta bloqueada temporariamente. Tente novamente mais tarde.`,
      layout: false // <--- ADICIONADO
    });
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const match = await bcrypt.compare(password, user.password);

      if (match) {
        // Login bem-sucedido: resetar tentativas e redirecionar
        req.session.loginAttempts = 0;
        req.session.lockUntil = null;
        req.session.userId = user.id;
        req.session.username = user.username; // Guardar username na sessão é útil
        req.session.role = user.cargo; // Guardar cargo na sessão

        // req.session.save() garante que a sessão seja salva antes do redirect. Boa prática.
        return req.session.save(err => {
          if (err) {
            console.error('Erro ao salvar sessão após login:', err);
            // Mesmo em erro de salvar sessão, renderiza login sem layout
            return res.render('login', {
              title: 'Login',
              errorMessage: 'Erro ao iniciar sessão, por favor, tente novamente.',
              layout: false // <--- ADICIONADO
            });
          }
          res.redirect('/'); // Redireciona para o menu principal (ou dashboard)
        });
      }
    }

    // Login falhou (usuário não encontrado ou senha não confere)
    req.session.loginAttempts += 1;
    let errorMessage = `Usuário ou senha inválidos!`;
    const remainingAttempts = 10 - req.session.loginAttempts;

    if (req.session.loginAttempts >= 10) {
      req.session.lockUntil = Date.now() + (5 * 60 * 1000); // Bloqueia por 5 minutos
      errorMessage = 'Muitas tentativas de login! Sua conta foi temporariamente bloqueada.';
    } else if (remainingAttempts > 0) {
      errorMessage += ` Você tem ${remainingAttempts} tentativa(s) restante(s) antes do bloqueio.`;
    } else { // Última tentativa antes do bloqueio efetivo
      errorMessage = 'Usuário ou senha inválidos! Esta é sua última tentativa antes do bloqueio.';
    }
    
    res.render('login', { 
      title: 'Login', 
      errorMessage: errorMessage,
      layout: false // <--- ADICIONADO
    });

  } catch (error) {
    console.error('Erro interno durante o processo de login:', error);
    res.render('login', { 
      title: 'Login', 
      errorMessage: 'Erro interno do servidor. Por favor, tente novamente mais tarde!',
      layout: false // <--- ADICIONADO
    });
  }
};

// Middleware para proteger rotas
exports.requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    // Se uma rota de API (ex: /api/...) for protegida e não autenticada,
    // o ideal seria retornar um JSON { error: 'Não autorizado' } com status 401.
    // Mas para redirecionamento geral para login, está ok.
    return res.redirect('/login');
  }
  next();
};

// Logout
exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Erro ao destruir a sessão:", err);
      // Idealmente, você não renderizaria a página de login aqui com erro,
      // mas sim redirecionaria e deixaria a rota GET /login lidar com a renderização.
      // Ou, se for mostrar um erro, também use layout: false
      return res.status(500).render('login', {
          title: 'Login',
          errorMessage: 'Não foi possível fazer logout. Tente novamente.',
          layout: false // <--- ADICIONADO (para consistência, embora o redirect seja mais comum)
      });
    }
    res.clearCookie('connect.sid'); // Limpa o cookie da sessão (o nome do cookie pode variar)
    res.redirect('/login');
  });
};