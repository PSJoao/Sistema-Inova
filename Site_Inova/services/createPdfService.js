const PDFDocument = require('pdfkit');

function generateAssistancePDF(data, stream) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 50
    });

    doc.pipe(stream);

    const pageLeft = 50;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // --- Cabeçalho ---
    doc.fontSize(20).font('Helvetica-Bold').text('INOVA MOVEIS', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text('INOVA MAGAZINE COMERCIO DE MOVEIS LTDA', { align: 'left' });
    doc.text('CNPJ: 40.062.295/0001-45', { align: 'left' });
    doc.text('RUA MARIA EDMÉA BLUNDI ARROYO, 1750, PRIMEIRO DISTRITO INDUSTRIAL, VOTUPORANGA, SP, CEP 15503-014', { align: 'left' });
    doc.text('FONE: (17) 3406-4062', { align: 'left' });
    doc.moveDown(2);

    // --- Data do Pedido ---
    doc.fontSize(12).font('Helvetica-Bold').text(`DATA DO PEDIDO: ${data.data_solicitacao_fmt}`, { align: 'right' });
    doc.moveDown(2);

    // --- Tabela de Informações do Cliente ---
    const tableTop = doc.y;
    doc.font('Helvetica-Bold').text('CLIENTE', pageLeft, tableTop);
    doc.text('CPF', pageLeft + 250, tableTop);
    doc.font('Helvetica').text(data.nome_pedido, pageLeft, tableTop + 15, { width: 240 });
    doc.text(data.documento_cliente || 'N/A', pageLeft + 250, tableTop + 15);
    doc.moveDown(3);

    // Linha divisória
    doc.moveTo(pageLeft, doc.y).lineTo(pageLeft + pageWidth, doc.y).stroke();
    doc.moveDown(1);

    // --- Seção de Produtos e Peças ---
    // << CORREÇÃO 1: Centralização do Título >>
    // Ao chamar .text() sem coordenadas X e Y, o { align: 'center' } usará a largura total
    // disponível entre as margens, resultando em uma centralização perfeita.
    doc.fontSize(14).font('Helvetica-Bold').text('PEÇAS SOLICITADAS', pageLeft + 175);
    doc.moveDown(1.5);

    if (data.produtos && data.produtos.length > 0) {
        data.produtos.forEach(produto => {
            const startY = doc.y;
            const padding = 10;
            let contentY = startY + padding;

            // << CORREÇÃO 2: Alinhamento Vertical dos Itens >>
            // Armazenamos a posição Y atual antes de desenhar os elementos da linha.
            const lineY = contentY;

            // Agora, usamos 'lineY' para todos os textos que devem estar na mesma altura.
            doc.fontSize(10).font('Helvetica-Bold').text('PRODUTO:', pageLeft + padding, lineY);
            doc.font('Helvetica').text(produto.nome_produto, pageLeft + padding + 60, lineY, { width: 280 });

            doc.font('Helvetica-Bold').text('COR:', pageLeft + 350, lineY);
            
            // Dica extra: Verifique se cada produto tem sua própria cor.
            // Se sim, o ideal seria usar 'produto.cor' em vez de 'data.cor'.
            // Vou manter como 'data.cor' para seguir seu código original.
            doc.font('Helvetica').text(data.cor || 'N/A', pageLeft + 380, lineY, { width: 100 });
            
            // Avança o cursor para depois da linha que acabamos de desenhar
            doc.y = lineY + 15; // Adiciona um espaçamento (1.5 * font size)

            doc.moveDown(2);

            // Lista as peças dentro da caixa
            if (produto.pecas && produto.pecas.length > 0) {
                 produto.pecas.forEach(peca => {
                    doc.fontSize(10).font('Helvetica').list([peca.nome_peca], pageLeft + padding, doc.y, {
                        bulletRadius: 2.5,
                        textIndent: 15,
                        lineGap: 4
                    });
                });
            } else {
                doc.fontSize(10).font('Helvetica-Oblique').text('Nenhuma peça especificada para este produto.', pageLeft + padding + 15, doc.y);
                doc.moveDown();
            }

            // Garante um pequeno padding no final antes de medir a altura
            doc.moveDown(0.5); 
            const endY = doc.y;
            const boxHeight = (endY - startY);

            // Agora desenha a caixa com a altura calculada
            doc.rect(pageLeft, startY, pageWidth, boxHeight).stroke();

            // Reposiciona o cursor para depois da caixa
            doc.y = startY + boxHeight + 15; // 15 de margem inferior
        });
    } else {
        doc.fontSize(10).font('Helvetica-Oblique').text('Nenhum produto associado a esta assistência.');
    }

    doc.end();
}

module.exports = { generateAssistancePDF };