const { PDFDocument } = require('pdf-lib');
const pdf = require('pdf-parse'); // Manter o import caso precise no futuro

/**
 * FUNÇÃO DE TESTE:
 * O objetivo é simplesmente carregar o PDF original, criar um novo PDF,
 * copiar a primeira página do original para o novo e retorná-lo.
 * Isso nos ajudará a verificar se o problema está na leitura/escrita básica do PDF.
 */
async function organizeLabelsPdf(pdfBuffer) {
    console.log('[TESTE] Iniciando o teste de replicação de página...');

    try {
        // 1. Carrega o documento PDF original a partir do buffer
        const originalPdf = await PDFDocument.load(pdfBuffer);
        console.log(`[TESTE] PDF original carregado. Total de páginas: ${originalPdf.getPageCount()}`);

        // 2. Cria um novo documento PDF em branco
        const newPdf = await PDFDocument.create();
        console.log('[TESTE] Novo documento PDF criado.');

        // 3. Copia a primeira página (índice 0) do PDF original para o novo
        // A função copyPages retorna um array de páginas copiadas
        const [firstPage] = await newPdf.copyPages(originalPdf, [0]);
        console.log('[TESTE] Primeira página copiada com sucesso.');

        // 4. Adiciona a página copiada ao novo documento
        newPdf.addPage(firstPage);
        console.log('[TESTE] Página copiada foi adicionada ao novo documento.');

        // 5. Salva o novo documento PDF em um buffer
        const newPdfBytes = await newPdf.save();
        console.log(`[TESTE] Novo PDF salvo em buffer. Tamanho: ${newPdfBytes.length} bytes.`);

        // 6. Retorna o buffer do novo PDF
        return newPdfBytes;

    } catch (error) {
        console.error('[TESTE] Ocorreu um erro durante o teste de replicação:', error);
        // Em caso de erro, retorna um PDF vazio para não quebrar o download
        const errorPdf = await PDFDocument.create();
        return await errorPdf.save();
    }
}

// Manter a exportação do módulo
module.exports = {
    organizeLabelsPdf
};