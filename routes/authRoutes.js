// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/politica-privacidade', (req, res) => {
    res.render('public/politica-privacidade', { 
        layout: 'public', // Especifica o novo layout 'public.handlebars'
        title: 'Política de Privacidade' // Título da página
    });
});

// Se sessionMiddleware já é global no index.js, pode não ser necessário aqui.
// Mas se for específico para rotas de autenticação, mantenha.
router.use(authController.sessionMiddleware);

router.get('/login', (req, res) => {
  res.render('login', { 
    title: 'Login',
    layout: false // Adicione esta linha para NÃO usar o layout 'main'
  });
});

router.post('/login', authController.login);
router.get('/logout', authController.logout);

// --- Rotas de Gerenciamento de Usuários (Painel Administrativo) ---
router.get('/admin/usuarios', authController.requireAuth, authController.requireAdmin, authController.listUsers);
router.get('/admin/usuarios/novo', authController.requireAuth, authController.requireAdmin, authController.renderCreateUser);
router.post('/admin/usuarios/novo', authController.requireAuth, authController.requireAdmin, authController.createUser);
router.get('/admin/usuarios/editar/:id', authController.requireAuth, authController.requireAdmin, authController.renderEditUser);
router.post('/admin/usuarios/editar/:id', authController.requireAuth, authController.requireAdmin, authController.updateUser);
router.post('/admin/usuarios/deletar/:id', authController.requireAuth, authController.requireAdmin, authController.deleteUser);

// Rota para persistência do estado da sidebar
router.post('/api/user/sidebar-state', authController.requireAuth, authController.updateSidebarState);

module.exports = router;