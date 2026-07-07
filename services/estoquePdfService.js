// services/estoquePdfService.js
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

// Conversão de milímetros para pontos (Padrão PDFKit: 1mm = 2.83465pt)
const mmToPt = (mm) => mm * 2.83465;

/**
 * Gera o buffer de um código de barras Code 128 usando bwip-js.
 */
async function gerarCodigoBarrasBuffer(texto) {
    return await bwipjs.toBuffer({
        bcid: 'code128',
        text: texto,
        scale: 2,
        height: 10,
        includetext: false,
    });
}

/**
 * Cria o PDF de etiquetas de peça (cada página é uma etiqueta de 3cm x 10cm).
 * 
 * @param {Object} peca Dados da peça do estoque
 * @param {number} quantidade Quantidade de etiquetas a gerar
 * @returns {Promise<Buffer>} Buffer do PDF gerado
 */
async function gerarPdfEtiquetasPeca(peca, quantidade) {
    return new Promise(async (resolve, reject) => {
        try {
            const buffers = [];
            
            // Dimensão da etiqueta: 100mm de largura x 30mm de altura
            const doc = new PDFDocument({
                size: [mmToPt(100), mmToPt(30)],
                margin: 0
            });

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // Gera o código de barras usando o SKU
            const barcodeBuffer = await gerarCodigoBarrasBuffer(peca.sku);
            const totalEtiquetas = parseInt(quantidade) || 1;

            // Formata o texto descritivo longo: Produto Pai - Fábrica - Nome Peça - Cor (se houver)
            const partesDescricao = [];
            if (peca.produto_pai_nome || peca.produto_pai_sku) {
                partesDescricao.push(peca.produto_pai_nome || peca.produto_pai_sku);
            } else {
                partesDescricao.push('Sem Produto Pai');
            }
            
            partesDescricao.push(peca.fabrica_nome || 'Sem Fábrica');
            partesDescricao.push(peca.nome_peca);
            
            if (peca.cor && peca.cor.trim() !== '') {
                partesDescricao.push(peca.cor.trim());
            }
            
            const textoDescricao = partesDescricao.join(' - ');

            for (let i = 0; i < totalEtiquetas; i++) {
                if (i > 0) doc.addPage();

                // 1. SKU (Canto superior esquerdo)
                doc.fontSize(9)
                   .font('Helvetica-Bold')
                   .fillColor('#000000')
                   .text(peca.sku, mmToPt(4), mmToPt(3), { width: mmToPt(48) });

                // 2. Localização (Abaixo do SKU)
                const localizacao = (peca.coluna_localizacao || peca.linha_localizacao)
                    ? `Loc: ${peca.coluna_localizacao || '-'}/${peca.linha_localizacao || '-'}`
                    : 'Loc: -';
                
                doc.fontSize(7.5)
                   .font('Helvetica')
                   .text(localizacao, mmToPt(4), mmToPt(9), { width: mmToPt(48) });

                // 3. Nº Peça (Abaixo da localização)
                const numeroPecaStr = peca.numero_peca ? `Nº Peça: ${peca.numero_peca}` : 'Nº Peça: -';
                doc.fontSize(7.5)
                   .font('Helvetica')
                   .text(numeroPecaStr, mmToPt(4), mmToPt(14.5), { width: mmToPt(48) });

                // 4. Código de Barras do SKU (Canto superior direito)
                // Ocupa a faixa de X=55mm até X=96mm, Y=3mm a Y=12mm
                doc.image(barcodeBuffer, mmToPt(55), mmToPt(3), {
                    width: mmToPt(41),
                    height: mmToPt(9)
                });

                // 5. Descrição Longa (Abaixo do número da peça, ocupando toda a largura útil)
                // Fonte reduzida (6.5pt) em negrito com quebra automática de linha para não ultrapassar a etiqueta
                doc.fontSize(6.5)
                   .font('Helvetica-Bold')
                   .text(textoDescricao, mmToPt(4), mmToPt(20.5), {
                       width: mmToPt(92),
                       align: 'left',
                       lineGap: 1
                   });
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    gerarPdfEtiquetasPeca
};
