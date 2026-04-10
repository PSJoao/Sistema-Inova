// services/shopeeEtiquetasService.js
const { Pool } = require('pg');
const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { findAndCacheNfeByNumber, findAndCachePedidoByLojaNumber } = require('../blingSyncService');
const fs = require('fs').promises;
const path = require('path');

// Configuração do banco de dados
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

const PDF_STORAGE_DIR = path.join(__dirname, '..', 'pdfEtiquetas');
const shopeeProcessBatches = new Map();

// --- ETAPA 1: EXTRAÇÃO E DIVISÃO (SPLIT) DOS PDFs DA SHOPEE ---

/**
 * Lê o PDF A4 da Shopee, extrai os números de pedidos e divide a página em 4 quadrantes.
 * Retorna um Buffer contendo um PDF onde cada página é 1 etiqueta isolada.
 */
async function splitPdfAndExtractPedidos(pdfInputs, umaPorPagina) {
    const splitPdfDoc = await PDFDocument.create();
    const extractions = [];
    let globalPageIndex = 0;

    for (const pdfInput of pdfInputs) {
        const { buffer, originalFilename } = pdfInput;
        const originalDoc = await PDFDocument.load(buffer);
        const pageCount = originalDoc.getPageCount();
        const pages = originalDoc.getPages();

        // Incorpora todas as páginas do PDF original de uma vez para eficiência
        const allIndices = Array.from({ length: pageCount }, (_, i) => i);
        const embeddedPages = await splitPdfDoc.embedPdf(buffer, allIndices);

        for (let i = 0; i < pageCount; i++) {
            // Cria um PDF temporário apenas com esta página para extrair o texto corretamente
            const tempDoc = await PDFDocument.create();
            const [copied] = await tempDoc.copyPages(originalDoc, [i]);
            tempDoc.addPage(copied);
            const parsed = await pdfParse(Buffer.from(await tempDoc.save()));
            
            const regex = /Pedido:\s*([A-Z0-9]{12,25})/gi;
            const pedidos = [];
            let match;
            while ((match = regex.exec(parsed.text)) !== null) {
                pedidos.push(match[1]);
            }

            // Fallback de segurança: Se o PDF "quebrar" a palavra "Pedido:" para muito longe do número,
            // procuramos diretamente pelo padrão único da Shopee (6 números seguidos de 8 caracteres alfanuméricos)
            if (pedidos.length === 0) {
                const regexDireta = /\b(\d{6}[A-Z0-9]{8})\b/gi;
                while ((match = regexDireta.exec(parsed.text)) !== null) {
                    pedidos.push(match[1]);
                }
            }

            // Remove números de pedidos duplicados na leitura da mesma página
            // Impede que a extração dobre o índice e troque as informações das etiquetas.
            const pedidosUnicos = [...new Set(pedidos)];

            const page = pages[i];
            const { width, height } = page.getSize();
            
            if (umaPorPagina) {
                // Lê apenas a primeira etiqueta encontrada na página inteira e não recorta
                if (pedidosUnicos.length > 0) {
                    const newPage = splitPdfDoc.addPage([width, height]);
                    newPage.drawPage(embeddedPages[i], {
                        x: 0, y: 0,
                        width: width,
                        height: height
                    });

                    extractions.push({
                        pedido: pedidosUnicos[0],
                        originalFilename,
                        pageIndex: globalPageIndex
                    });
                    globalPageIndex++;
                }
            } else {
                // Definição dos 4 quadrantes da Shopee na página A4
                // A origem (0,0) no pdf-lib é o canto inferior esquerdo.
                // O texto do PDF da Shopee é lido em colunas: Cima-Esq, Baixo-Esq, Cima-Dir, Baixo-Dir.
                const quadrants = [
                    { x: 0, y: -(height / 2) },            // 1º lido: Top-Left (Quadrante 1)
                    { x: 0, y: 0 },                        // 2º lido: Bottom-Left (Quadrante 3)
                    { x: -(width / 2), y: -(height / 2) }, // 3º lido: Top-Right (Quadrante 2)
                    { x: -(width / 2), y: 0 }              // 4º lido: Bottom-Right (Quadrante 4)
                ];

                // Cria uma nova página A6 para cada pedido ÚNICO encontrado (máx 4)
                for (let j = 0; j < pedidosUnicos.length; j++) {
                    if (j >= 4) break; // Garantia de segurança
                    
                    const newPage = splitPdfDoc.addPage([width / 2, height / 2]);
                    newPage.drawPage(embeddedPages[i], {
                        x: quadrants[j].x,
                        y: quadrants[j].y,
                        width: width,
                        height: height
                    });

                    extractions.push({
                        pedido: pedidosUnicos[j],
                        originalFilename,
                        pageIndex: globalPageIndex
                    });
                    globalPageIndex++;
                }
            }
        }
    }
    const splitBuffer = Buffer.from(await splitPdfDoc.save());
    return { splitBuffer, extractions };
}


