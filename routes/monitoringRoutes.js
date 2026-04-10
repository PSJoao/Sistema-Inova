const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoringController');
const authController = require('../controllers/authController');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

//Rota de login
router.use(authController.requireAuth);
// Rotas para o módulo Madeira Madeira
router.get('/madeiramadeira/monitoring', monitoringController.getMonitoringProducts);
router.get('/madeiramadeira/non-competitive-products', monitoringController.getNonCompetitiveProducts);
router.get('/madeiramadeira/urls', monitoringController.getUrls);
router.get('/madeiramadeira/add-url', (req, res) => {
  res.render('monitoring/add-url', { title: 'Adicionar Produto' });
});
router.post('/madeiramadeira/add-url', monitoringController.addUrl);
router.get('/madeiramadeira/edit-url/:id', monitoringController.editUrl);
router.post('/madeiramadeira/update-url/:id', monitoringController.updateUrl);
router.post('/madeiramadeira/remove-url', monitoringController.removeUrl);
router.get('/', (req, res) => {
  res.render('menu', { title: 'Menu Madeira' });
});
router.get('/madeiramadeira/update-prices', monitoringController.updatePrices);
router.get('/madeiramadeira/out-of-promotion', monitoringController.getProductsOutOfPromotion);
router.get('/madeiramadeira/generate-report', monitoringController.generateReport);
router.get('/madeiramadeira/generate-monitoring-report', monitoringController.generateMonitoringReport);
router.get('/madeiramadeira/bulk-add', (req, res) => {
    res.render('monitoring/bulk-add', { 
        title: 'Adicionar Produtos em Massa' 
    });
});
router.post('/madeiramadeira/bulk-add', upload.single('productSheet'), monitoringController.bulkAddProductsFromFile);

module.exports = router;