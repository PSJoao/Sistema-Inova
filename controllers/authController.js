const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const session = require('express-session');

const pool = new Pool({
  user: process.env.DB_MON_USER,
  host: process.env.DB_MON_HOST,
  database: process.env.DB_MON_DATABASE,
  password: process.env.DB_MON_PASSWORD,
  port: process.env.DB_MON_PORT,
});

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRATION = '24h';
const JWT_COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas em ms

// Configuração da sessão (mantida APENAS para connect-flash e fluxo PKCE do MELI)
const sessionMiddleware = session({
  secret: 'chave-secreta-segura', // Mude para uma chave longa e aleatória em produção
  resave: false,
  saveUninitialized: false, // True se quiser salvar sessões anônimas, false se só após login
  cookie: {
    secure: false, // Em produção, com HTTPS, mude para true
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
});

exports.sessionMiddleware = sessionMiddleware;

// Middleware JWT: extrai e verifica o token do cookie, populando req.user
exports.jwtMiddleware = (req, res, next) => {
  const token = req.cookies && req.cookies.token;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Garantir que modulos_permitidos seja um array
    let modulos = decoded.modulos_permitidos || [];
    if (typeof modulos === 'string') {
      try {
        modulos = JSON.parse(modulos);
      } catch (e) {
        modulos = [];
      }
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      tipo_conta: decoded.tipo_conta !== undefined ? parseInt(decoded.tipo_conta) : 2,
      modulos_permitidos: modulos,
    };
  } catch (err) {
    // Token inválido ou expirado — limpa o cookie e segue sem autenticar
    res.clearCookie('token');
    req.user = null;
  }

  next();
};

// Função de login com limite de tentativas (rate-limiting via banco de dados)
exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];

      // Verifica se o usuário está bloqueado (rate-limiting via DB)
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.render('login', {
          title: 'Login',
          errorMessage: `Muitas tentativas! Conta bloqueada temporariamente. Tente novamente mais tarde.`,
          layout: false
        });
      }

      const match = await bcrypt.compare(password, user.password);

      if (match) {
        // Login bem-sucedido: resetar tentativas no banco
        await pool.query(
          'UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = $1',
          [user.id]
        );

        // Trata os módulos permitidos que estão guardados no banco como string JSON ou array
        let modulos = [];
        if (user.modulos_permitidos) {
          if (typeof user.modulos_permitidos === 'string') {
            try {
              modulos = JSON.parse(user.modulos_permitidos);
            } catch (e) {
              modulos = [];
            }
          } else if (Array.isArray(user.modulos_permitidos)) {
            modulos = user.modulos_permitidos;
          }
        }

        const tipoConta = user.tipo_conta !== undefined && user.tipo_conta !== null ? parseInt(user.tipo_conta) : 2;

        // Gerar JWT com tipo_conta e modulos_permitidos
        const token = jwt.sign(
          { 
            userId: user.id, 
            username: user.username, 
            role: user.cargo,
            tipo_conta: tipoConta,
            modulos_permitidos: modulos
          },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRATION }
        );

        // Setar cookie httpOnly
        res.cookie('token', token, {
          httpOnly: true,
          secure: false, // Em produção, com HTTPS, mude para true
          maxAge: JWT_COOKIE_MAX_AGE,
          sameSite: 'lax',
        });

        return res.redirect('/'); // Redireciona para o menu principal
      }
    }

    // Login falhou (usuário não encontrado ou senha não confere)
    // Atualizar tentativas no banco de dados
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const currentAttempts = (user.login_attempts || 0) + 1;
      let errorMessage = `Usuário ou senha inválidos!`;
      const remainingAttempts = 10 - currentAttempts;

      if (currentAttempts >= 10) {
        // Bloqueia por 5 minutos
        const lockedUntil = new Date(Date.now() + (5 * 60 * 1000));
        await pool.query(
          'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
          [currentAttempts, lockedUntil, user.id]
        );
        errorMessage = 'Muitas tentativas de login! Sua conta foi temporariamente bloqueada.';
      } else {
        await pool.query(
          'UPDATE users SET login_attempts = $1 WHERE id = $2',
          [currentAttempts, user.id]
        );
        if (remainingAttempts > 0) {
          errorMessage += ` Você tem ${remainingAttempts} tentativa(s) restante(s) antes do bloqueio.`;
        } else {
          errorMessage = 'Usuário ou senha inválidos! Esta é sua última tentativa antes do bloqueio.';
        }
      }

      return res.render('login', {
        title: 'Login',
        errorMessage: errorMessage,
        layout: false
      });
    }

    // Usuário não encontrado — mensagem genérica (sem revelar que o user não existe)
    res.render('login', {
      title: 'Login',
      errorMessage: 'Usuário ou senha inválidos!',
      layout: false
    });

  } catch (error) {
    console.error('Erro interno durante o processo de login:', error);
    res.render('login', {
      title: 'Login',
      errorMessage: 'Erro interno do servidor. Por favor, tente novamente mais tarde!',
      layout: false
    });
  }
};

