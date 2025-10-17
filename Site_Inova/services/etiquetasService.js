// services/etiquetasService.js
const { Pool } = require('pg');
const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const bwip = require('bwip-js');
const { findAndCacheNfeByNumber, findAndCachePedidoByLojaNumber } = require('../blingSyncService');

// Configuração do banco de dados
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

// --- FUNÇÕES PRINCIPAIS DE PROCESSAMENTO ---

async function gerarPdfRelatorio(etiquetasCompletas) {
    console.log('[Relatório] Iniciando geração do PDF de relatório...');
    const skuQuantidades = new Map();
    let quantidadeTotalGeral = 0;

    // 1. Agrega as quantidades totais por SKU
    for (const etiqueta of etiquetasCompletas) {
        // --- CORREÇÃO APLICADA AQUI ---
        // Acessa diretamente o 'nfeNumero' que agora está presente em CADA objeto 'etiqueta',
        // independentemente de como foi encontrado (NF, Venda ou Pack ID).
        const nfeNumeroParaBusca = etiqueta.nfeNumero;

        if (nfeNumeroParaBusca && etiqueta.skus && etiqueta.skus.length > 0) {
            const client = await pool.connect();
            try {
                for (const sku of etiqueta.skus) {
                    const res = await client.query(
                        'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND produto_codigo = $2',
                        [nfeNumeroParaBusca, sku]
                    );
                    const quantidade = Number(res.rows[0]?.quantidade || 0);
                    skuQuantidades.set(sku, (skuQuantidades.get(sku) || 0) + quantidade);
                }
            } catch(e) {
                console.error(`[Relatório] Erro ao buscar quantidades para a NF ${nfeNumeroParaBusca}:`, e.message);
            }
            finally {
                client.release();
            }
        }
    }

    // 2. Ordena os SKUs para o relatório
    const skusOrdenados = Array.from(skuQuantidades.keys()).sort((a, b) => {
        const skuA = a.toUpperCase();
        const skuB = b.toUpperCase();
        const aComecaComLetra = /^[A-Z]/.test(skuA);
        const bComecaComLetra = /^[A-Z]/.test(skuB);
        
        if (aComecaComLetra && !bComecaComLetra) return -1;
        if (!aComecaComLetra && bComecaComLetra) return 1;
        
        if (skuA < skuB) return -1;
        if (skuA > skuB) return 1;
        return 0;
    });

    // 3. Cria o PDF (lógica inalterada)
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    page.drawText('Relatório de Separação de Produtos', { x: margin, y, font: boldFont, size: 18 });
    y -= 30;
    page.drawText(new Date().toLocaleString('pt-BR'), { x: margin, y, font: font, size: 10 });
    y -= 30;

    page.drawText('SKU do Produto', { x: margin, y, font: boldFont, size: 12 });
    page.drawText('Quantidade Total', { x: width - margin - 100, y, font: boldFont, size: 12 });
    y -= 20;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1 });
    y -= 15;

    for (const sku of skusOrdenados) {
        if (y < margin) {
            page = pdfDoc.addPage();
            y = height - margin;
        }
        const quantidade = skuQuantidades.get(sku);
        quantidadeTotalGeral += quantidade;

        page.drawText(sku, { x: margin, y, font: font, size: 11 });
        page.drawText(String(quantidade), { x: width - margin - 100, y, font: font, size: 11 });
        y -= 20;
    }
    
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1 });
    y -= 20;
    page.drawText('Quantidade Total de Itens:', { x: margin, y, font: boldFont, size: 14 });
    page.drawText(String(quantidadeTotalGeral), { x: width - margin - 100, y, font: boldFont, size: 14 });

    console.log('[Relatório] PDF de relatório gerado com sucesso.');
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

/**
 * Orquestra todo o processo de organização de etiquetas.
 * @param {Array<Buffer>} pdfBuffers - Um array com os buffers dos arquivos PDF enviados.
 * @returns {Buffer} - O buffer do novo PDF gerado e organizado.
 */
