// controllers/pedidosFullController.js

const blingSyncService = require('../blingSyncService');

/**
 * @route POST /api/pedidos-full/sync
 * @description Dispara a sincronização manual dos pedidos de venda "FULL".
 */
exports.iniciarSincronizacaoFull = async (req, res) => {
    console.log('[PedidosFullController] Recebida requisição para Sincronização Full de Pedidos...');
    
    // Checa o status ANTES de disparar
    const currentStatus = blingSyncService.getSyncStatus();
    
    // Verifica se qualquer sincronização crítica está em andamento
    if (currentStatus.isPedidoFullSyncRunning || currentStatus.isNFeRunning || currentStatus.isProductSyncRunning || currentStatus.isEmissaoPageActive) {
         console.warn('[PedidosFullController] Tentativa de iniciar sync, mas outra operação já está em andamento.');
         return res.status(409).json({ // 409 Conflict
            success: false,
            message: 'Outra sincronização (NFe, Produtos, Emissão ou Pedidos Full) já está em andamento. Tente novamente mais tarde.'
         });
    }
    
    // Dispara a função em background (não usa 'await' aqui)
    // Isso libera a requisição HTTP imediatamente
    blingSyncService.syncPedidosVendaFull()
        .then(result => {
            // Loga quando a tarefa de background terminar
            console.log(`[PedidosFullController] Sincronização em background concluída: ${result.message}`);
        })
        .catch(error => {
            // Loga se a tarefa de background falhar
            console.error(`[PedidosFullController] Erro inesperado na Sincronização em background: ${error.message}`);
        });

    // Resposta imediata 202 Accepted
    // Informa ao usuário que a tarefa foi aceita e está rodando
    res.status(202).json({ 
        success: true, 
        message: 'A sincronização dos Pedidos Full foi iniciada em segundo plano. O processo pode levar alguns minutos.' 
    });
};