// --- ETAPA 2: BUSCA DE INFORMAÇÕES CRUCIAIS (BLING/CACHE) ---

async function buscarInformacoesCruciaisShopee(extractions, nomeArquivoGerado) {
    const etiquetasCompletas = [];
    const client = await pool.connect();
    
    // Deleta os pendentes antigos caso necessário (opcional, ajustável à sua regra)
    await client.query("DELETE FROM cached_etiquetas_shopee WHERE situacao = 'pendente'");

    try {
        for (const extracao of extractions) {
            console.log(`\n-- Buscando dados para Pedido Shopee [${extracao.pedido}] (Origem: ${extracao.originalFilename}) --`);
            
            let info = await getInfoPorNumeroLoja(extracao.pedido);
            let pedidoInterno = null;

            if (info && info.nfeNumero) {
                try {
                    const pedidoRes = await client.query(
                        'SELECT numero FROM cached_pedido_venda WHERE numero_loja = $1 LIMIT 1', 
                        [extracao.pedido]
                    );

                    if (pedidoRes.rows.length > 0) {
                        pedidoInterno = pedidoRes.rows[0].numero;
                    }
                } catch (errPedido) {
                    console.error(`   > Erro ao buscar pedido interno para ${extracao.pedido}:`, errPedido.message);
                }

                console.log(`   > SUCESSO: Infos encontradas. NF: ${info.nfeNumero}, SKUs: [${info.skus.map(s => s.display).join(', ')}], QTD: ${info.totalQuantidade}`);
                
                const etiquetaCompleta = { 
                    ...extracao, 
                    ...info, 
                    id: extracao.pedido, 
                    pedidoInterno: pedidoInterno 
                };
                etiquetasCompletas.push(etiquetaCompleta);

                // Salva no banco de dados na tabela dedicada para Shopee
                try {
                    const insertQuery = `
                        INSERT INTO cached_etiquetas_shopee (
                            nfe_numero, numero_loja, chave_acesso, skus,
                            quantidade_total, locations, pdf_pagina, pdf_arquivo_origem,
                            situacao, last_processed_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                        ON CONFLICT (numero_loja) DO UPDATE SET
                            nfe_numero = EXCLUDED.nfe_numero,
                            chave_acesso = EXCLUDED.chave_acesso,
                            skus = EXCLUDED.skus,
                            quantidade_total = EXCLUDED.quantidade_total,
                            locations = EXCLUDED.locations,
                            pdf_pagina = EXCLUDED.pdf_pagina,
                            pdf_arquivo_origem = EXCLUDED.pdf_arquivo_origem,
                            situacao = 'pendente',
                            last_processed_at = NOW();
                    `;

                    const skusOriginais = info.skus.map(s => s.original).join(',');

                    await client.query(insertQuery, [
                        info.nfeNumero,
                        extracao.pedido,
                        info.chaveAcesso,
                        skusOriginais,
                        info.totalQuantidade,
                        info.locations.join(','),
                        extracao.pageIndex,
                        nomeArquivoGerado,
                        'pendente'
                    ]);
                } catch (dbError) {
                     console.error(`   [DB Cache] ERRO ao salvar etiqueta Shopee no banco:`, dbError.message);
                }
            } else {
                 console.warn(`   > AVISO: Não foi possível encontrar informações para o Pedido Shopee: ${extracao.pedido}`);
            }
        }
    } finally {
        client.release();
    }
    return etiquetasCompletas;
}