// Middleware para proteger rotas (Autenticação Básica)
exports.requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/login');
  }
  next();
};

// Middleware para proteger rotas de Administração Geral
exports.requireAdmin = (req, res, next) => {
  if (req.user && (req.user.tipo_conta === 0 || req.user.tipo_conta === 1)) {
    return next();
  }
  req.flash('error', 'Acesso negado. Apenas administradores podem acessar esta página.');
  res.redirect('/');
};

// Middleware para controle de acesso granular de rotas por módulo
exports.requireModule = (moduleName) => {
  return (req, res, next) => {
    // Administrador Mestra (0) e Administrador (1) têm acesso livre a todos os módulos
    if (req.user && (req.user.tipo_conta === 0 || req.user.tipo_conta === 1)) {
      return next();
    }

    // Funcionário (2) precisa ter o módulo na lista de permissões
    if (req.user && req.user.tipo_conta === 2) {
      const modulos = req.user.modulos_permitidos || [];
      if (modulos.includes(moduleName)) {
        return next();
      }
    }

    // Se a requisição for AJAX/API
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(403).json({ success: false, message: 'Você não tem permissão para acessar este módulo.' });
    }

    // Se for rota de página normal
    req.flash('error', 'Acesso negado. Você não tem permissão para acessar o módulo: ' + moduleName);
    res.redirect('/');
  };
};

// Logout
exports.logout = (req, res) => {
  res.clearCookie('token');
  if (req.session) {
    req.session.destroy(() => {});
  }
  res.clearCookie('connect.sid');
  res.redirect('/login');
};

// --- CRUD DE USUÁRIOS (PAINEL ADMINISTRATIVO) ---

// 1. Listagem de usuários
exports.listUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, cargo, tipo_conta, modulos_permitidos FROM users ORDER BY username ASC');

    // Processar campos para exibição no template
    const users = result.rows.map(u => {
      let labelCargo = 'Funcionário';
      if (u.tipo_conta === 0) labelCargo = 'Administrador Mestre';
      else if (u.tipo_conta === 1) labelCargo = 'Administrador';

      return {
        id: u.id,
        username: u.username,
        cargoText: labelCargo,
        cargoOriginal: u.cargo,
        tipo_conta: u.tipo_conta,
        isMaster: u.tipo_conta === 0,
        isAdmin: u.tipo_conta === 1,
        isFuncionario: u.tipo_conta === 2 || u.tipo_conta === null
      };
    });

    res.render('admin/usuarios', {
      title: 'Gerenciamento de Usuários',
      users,
      isMasterAccount: req.user.tipo_conta === 0
    });
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    req.flash('error', 'Erro ao carregar a lista de usuários.');
    res.redirect('/');
  }
};

// 2. Renderizar formulário de criação de usuário
exports.renderCreateUser = (req, res) => {
  res.render('admin/editar-usuario', {
    title: 'Adicionar Novo Usuário',
    isEdit: false,
    isMasterAccount: req.user.tipo_conta === 0
  });
};

