// services/comprasPdfService.js
const PDFDocument = require('pdfkit');

/**
 * Gera o Buffer do PDF de Pedido de Compra A4 profissional via PDFKit.
 * 
 * @param {Object} params
 * @param {string} params.nomeFabrica Nome do fornecedor / fábrica
 * @param {Array<{ nome: string, quantidade: number, preco?: string }>} params.itens Itens do pedido
 * @returns {Promise<Buffer>}
 */
async function gerarPedidoPdfBuffer({ nomeFabrica, itens }) {
    return new Promise((resolve, reject) => {
        try {
            const buffers = [];
            const doc = new PDFDocument({
                size: 'A4',
                margin: 40,
                autoFirstPage: true
            });

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            const pageLeft = 40;
            const pageWidth = doc.page.width - 80; // 595.28 - 80 = 515.28 pt
            const pageBottom = doc.page.height - 40; // 801.89 pt

            // Paleta de Cores Inova
            const primaryColor = '#1E1E24';
            const accentOrange = '#F07C00';
            const textSecondary = '#555555';
            const textDark = '#222222';
            const tableHeaderBg = '#23232B';
            const borderLight = '#CBD5E1';
            const rowAltBg = '#F8FAFC';

            const dataHoje = new Date().toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            // Função para desenhar o cabeçalho superior padrão
            function desenharCabecalhoDocumento(isFirstPage = false) {
                // Barra decorativa superior laranja
                doc.rect(0, 0, doc.page.width, 5).fill(accentOrange);
                // Barra decorativa inferior laranja
                doc.rect(0, doc.page.height - 4, doc.page.width, 4).fill(accentOrange);

                let currentY = 25;

                if (isFirstPage) {
                    // Razão Social
                    doc.font('Helvetica-Bold')
                        .fontSize(12)
                        .fillColor(primaryColor)
                        .text('INOVA MAGAZINE COMÉRCIO DE MÓVEIS LTDA', pageLeft, currentY);

                    currentY += 15;

                    // Endereço e Dados Cadastrais
                    doc.font('Helvetica')
                        .fontSize(7.5)
                        .fillColor(textSecondary)
                        .text('ENDEREÇO: RUA MARIA EDMÉA BLUNDI ARROYO, 1750, PRIMEIRO DISTRITO INDUSTRIAL, VOTUPORANGA, SP', pageLeft, currentY);

                    currentY += 10;
                    doc.text('CEP: 15503-014   |   FONE: (17) 3423-4007   |   CNPJ: 40.062.295/0001-45   |   IE: 718221938118', pageLeft, currentY);

                    currentY += 14;

                    // Linha divisória fina com detalhe laranja
                    doc.strokeColor(accentOrange)
                        .lineWidth(1)
                        .moveTo(pageLeft, currentY)
                        .lineTo(pageLeft + pageWidth, currentY)
                        .stroke();

                    currentY += 12;

                    // Bloco Título do Pedido + Data
                    doc.font('Helvetica-Bold')
                        .fontSize(14)
                        .fillColor(accentOrange)
                        .text('PEDIDO DE COMPRA', pageLeft, currentY);

                    doc.font('Helvetica-Bold')
                        .fontSize(9.5)
                        .fillColor(textDark)
                        .text(`DATA: ${dataHoje}`, pageLeft, currentY + 3, {
                            width: pageWidth,
                            align: 'right'
                        });

                    currentY += 22;

                    // Cartão do Fornecedor
                    const boxHeight = 24;
                    doc.roundedRect(pageLeft, currentY, pageWidth, boxHeight, 4)
                        .fillAndStroke('#FFF7ED', '#FED7AA');

                    doc.font('Helvetica-Bold')
                        .fontSize(9.5)
                        .fillColor(primaryColor)
                        .text('FORNECEDOR:', pageLeft + 10, currentY + 7);

                    const labelW = doc.widthOfString('FORNECEDOR: ');
                    doc.font('Helvetica-Bold')
                        .fontSize(10)
                        .fillColor(accentOrange)
                        .text(nomeFabrica || 'NÃO ESPECIFICADO', pageLeft + 10 + labelW, currentY + 7);

                    currentY += boxHeight + 14;
                } else {
                    currentY = 22;
                    doc.font('Helvetica-Bold')
                        .fontSize(8)
                        .fillColor(accentOrange)
                        .text(`PEDIDO DE COMPRA — ${nomeFabrica} (${dataHoje}) (Continuação)`, pageLeft, currentY);

                    currentY += 14;
                }

                return currentY;
            }

            // Inicia na primeira página
            let y = desenharCabecalhoDocumento(true);

            // Definições da Tabela
            const colWidths = {
                qtd: 80,
                preco: 85,
                produto: pageWidth - 80 - 85 // 515.28 - 165 = 350.28 pt
            };

            function desenharCabecalhoTabela(startY) {
                const h = 18;
                doc.rect(pageLeft, startY, pageWidth, h).fill(tableHeaderBg);

                doc.font('Helvetica-Bold')
                    .fontSize(8.5)
                    .fillColor('#FFFFFF');

                // QUANTIDADE
                doc.text('QUANTIDADE', pageLeft, startY + 5, {
                    width: colWidths.qtd,
                    align: 'center'
                });

                // PRODUTO
                doc.text('PRODUTO', pageLeft + colWidths.qtd + 8, startY + 5, {
                    width: colWidths.produto - 16,
                    align: 'left'
                });

                // PREÇO
                doc.text('PREÇO', pageLeft + colWidths.qtd + colWidths.produto, startY + 5, {
                    width: colWidths.preco,
                    align: 'center'
                });

                return startY + h;
            }

            y = desenharCabecalhoTabela(y);

            let totalItens = 0;
            let totalUnidades = 0;

            // Renderiza cada linha da tabela
            (itens || []).forEach((item, index) => {
                const qtdStr = String(item.quantidade || 0);
                const nomeProduto = String(item.nome || 'Produto Sem Descrição').trim();
                const precoStr = item.preco ? String(item.preco) : '';

                totalItens++;
                totalUnidades += (parseInt(item.quantidade, 10) || 0);

                // Calcula a altura da célula do produto
                doc.font('Helvetica').fontSize(8.5);
                const textH = doc.heightOfString(nomeProduto, { width: colWidths.produto - 16 });
                const rowH = Math.max(18, textH + 8);

                // Verifica se a linha cabe na página atual (reserva espaço para totais e rodapé)
                if (y + rowH > pageBottom - 65) {
                    doc.addPage();
                    y = desenharCabecalhoDocumento(false);
                    y = desenharCabecalhoTabela(y);
                }

                // Fundo zebrado
                if (index % 2 === 1) {
                    doc.rect(pageLeft, y, pageWidth, rowH).fill(rowAltBg);
                }

                // Bordas da linha
                doc.strokeColor(borderLight)
                    .lineWidth(0.5)
                    .rect(pageLeft, y, pageWidth, rowH)
                    .stroke();

                // Linhas verticais separadoras
                doc.moveTo(pageLeft + colWidths.qtd, y)
                    .lineTo(pageLeft + colWidths.qtd, y + rowH)
                    .stroke();

                doc.moveTo(pageLeft + colWidths.qtd + colWidths.produto, y)
                    .lineTo(pageLeft + colWidths.qtd + colWidths.produto, y + rowH)
                    .stroke();

                // 1. Quantidade
                doc.font('Helvetica-Bold')
                    .fontSize(9)
                    .fillColor(primaryColor)
                    .text(qtdStr, pageLeft, y + (rowH / 2) - 4.5, {
                        width: colWidths.qtd,
                        align: 'center'
                    });

                // 2. Nome do Produto
                doc.font('Helvetica')
                    .fontSize(8.5)
                    .fillColor(textDark)
                    .text(nomeProduto, pageLeft + colWidths.qtd + 8, y + 4, {
                        width: colWidths.produto - 16,
                        align: 'left'
                    });

                // 3. Preço (em branco para anotação/conferência)
                if (precoStr) {
                    doc.font('Helvetica')
                        .fontSize(8.5)
                        .fillColor(textDark)
                        .text(precoStr, pageLeft + colWidths.qtd + colWidths.produto, y + (rowH / 2) - 4.5, {
                            width: colWidths.preco,
                            align: 'center'
                        });
                }

                y += rowH;
            });

            // Verifica se a seção de totais e observações cabe na página
            const espacoNecessario = 70;
            if (y + espacoNecessario > pageBottom) {
                doc.addPage();
                y = desenharCabecalhoDocumento(false);
            } else {
                y += 10;
            }

            // Bloco de Totais
            const boxTotalH = 20;
            doc.roundedRect(pageLeft, y, pageWidth, boxTotalH, 3)
                .fillAndStroke('#F1F5F9', '#CBD5E1');

            doc.font('Helvetica-Bold')
                .fontSize(9)
                .fillColor(primaryColor)
                .text(
                    `TOTAL DE ITENS: ${totalItens} produto(s)   |   TOTAL DE PEÇAS/UNIDADES: ${totalUnidades} unidade(s)`,
                    pageLeft + 10,
                    y + 6
                );

            y += boxTotalH + 12;

            // Bloco de Observações Obrigatórias
            doc.strokeColor(borderLight)
                .lineWidth(0.6)
                .moveTo(pageLeft, y)
                .lineTo(pageLeft + pageWidth, y)
                .stroke();

            y += 8;

            doc.font('Helvetica-Bold')
                .fontSize(8)
                .fillColor(accentOrange)
                .text('OBSERVAÇÕES:', pageLeft, y);

            y += 10;

            doc.font('Helvetica-Bold')
                .fontSize(8)
                .fillColor(textDark)
                .text('• FAVOR ENCAMINHAR CÓPIA DA FABRICANTE ASSIM QUE DISPONÍVEL', pageLeft + 6, y);

            y += 10;
            doc.text('• SUJEITO A CONFERÊNCIA', pageLeft + 6, y);

            // Finaliza o documento PDF diretamente (sem páginas extras ou rodapés fantasmas)
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Gera o Buffer do PDF de Romaneio de Carga / Coleta A4 profissional via PDFKit.
 * 
 * @param {Object} params
 * @param {Array<Object>} params.pedidos Lista de pedidos incluídos no romaneio
 * @param {Array<Object>} params.itensConsolidados Lista de itens consolidados com pesos
 * @param {Object} params.totais Métricas consolidadas (totalPedidos, totalItens, totalUnidades, pesoTotalKg)
 * @param {string} [params.numeroRomaneio] Identificador do romaneio
 * @returns {Promise<Buffer>}
 */
async function gerarRomaneioPdfBuffer({ pedidos, itensConsolidados, totais, numeroRomaneio }) {
    return new Promise((resolve, reject) => {
        try {
            const buffers = [];
            const doc = new PDFDocument({
                size: 'A4',
                margin: 35,
                autoFirstPage: true
            });

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            const pageLeft = 35;
            const pageWidth = doc.page.width - 70; // 595.28 - 70 = 525.28 pt
            const pageBottom = doc.page.height - 35; // 841.89 - 35 = 806.89 pt

            // Paleta de Cores Inova
            const primaryColor = '#1E1E24';
            const accentOrange = '#F07C00';
            const textSecondary = '#555555';
            const textDark = '#222222';
            const tableHeaderBg = '#23232B';
            const borderLight = '#CBD5E1';
            const rowAltBg = '#F8FAFC';

            const dataHoraAgora = new Date().toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const dataHoje = new Date().toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            const codRomaneio = numeroRomaneio || `ROM-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

            // Função para desenhar o cabeçalho superior padrão
            function desenharCabecalhoDocumento(isFirstPage = false) {
                // Barra decorativa superior laranja
                doc.rect(0, 0, doc.page.width, 5).fill(accentOrange);
                // Barra decorativa inferior laranja
                doc.rect(0, doc.page.height - 4, doc.page.width, 4).fill(accentOrange);

                let currentY = 22;

                if (isFirstPage) {
                    // Razão Social
                    doc.font('Helvetica-Bold')
                        .fontSize(12)
                        .fillColor(primaryColor)
                        .text('INOVA MAGAZINE COMÉRCIO DE MÓVEIS LTDA', pageLeft, currentY);

                    currentY += 14;

                    // Endereço e Dados Cadastrais
                    doc.font('Helvetica')
                        .fontSize(7.5)
                        .fillColor(textSecondary)
                        .text('ENDEREÇO: RUA MARIA EDMÉA BLUNDI ARROYO, 1750, PRIMEIRO DISTRITO INDUSTRIAL, VOTUPORANGA, SP', pageLeft, currentY);

                    currentY += 10;
                    doc.text('CEP: 15503-014   |   FONE: (17) 3423-4007   |   CNPJ: 40.062.295/0001-45   |   IE: 718221938118', pageLeft, currentY);

                    currentY += 13;

                    // Linha divisória fina com detalhe laranja
                    doc.strokeColor(accentOrange)
                        .lineWidth(1)
                        .moveTo(pageLeft, currentY)
                        .lineTo(pageLeft + pageWidth, currentY)
                        .stroke();

                    currentY += 10;

                    // Bloco Título do Romaneio + Identificador e Data
                    doc.font('Helvetica-Bold')
                        .fontSize(13.5)
                        .fillColor(accentOrange)
                        .text('ROMANEIO DE CARGA / COLETA', pageLeft, currentY);

                    doc.font('Helvetica-Bold')
                        .fontSize(9)
                        .fillColor(textDark)
                        .text(`EMISSÃO: ${dataHoraAgora}`, pageLeft, currentY + 3, {
                            width: pageWidth,
                            align: 'right'
                        });

                    currentY += 18;

                    // Card Resumo dos Pedidos Inclusos
                    const pedidosNomes = (pedidos || []).map(p => `${p.numero_pedido || `#${p.id}`} (${p.nome_fabrica})`).join(', ');
                    const boxPedidosH = Math.max(22, doc.font('Helvetica').fontSize(8).heightOfString(`PEDIDOS VINCULADOS: ${pedidosNomes}`, { width: pageWidth - 16 }) + 10);

                    doc.roundedRect(pageLeft, currentY, pageWidth, boxPedidosH, 4)
                        .fillAndStroke('#FFF7ED', '#FED7AA');

                    doc.font('Helvetica-Bold')
                        .fontSize(8.5)
                        .fillColor(primaryColor)
                        .text('PEDIDOS VINCULADOS:', pageLeft + 8, currentY + 6, { continued: true });

                    doc.font('Helvetica')
                        .fontSize(8.5)
                        .fillColor('#9A3412')
                        .text(`  ${pedidosNomes || 'Nenhum pedido vinculado'}`, { width: pageWidth - 16 });

                    currentY += boxPedidosH + 10;
                } else {
                    currentY = 20;
                    doc.font('Helvetica-Bold')
                        .fontSize(8)
                        .fillColor(accentOrange)
                        .text(`ROMANEIO DE CARGA / COLETA — ${codRomaneio} (${dataHoje}) (Continuação)`, pageLeft, currentY);

                    currentY += 12;
                }

                return currentY;
            }

            // Inicia na primeira página
            let y = desenharCabecalhoDocumento(true);

            // Definições das Colunas da Tabela
            const colWidths = {
                qtd: 50,
                sku: 85,
                produto: pageWidth - 50 - 85 - 85 - 55 - 60, // 525.28 - 335 = 190.28 pt
                fabrica: 85,
                pesoUnit: 55,
                pesoTotal: 60
            };

            function desenharCabecalhoTabela(startY) {
                const h = 18;
                doc.rect(pageLeft, startY, pageWidth, h).fill(tableHeaderBg);

                doc.font('Helvetica-Bold')
                    .fontSize(8)
                    .fillColor('#FFFFFF');

                let curX = pageLeft;

                // 1. QUANTIDADE
                doc.text('QTD', curX, startY + 5, {
                    width: colWidths.qtd,
                    align: 'center'
                });
                curX += colWidths.qtd;

                // 2. SKU
                doc.text('SKU', curX, startY + 5, {
                    width: colWidths.sku,
                    align: 'center'
                });
                curX += colWidths.sku;

                // 3. PRODUTO
                doc.text('DESCRIÇÃO DO PRODUTO', curX + 6, startY + 5, {
                    width: colWidths.produto - 12,
                    align: 'left'
                });
                curX += colWidths.produto;

                // 4. FÁBRICA
                doc.text('FÁBRICA', curX + 4, startY + 5, {
                    width: colWidths.fabrica - 8,
                    align: 'left'
                });
                curX += colWidths.fabrica;

                // 5. PESO UNIT
                doc.text('PESO UN.', curX, startY + 5, {
                    width: colWidths.pesoUnit,
                    align: 'center'
                });
                curX += colWidths.pesoUnit;

                // 6. PESO TOTAL
                doc.text('PESO TOT.', curX, startY + 5, {
                    width: colWidths.pesoTotal,
                    align: 'center'
                });

                return startY + h;
            }

            y = desenharCabecalhoTabela(y);

            let totalItens = 0;
            let totalUnidades = 0;
            let pesoTotalGeralKg = 0;

            // Renderiza cada linha consolidada da tabela
            (itensConsolidados || []).forEach((item, index) => {
                const qtd = parseInt(item.quantidade, 10) || 0;
                const skuStr = String(item.sku || '-').trim();
                const nomeProduto = String(item.nome || 'Produto Sem Descrição').trim();
                const fabricaStr = String(item.fabricas || item.nome_fabrica || '-').trim();
                
                const pesoUnit = parseFloat(item.peso_unitario) || 0;
                const pesoTot = parseFloat(item.peso_total) || (pesoUnit * qtd);

                totalItens++;
                totalUnidades += qtd;
                pesoTotalGeralKg += pesoTot;

                const pesoUnitStr = pesoUnit > 0 ? `${pesoUnit.toFixed(2).replace('.', ',')} kg` : '-';
                const pesoTotStr = pesoTot > 0 ? `${pesoTot.toFixed(2).replace('.', ',')} kg` : '-';

                // Calcula a altura necessária para a linha
                doc.font('Helvetica').fontSize(8);
                const textHProd = doc.heightOfString(nomeProduto, { width: colWidths.produto - 12 });
                const textHFab = doc.heightOfString(fabricaStr, { width: colWidths.fabrica - 8 });
                const rowH = Math.max(18, Math.max(textHProd, textHFab) + 7);

                // Verifica quebra de página (reserva espaço para totais na última)
                if (y + rowH > pageBottom - 80) {
                    doc.addPage();
                    y = desenharCabecalhoDocumento(false);
                    y = desenharCabecalhoTabela(y);
                }

                // Fundo zebrado
                if (index % 2 === 1) {
                    doc.rect(pageLeft, y, pageWidth, rowH).fill(rowAltBg);
                }

                // Bordas da linha
                doc.strokeColor(borderLight)
                    .lineWidth(0.5)
                    .rect(pageLeft, y, pageWidth, rowH)
                    .stroke();

                // Divisórias verticais
                let lineX = pageLeft + colWidths.qtd;
                doc.moveTo(lineX, y).lineTo(lineX, y + rowH).stroke();

                lineX += colWidths.sku;
                doc.moveTo(lineX, y).lineTo(lineX, y + rowH).stroke();

                lineX += colWidths.produto;
                doc.moveTo(lineX, y).lineTo(lineX, y + rowH).stroke();

                lineX += colWidths.fabrica;
                doc.moveTo(lineX, y).lineTo(lineX, y + rowH).stroke();

                lineX += colWidths.pesoUnit;
                doc.moveTo(lineX, y).lineTo(lineX, y + rowH).stroke();

                // 1. Quantidade
                doc.font('Helvetica-Bold')
                    .fontSize(8.5)
                    .fillColor(primaryColor)
                    .text(String(qtd), pageLeft, y + (rowH / 2) - 4.5, {
                        width: colWidths.qtd,
                        align: 'center'
                    });

                // 2. SKU
                doc.font('Helvetica-Bold')
                    .fontSize(7.8)
                    .fillColor('#1E293B')
                    .text(skuStr, pageLeft + colWidths.qtd, y + (rowH / 2) - 4, {
                        width: colWidths.sku,
                        align: 'center'
                    });

                // 3. Descrição do Produto
                doc.font('Helvetica')
                    .fontSize(8)
                    .fillColor(textDark)
                    .text(nomeProduto, pageLeft + colWidths.qtd + colWidths.sku + 6, y + 4, {
                        width: colWidths.produto - 12,
                        align: 'left'
                    });

                // 4. Fábrica
                doc.font('Helvetica')
                    .fontSize(7.5)
                    .fillColor(textSecondary)
                    .text(fabricaStr, pageLeft + colWidths.qtd + colWidths.sku + colWidths.produto + 4, y + 4, {
                        width: colWidths.fabrica - 8,
                        align: 'left'
                    });

                // 5. Peso Unitário
                doc.font('Helvetica')
                    .fontSize(8)
                    .fillColor(textDark)
                    .text(pesoUnitStr, pageLeft + colWidths.qtd + colWidths.sku + colWidths.produto + colWidths.fabrica, y + (rowH / 2) - 4, {
                        width: colWidths.pesoUnit,
                        align: 'center'
                    });

                // 6. Peso Total
                doc.font('Helvetica-Bold')
                    .fontSize(8)
                    .fillColor(pesoTot > 0 ? primaryColor : textSecondary)
                    .text(pesoTotStr, pageLeft + colWidths.qtd + colWidths.sku + colWidths.produto + colWidths.fabrica + colWidths.pesoUnit, y + (rowH / 2) - 4, {
                        width: colWidths.pesoTotal,
                        align: 'center'
                    });

                y += rowH;
            });

            // Verifica se a seção final de totais e assinaturas cabe na página atual
            const espacoNecessarioFinal = 85;
            if (y + espacoNecessarioFinal > pageBottom) {
                doc.addPage();
                y = desenharCabecalhoDocumento(false);
            } else {
                y += 10;
            }

            // Bloco de Totais Consolidado em Destaque
            const boxTotalH = 26;
            doc.roundedRect(pageLeft, y, pageWidth, boxTotalH, 4)
                .fillAndStroke('#F1F5F9', '#CBD5E1');

            const pesoFinalKg = totais?.pesoTotalKg !== undefined ? totais.pesoTotalKg : pesoTotalGeralKg;
            const pesoFormatado = pesoFinalKg.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            doc.font('Helvetica-Bold')
                .fontSize(8.5)
                .fillColor(primaryColor)
                .text(
                    `PEDIDOS: ${(pedidos || []).length}   |   PRODUTOS: ${totalItens}   |   VOLUMES/PEÇAS: ${totalUnidades.toLocaleString('pt-BR')} un`,
                    pageLeft + 10,
                    y + 8
                );

            // Destaque do Peso Total da Carga em Laranja
            doc.font('Helvetica-Bold')
                .fontSize(9.5)
                .fillColor(accentOrange)
                .text(
                    `PESO TOTAL DA CARGA: ${pesoFormatado} KG`,
                    pageLeft,
                    y + 8,
                    {
                        width: pageWidth - 10,
                        align: 'right'
                    }
                );

            y += boxTotalH + 16;

            // Seção de Assinaturas e Conferência
            doc.strokeColor(borderLight)
                .lineWidth(0.6)
                .moveTo(pageLeft, y)
                .lineTo(pageLeft + pageWidth, y)
                .stroke();

            y += 16;

            const colAssinaturaW = (pageWidth - 40) / 2;

            // Linha Assinatura Motorista
            doc.strokeColor('#94A3B8')
                .lineWidth(0.8)
                .moveTo(pageLeft + 10, y)
                .lineTo(pageLeft + 10 + colAssinaturaW, y)
                .stroke();

            doc.font('Helvetica-Bold')
                .fontSize(7.5)
                .fillColor(textDark)
                .text('MOTORISTA / TRANSPORTADOR (NOME / RG)', pageLeft + 10, y + 4, {
                    width: colAssinaturaW,
                    align: 'center'
                });

            // Linha Assinatura Conferente Inova
            doc.strokeColor('#94A3B8')
                .lineWidth(0.8)
                .moveTo(pageLeft + 30 + colAssinaturaW, y)
                .lineTo(pageLeft + 30 + (colAssinaturaW * 2), y)
                .stroke();

            doc.font('Helvetica-Bold')
                .fontSize(7.5)
                .fillColor(textDark)
                .text('CONFERENTE EXPEDIÇÃO INOVA', pageLeft + 30 + colAssinaturaW, y + 4, {
                    width: colAssinaturaW,
                    align: 'center'
                });

            // Finaliza o documento PDF
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    gerarPedidoPdfBuffer,
    gerarRomaneioPdfBuffer
};

