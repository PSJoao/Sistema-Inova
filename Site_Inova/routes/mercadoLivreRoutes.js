const express = require('express');
const router = express.Router();
const multer = require('multer');
const mercadoLivreController = require('../controllers/mercadoLivreController');
const authController = require('../controllers/authController');

// Configuração do Multer para upload de arquivos em memória
const upload = multer({ storage: multer.memoryStorage() });

router.use(authController.requireAuth);

// Rota principal para exibir a página do organizador de etiquetas
router.get('/mercado-livre/organizer', mercadoLivreController.showOrganizerPage);

// Rota para processar o upload do arquivo de etiquetas
router.post('/mercado-livre/process-labels', upload.single('pdfFile'), mercadoLivreController.processLabels);

module.exports = router;