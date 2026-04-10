// services/carregadoresPdfService.js
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');
const archiver = require('archiver');

// Conversão de milímetros para pontos (Padrão PDFKit: 1mm = 2.83465pt)
const mmToPt = (mm) => mm * 2.83465;

async function gerarCodigoBarrasBuffer(texto) {
    return await bwipjs.toBuffer({
        bcid: 'code128',
        text: texto,
        scale: 2,
        height: 10,
        includetext: false,
    });
}

async function createCarregadorPdf(carregador) {
    return new Promise(async (resolve, reject) => {
        try {
            const buffers = [];
            // Dimensão da página: 80mm de largura (2 colunas de 40mm) x 25mm de altura
            const doc = new PDFDocument({
                size: [mmToPt(80), mmToPt(25)], 
                margin: 0
            });

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            const barcodeBuffer = await gerarCodigoBarrasBuffer(carregador.codigo_barras);
            const quantidade = parseInt(carregador.quantidade) || 1;
            const totalPaginas = Math.ceil(quantidade / 2);

            let etiquetasImpressas = 0;

            for (let p = 0; p < totalPaginas; p++) {
                if (p > 0) doc.addPage();

                // ETIQUETA 1 (Esquerda - 0 a 40mm)
                if (etiquetasImpressas < quantidade) {
                    doc.image(barcodeBuffer, mmToPt(5), mmToPt(3), { width: mmToPt(30), height: mmToPt(10) });
                    doc.fontSize(8).font('Helvetica-Bold').text(carregador.nome.substring(0, 18), mmToPt(2), mmToPt(15), { width: mmToPt(36), align: 'center' });
                    doc.fontSize(6).font('Helvetica').text(carregador.codigo_barras, mmToPt(2), mmToPt(19), { width: mmToPt(36), align: 'center' });
                    etiquetasImpressas++;
                }

                // ETIQUETA 2 (Direita - 40 a 80mm)
                if (etiquetasImpressas < quantidade) {
                    doc.image(barcodeBuffer, mmToPt(45), mmToPt(3), { width: mmToPt(30), height: mmToPt(10) });
                    doc.fontSize(8).font('Helvetica-Bold').text(carregador.nome.substring(0, 18), mmToPt(42), mmToPt(15), { width: mmToPt(36), align: 'center' });
                    doc.fontSize(6).font('Helvetica').text(carregador.codigo_barras, mmToPt(42), mmToPt(19), { width: mmToPt(36), align: 'center' });
                    etiquetasImpressas++;
                }
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

async function gerarZipEtiquetasCarregadores(carregadores) {
    return new Promise(async (resolve, reject) => {
        try {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const zipBuffer = [];

            archive.on('data', data => zipBuffer.push(data));
            archive.on('end', () => resolve(Buffer.concat(zipBuffer)));
            archive.on('error', err => reject(err));

            for (const carregador of carregadores) {
                const pdfBuffer = await createCarregadorPdf(carregador);
                // Nome do arquivo limpo para evitar problemas no Windows/Linux
                const safeName = carregador.nome.replace(/[^a-zA-Z0-9]/g, '_');
                archive.append(pdfBuffer, { name: `Etiquetas_${safeName}.pdf` });
            }

            archive.finalize();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    gerarZipEtiquetasCarregadores
};