async function getInfoPorNumeroLoja(numeroLoja) {
    let client;
    try {
        client = await pool.connect();
        const query = 'SELECT nfe_parent_numero FROM cached_pedido_venda WHERE numero_loja = $1';
        let result = await client.query(query, [numeroLoja]);

        if (!result.rows.length || !result.rows[0].nfe_parent_numero) {
            console.log(`   [Cache Miss] Pedido Shopee ${numeroLoja} não encontrado. Solicitando busca no Bling...`);
            const pedidoFoiEncontrado = await findAndCachePedidoByLojaNumber(numeroLoja, 'lucas');

            if (pedidoFoiEncontrado) {
                result = await client.query(query, [numeroLoja]);
            } else {
                return null;
            }
        }

        if (result.rows.length > 0 && result.rows[0].nfe_parent_numero) {
            const nfeNumero = result.rows[0].nfe_parent_numero;
            return await getInfoPorNFe(nfeNumero, client);
        }
        return null;
    } catch (error) {
        console.error(`   > ERRO ao processar Numero Loja Shopee ${numeroLoja}:`, error);
        return null;
    } finally {
        if (client) client.release();
    }
}

async function getInfoPorNFe(nfeNumero, client) {
    const nfeQuery = 'SELECT chave_acesso, product_ids_list FROM cached_nfe WHERE nfe_numero = $1 AND bling_account = $2';
    let nfeResult = await client.query(nfeQuery, [nfeNumero, 'lucas']);
    let nfeData = nfeResult.rows[0];

    if (!nfeData) {
        const nfeFoiEncontrada = await findAndCacheNfeByNumber(nfeNumero, 'lucas', false);
        if (nfeFoiEncontrada) {
            nfeResult = await client.query(nfeQuery, [nfeNumero, 'lucas']);
            nfeData = nfeResult.rows[0];
        } else {
            return null;
        }
    }

    if (!nfeData || !nfeData.product_ids_list || nfeData.product_ids_list === '{}') {
        return { nfeNumero, chaveAcesso: nfeData?.chave_acesso, skus: [], totalQuantidade: 0, locations: [] };
    }

    const productIds = nfeData.product_ids_list.split(';').map(id => id.replace(/[{}]/g, '').trim()).filter(Boolean);
    if (productIds.length === 0) return { nfeNumero, chaveAcesso: nfeData.chave_acesso, skus: [], totalQuantidade: 0, locations: [] };
    
    const { skus, totalQuantidade } = await getSkusAndQuantidades(client, productIds, nfeNumero);

    let locations = [];
    try {
        const structuresResult = await client.query(
            `SELECT DISTINCT component_location FROM cached_structures 
             WHERE parent_product_bling_id = ANY($1::bigint[]) AND component_location IS NOT NULL`,
            [productIds]
        );
        locations = [...new Set(structuresResult.rows.map(row => row.component_location))];
    } catch (e) {}
    
    return { nfeNumero, chaveAcesso: nfeData.chave_acesso, skus, totalQuantidade, locations };
}

async function getSkusAndQuantidades(client, productIds, nfeNumero) {
    const skus = [];
    let totalQuantidade = 0;

    for (const id of productIds) {
        const productQuery = 'SELECT sku, tipo_ml FROM cached_products WHERE bling_id = $1 AND bling_account = $2';
        const productResult = await client.query(productQuery, [id, 'lucas']);
        const skuData = productResult.rows[0];

        if (skuData && skuData.sku) {
            const originalSku = skuData.sku;
            const tipo = skuData.tipo_ml; // Pode usar o tipo se desejar manter o prefixo visual
            
            const qtdQuery = 'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND UPPER(produto_codigo) = UPPER($2)';
            const qtdResult = await client.query(qtdQuery, [nfeNumero, originalSku]);
            const quantidade = parseInt(qtdResult.rows[0]?.quantidade || 0, 10);

            const displaySku = (tipo && tipo.trim() !== '') ? `${tipo.toUpperCase()}-${originalSku}` : originalSku;

            skus.push({ display: displaySku, original: originalSku });
            totalQuantidade += quantidade;
        }
    }
    return { skus, totalQuantidade };
}