async function processarEtiquetas(pdfBuffers) {
    console.log('==================================================');
    console.log('[ETAPA 1] Iniciando extração de dados das etiquetas...');
    const etiquetasExtraidas = await extrairDadosDosPdfs(pdfBuffers);
    console.log(`[ETAPA 1] Extração finalizada. ${etiquetasExtraidas.length} etiquetas encontradas.`);
    console.log('==================================================');

    if (etiquetasExtraidas.length === 0) {
        throw new Error('Nenhuma etiqueta com NFe ou Pack ID válido foi encontrada nos PDFs.');
    }

    console.log('[ETAPA 2] Iniciando busca de informações cruciais (cache/Bling)...');
    const etiquetasCompletas = await buscarInformacoesCruciais(etiquetasExtraidas);
    console.log('[ETAPA 2] Busca de informações finalizada.');
    console.log('==================================================');
    
    console.log('[ETAPA 3] Iniciando ordenação das etiquetas...');
    const etiquetasOrdenadas = ordenarEtiquetas(etiquetasCompletas);
    console.log('[ETAPA 3] Etiquetas ordenadas com sucesso.');
    console.log('==================================================');

    console.log('[ETAPA 4] Iniciando geração do PDF de Etiquetas...');
    const etiquetasPdf = await gerarPdfOrganizado(etiquetasOrdenadas);
    console.log('[ETAPA 4] PDF de Etiquetas gerado com sucesso!');
    console.log('==================================================');
    
    console.log('[ETAPA 5] Iniciando geração do PDF de Relatório...');
    const relatorioPdf = await gerarPdfRelatorio(etiquetasCompletas);
    console.log('[ETAPA 5] PDF de Relatório gerado com sucesso!');
    console.log('==================================================');

    return { etiquetasPdf, relatorioPdf };
}

// --- ETAPA 1: EXTRAÇÃO DE DADOS DOS PDFs ---

async function extrairDadosDosPdfs(pdfBuffers) {
    const etiquetas = [];
    let fileIndex = 0;

    for (const buffer of pdfBuffers) {
        fileIndex++;
        console.log(`\n-- Processando Arquivo PDF ${fileIndex} --`);
        const packIdToVendaMap = new Map();
        const paginasDeRelatorio = new Set();
        let indiceInicioRelatorio = -1;

        try {
            const pdfDoc = await PDFDocument.load(buffer);
            const totalPages = pdfDoc.getPageCount();

            // --- FASE 1: IDENTIFICAR O BLOCO DO RELATÓRIO E ERRADICÁ-LO ---
            console.log('\n[FASE 1] Identificando e mapeando o bloco da Folha de Relação...');
            
            // Primeiro, encontra o ponto de partida do relatório.
            for (let i = 0; i < totalPages; i++) {
                const tempDoc = await PDFDocument.create();
                const [copiedPage] = await tempDoc.copyPages(pdfDoc, [i]);
                tempDoc.addPage(copiedPage);
                const data = await pdfParse(await tempDoc.save());

                if (data.text.includes('Despachem as suas vendas o quanto antes') || data.text.includes('Não demore, o seu comprador está esperando')) {
                    console.log(`   > Página ${i + 1} identificada como o INÍCIO do relatório.`);
                    indiceInicioRelatorio = i;
                    break; 
                }
            }

            // Se encontrou o início, mapeia TODOS os dados dali até o final do PDF.
            if (indiceInicioRelatorio !== -1) {
                for (let i = indiceInicioRelatorio; i < totalPages; i++) {
                    paginasDeRelatorio.add(i); // Adiciona à lista de páginas a serem ignoradas.
                    
                    const tempDoc = await PDFDocument.create();
                    const [copiedPage] = await tempDoc.copyPages(pdfDoc, [i]);
                    tempDoc.addPage(copiedPage);
                    const data = await pdfParse(await tempDoc.save());
                    
                    console.log(`   > Lendo mapeamento da página de relatório ${i + 1}...`);
                    // Regex robusta para capturar o padrão onde 'Pack ID' é opcional.
                    const regex = /Pack ID:\s*(\d+)\s+Venda:\s*(\d+)/g;
                    let match;
                    while ((match = regex.exec(data.text)) !== null) {
                        const packId = match[1];
                        const vendaId = match[2];
                        if (packId && vendaId) {
                            packIdToVendaMap.set(packId, vendaId);
                            console.log(`      - Mapeado: Pack ID ${packId} -> Venda ${vendaId}`);
                        }
                    }
                }
                console.log(`[FASE 1] Mapeamento concluído. ${packIdToVendaMap.size} pares encontrados. As páginas de ${indiceInicioRelatorio + 1} a ${totalPages} serão ignoradas na busca por etiquetas.`);
            } else {
                console.log('[FASE 1] Nenhuma Folha de Relação encontrada neste PDF.');
            }

            // --- FASE 2: PROCESSAR APENAS AS PÁGINAS DE ETIQUETA ---
            console.log('\n[FASE 2] Processando apenas as páginas de etiquetas...');
            for (let i = 0; i < totalPages; i++) {
                // Pula a página se ela foi identificada como parte do relatório ERRADICADO.
                if (paginasDeRelatorio.has(i)) {
                    continue;
                }

                const tempDoc = await PDFDocument.create();
                const [copiedPage] = await tempDoc.copyPages(pdfDoc, [i]);
                tempDoc.addPage(copiedPage);
                const data = await pdfParse(await tempDoc.save());
                const textoPagina = data.text;
                const pageIndex = i;

                const nfMatch = textoPagina.match(/NF:\s*(\d{5,})/);
                const vendaMatch = textoPagina.match(/Venda:\s*(\d+)/);
                const packIdMatch = textoPagina.match(/Pack ID:\s*(\d+)/);

                // APLICAÇÃO DA HIERARQUIA CORRETA DE BUSCA: NF > Venda > Pack ID
                if (nfMatch) {
                    console.log(`   > Página ${pageIndex + 1}: Encontrado por HIERARQUIA 1 (NF): ${nfMatch[1]}`);
                    etiquetas.push({ tipoId: 'nfe', id: nfMatch[1], pdfBuffer: buffer, pageIndex: pageIndex });
                } else if (vendaMatch) {
                    console.log(`   > Página ${pageIndex + 1}: Encontrado por HIERARQUIA 2 (Venda): ${vendaMatch[1]}`);
                    etiquetas.push({ tipoId: 'numero_loja', id: vendaMatch[1], pdfBuffer: buffer, pageIndex: pageIndex });
                } else if (packIdMatch) {
                    const packId = packIdMatch[1];
                    if (packIdToVendaMap.has(packId)) {
                        const numeroLoja = packIdToVendaMap.get(packId);
                        console.log(`   > Página ${pageIndex + 1}: Encontrado por HIERARQUIA 3 (Pack ID Mapeado): ${packId} -> ${numeroLoja}`);
                        etiquetas.push({ tipoId: 'numero_loja', id: numeroLoja, pdfBuffer: buffer, pageIndex: pageIndex });
                    } else {
                        console.warn(`   > Página ${pageIndex + 1}: AVISO - Pack ID ${packId} encontrado, mas não consta na Folha de Relação.`);
                    }
                } else {
                    console.log(`   > Página ${pageIndex + 1}: Nenhum identificador (NF, Venda ou Pack ID) encontrado.`);
                }
            }
        } catch (error) {
            console.error(`Erro ao processar o arquivo PDF ${fileIndex}:`, error);
        }
    }
    return etiquetas;
}


