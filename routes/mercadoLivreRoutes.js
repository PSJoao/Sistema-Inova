const express = require('express');
const router = express.Router();
const multer = require('multer');
const mercadoLivreController = require('../controllers/mercadoLivreController');
const authController = require('../controllers/authController');
const meliAuthController = require('../controllers/meliAuthController');

// Configuração do Multer para upload de arquivos em memória
const upload = multer({ storage: multer.memoryStorage() });

router.post('/mercado-livre/webhook', mercadoLivreController.handleWebhook);

router.use(authController.requireAuth);

// Rota principal para exibir a página do organizador de etiquetas
router.get('/mercado-livre/organizer', mercadoLivreController.showOrganizerPage);

// Rota para processar o upload do arquivo de etiquetas
router.post('/mercado-livre/process-labels', upload.single('pdfFile'), mercadoLivreController.processLabels);

router.get('/mercado-livre/auth', meliAuthController.authorize);

// Rota de callback (para onde o MELI redireciona)
router.get('/mercado-livre/callback', meliAuthController.handleCallback);

module.exports = router;