// --- ETAPA 3: ORDENAÇÃO (APENAS ALFANUMÉRICA) ---

function ordenarEtiquetasShopee(etiquetas) {
    const etiquetasUnicas = [...new Map(etiquetas.map(et => [et.pedido, et])).values()];

    const etiquetasOrdenadas = etiquetasUnicas.sort((a, b) => {
        const skuA = a.skus.map(s => s.display).join(';').toUpperCase();
        const skuB = b.skus.map(s => s.display).join(';').toUpperCase();

        const aComecaComLetra = /^[A-Z]/.test(skuA);
        const bComecaComLetra = /^[A-Z]/.test(skuB);
        
        if (aComecaComLetra && !bComecaComLetra) return -1;
        if (!aComecaComLetra && bComecaComLetra) return 1;
        
        if (skuA < skuB) return -1;
        if (skuA > skuB) return 1;

        return 0;
    });

    return etiquetasOrdenadas;
}

function atribuirSequenciaPorSku(etiquetasOrdenadas) {
    let currentSequence = 0;
    let previousSkuString = null;

    for (const etiqueta of etiquetasOrdenadas) {
        const currentSkuString = etiqueta.skus.map(s => s.display).join(';');
        if (currentSkuString !== previousSkuString) {
            currentSequence++;
            previousSkuString = currentSkuString;
        }
        etiqueta.sequencia = currentSequence;
    }
}


// --- ETAPA 4: GERAÇÃO DOS PDFs (ETIQUETAS E RELATÓRIOS) ---

async function gerarPdfOrganizadoShopee(etiquetasOrdenadas, splitBuffer) {
    const finalPdfDoc = await PDFDocument.create();
    const font = await finalPdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await finalPdfDoc.embedFont(StandardFonts.HelveticaBold);

    const cmToPoints = (cm) => cm * 28.3465;
    // Tamanho A6 padrão, perfeito para 1 quadrante de A4
    const pageWidth = cmToPoints(10.5); 
    const pageHeight = cmToPoints(14.8); 

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
        try {
            // Puxamos a página correta do Buffer temporário que contém as etiquetas divididas
            const [embeddedPage] = await finalPdfDoc.embedPdf(splitBuffer, [etiqueta.pageIndex]);
            const page = finalPdfDoc.addPage([pageWidth, pageHeight]);

            const canhotoHeight = cmToPoints(2.5);
            const etiquetaHeight = pageHeight - canhotoHeight;

            // Fundo branco do canhoto superior
            page.drawRectangle({
                x: 0, y: etiquetaHeight,
                width: pageWidth, height: canhotoHeight,
                color: rgb(1, 1, 1),
            });

            const padding = 8;
            let currentY = pageHeight - 15;

            // Paginação
            const pageNumText = `Pág: ${etiquetaCount}`;
            const pageNumTextWidth = boldFont.widthOfTextAtSize(pageNumText, 8);
            page.drawText(pageNumText, {
                x: pageWidth - pageNumTextWidth - 5,
                y: pageHeight - 12,
                font: boldFont, size: 8, color: rgb(0.5, 0.5, 0.5)
            });

            // Quantidade e Checkout
            const qtdText = `Qtd: ${etiqueta.totalQuantidade}`;
            page.drawText(qtdText, { x: padding, y: currentY, font: boldFont, size: 10 });

            if (etiqueta.pedidoInterno) {
                page.drawText(`Checkout: ${etiqueta.pedidoInterno}`, {
                    x: padding + 120, y: currentY, font: boldFont, size: 10
                });
            }

            // Localização
            if (etiqueta.locations && etiqueta.locations.length > 0) {
                page.drawText(`Loc: ${etiqueta.locations.join(', ')}`, {
                    x: padding + 55, y: currentY, font: font, size: 8
                });
            }

            currentY -= 15;

            // SKUs (com quebra de linha)
            const skusText = `${etiqueta.skus.map(s => s.display).join(', ')}`;
            const skuLines = wrapText(skusText, pageWidth - (padding * 2), 9);
            for (const line of skuLines) {
                page.drawText(line, { x: padding, y: currentY, font: font, size: 9 });
                currentY -= 10;
            }

            currentY -= 5;
            
            // Sequência
            page.drawText(`Seq: ${etiqueta.sequencia}`, {
                x: padding, y: currentY, font: boldFont, size: 10
            });

            // NFe Info Rápida
            if(etiqueta.nfeNumero) {
                page.drawText(`NF: ${etiqueta.nfeNumero}`, {
                    x: padding + 220, y: currentY, font: boldFont, size: 8
                });
            }

            // Cola a Etiqueta da Shopee no espaço restante
            page.drawPage(embeddedPage, {
                x: 0, y: 0,
                width: pageWidth,
                height: etiquetaHeight,
            });

        } catch(e) {
            console.error(`   > ERRO ao gerar página para etiqueta Shopee ID ${etiqueta.pedido}.`, e);
            continue;
        }
    }

    const pdfBytes = await finalPdfDoc.save();
    return Buffer.from(pdfBytes);
}