// --- ETAPA 2: BUSCA DE INFORMAÇÕES CRUCIAIS ---

async function buscarInformacoesCruciais(etiquetasExtraidas) {
    const etiquetasCompletas = [];
    for (const etiqueta of etiquetasExtraidas) {
        console.log(`\n-- Buscando dados para etiqueta [${etiqueta.tipoId.toUpperCase()}: ${etiqueta.id}] --`);
        try {
            let info = null;
            if (etiqueta.tipoId === 'nfe') {
                info = await getInfoPorNFe(etiqueta.id);
            } else if (etiqueta.tipoId === 'numero_loja') {
                info = await getInfoPorNumeroLoja(etiqueta.id);
            }

            if (info) {
                console.log(`   > SUCESSO: Informações encontradas para ${etiqueta.id}. SKUs: [${info.skus.join(', ')}], QTD Total: ${info.totalQuantidade}`);
                etiquetasCompletas.push({ ...etiqueta, ...info, idOriginal: etiqueta.id });
            } else {
                 console.warn(`   > AVISO: Não foi possível encontrar informações para a etiqueta ID: ${etiqueta.id}`);
            }
        } catch (error) {
            console.error(`   > ERRO ao buscar dados para a etiqueta ID ${etiqueta.id}:`, error);
        }
    }
    return etiquetasCompletas;
}

