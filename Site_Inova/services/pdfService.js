const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs = require('fs/promises');
const path = require('path');
const bwip = require('bwip-js');

const cmToPoints = (cm) => cm * 28.3465;

// Limpa quebras de linha e espaços extras
const sanitizeText = (text, fallback = '') =>
    String(text || fallback).replace(/[\r\n\t]+/g, ' ').trim();

/**
 * Quebra um texto em múltiplas linhas com base na largura da página.
 */
function wrapText(text, font, fontSize, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (const word of words) {
        const testLine = line ? line + ' ' + word : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > maxWidth) {
            if (line) lines.push(line);
            line = word;
        } else {
            line = testLine;
        }
    }
    if (line) lines.push(line);
    return lines;
}

async function generateLabelsPdf(labelsData) {
    console.log('[PDF Service] Iniciando geração de PDF com rotação de página...');

    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const labelWidth = cmToPoints(15);
    const labelHeight = cmToPoints(10);
    const margin = cmToPoints(0.8);

    for (const label of labelsData) {
        const page = pdfDoc.addPage([labelWidth, labelHeight]);
        page.setRotation(degrees(90));

        const chaveAcesso = sanitizeText(label.chave_acesso, '00000000000000000000000000000000000000000000');
        const pngBuffer = await bwip.toBuffer({
            bcid: 'code128',
            text: chaveAcesso,
            scale: 3,
            height: 14
        });
        const barcodeImage = await pdfDoc.embedPng(pngBuffer);

        let currentY = labelHeight - margin;

        const dataFormatada = label.nfe_emissao
            ? new Date(label.nfe_emissao).toLocaleDateString('pt-BR')
            : 'Data não disponível';

        page.drawText(sanitizeText(label.empresa?.nome), {
            x: margin,
            y: currentY,
            font: helveticaBoldFont,
            size: 10
        });
        page.drawText(`Data Emissão: ${dataFormatada}`, {
            x: margin + 250,
            y: currentY,
            font: helveticaBoldFont,
            size: 10
        });
        currentY -= 12;

        page.drawText(sanitizeText(label.empresa?.cnpj), {
            x: margin,
            y: currentY,
            font: helveticaFont,
            size: 9
        });

        currentY -= 16;
        currentY -= 20;

        const nomeDestinatario = sanitizeText(label.nome, 'DESTINATÁRIO NÃO INFORMADO');
        const nomeLines = wrapText(nomeDestinatario, helveticaBoldFont, 16, labelWidth - margin * 2);
        nomeLines.forEach(line => {
            page.drawText(line, {
                x: margin,
                y: currentY,
                font: helveticaBoldFont,
                size: 16,
            });
            currentY -= 18;
        });

        page.drawText(`${sanitizeText(label.endereco)}, ${sanitizeText(label.numero)}`, {
            x: margin,
            y: currentY,
            font: helveticaFont,
            size: 12
        });
        currentY -= 15;

        const complementoBairro = `${label.complemento ? sanitizeText(label.complemento) + ' - ' : ''}Bairro: ${sanitizeText(label.bairro)}`;
        const wrappedLines = wrapText(complementoBairro, helveticaFont, 12, labelWidth - margin * 2);
        wrappedLines.forEach(line => {
            page.drawText(line, {
                x: margin,
                y: currentY,
                font: helveticaFont,
                size: 12
            });
            currentY -= 14;
        });

        page.drawText(`CEP: ${sanitizeText(label.cep)} - ${sanitizeText(label.municipio)} - ${sanitizeText(label.uf)}`, {
            x: margin,
            y: currentY,
            font: helveticaFont,
            size: 12
        });
        currentY -= 15;

        if (label.fone) {
            page.drawText(`FONE: ${sanitizeText(label.fone)}`, {
                x: margin,
                y: currentY,
                font: helveticaFont,
                size: 12
            });
            currentY -= 15;
        }

        const produtoNomeLines = wrapText(`Produto: ${sanitizeText(label.product_name, 'N/D')}`, helveticaBoldFont, 10, labelWidth - margin * 2);
        const produtoBaseY = margin + 84;
        const produtoLineHeight = 12;

        produtoNomeLines.slice().reverse().forEach((line, i) => {
            page.drawText(line, {
                x: margin,
                y: produtoBaseY + (i * produtoLineHeight),
                font: helveticaBoldFont,
                size: 10
            });
        });

        page.drawText(`Estrutura: ${sanitizeText(label.structure_name, 'N/A')}`, {
            x: margin,
            y: margin + 70,
            font: helveticaBoldFont,
            size: 10
        });
        page.drawText(`SKU: ${sanitizeText(label.component_sku, 'N/A')}`, {
            x: margin,
            y: margin + 58,
            font: helveticaBoldFont,
            size: 10
        });
        page.drawText(`EAN: ${sanitizeText(label.gtin, 'N/A')}`, {
            x: margin + 115,
            y: margin + 58,
            font: helveticaBoldFont,
            size: 8.5
        });
        page.drawText(`QTD: ${sanitizeText(label.quantidade_produto, '1')}`, {
            x: margin + 215,
            y: margin + 58,
            font: helveticaBoldFont,
            size: 10
        });
        page.drawText(`LOC: ${sanitizeText(label.component_location, 'N/A')}`, {
            x: margin + 265,
            y: margin + 58,
            font: helveticaBoldFont,
            size: 10
        });

        const nfText = `NF: ${sanitizeText(label.nfe_numero, 'N/D')}  •  Vol: ${sanitizeText(label.volume_atual, '1')}/${sanitizeText(label.volume_total, '1')}`;
        page.drawText(nfText, {
            x: margin,
            y: margin + 28,
            font: helveticaBoldFont,
            size: 30
        });
        page.drawText(sanitizeText(label.transportador_nome), {
            x: margin,
            y: margin + 12,
            font: helveticaBoldFont,
            size: 14
        });

        const barcodeWidth = labelWidth - margin - cmToPoints(5);
        const barcodeHeight = barcodeWidth * (barcodeImage.height / barcodeImage.width);
        page.drawImage(barcodeImage, {
            x: margin,
            y: margin - 30,
            width: barcodeWidth,
            height: Math.min(barcodeHeight, cmToPoints(3.5))
        });
    }

    const pdfBytes = await pdfDoc.save();
    console.log('[PDF Service] Documento PDF gerado com sucesso.');
    return Buffer.from(pdfBytes);
}