async function atualizarPaginasCorretasNoDBShopee(etiquetasOrdenadas, nomeArquivoGerado) {
    if (!etiquetasOrdenadas || etiquetasOrdenadas.length === 0) return;
    const client = await pool.connect();
    try {
        const updatePromises = etiquetasOrdenadas.map((etiqueta, index) => {
            if (!etiqueta.pedido) return Promise.resolve();
            const query = `
                UPDATE cached_etiquetas_shopee
                SET pdf_pagina = $1
                WHERE numero_loja = $2 AND pdf_arquivo_origem = $3;
            `;
            return client.query(query, [index, etiqueta.pedido, nomeArquivoGerado]);
        });
        await Promise.all(updatePromises);
    } finally {
        client.release();
    }
}


// --- FLUXO PRINCIPAL: PRÉ-PROCESSAMENTO E FINALIZAÇÃO ---

async function preProcessarEtiquetasShopee(pdfInputs, organizedPdfFilename, umaPorPagina) {
    console.log(`[Shopee] Iniciando extração... (Formato de 1 por página ativado: ${umaPorPagina})`);
    const { splitBuffer, extractions } = await splitPdfAndExtractPedidos(pdfInputs, umaPorPagina);
    
    if (extractions.length === 0) throw new Error('Nenhuma etiqueta válida da Shopee encontrada nos PDFs.');

    const etiquetasCompletas = await buscarInformacoesCruciaisShopee(extractions, organizedPdfFilename);
    const etiquetasOrdenadas = ordenarEtiquetasShopee(etiquetasCompletas);
    
    await atualizarPaginasCorretasNoDBShopee(etiquetasOrdenadas, organizedPdfFilename);
    atribuirSequenciaPorSku(etiquetasOrdenadas);

    const skuQuantidades = new Map();
    const locEtiquetas = new Map();
    const skuOriginais = new Map();
    const client = await pool.connect();
    
    try {
        for (const etiqueta of etiquetasOrdenadas) {
            if (etiqueta.nfeNumero && etiqueta.skus && etiqueta.skus.length > 0) {
                for (const sku of etiqueta.skus) { 
                    const res = await client.query(
                        'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND UPPER(produto_codigo) = UPPER($2)',
                        [etiqueta.nfeNumero, sku.original]
                    );
                    const quantidade = Number(res.rows[0]?.quantidade || 0);
                    skuQuantidades.set(sku.display, (skuQuantidades.get(sku.display) || 0) + quantidade);
                    locEtiquetas.set(sku.display, etiqueta.locations);
                    skuOriginais.set(sku.display, sku.original);
                }
            }
        }
    } finally {
        client.release();
    }

    const resumoProdutos = [];
    for (const [sku, quantidade] of skuQuantidades.entries()) {
        resumoProdutos.push({
            sku: sku,
            skuOriginal: skuOriginais.get(sku),
            quantidadeTotal: quantidade,
            loc: locEtiquetas.get(sku) ? locEtiquetas.get(sku).join(', ') : ''
        });
    }

    const batchId = 'shopee-' + Date.now().toString();
    shopeeProcessBatches.set(batchId, {
        splitBuffer,
        etiquetasOrdenadas,
        organizedPdfFilename
    });

    setTimeout(() => shopeeProcessBatches.delete(batchId), 3600000);

    return { batchId, resumoProdutos };
}