async function getInfoPorNFe(nfeNumero) {
    let client;
    try {
        client = await pool.connect();
        let nfeData = await fetchNfeFromCache(client, nfeNumero);

        if (nfeData) {
            console.log(`   [Cache Hit] NFe ${nfeNumero} encontrada no cache.`);
        } else {
            console.log(`   [Cache Miss] NFe ${nfeNumero} não encontrada. Solicitando busca no Bling via fila...`);
            const nfeFoiEncontrada = await findAndCacheNfeByNumber(nfeNumero, 'lucas');

            if (nfeFoiEncontrada) {
                console.log(`   [Bling Success] NFe ${nfeNumero} encontrada e cache atualizado pela fila.`);
                nfeData = await fetchNfeFromCache(client, nfeNumero);
            } else {
                console.warn(`   [Bling Fail] NFe ${nfeNumero} não foi encontrada no Bling.`);
                return null;
            }
        }

        if (!nfeData || !nfeData.product_ids_list || nfeData.product_ids_list === '{}') {
            console.warn(`   > AVISO: NFe ${nfeNumero} não possui produtos válidos no cache.`);
            return {
                nfeNumero: nfeNumero,
                chaveAcesso: nfeData?.chave_acesso,
                skus: [],
                totalQuantidade: 0,
                locations: [] // Retorna localização vazia
            };
        }

        const productIds = nfeData.product_ids_list.split(';')
            .map(id => id.replace(/[{}]/g, '').trim())
            .filter(Boolean);

        if (productIds.length === 0) {
            return {
                nfeNumero: nfeNumero,
                chaveAcesso: nfeData.chave_acesso,
                skus: [],
                totalQuantidade: 0,
                locations: [] // Retorna localização vazia
            };
        }
        
        const { skus, totalQuantidade } = await getSkusAndQuantidades(client, productIds, nfeNumero);

        // --- NOVA LÓGICA PARA BUSCAR LOCALIZAÇÕES ---
        let locations = [];
        try {
            const structuresResult = await client.query(
                `SELECT DISTINCT component_location 
                 FROM cached_structures 
                 WHERE parent_product_bling_id = ANY($1::bigint[]) AND component_location IS NOT NULL`,
                [productIds]
            );
            // Mapeia o resultado para um array de strings e remove duplicados
            locations = [...new Set(structuresResult.rows.map(row => row.component_location))];
            console.log(`   [Cache Hit] Localizações encontradas para a NFe ${nfeNumero}: [${locations.join(', ')}]`);
        } catch (structError) {
            console.error(`   > ERRO ao buscar localizações para a NFe ${nfeNumero}:`, structError);
        }
        // --- FIM DA NOVA LÓGICA ---
        
        return {
            nfeNumero: nfeNumero,
            chaveAcesso: nfeData.chave_acesso,
            skus,
            totalQuantidade,
            locations // Adiciona as localizações ao objeto de retorno
        };

    } catch (error) {
        console.error(`   > ERRO ao processar NFe ${nfeNumero}:`, error);
        return null;
    } finally {
        if (client) client.release();
    }
}

async function getInfoPorNumeroLoja(numeroLoja) {
    let client;
    try {
        client = await pool.connect();
        const query = 'SELECT nfe_parent_numero FROM cached_pedido_venda WHERE numero_loja = $1';
        let result = await client.query(query, [numeroLoja]);

        if (!result.rows.length || !result.rows[0].nfe_parent_numero) {
            console.log(`   [Cache Miss] Pedido com Numero Loja ${numeroLoja} não encontrado. Solicitando busca no Bling...`);
            const pedidoFoiEncontrado = await findAndCachePedidoByLojaNumber(numeroLoja, 'lucas');

            if (pedidoFoiEncontrado) {
                console.log(`   [Bling Success] Pedido do Numero Loja ${numeroLoja} encontrado e cache atualizado.`);
                result = await client.query(query, [numeroLoja]);
            } else {
                console.warn(`   [Bling Fail] Pedido do Numero Loja ${numeroLoja} não encontrado no Bling.`);
                return null;
            }
        }

        if (result.rows.length > 0 && result.rows[0].nfe_parent_numero) {
            const nfeNumero = result.rows[0].nfe_parent_numero;
            console.log(`   [Cache Hit] Numero Loja ${numeroLoja} mapeado para NFe ${nfeNumero}. Buscando detalhes da nota...`);
            return await getInfoPorNFe(nfeNumero);
        } else {
            console.warn(`   > AVISO: Mesmo após a busca, não foi possível encontrar a NFe para o Numero Loja ${numeroLoja}.`);
            return null;
        }
    } catch (error) {
        console.error(`   > ERRO ao processar Numero Loja ${numeroLoja}:`, error);
        return null;
    } finally {
        if (client) client.release();
    }
}