// 3. Criar usuário
exports.createUser = async (req, res) => {
  const { username, password, cargo, tipo_conta, modulos } = req.body;

  try {
    // 1. Verificar se usuário com mesmo nome já existe
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (exists.rows.length > 0) {
      return res.render('admin/editar-usuario', {
        title: 'Adicionar Novo Usuário',
        isEdit: false,
        isMasterAccount: req.user.tipo_conta === 0,
        errorMessage: 'Já existe um usuário com este nome.',
        userData: { username, cargo }
      });
    }

    // 2. Validação de cargos por privilégio do usuário logado
    const selectedTipoConta = parseInt(tipo_conta);
    if (req.user.tipo_conta !== 0) { // Se não for Master
      if (selectedTipoConta !== 2) { // E tentar criar admin
        req.flash('error', 'Apenas a conta mestra pode criar contas de Administrador.');
        return res.redirect('/admin/usuarios');
      }
    }

    // 3. Processar módulos
    let modulosPermitidos = [];
    if (selectedTipoConta === 2) {
      if (Array.isArray(modulos)) {
        modulosPermitidos = modulos;
      } else if (modulos) {
        modulosPermitidos = [modulos];
      }
    }

    // 4. Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Mapear campo textual de cargo para compatibilidade
    let textCargo = 'funcionário';
    if (selectedTipoConta === 0) textCargo = 'administrador mestre';
    else if (selectedTipoConta === 1) textCargo = 'administrador';

    await pool.query(
      'INSERT INTO users (username, password, cargo, tipo_conta, modulos_permitidos) VALUES ($1, $2, $3, $4, $5)',
      [username.trim(), hashedPassword, textCargo, selectedTipoConta, JSON.stringify(modulosPermitidos)]
    );

    req.flash('success', 'Usuário criado com sucesso!');
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.render('admin/editar-usuario', {
      title: 'Adicionar Novo Usuário',
      isEdit: false,
      isMasterAccount: req.user.tipo_conta === 0,
      errorMessage: 'Erro interno ao salvar usuário.',
      userData: { username, cargo }
    });
  }
};

// 4. Renderizar formulário de edição de usuário
exports.renderEditUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/admin/usuarios');
    }

    const u = result.rows[0];

    // Converter modulos_permitidos para array javascript
    let modulos = [];
    if (u.modulos_permitidos) {
      try {
        modulos = typeof u.modulos_permitidos === 'string' 
          ? JSON.parse(u.modulos_permitidos) 
          : u.modulos_permitidos;
      } catch (e) {
        modulos = [];
      }
    }

    const isMaster = u.tipo_conta === 0;
    const isAdmin = u.tipo_conta === 1;
    const isFuncionario = u.tipo_conta === 2 || u.tipo_conta === null;

    res.render('admin/editar-usuario', {
      title: `Editar Usuário: ${u.username}`,
      isEdit: true,
      isMasterAccount: req.user.tipo_conta === 0,
      userData: {
        id: u.id,
        username: u.username,
        cargo: u.cargo,
        tipo_conta: u.tipo_conta,
        isMaster,
        isAdmin,
        isFuncionario
      },
      modulos,
      // Flags booleanas para marcar no view (26 permissões granulares detalhadas)
      has_monitoramento_madeira_lucas: modulos.includes('monitoramento_madeira_lucas'),
      has_monitoramento_madeira_eliane: modulos.includes('monitoramento_madeira_eliane'),
      has_monitoramento_viavarejo: modulos.includes('monitoramento_viavarejo'),
      
      has_faturamento_gerenciar_emissoes: modulos.includes('faturamento_gerenciar_emissoes'),
      has_faturamento_gerar_etiquetas: modulos.includes('faturamento_gerar_etiquetas'),
      has_faturamento_automatico: modulos.includes('faturamento_automatico'),
      has_faturamento_gerenciar_pedidos: modulos.includes('faturamento_gerenciar_pedidos'),
      has_faturamento_assistencias: modulos.includes('faturamento_assistencias'),
      has_faturamento_historico_notas: modulos.includes('faturamento_historico_notas'),
      
      has_produtos_gerenciar: modulos.includes('produtos_gerenciar'),
      has_produtos_tipos: modulos.includes('produtos_tipos'),
      has_produtos_sincronizar: modulos.includes('produtos_sincronizar'),
      has_produtos_estoque_dev: modulos.includes('produtos_estoque_dev'),
      has_produtos_bipagem_pecas: modulos.includes('produtos_bipagem_pecas'),
      
      has_expedicao_ordenador: modulos.includes('expedicao_ordenador'),
      has_expedicao_gondolas: modulos.includes('expedicao_gondolas'),
      has_expedicao_rel_tarde: modulos.includes('expedicao_rel_tarde'),
      has_expedicao_bipagem_produtos: modulos.includes('expedicao_bipagem_produtos'),
      has_expedicao_dashboard: modulos.includes('expedicao_dashboard'),
      has_expedicao_bipagem_exp: modulos.includes('expedicao_bipagem_exp'),
      has_expedicao_massa: modulos.includes('expedicao_massa'),
      
      has_conferencia_bipagem: modulos.includes('conferencia_bipagem'),
      has_conferencia_codigos: modulos.includes('conferencia_codigos'),
      has_conferencia_ml_batch: modulos.includes('conferencia_ml_batch'),
      
      has_logistica_relacoes: modulos.includes('logistica_relacoes'),
      has_logistica_rastreio: modulos.includes('logistica_rastreio')
    });
  } catch (error) {
    console.error('Erro ao buscar dados do usuário para edição:', error);
    req.flash('error', 'Erro ao carregar dados do usuário.');
    res.redirect('/admin/usuarios');
  }
};

