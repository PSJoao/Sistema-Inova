// routes/productSyncRoutes.js
const express = require('express');
const router = express.Router();
const productSyncController = require('../controllers/productSyncController');
const authController = require('../controllers/authController'); // Reutiliza o middleware de autenticação

router.use(authController.requireAuth);

// Rota para exibir a página de upload
router.get('/', productSyncController.renderProductSyncPage);

// Rota para processar o upload das planilhas
// O middleware do multer é chamado implicitamente pela função do controller agora
router.post('/upload', productSyncController.handleProductSyncUpload);

module.exports = router;
