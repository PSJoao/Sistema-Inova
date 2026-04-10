const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.HUB_JWT_SECRET;

const verifyHubToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer
    if (!token) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified; // Adiciona os dados do cliente (id, email) na requisição
        next();
    } catch (err) {
        res.status(403).json({ error: 'Token inválido ou expirado.' });
    }
};

module.exports = { verifyHubToken, JWT_SECRET };