async function finalizarEtiquetasShopee(batchId, abatimentosManuais, gondolaState) {
    const lote = shopeeProcessBatches.get(batchId);
    if (!lote) throw new Error('Sessão de processamento expirada. Envie os arquivos novamente.');

    console.log('[Shopee] Gerando PDF de Etiquetas...');
    const etiquetasPdf = await gerarPdfOrganizadoShopee(lote.etiquetasOrdenadas, lote.splitBuffer);
    
    console.log('[Shopee] Gerando Relatórios...');
    const relatorios = await gerarRelatoriosSeparacaoShopee(lote.etiquetasOrdenadas, abatimentosManuais, gondolaState);

    shopeeProcessBatches.delete(batchId);

    return { 
        etiquetasPdf, 
        relatorioPdf: relatorios.principal, 
        relatorioGondolaPdf: relatorios.gondola,
        organizedPdfFilename: lote.organizedPdfFilename 
    };
}

async function calcularGondolaParaProduto(client, skuOriginalProduto, gondolaItens) {
    if (!gondolaItens || gondolaItens.length === 0) return 0;
    const prodRes = await client.query("SELECT bling_id FROM cached_products WHERE sku = $1 AND bling_account = 'lucas' LIMIT 1", [skuOriginalProduto]);
    if (prodRes.rows.length === 0) return 0;
    const parentBlingId = prodRes.rows[0].bling_id;

    const structRes = await client.query('SELECT component_sku FROM cached_structures WHERE parent_product_bling_id = $1', [parentBlingId]);
    if (structRes.rows.length === 0) {
        const itemGondola = gondolaItens.find(i => i.component_sku === skuOriginalProduto);
        return itemGondola ? itemGondola.quantidade : 0;
    }

    let maxMontagens = Infinity;
    for (const row of structRes.rows) {
        const itemGondola = gondolaItens.find(i => i.component_sku === row.component_sku);
        const qtdNaGondola = itemGondola ? itemGondola.quantidade : 0;
        if (qtdNaGondola < maxMontagens) maxMontagens = qtdNaGondola;
    }
    return maxMontagens === Infinity ? 0 : maxMontagens;
}

