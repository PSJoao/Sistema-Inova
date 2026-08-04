// routes/stockHistoryRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { getStockHistory, getStockSummary } = require('../services/stockHistoryService');

// Todas as rotas exigem autenticação
router.use(authController.requireAuth);

/**
 * GET /api/stock-history
 * Lista movimentações de estoque com filtros.
 * 
 * Query params:
 *   - sku: string (busca parcial)
 *   - blingProductId: number
 *   - account: 'lucas' | 'eliane'
 *   - operation: 'E' | 'S'
 *   - startDate: ISO 8601
 *   - endDate: ISO 8601
 *   - limit: number (default 50)
 *   - offset: number (default 0)
 */
router.get('/history', async (req, res) => {
    try {
        const filters = {
            sku: req.query.sku || null,
            blingProductId: req.query.blingProductId ? parseInt(req.query.blingProductId, 10) : null,
            account: req.query.account || null,
            operation: req.query.operation || null,
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : 0
        };

        const result = await getStockHistory(filters);
        res.json({ success: true, data: result.rows, total: result.total });
    } catch (err) {
        console.error('[StockHistory API] Erro ao buscar histórico:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao buscar histórico de estoque.' });
    }
});

/**
 * GET /api/stock-history/summary
 * Resumo de entradas/saídas por produto em um período.
 * Útil para análise de compras.
 * 
 * Query params:
 *   - account: 'lucas' | 'eliane'
 *   - startDate: ISO 8601
 *   - endDate: ISO 8601
 *   - blingProductId: number (opcional, para produto específico)
 */
router.get('/summary', async (req, res) => {
    try {
        const filters = {
            account: req.query.account || null,
            startDate: req.query.startDate || null,
            endDate: req.query.endDate || null,
            blingProductId: req.query.blingProductId ? parseInt(req.query.blingProductId, 10) : null
        };

        const summary = await getStockSummary(filters);
        res.json({ success: true, data: summary });
    } catch (err) {
        console.error('[StockHistory API] Erro ao buscar resumo:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao buscar resumo de estoque.' });
    }
});

module.exports = router;