// services/pdfService.js

async function generateAssistanceLabelPdf(labelData) {
    console.log('[PDF Service] Gerando etiqueta de assistência com lógica de continuação...');

    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const labelWidth = cmToPoints(15);
    const labelHeight = cmToPoints(10);
    const margin = cmToPoints(0.8);

    // --- Lógica de Divisão de Peças ---
    const todasAsPecas = labelData.pecas || [];
    const pecasPrincipais = todasAsPecas.slice(0, 7);
    const pecasExtras = todasAsPecas.slice(7);
    
    const paginasDePecasExtras = [];
    if (pecasExtras.length > 0) {
        // Divide as peças extras em páginas de até 14 peças cada
        for (let i = 0; i < pecasExtras.length; i += 14) {
            paginasDePecasExtras.push(pecasExtras.slice(i, i + 14));
        }
    }
    const totalPages = 1 + paginasDePecasExtras.length;

    // =============================================================
    // GERAÇÃO DA ETIQUETA PRINCIPAL (PÁGINA 1)
    // =============================================================
    const page1 = pdfDoc.addPage([labelWidth, labelHeight]);
    page1.setRotation(degrees(90));

    // Coordenadas e dimensões úteis
    const leftX = margin;
    const rightX = labelWidth - margin;
    const contentWidth = rightX - leftX;
    let currentY = labelHeight - margin;

    // --- Seção Superior ---
    currentY -= 14;
    const nomePedido = sanitizeText(labelData.nome_pedido, 'PEDIDO NÃO INFORMADO');
    const wrappedNomeLines = wrapText(nomePedido, helveticaBoldFont, 14, contentWidth * 0.65);
    let tempY = currentY;
    wrappedNomeLines.forEach(line => {
        page1.drawText(line, { x: leftX, y: tempY, font: helveticaBoldFont, size: 14 });
        tempY -= 16;
    });
    const nfeText = `NF-e: ${sanitizeText(labelData.nfe_numero, 'N/A')}`;
    const nfeTextWidth = helveticaBoldFont.widthOfTextAtSize(nfeText, 12);
    page1.drawText(nfeText, { x: rightX - nfeTextWidth, y: currentY, font: helveticaBoldFont, size: 12 });
    currentY -= (wrappedNomeLines.length * 16) + 15;

    // --- Seção do Formulário ---
    const formLabelFont = helveticaBoldFont;
    const formLabelSize = 10;
    const formLineYOffset = -3;
    const formLineHeight = 28;
    
    const drawFormField = (page, label, x, y, width) => {
        page.drawText(label, { x, y, font: formLabelFont, size: formLabelSize });
        const labelWidth = formLabelFont.widthOfTextAtSize(label, formLabelSize);
        page.drawLine({
            start: { x: x + labelWidth + 5, y: y + formLineYOffset },
            end: { x: x + width, y: y + formLineYOffset },
            thickness: 0.5,
            color: rgb(0.5, 0.5, 0.5),
        });
    };

    drawFormField(page1, `Produto: ${sanitizeText(labelData.nome_produtos, '')}`, leftX, currentY, contentWidth);
    currentY -= formLineHeight;
    
    const columnWidth = contentWidth / 2 - 10;
    const midX = leftX + contentWidth / 2 + 10;
    drawFormField(page1, `Volume: ${labelData.volume_info || ''}`, leftX, currentY, columnWidth);
    drawFormField(page1, `Cor: ${labelData.cor || ''}`, midX, currentY, columnWidth);
    currentY -= formLineHeight;
    
    // Adiciona o título da seção de peças
    const pecasTitle = `Peças ${pecasExtras.length > 0 ? '(Continua...)' : ''}`;
    page1.drawText(pecasTitle, { x: leftX, y: currentY, font: formLabelFont, size: formLabelSize, color: rgb(0, 0, 0) });
    currentY -= 14; // Espaço após o título

    // Desenha as 7 primeiras peças
    for (let i = 0; i < 7; i++) {
        const pecaText = `${i + 1}. ${pecasPrincipais[i] || ''}`;
        if (i % 2 === 0) { // Coluna da esquerda
            drawFormField(page1, pecaText, leftX, currentY, columnWidth);
        } else { // Coluna da direita
            drawFormField(page1, pecaText, midX, currentY, columnWidth);
            if (i < 6) currentY -= formLineHeight / 1.5; // Reduz o espaçamento entre peças
        }
    }
    
    // Desenha o campo de localização no espaço da 8ª peça
    drawFormField(page1, `Localização: ${labelData.localizacao || ''}`, midX, currentY, columnWidth);

    // --- Seção Inferior (Código de Barras) ---
    const barcodeValue = sanitizeText(labelData.chave_acesso, '0');
    if (barcodeValue && barcodeValue.length > 1) {
        const pngBuffer = await bwip.toBuffer({ bcid: 'code128', text: barcodeValue, scale: 2, height: 10, includetext: true, textxalign: 'center' });
        const barcodeImage = await pdfDoc.embedPng(pngBuffer);
        const barcodeImageWidth = barcodeImage.width * 0.7;
        const barcodeImageHeight = barcodeImage.height * 0.7;
        page1.drawImage(barcodeImage, { x: (labelWidth - barcodeImageWidth) / 2, y: margin, width: barcodeImageWidth, height: barcodeImageHeight });
    }

    // =============================================================
    // GERAÇÃO DAS ETIQUETAS DE CONTINUAÇÃO (PÁGINAS EXTRAS)
    // =============================================================
    paginasDePecasExtras.forEach((paginaPecas, index) => {
        const pageNum = index + 2;
        const page = pdfDoc.addPage([labelWidth, labelHeight]);
        page.setRotation(degrees(90));
        let pageY = labelHeight - margin;

        // Cabeçalho da página de continuação
        page.drawText(`Continuação de Peças - Assistência`, { x: leftX, y: pageY - 14, font: helveticaBoldFont, size: 14 });
        page.drawText(`Página ${pageNum} de ${totalPages}`, { x: rightX - 70, y: pageY - 14, font: helveticaFont, size: 10 });
        pageY -= 30;
        page.drawText(`NF-e: ${sanitizeText(labelData.nfe_numero, 'N/A')}`, { x: leftX, y: pageY, font: helveticaFont, size: 10 });
        page.drawText(`Pedido: ${sanitizeText(labelData.nome_pedido, 'N/A')}`, { x: leftX + 150, y: pageY, font: helveticaFont, size: 10 });
        pageY -= 25;

        // Lista das peças extras
        let pecaCounter = 8; // Começa a contar a partir da 8ª peça
        const pecaLineHeight = 18;
        const pecaColumnWidth = contentWidth / 2 - 5;
        const pecaMidX = leftX + contentWidth / 2 + 5;

        for (let i = 0; i < paginaPecas.length; i++) {
            const pecaText = `${pecaCounter + i}. ${paginaPecas[i]}`;
            // Desenha em duas colunas
            if (i < 7) { // Primeira coluna (até 7 peças)
                page.drawText(pecaText, { x: leftX, y: pageY - (i * pecaLineHeight), font: helveticaFont, size: 10 });
            } else { // Segunda coluna
                page.drawText(pecaText, { x: pecaMidX, y: pageY - ((i - 7) * pecaLineHeight), font: helveticaFont, size: 10 });
            }
        }
    });

    const pdfBytes = await pdfDoc.save();
    console.log(`[PDF Service] Etiqueta de ${totalPages} página(s) gerada com sucesso.`);
    return Buffer.from(pdfBytes);
}