async function gerarRelatoriosSeparacaoShopee(etiquetasOrdenadas, abatimentosManuais = {}, gondolaState = null) {
    const reportRowsMap = new Map(); 
    let quantidadeTotalGeral = 0;
    let quantidadeTotalGondola = 0;

    const client = await pool.connect();
    try {
        for (const etiqueta of etiquetasOrdenadas) {
            if (etiqueta.nfeNumero && etiqueta.skus && etiqueta.skus.length > 0) {
                for (const sku of etiqueta.skus) { 
                    const uniqueKey = sku.display;
                    if (!reportRowsMap.has(uniqueKey)) {
                        reportRowsMap.set(uniqueKey, {
                            skuDisplay: sku.display,
                            skuOriginal: sku.original,
                            quantidade: 0,
                            loc: etiqueta.locations ? etiqueta.locations.join(', ') : '',
                            seq: etiqueta.sequencia
                        });
                    }
                    const res = await client.query('SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND UPPER(produto_codigo) = UPPER($2)', [etiqueta.nfeNumero, sku.original]);
                    const quantidade = Number(res.rows[0]?.quantidade || 0);
                    reportRowsMap.get(uniqueKey).quantidade += quantidade;
                }
            }
        }

        const sortedReportRows = Array.from(reportRowsMap.values()).sort((a, b) => {
            if (a.skuDisplay < b.skuDisplay) return -1;
            if (a.skuDisplay > b.skuDisplay) return 1;
            return 0;
        });

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        let page = pdfDoc.addPage();
        let { width, height } = page.getSize();
        
        const margin = 12;
        const rowHeight = 22;
        const tableWidth = width - (margin * 2);
        
        // Colunas reajustadas sem a "Onda"
        const colSeqWidth = 35;
        const colQuantidadeWidth = 40;
        const colAnotacoesWidth = 60; 
        const colLocWidht = 100;
        const colSkuWidth = tableWidth - colAnotacoesWidth - colQuantidadeWidth - colSeqWidth - colLocWidht;

        const colAnotacoesX = margin;
        const colSkuX = colAnotacoesX + colAnotacoesWidth;
        const colQuantidadeX = colSkuX + colSkuWidth;
        const colSeqX = colQuantidadeX + colQuantidadeWidth;
        const colLocX = colSeqX + colSeqWidth;
        
        let y = height - margin;
        page.drawText('Relatório de Separação de Produtos - Shopee', { x: margin, y, font: boldFont, size: 16 });
        y -= 25;
        page.drawText(new Date().toLocaleString('pt-BR'), { x: margin, y, font: font, size: 10 });
        y -= 25;

        const drawRow = (pageObj, t1, t2, t3, t4, t5, isHeader = false) => {
            if (y < margin + rowHeight) {
                pageObj = pdfDoc.addPage();
                y = height - margin;
            }
            const cFont = isHeader ? boldFont : font;
            const fSize = isHeader ? 8 : 7;
            const vOff = (rowHeight - fSize) / 2; 

            pageObj.drawRectangle({ x: colAnotacoesX, y: y - rowHeight, width: colAnotacoesWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            pageObj.drawRectangle({ x: colSkuX, y: y - rowHeight, width: colSkuWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            pageObj.drawRectangle({ x: colQuantidadeX, y: y - rowHeight, width: colQuantidadeWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            pageObj.drawRectangle({ x: colSeqX, y: y - rowHeight, width: colSeqWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            pageObj.drawRectangle({ x: colLocX, y: y - rowHeight, width: colLocWidht, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });

            pageObj.drawText(t1, { x: colAnotacoesX + 3, y: y - rowHeight + vOff, font: cFont, size: fSize });
            pageObj.drawText(t2, { x: colSkuX + 3, y: y - rowHeight + vOff, font: cFont, size: fSize });
            pageObj.drawText(t3, { x: colQuantidadeX + 3, y: y - rowHeight + vOff, font: cFont, size: fSize });
            pageObj.drawText(t4, { x: colSeqX + 3, y: y - rowHeight + vOff, font: cFont, size: fSize });
            pageObj.drawText(t5, { x: colLocX + 3, y: y - rowHeight + vOff, font: cFont, size: fSize - 1 });

            y -= rowHeight;
            return pageObj;
        };
        
        page = drawRow(page, '', 'SKU do Produto', 'Qtd', 'Seq.', 'Loc', true);

        let pdfDocGondola = null, pageGondola = null, yGondola = 0, drawRowGondola = null;
        if (gondolaState) {
            pdfDocGondola = await PDFDocument.create();
            pageGondola = pdfDocGondola.addPage();
            yGondola = height - margin;

            pageGondola.drawText('Relatório de GÔNDOLA - Shopee', { x: margin, y: yGondola, font: boldFont, size: 16 });
            yGondola -= 25;
            pageGondola.drawText(new Date().toLocaleString('pt-BR'), { x: margin, y: yGondola, font: font, size: 10 });
            yGondola -= 25;

            drawRowGondola = (pObj, t1, t2, t3, t4, t5, isHeader = false) => {
                if (yGondola < margin + rowHeight) {
                    pObj = pdfDocGondola.addPage();
                    yGondola = height - margin;
                }
                const cFont = isHeader ? boldFont : font;
                const fSize = isHeader ? 8 : 7;
                const vOff = (rowHeight - fSize) / 2; 

                pObj.drawRectangle({ x: colAnotacoesX, y: yGondola - rowHeight, width: colAnotacoesWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
                pObj.drawRectangle({ x: colSkuX, y: yGondola - rowHeight, width: colSkuWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
                pObj.drawRectangle({ x: colQuantidadeX, y: yGondola - rowHeight, width: colQuantidadeWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
                pObj.drawRectangle({ x: colSeqX, y: yGondola - rowHeight, width: colSeqWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
                pObj.drawRectangle({ x: colLocX, y: yGondola - rowHeight, width: colLocWidht, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });

                pObj.drawText(t1, { x: colAnotacoesX + 3, y: yGondola - rowHeight + vOff, font: cFont, size: fSize });
                pObj.drawText(t2, { x: colSkuX + 3, y: yGondola - rowHeight + vOff, font: cFont, size: fSize });
                pObj.drawText(t3, { x: colQuantidadeX + 3, y: yGondola - rowHeight + vOff, font: cFont, size: fSize });
                pObj.drawText(t4, { x: colSeqX + 3, y: yGondola - rowHeight + vOff, font: cFont, size: fSize });
                pObj.drawText(t5, { x: colLocX + 3, y: yGondola - rowHeight + vOff, font: cFont, size: fSize - 1 });

                yGondola -= rowHeight;
                return pObj;
            };
            pageGondola = drawRowGondola(pageGondola, '', 'SKU do Produto', 'Qtd', 'Seq.', 'Loc', true);
        }

        const abatimentosRestantes = { ...abatimentosManuais };
        const gondolaLimits = new Map(); 
        
        if (gondolaState) {
            const uniqueOriginals = [...new Set(sortedReportRows.map(r => r.skuOriginal))];
            for (const skuOrig of uniqueOriginals) {
                const qtd = await calcularGondolaParaProduto(client, skuOrig, gondolaState.itens);
                gondolaLimits.set(skuOrig, qtd);
            }
        }

        for (const row of sortedReportRows) {
            let qtdRestante = row.quantidade;

            let abatimentoDisponivel = abatimentosRestantes[row.skuDisplay] || 0;
            let aAbaterManualmente = Math.min(qtdRestante, abatimentoDisponivel);
            qtdRestante -= aAbaterManualmente;
            if (abatimentosRestantes[row.skuDisplay]) abatimentosRestantes[row.skuDisplay] -= aAbaterManualmente;

            let qtdGondola = 0;
            if (gondolaState && qtdRestante > 0) {
                let gondolaDisponivel = gondolaLimits.get(row.skuOriginal) || 0;
                qtdGondola = Math.min(qtdRestante, gondolaDisponivel);
                qtdRestante -= qtdGondola;
                gondolaLimits.set(row.skuOriginal, gondolaDisponivel - qtdGondola);
            }

            const seqTxt = row.seq ? String(row.seq) : '-';

            if (qtdRestante > 0) {
                quantidadeTotalGeral += qtdRestante;
                page = drawRow(page, '', row.skuDisplay, String(qtdRestante), seqTxt, String(row.loc));
            }
            if (qtdGondola > 0 && drawRowGondola) {
                quantidadeTotalGondola += qtdGondola;
                pageGondola = drawRowGondola(pageGondola, '', row.skuDisplay, String(qtdGondola), seqTxt, String(row.loc));
            }
        }
        
        page = drawRow(page, '', 'Total Restante a Separar:', String(quantidadeTotalGeral), '', '', true);
        const pdfBytesPrincipal = await pdfDoc.save();

        let pdfBytesGondola = null;
        if (pdfDocGondola && quantidadeTotalGondola > 0) {
            pageGondola = drawRowGondola(pageGondola, '', 'Total itens na Gôndola:', String(quantidadeTotalGondola), '', '', true);
            pdfBytesGondola = await pdfDocGondola.save();
        }

        return {
            principal: Buffer.from(pdfBytesPrincipal),
            gondola: pdfBytesGondola ? Buffer.from(pdfBytesGondola) : null
        };

    } finally {
        client.release();
    }
}

module.exports = {
    preProcessarEtiquetasShopee,
    finalizarEtiquetasShopee
};