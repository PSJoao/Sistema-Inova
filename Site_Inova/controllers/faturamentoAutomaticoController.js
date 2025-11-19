const faturamentoService = require('../services/faturamentoAutomaticoService');

exports.handleFaturamentoManual = async (req, res) => {
    const { accountName } = req.body;

    // Validação básica
    if (!accountName || (accountName !== 'lucas' && accountName !== 'eliane')) {
        return res.status(400).json({ 
            success: false, 
            message: 'Conta inválida. Informe "lucas" ou "eliane".' 
        });
    }

    console.log(`[Controller] Recebida solicitação de Faturamento Automático ML para: ${accountName}`);

    // Aciona o serviço sem 'await' para liberar a resposta da API imediatamente.
    // O processo continuará rodando no servidor.
    faturamentoService.startFaturamentoAutomatico(accountName)
        .then(() => {
            console.log(`[Controller] Ciclo de faturamento background finalizado para ${accountName}.`);
        })
        .catch((err) => {
            console.error(`[Controller] Erro não tratado no ciclo de faturamento de ${accountName}:`, err);
        });

    return res.status(200).json({ 
        success: true, 
        message: `Processo de Faturamento Automático (${accountName}) iniciado! Acompanhe pelos logs do servidor.` 
    });
};