async function fetchNfeFromCache(client, nfeNumero) {
    const nfeQuery = 'SELECT chave_acesso, product_ids_list FROM cached_nfe WHERE nfe_numero = $1 AND bling_account = $2';
    const nfeResult = await client.query(nfeQuery, [nfeNumero, 'lucas']);
    return nfeResult.rows[0];
}

async function getSkusAndQuantidades(client, productIds, nfeNumero) {
    const skus = [];
    let totalQuantidade = 0;

    for (const id of productIds) {
        const productQuery = 'SELECT sku FROM cached_products WHERE bling_id = $1 AND bling_account = $2';
        const productResult = await client.query(productQuery, [id, 'lucas']);
        const sku = productResult.rows[0]?.sku;

        if (sku) {
            const qtdQuery = 'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND produto_codigo = $2';
            const qtdResult = await client.query(qtdQuery, [nfeNumero, sku]);
            const quantidade = parseInt(qtdResult.rows[0]?.quantidade || 0, 10);

            skus.push(sku);
            totalQuantidade += quantidade;
        }
    }
    return { skus, totalQuantidade };
}

// --- ETAPA 3: ORDENAÇÃO ---

/**
 * Ordena a lista de etiquetas com base nos SKUs em ordem alfanumérica.
 * @param {Array<Object>} etiquetas - O array de etiquetas completas.
 * @returns {Array<Object>} - O array de etiquetas ordenado.
 */
function ordenarEtiquetas(etiquetas) {
    console.log('\n-- Lista de SKUs antes da ordenação: --');
    etiquetas.forEach(et => console.log(`   > ID: ${et.id}, SKUs: [${et.skus.join('; ')}]`));

    const etiquetasOrdenadas = etiquetas.sort((a, b) => {
        const skuA = a.skus.join(';').toUpperCase();
        const skuB = b.skus.join(';').toUpperCase();

        const aComecaComLetra = /^[A-Z]/.test(skuA);
        const bComecaComLetra = /^[A-Z]/.test(skuB);
        
        if (aComecaComLetra && !bComecaComLetra) return -1;
        if (!aComecaComLetra && bComecaComLetra) return 1;
        
        if (skuA < skuB) return -1;
        if (skuA > skuB) return 1;
        return 0;
    });

    console.log('\n-- Lista de SKUs DEPOIS da ordenação: --');
    etiquetasOrdenadas.forEach(et => console.log(`   > ID: ${et.id}, SKUs: [${et.skus.join('; ')}]`));

    return etiquetasOrdenadas;
}


// --- ETAPA 4: GERAÇÃO DO PDF FINAL ---

async function gerarCodigoDeBarras(text) {
    return bwip.toBuffer({
        bcid: 'code128',    // Tipo do código de barras
        text: text,         // Texto a ser codificado
        scale: 3,           // Escala da imagem
        height: 14,         // Altura em mm
        includetext: true,
        textxalign: 'center',
    });
}

/**
 * Monta o PDF final com as etiquetas ordenadas e com os canhotos.
 * @param {Array<Object>} etiquetasOrdenadas - As etiquetas prontas e ordenadas.
 * @returns {Promise<Buffer>} - O buffer do PDF final.
 */