// 5. Atualizar usuário
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, password, tipo_conta, modulos } = req.body;

  try {
    // 1. Obter dados atuais do usuário no banco
    const currentResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      req.flash('error', 'Usuário não encontrado.');
      return res.redirect('/admin/usuarios');
    }
    const targetUser = currentResult.rows[0];

    // 2. Garantir que não existirá duplicidade de nome de usuário
    const exists = await pool.query('SELECT id FROM users WHERE username = $1 AND id <> $2', [username.trim(), id]);
    if (exists.rows.length > 0) {
      return res.render('admin/editar-usuario', {
        title: `Editar Usuário: ${targetUser.username}`,
        isEdit: true,
        isMasterAccount: req.user.tipo_conta === 0,
        errorMessage: 'Já existe um usuário cadastrado com este nome.',
        userData: { id, username, tipo_conta }
      });
    }

    // 3. Validação rígida de cargos (Apenas conta Mestre pode alterar cargos de/para Administrador)
    const selectedTipoConta = parseInt(tipo_conta);
    if (req.user.tipo_conta !== 0) {
      if (selectedTipoConta !== targetUser.tipo_conta) {
        req.flash('error', 'Apenas a conta mestra pode alterar o cargo/perfil de usuários.');
        return res.redirect('/admin/usuarios');
      }
    }

    // 4. Mapeamento textual de cargo
    let textCargo = 'funcionário';
    if (selectedTipoConta === 0) textCargo = 'administrador mestre';
    else if (selectedTipoConta === 1) textCargo = 'administrador';

    // 5. Tratar módulos de acesso se for funcionário
    let modulosPermitidos = [];
    if (selectedTipoConta === 2) {
      if (Array.isArray(modulos)) {
        modulosPermitidos = modulos;
      } else if (modulos) {
        modulosPermitidos = [modulos];
      }
    }

    // 6. Atualizar senha se preenchida
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE users SET username = $1, password = $2, cargo = $3, tipo_conta = $4, modulos_permitidos = $5 WHERE id = $6',
        [username.trim(), hashedPassword, textCargo, selectedTipoConta, JSON.stringify(modulosPermitidos), id]
      );
    } else {
      await pool.query(
        'UPDATE users SET username = $1, cargo = $2, tipo_conta = $3, modulos_permitidos = $4 WHERE id = $5',
        [username.trim(), textCargo, selectedTipoConta, JSON.stringify(modulosPermitidos), id]
      );
    }

    req.flash('success', 'Usuário atualizado com sucesso!');
    res.redirect('/admin/usuarios');
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    req.flash('error', 'Erro interno ao salvar alterações.');
    res.redirect('/admin/usuarios');
  }
};

// 6. Deletar usuário
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Obter informações do usuário a ser deletado
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }
    const targetUser = userResult.rows[0];

    // 2. Não permitir que o usuário delete a si mesmo
    if (parseInt(id) === req.user.userId) {
      return res.status(400).json({ success: false, message: 'Você não pode excluir sua própria conta.' });
    }

    // 3. Administradores normais não podem excluir outros administradores
    if (req.user.tipo_conta !== 0 && (targetUser.tipo_conta === 0 || targetUser.tipo_conta === 1)) {
      return res.status(403).json({ success: false, message: 'Apenas a conta mestra pode excluir contas de Administradores.' });
    }

    // 4. Executar deleção
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    
    return res.status(200).json({ success: true, message: 'Usuário excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    return res.status(500).json({ success: false, message: 'Erro interno ao excluir o usuário.' });
  }
};