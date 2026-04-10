// routes/tiposRoutes.js
const express = require('express');
const router = express.Router();
const tiposController = require('../controllers/tiposController');
const authController = require('../controllers/authController');
const multer = require('multer');

// Configuração do Multer para upload da planilha em memória
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            cb(null, true);
        } else {
            cb(new Error('Formato de arquivo inválido. Apenas planilhas .xlsx são permitidas.'), false);
        }
    }
}).single('tiposPlanilha'); // 'tiposPlanilha' é o 'name' do input no form

// Protege todas as rotas de tipos
router.use('/tipos', authController.requireAuth);

// Rota para renderizar a página de gerenciamento
// GET /tipos
router.get('/tipos', tiposController.renderTiposPage);

// Rota para processar o upload da planilha
// POST /tipos/upload
router.post('/tipos/upload', upload, tiposController.uploadTiposPlanilha);

// Rota para atualização individual
// POST /tipos/update-individual
router.post('/tipos/update-individual', tiposController.updateTipoIndividual);

module.exports = router;