async function gerarPdfOrganizado(etiquetasOrdenadas) {
    const finalPdfDoc = await PDFDocument.create();
    const font = await finalPdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await finalPdfDoc.embedFont(StandardFonts.HelveticaBold); // Fonte em negrito para destaque

    const cmToPoints = (cm) => cm * 28.3465;
    // Dimensões corretas conforme sua alteração: 5cm de largura, 10cm de altura
    const pageWidth = cmToPoints(10);
    const pageHeight = cmToPoints(15);
    
    // Função auxiliar para quebrar o texto do SKU
    const wrapText = (text, maxWidth, fontSize) => {
        const words = text.split(' ');
        let line = '';
        const lines = [];
        const textWidth = (str) => font.widthOfTextAtSize(str, fontSize);

        for (const word of words) {
            const testLine = line + (line ? ' ' : '') + word;
            if (textWidth(testLine) > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        }
        lines.push(line);
        return lines;
    };

    let etiquetaCount = 0;
    for (const etiqueta of etiquetasOrdenadas) {
        etiquetaCount++;
        console.log(`\n-- Gerando página ${etiquetaCount} para etiqueta ID: ${etiqueta.id} --`);
        
        try {
            const [embeddedPage] = await finalPdfDoc.embedPdf(etiqueta.pdfBuffer, [etiqueta.pageIndex]);
            const page = finalPdfDoc.addPage([pageWidth, pageHeight]);

            // --- Adicionar Canhoto com Layout Ajustado ---
            const canhotoHeight = cmToPoints(2.5); // Aumentamos um pouco a altura do canhoto para comportar tudo
            const etiquetaHeight = pageHeight - canhotoHeight;

            // Fundo branco do canhoto
            page.drawRectangle({
                x: 0, y: etiquetaHeight,
                width: pageWidth, height: canhotoHeight,
                color: rgb(1, 1, 1),
            });

            // --- Posicionamento dos Elementos no Canhoto (5cm de largura) ---
            const padding = 8;
            let currentY = pageHeight - 15; // Posição Y inicial, perto do topo

            // 1. Quantidade (em destaque)
            const qtdText = `Qtd: ${etiqueta.totalQuantidade}`;
            page.drawText(qtdText, {
                x: padding, y: currentY,
                font: boldFont, size: 9.5,
            });
    
            if (etiqueta.locations && etiqueta.locations.length > 0) {
                const locText = `Loc: ${etiqueta.locations.join(', ')}`;
                const locTextWidth = font.widthOfTextAtSize(locText, 8);
                // Alinha o texto da localização à direita da página
                page.drawText(locText, {
                    x: padding + 30, y: currentY,
                    font: font, size: 8,
                });
            }

            currentY -= 15; // Move o Y para baixo para o próximo elemento

            // 2. SKUs (com quebra de linha)
            const skusText = `${etiqueta.skus.join(', ')}`;
            const skuLines = wrapText(skusText, pageWidth - (padding * 2), 8);
            
            for (const line of skuLines) {
                page.drawText(line, {
                    x: padding, y: currentY,
                    font: font, size: 9,
                });
                currentY -= 5; // Move para a próxima linha de SKU
            }
            currentY -= 8;

            page.drawText('DANFE', {
                x: padding + 235, y: currentY,
                font: boldFont, size: 7,
            });

            page.drawText('')
            // 3. Código de Barras (ajustado para caber)
            if (etiqueta.chaveAcesso) {
                const barcodeImageBytes = await gerarCodigoDeBarras(etiqueta.chaveAcesso);
                const barcodeImage = await finalPdfDoc.embedPng(barcodeImageBytes);
                
                // Ajuste a escala conforme necessário para o seu novo layout
                const barcodeDims = barcodeImage.scale(0.3);

                // Após a rotação, a largura e altura originais são trocadas
                const rotatedBarcodeWidth = barcodeDims.height;
                const rotatedBarcodeHeight = barcodeDims.width;

                // Desenha a imagem do código de barras rotacionada
                page.drawImage(barcodeImage, {
                    // Posição X: No canto direito da página, recuado pela nova largura e um padding.
                    x: pageWidth - rotatedBarcodeWidth + 40, // 5 é um pequeno padding
                    
                    // Posição Y: Centralizado verticalmente na altura total da etiqueta.
                    y: (pageHeight / 2) - (rotatedBarcodeHeight / 2) + 40,
                    
                    // Dimensões originais da imagem
                    width: barcodeDims.width,
                    height: barcodeDims.height,
                    
                    // Rotação de 90 graus para deixá-lo "em pé"
                    rotate: degrees(90),
                });
            }

            
            // --- Adicionar Etiqueta Original (redimensionada para o espaço restante) ---
            page.drawPage(embeddedPage, {
                x: 0, y: 0,
                width: pageWidth - 35,
                height: etiquetaHeight,
            });

            console.log(`   > Página ${etiquetaCount} gerada com sucesso.`);
        
        } catch(e) {
            console.error(`   > ERRO CRÍTICO ao gerar página para etiqueta ID ${etiqueta.id}. Esta etiqueta será pulada.`, e);
            continue;
        }
    }

    const pdfBytes = await finalPdfDoc.save();
    return Buffer.from(pdfBytes);
}


module.exports = {
    processarEtiquetas,
};