async function generateStructureLabelsPdf(structuresData) {
    console.log(`[PDF Service] Iniciando geração de ${structuresData.length} etiquetas de estrutura...`);

    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const labelWidth = cmToPoints(10);
    const labelHeight = cmToPoints(3);
    const margin = cmToPoints(0.5);

    for (const structure of structuresData) {
        const page = pdfDoc.addPage([labelWidth, labelHeight]);

        // --- Código de Barras (Canto Superior Direito) ---
        const barcodeValue = sanitizeText(structure.component_sku, 'SEM-SKU');
        if (barcodeValue) {
            const pngBuffer = await bwip.toBuffer({
                bcid: 'code128',
                text: barcodeValue,
                scale: 2,
                height: 8, // Altura em mm
                includetext: true,
                textxalign: 'center',
                textsize: 8,
            });
            const barcodeImage = await pdfDoc.embedPng(pngBuffer);
            const barcodeImageWidth = barcodeImage.width * 0.5;
            const barcodeImageHeight = barcodeImage.height * 0.5;

            page.drawImage(barcodeImage, {
                x: labelWidth - margin - barcodeImageWidth,
                y: labelHeight - margin - barcodeImageHeight,
                width: barcodeImageWidth,
                height: barcodeImageHeight,
            });
        }
        
        const structureLoc = sanitizeText(structure.component_location, '');
        // --- Nome da Estrutura (Com quebra de linha) ---
        const structureName = sanitizeText(structure.structure_name, 'Estrutura sem nome');

        page.drawText(structureLoc, {
            x: margin,
            y: labelHeight - margin - 10,
            font: helveticaFont,
            size: 9,
        });
        // A largura máxima é a largura total menos as margens
        const wrappedLines = wrapText(structureName, helveticaBoldFont, 9, labelWidth - (margin * 2));

        // Desenha as linhas de texto de baixo para cima para facilitar o alinhamento
        let currentY = margin + ((wrappedLines.length - 1) * 10);
        wrappedLines.forEach(line => {
             page.drawText(line, {
                x: margin,
                y: currentY,
                font: helveticaBoldFont,
                size: 9,
            });
            currentY -= 10; // Espaçamento entre as linhas
        });
    }

    const pdfBytes = await pdfDoc.save();
    console.log('[PDF Service] PDF de etiquetas de estrutura gerado com sucesso.');
    return Buffer.from(pdfBytes);
}

module.exports = {
    generateLabelsPdf,
    generateAssistanceLabelPdf,
    generateStructureLabelsPdf
};