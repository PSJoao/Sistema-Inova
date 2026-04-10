const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/madeiraController');
const authController = require('../controllers/authController');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

//Rota de login
router.use(authController.requireAuth);
// Rotas para o módulo Madeira Madeira
router.get('/madeira/monitoring', monitoringController.getMonitoringProducts);
router.get('/madeira/non-competitive-products', monitoringController.getNonCompetitiveProducts);
router.get('/madeira/urls', monitoringController.getUrls);
router.get('/madeira/add-url', (req, res) => {
  res.render('mm/add-url', { title: 'Adicionar Produto' });
});
router.post('/madeira/add-url', monitoringController.addUrl);
router.get('/madeira/edit-url/:id', monitoringController.editUrl);
router.post('/madeira/update-url/:id', monitoringController.updateUrl);
router.post('/madeira/remove-url', monitoringController.removeUrl);
router.get('/', (req, res) => {
  res.render('menu', { title: 'Menu Madeira' });
});
router.get('/madeira/update-prices', monitoringController.updatePrices);
router.get('/madeira/out-of-promotion', monitoringController.getProductsOutOfPromotion);
router.get('/madeira/generate-report', monitoringController.generateReport);
router.get('/madeira/generate-monitoring-report', monitoringController.generateMonitoringReport);
router.get('/madeira/bulk-add', (req, res) => {
    res.render('mm/bulk-add', { 
        title: 'Adicionar Produtos em Massa' 
    });
});
router.post('/madeira/bulk-add', upload.single('productSheet'), monitoringController.bulkAddProductsFromFile);

module.exports = router;