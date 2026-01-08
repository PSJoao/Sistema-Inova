// services/etiquetasService.js
const { Pool } = require('pg');
const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const ExcelJS = require('exceljs');
const bwip = require('bwip-js');
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

// --- FUNÇÕES PRINCIPAIS DE PROCESSAMENTO ---

/**
 * Gera o PDF de relatório de separação, agora com páginas e formato de tabela.
 * @param {Array<Object>} etiquetasCompletas - Lista original de etiquetas para contagem.
 * @param {Array<Object>} etiquetasOrdenadas - Lista ordenada usada para gerar o PDF de etiquetas.
 */
async function gerarPdfRelatorio(etiquetasCompletas, etiquetasOrdenadas) {
    console.log('[Relatório] Iniciando geração do PDF de relatório...');
    const skuQuantidades = new Map();
    const locEtiquetas = new Map();
    let quantidadeTotalGeral = 0;

    // --- ETAPA 1: Agrega as quantidades totais por SKU (Lógica Original) ---
    // Usa 'etiquetasCompletas' pois a ordem não importa para a contagem total
    for (const etiqueta of etiquetasOrdenadas) {
        const nfeNumeroParaBusca = etiqueta.nfeNumero;
        const locEtiqueta = etiqueta.locations;
        if (nfeNumeroParaBusca && etiqueta.skus && etiqueta.skus.length > 0) {
            const client = await pool.connect();
            try {
                for (const sku of etiqueta.skus) { 
                    const res = await client.query(
                        'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND UPPER(produto_codigo) = UPPER($2)',
                        [nfeNumeroParaBusca, sku.original] // Usa o SKU original para a query
                    );
                    const quantidade = Number(res.rows[0]?.quantidade || 0);
                    // Usa o SKU de display como chave do Map
                    skuQuantidades.set(sku.display, (skuQuantidades.get(sku.display) || 0) + quantidade);
                    locEtiquetas.set(sku.display, locEtiqueta);
                }
            } catch(e) {
                console.error(`[Relatório] Erro ao buscar quantidades para a NF ${nfeNumeroParaBusca}:`, e.message);
            }
            finally {
                client.release();
            }
        }
    }

    // --- MODIFICADO: ETAPA 1.5 - Mapear SKUs para Sequência ---
    // Usa 'etiquetasOrdenadas' que JÁ TÊM a sequência
    console.log('[Relatório] Mapeando SKUs para sequência...');
    const skuSequenciaMap = new Map();
    for (const etiqueta of etiquetasOrdenadas) {
        const sequencia = etiqueta.sequencia;
        
        if (etiqueta.skus && etiqueta.skus.length > 0) {
            for (const sku of etiqueta.skus) {
                const displaySku = sku.display;
                // Apenas seta. Como está ordenado, o primeiro
                // valor encontrado (que é o número da sequência) será o correto.
                if (!skuSequenciaMap.has(displaySku)) {
                    skuSequenciaMap.set(displaySku, sequencia);
                }
            }
        }
    }
    console.log('[Relatório] Mapeamento de sequência concluído.');


    // --- ETAPA 2: Ordena os SKUs (Lógica Original) ---
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

    // --- ETAPA 3: Cria o PDF (Lógica de Desenho Modificada) ---
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    const margin = 40;
    const rowHeight = 22; // Altura de cada linha da "planilha"
    const tableWidth = width - (margin * 2);
    
    // Definição das colunas
    const colSeqWidth = 40; // Era colPaginasWidth = 60
    const colQuantidadeWidth = 50;
    const colAnotacoesWidth = 64; // Era 90 (ganhou o espaço da Seq.)
    const colLocWidht = 110;
    const colSkuWidth = tableWidth - colAnotacoesWidth - colQuantidadeWidth - colSeqWidth - colLocWidht;

    const colAnotacoesX = margin;
    const colSkuX = colAnotacoesX + colAnotacoesWidth;
    const colQuantidadeX = colSkuX + colSkuWidth;
    const colSeqX = colQuantidadeX + colQuantidadeWidth; // Era colPaginasX
    const colLocX = colSeqX + colSeqWidth;
    
    let y = height - margin; // Posição Y atual

    // Título e Data (Original)
    page.drawText('Relatório de Separação de Produtos', { x: margin, y, font: boldFont, size: 18 });
    y -= 30;
    page.drawText(new Date().toLocaleString('pt-BR'), { x: margin, y, font: font, size: 10 });
    y -= 30;

    // --- NOVO: Função auxiliar para desenhar uma linha da tabela ---
    const drawRow = (text1, text2, text3, text4, text5, isHeader = false) => {
        // Adiciona nova página se não houver espaço
        if (y < margin + rowHeight) {
            page = pdfDoc.addPage();
            y = height - margin;
        }
        
        const currentY = y;
        const currentFont = isHeader ? boldFont : font;
        const fontSize = isHeader ? 11 : 10;
        // Calcula o offset vertical para centralizar o texto na célula
        const textVOffset = (rowHeight - fontSize) / 2; 

        // Desenha os retângulos de cada célula
        page.drawRectangle({ x: colAnotacoesX, y: currentY - rowHeight, width: colAnotacoesWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawRectangle({ x: colSkuX, y: currentY - rowHeight, width: colSkuWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawRectangle({ x: colQuantidadeX, y: currentY - rowHeight, width: colQuantidadeWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawRectangle({ x: colSeqX, y: currentY - rowHeight, width: colSeqWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawRectangle({ x: colSeqX, y: currentY - rowHeight, width: colSeqWidth, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawRectangle({ x: colLocX, y: currentY - rowHeight, width: colLocWidht, height: rowHeight, borderColor: rgb(0,0,0), borderWidth: 0.5 });

        // Desenha o texto dentro das células
        page.drawText(text1, { x: colAnotacoesX + 5, y: currentY - rowHeight + textVOffset, font: currentFont, size: fontSize, color: rgb(0,0,0) });
        page.drawText(text2, { x: colSkuX + 5, y: currentY - rowHeight + textVOffset, font: currentFont, size: fontSize, color: rgb(0,0,0) });
        page.drawText(text3, { x: colQuantidadeX + 5, y: currentY - rowHeight + textVOffset, font: currentFont, size: fontSize, color: rgb(0,0,0) });
        page.drawText(text4, { x: colSeqX + 5, y: currentY - rowHeight + textVOffset, font: currentFont, size: fontSize, color: rgb(0,0,0) });
        page.drawText(text5, { x: colLocX + 5, y: currentY - rowHeight + textVOffset, font: currentFont, size: fontSize - 2.5, color: rgb(0,0,0) });

        y -= rowHeight; // Move o Y para a próxima linha
    };

    // --- MODIFICADO: Desenhar Tabela ---
    
    // 1. Cabeçalho
    drawRow('Anotações', 'SKU do Produto', 'QTD.', 'Seq.', 'Loc', true);

    // 2. Corpo
    for (const sku of skusOrdenados) {
        if (y < margin) { // Adiciona nova página se necessário
            page = pdfDoc.addPage();
            y = height - margin;
            // Redesenha o cabeçalho na nova página
            drawRow('Anotações', 'SKU do Produto', 'QTD.', 'Seq.', 'Loc', true);
        }

        const quantidade = skuQuantidades.get(sku);
        quantidadeTotalGeral += quantidade;

        const locEtiqueta = locEtiquetas.get(sku);

        // Formata o texto da sequência
        const sequencia = skuSequenciaMap.get(sku);
        let seqText = sequencia ? String(sequencia) : '-';

        // Desenha a linha com a primeira coluna vazia
        drawRow('', sku, String(quantidade), seqText, String(locEtiqueta), false);
    }
    
    // 3. Rodapé
    drawRow('', 'Quantidade Total de Itens:', String(quantidadeTotalGeral), '', '', true);

    console.log('[Relatório] PDF de relatório gerado com sucesso.');
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

/**
 * Orquestra todo o processo de organização de etiquetas.
 * @param {Array<Buffer>} pdfInputs - Um array com os buffers dos arquivos PDF enviados.
 * @returns {Buffer} - O buffer do novo PDF gerado e organizado.
 */
async function processarEtiquetas(pdfInputs, organizedPdfFilename) {
    console.log('==================================================');
    console.log('[ETAPA 1] Iniciando extração de dados das etiquetas...');
    const etiquetasExtraidas = await extrairDadosDosPdfs(pdfInputs);
    console.log(`[ETAPA 1] Extração finalizada. ${etiquetasExtraidas.length} etiquetas encontradas.`);
    console.log('==================================================');

    if (etiquetasExtraidas.length === 0) {
        throw new Error('Nenhuma etiqueta com NFe ou Pack ID válido foi encontrada nos PDFs.');
    }

    console.log('[ETAPA 2] Iniciando busca de informações cruciais (cache/Bling)...');
    const etiquetasCompletas = await buscarInformacoesCruciais(etiquetasExtraidas, organizedPdfFilename);
    console.log('[ETAPA 2] Busca de informações finalizada.');
    console.log('==================================================');
    
    console.log('[ETAPA 3] Iniciando ordenação das etiquetas...');
    const etiquetasOrdenadas = ordenarEtiquetas(etiquetasCompletas);
    console.log('[ETAPA 3] Etiquetas ordenadas com sucesso.');
    console.log('==================================================');

    console.log('[ETAPA 3.1] Atualizando índices de página corretos no banco de dados...');
    await atualizarPaginasCorretasNoDB(etiquetasOrdenadas, organizedPdfFilename);
    console.log('[ETAPA 3.1] Índices de página atualizados.');
    console.log('==================================================');

    // --- ETAPA 3.5 ---
    console.log('[ETAPA 3.5] Atribuindo sequência por SKU...');
    atribuirSequenciaPorSku(etiquetasOrdenadas); // Modifica o array 'etiquetasOrdenadas' por referência
    console.log('[ETAPA 3.5] Sequência de SKUs atribuída.');
    console.log('==================================================');

    console.log('[ETAPA 4] Iniciando geração do PDF de Etiquetas...');
    const etiquetasPdf = await gerarPdfOrganizado(etiquetasOrdenadas);
    console.log('[ETAPA 4] PDF de Etiquetas gerado com sucesso!');
    console.log('==================================================');
    
    console.log('[ETAPA 5] Iniciando geração do PDF de Relatório...');
    const relatorioPdf = await gerarPdfRelatorio(etiquetasCompletas, etiquetasOrdenadas);
    console.log('[ETAPA 5] PDF de Relatório gerado com sucesso!');
    console.log('==================================================');

    return { etiquetasPdf, relatorioPdf };
}

// --- ETAPA 1: EXTRAÇÃO DE DADOS DOS PDFs ---

async function extrairDadosDosPdfs(pdfInputs) {
    const etiquetas = [];
    let fileIndex = 0;

    for (const pdfInput of pdfInputs) {
        const { buffer, originalFilename } = pdfInput;
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
                    etiquetaData = { tipoId: 'nfe', id: nfMatch[1] };
                } else if (vendaMatch) {
                    console.log(`   > Página ${pageIndex + 1}: Encontrado por HIERARQUIA 2 (Venda): ${vendaMatch[1]}`);
                    etiquetaData = { tipoId: 'numero_loja', id: vendaMatch[1] };
                } else if (packIdMatch) {
                    const packId = packIdMatch[1];
                    if (packIdToVendaMap.has(packId)) {
                        const numeroLoja = packIdToVendaMap.get(packId);
                        console.log(`   > Página ${pageIndex + 1}: Encontrado por HIERARQUIA 3 (Pack ID Mapeado): ${packId} -> ${numeroLoja}`);
                        // Guarda o Pack ID original para salvar no banco depois
                        etiquetaData = { tipoId: 'numero_loja', id: numeroLoja, originalPackId: packId };
                    } else {
                        console.warn(`   > Página ${pageIndex + 1}: AVISO - Pack ID ${packId} encontrado, mas não consta na Folha de Relação.`);
                         // Se não achou no mapa, não adiciona etiquetaData
                    }
                } else {
                    console.log(`   > Página ${pageIndex + 1}: Nenhum identificador (NF, Venda ou Pack ID) encontrado.`);
                }

                if (etiquetaData) {
                    etiquetas.push({
                        ...etiquetaData,
                        pdfBuffer: buffer, // O buffer do arquivo completo
                        pageIndex: pageIndex,
                        originalFilename: originalFilename // Adiciona o nome original aqui
                    });
                }
            }
        } catch (error) {
            console.error(`Erro ao processar o arquivo PDF ${fileIndex}:`, error);
        }
    }
    return etiquetas;
}


// --- ETAPA 2: BUSCA DE INFORMAÇÕES CRUCIAIS ---

async function buscarInformacoesCruciais(etiquetasExtraidas, nomeArquivoGerado) { // Recebe nomeArquivoGerado
    const etiquetasCompletas = [];
    const client = await pool.connect();
    const delPendentes = "DELETE FROM cached_nfe WHERE situacao = 1";

    await client.query(delPendentes);

    try {
        for (const etiqueta of etiquetasExtraidas) {
            console.log(`\n-- Buscando dados para etiqueta [${etiqueta.tipoId.toUpperCase()}: ${etiqueta.id}] (Origem: ${etiqueta.originalFilename}, Pg: ${etiqueta.pageIndex + 1}) --`);
            // ... (resto da lógica de busca info, nfeNumeroFinal, etc.)
            let info = null;
            let nfeNumeroFinal = null;
            let numeroLojaFinal = null;
            let packIdOriginal = etiqueta.originalPackId || null; // Pega daqui

             try {
                 if (etiqueta.tipoId === 'nfe') {
                     info = await getInfoPorNFe(etiqueta.id);
                     nfeNumeroFinal = etiqueta.id;
                     if(info?.nfeNumero) { // Usa info.nfeNumero que é garantido
                        const pedidoRes = await client.query('SELECT numero_loja FROM cached_pedido_venda WHERE nfe_parent_numero = $1 LIMIT 1', [info.nfeNumero]);
                        numeroLojaFinal = pedidoRes.rows[0]?.numero_loja;
                     }
                 } else if (etiqueta.tipoId === 'numero_loja') {
                     info = await getInfoPorNumeroLoja(etiqueta.id);
                     numeroLojaFinal = etiqueta.id;
                     nfeNumeroFinal = info?.nfeNumero;
                 }

                if (info && info.chaveAcesso) { // Garante que temos chave de acesso para salvar/buscar
                    console.log(`   > SUCESSO: Infos encontradas. NF: ${info.nfeNumero}, SKUs: [${info.skus.join(', ')}], QTD: ${info.totalQuantidade}, Loc: [${info.locations.join(', ')}]`);
                    const etiquetaCompleta = { ...etiqueta, ...info, idOriginal: etiqueta.id };
                    etiquetasCompletas.push(etiquetaCompleta);

                    console.log(`   [DB Cache] Tentando salvar etiqueta no banco de dados...`);
                    try {
                        const insertQuery = `
                            INSERT INTO cached_etiquetas_ml (
                                nfe_numero, numero_loja, pack_id, chave_acesso, skus,
                                quantidade_total, locations, pdf_pagina, pdf_arquivo_origem,
                                situacao, last_processed_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                            ON CONFLICT (chave_acesso) DO UPDATE SET
                                nfe_numero = EXCLUDED.nfe_numero,
                                numero_loja = EXCLUDED.numero_loja,
                                pack_id = EXCLUDED.pack_id,
                                skus = EXCLUDED.skus,
                                quantidade_total = EXCLUDED.quantidade_total,
                                locations = EXCLUDED.locations,
                                pdf_pagina = EXCLUDED.pdf_pagina,
                                pdf_arquivo_origem = EXCLUDED.pdf_arquivo_origem, -- Salva o nome do arquivo gerado
                                situacao = 'pendente',
                                last_processed_at = NOW();
                        `;

                        const skusOriginais = info.skus.map(s => s.original).join(',');

                        await client.query(insertQuery, [
                            info.nfeNumero,
                            numeroLojaFinal,
                            packIdOriginal,
                            info.chaveAcesso,
                            skusOriginais,
                            info.totalQuantidade,
                            info.locations.join(','),
                            etiqueta.pageIndex,
                            nomeArquivoGerado, // Salva o NOME DO ARQUIVO GERADO
                            'pendente'
                        ]);
                        console.log(`   [DB Cache] Etiqueta (Chave ${info.chaveAcesso}) salva/atualizada com sucesso.`);
                    } catch (dbError) {
                        // ... (tratamento de erro do DB)
                         if (dbError.code === '23505') { // Pode ser outra constraint, mas chave_acesso é a principal
                             console.warn(`   [DB Cache] Aviso: Etiqueta com chave de acesso ${info.chaveAcesso} já existe ou conflito. Atualizando.`);
                         } else {
                             console.error(`   [DB Cache] ERRO ao salvar etiqueta no banco:`, dbError.message);
                         }
                    }
                } else {
                     console.warn(`   > AVISO: Não foi possível encontrar informações completas (ou chave de acesso) para a etiqueta ID: ${etiqueta.id}`);
                }
            } catch (error) {
                console.error(`   > ERRO GERAL ao buscar/processar dados para a etiqueta ID ${etiqueta.id}:`, error);
            }
        }
    } finally {
        client.release();
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
    // Agora 'skus' será um array de objetos para carregar o tipo
    const skus = [];
    let totalQuantidade = 0;

    for (const id of productIds) {
        // Query modificada para incluir a nova coluna 'tipo_ml'
        const productQuery = 'SELECT sku, tipo_ml FROM cached_products WHERE bling_id = $1 AND bling_account = $2';
        const productResult = await client.query(productQuery, [id, 'lucas']);
        const skuData = productResult.rows[0]; // Contém { sku, tipo_ml }

        if (skuData && skuData.sku) {
            const originalSku = skuData.sku;
            const tipo = skuData.tipo_ml;

            // Busca a quantidade usando o SKU original (com UPPER para ser case-insensitive)
            const qtdQuery = 'SELECT quantidade FROM nfe_quantidade_produto WHERE nfe_numero = $1 AND UPPER(produto_codigo) = UPPER($2)';
            const qtdResult = await client.query(qtdQuery, [nfeNumero, originalSku]);
            const quantidade = parseInt(qtdResult.rows[0]?.quantidade || 0, 10);

            // Cria o SKU de exibição (prefixado) se o tipo existir
            const displaySku = (tipo && tipo.trim() !== '') ? `${tipo.toUpperCase()}-${originalSku}` : originalSku;

            // Adiciona o objeto completo ao array
            skus.push({
                display: displaySku, // Para ordenação e exibição
                original: originalSku // Para queries no banco
            });
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

    const etiquetasUnicas = [...new Map(etiquetas.map(et => [et.nfeNumero, et])).values()];

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
 * Itera sobre as etiquetas ordenadas e atribui um número de sequência
 * baseado em grupos de SKUs idênticos.
 * @param {Array<Object>} etiquetasOrdenadas - Array de etiquetas, já ordenado.
 */
function atribuirSequenciaPorSku(etiquetasOrdenadas) {
    let currentSequence = 0;
    let previousSkuString = null;

    console.log('[Sequência] Iniciando atribuição de sequência...');
    for (const etiqueta of etiquetasOrdenadas) {
        // Gera uma string única para o conjunto de SKUs da etiqueta
        const currentSkuString = etiqueta.skus.map(s => s.display).join(';');
        
        // Se a string de SKUs for diferente da anterior, incrementa a sequência
        if (currentSkuString !== previousSkuString) {
            currentSequence++;
            previousSkuString = currentSkuString;
        }
        
        // Atribui a sequência atual à etiqueta
        etiqueta.sequencia = currentSequence;
    }
    console.log(`[Sequência] Atribuição finalizada. Total de ${currentSequence} sequências únicas.`);
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

            const pageNumText = `Pág: ${etiquetaCount}`;
            const pageNumTextWidth = boldFont.widthOfTextAtSize(pageNumText, 8);
            page.drawText(pageNumText, {
                x: pageWidth - pageNumTextWidth - 5, // Alinha à direita
                y: pageHeight - 12, // Perto do topo
                font: boldFont,
                size: 8,
                color: rgb(0.5, 0.5, 0.5) // Cor cinza para ser discreto
            });

            // 1. Quantidade (esquerda) e Sequência (direita)
            const qtdText = `Qtd: ${etiqueta.totalQuantidade}`;
            page.drawText(qtdText, {
                x: padding, y: currentY,
                font: boldFont, size: 9.5,
            });

            // 2. Localização (em sua própria linha)
            if (etiqueta.locations && etiqueta.locations.length > 0) {
                const locText = `Loc: ${etiqueta.locations.join(', ')}`;
                page.drawText(locText, {
                    x: padding + 45, y: currentY,
                    font: font, size: 8,
                });
            }
            // (Se não houver loc, esta linha fica em branco, o Y desce mesmo assim)

            currentY -= 15; // Move o Y para baixo para os SKUs

            // 3. SKUs (com quebra de linha)
            const skusText = `${etiqueta.skus.map(s => s.display).join(', ')}`;
            const skuLines = wrapText(skusText, pageWidth - (padding * 2), 8);
            
            for (const line of skuLines) {
                page.drawText(line, {
                    x: padding, y: currentY,
                    font: font, size: 9,
                });
                currentY -= 5; // Move para a próxima linha de SKU
            }
            currentY -= 8; // Espaço antes do "DANFE"

            const seqText = `Seq: ${etiqueta.sequencia}`;
            const seqTextWidth = boldFont.widthOfTextAtSize(seqText, 12); // Tamanho em negrito
            page.drawText(seqText, {
                x: padding, // Alinhado à direita
                y: currentY,
                font: boldFont, size: 9,
            });

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

/**
 * Busca uma etiqueta específica pelo número da NF, priorizando a tabela
 * cached_etiquetas_ml para encontrar a página e o arquivo correto.
 * @param {string} nfNumero O número da Nota Fiscal a ser buscada.
 * @returns {Promise<Object>} Um objeto { success: boolean, pdfBuffer?: Buffer }
 */
async function buscarEtiquetaPorNF(nfNumero) {
    console.log(`[Service - Busca NF DB] Iniciando busca por NF ${nfNumero} na tabela cached_etiquetas_ml...`);
    const client = await pool.connect();
    try {
        // 1. Busca na tabela cached_etiquetas_ml
        const queryResult = await client.query(
            `SELECT pdf_arquivo_origem, pdf_pagina
             FROM cached_etiquetas_ml
             WHERE nfe_numero = $1
             ORDER BY last_processed_at DESC -- Pega a versão mais recente caso haja duplicatas
             LIMIT 1`,
            [nfNumero]
        );

        if (queryResult.rows.length === 0) {
            console.log(`[Service - Busca NF DB] NF ${nfNumero} não encontrada na tabela cached_etiquetas_ml.`);
            return { success: false };
        }

        const { pdf_arquivo_origem, pdf_pagina } = queryResult.rows[0];

        // Verifica se temos as informações necessárias
        if (pdf_arquivo_origem === 'desconhecido' || pdf_pagina === null || pdf_pagina === undefined) {
            console.warn(`[Service - Busca NF DB] NF ${nfNumero} encontrada no DB, mas falta informação do arquivo (${pdf_arquivo_origem}) ou página (${pdf_pagina}). Não é possível gerar o PDF.`);
            return { success: false, message: 'Informações incompletas no banco de dados para gerar a etiqueta.' }; // Mensagem mais específica
        }

        console.log(`[Service - Busca NF DB] NF ${nfNumero} encontrada! Arquivo: ${pdf_arquivo_origem}, Página: ${pdf_pagina + 1}`);

        // 2. Localiza o arquivo PDF original (ou o gerado anteriormente)
        // A lógica assume que pdf_arquivo_origem é o nome do PDF *gerado e salvo*
        const filePath = path.join(PDF_STORAGE_DIR, pdf_arquivo_origem);

        // 3. Verifica se o arquivo existe
        try {
            await fs.access(filePath); // Checa se o arquivo existe e é acessível
        } catch (accessError) {
            console.error(`[Service - Busca NF DB] Erro: O arquivo ${pdf_arquivo_origem} referenciado para a NF ${nfNumero} não foi encontrado em ${PDF_STORAGE_DIR}.`);
            return { success: false, message: 'Arquivo PDF associado não encontrado no servidor.' };
        }

        // 4. Extrai a página específica do arquivo encontrado
        console.log(`[Service - Busca NF DB] Lendo arquivo ${pdf_arquivo_origem} para extrair a página ${pdf_pagina + 1}...`);
        const pdfBytes = await fs.readFile(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);

        if (pdf_pagina >= pdfDoc.getPageCount()) {
            console.error(`[Service - Busca NF DB] Erro: O índice da página (${pdf_pagina}) é inválido para o arquivo ${pdf_arquivo_origem} que tem ${pdfDoc.getPageCount()} páginas.`);
             return { success: false, message: 'Índice de página inválido no arquivo PDF.' };
        }

        // Cria um novo PDF contendo APENAS a página encontrada
        const singlePageDoc = await PDFDocument.create();
        const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pdf_pagina]);
        singlePageDoc.addPage(copiedPage);
        const singlePageBytes = await singlePageDoc.save();

        console.log(`[Service - Busca NF DB] PDF individual para NF ${nfNumero} gerado com sucesso.`);
        return { success: true, pdfBuffer: Buffer.from(singlePageBytes) };

    } catch (error) {
        console.error(`[Service - Busca NF DB] Erro geral ao buscar etiqueta por NF ${nfNumero}:`, error);
        return { success: false, message: 'Erro interno do servidor durante a busca.' }; // Mensagem genérica
    } finally {
        client.release();
    }
}

async function atualizarPaginasCorretasNoDB(etiquetasOrdenadas, nomeArquivoGerado) {
    if (!etiquetasOrdenadas || etiquetasOrdenadas.length === 0) {
        console.log('[DB Page Update] Nenhuma etiqueta para atualizar.');
        return;
    }

    const client = await pool.connect();
    try {
        console.log(`[DB Page Update] Iniciando atualização de ${etiquetasOrdenadas.length} páginas para o arquivo: ${nomeArquivoGerado}`);
        
        // Prepara todas as queries de atualização
        const updatePromises = etiquetasOrdenadas.map((etiqueta, index) => {
            const novaPaginaIndex = index; // O índice 0-based do array é a nova página
            const chaveAcesso = etiqueta.chaveAcesso; // Usamos a chave de acesso como ID único

            if (!chaveAcesso) {
                // Se não houver chave de acesso (erro raro), não podemos atualizar
                console.warn(`[DB Page Update] Etiqueta (ID: ${etiqueta.idOriginal}, Pg Orig: ${etiqueta.pageIndex}) sem chave de acesso, não foi possível atualizar a página.`);
                return Promise.resolve(); // Pula esta promessa
            }
            
            const query = `
                UPDATE cached_etiquetas_ml
                SET pdf_pagina = $1
                WHERE chave_acesso = $2 AND pdf_arquivo_origem = $3;
            `;
            
            // Atualiza a linha baseado na Chave de Acesso E no nome do arquivo que geramos
            return client.query(query, [novaPaginaIndex, chaveAcesso, nomeArquivoGerado]);
        });

        // Executa todas as atualizações em paralelo
        await Promise.all(updatePromises);
        
        console.log(`[DB Page Update] Atualização de páginas concluída para ${nomeArquivoGerado}.`);

    } catch (error) {
        console.error('[DB Page Update] Erro catastrófico ao atualizar índices de página:', error);
        // Não lança erro, apenas loga, para não parar o processo principal de geração do PDF
    } finally {
        client.release();
    }
}

async function validarProdutoPorEstruturas(scannedCodes) { // 1. Parâmetro renomeado
    let client;
    try {
        client = await pool.connect();
        const blingAccount = 'lucas'; // Assumindo

        // ETAPA 1: Traduzir os códigos bipados para os component_sku internos.
        
        const trueComponentSkus = [];
        const translationQuery = `
            SELECT component_sku
            FROM cached_structures
            WHERE component_sku = $1  -- 1ª Tentativa: SKU
               OR gtin = $1           -- 2ª Tentativa: GTIN
               OR gtin_embalagem = $1 -- 3ª Tentativa: GTIN Embalagem
            LIMIT 1;
        `;

        for (const code of scannedCodes) {
            const res = await client.query(translationQuery, [code]);
            
            if (res.rows.length === 0) {
                // Se nenhum dos 3 campos bateu, o código é inválido.
                return { success: false, message: `Código bipado "${code}" não foi encontrado em nenhuma estrutura (SKU, GTIN ou GTIN Embalagem).` };
            }
            
            const foundSku = res.rows[0].component_sku;
            
            // Adiciona (sem duplicatas)
            if (!trueComponentSkus.includes(foundSku)) {
                trueComponentSkus.push(foundSku);
            }
        }
        // Ao final deste loop, 'trueComponentSkus' contém os SKUs internos corretos,
        // ex: ['E-5678', 'E-7890']

        const skuCount = trueComponentSkus.length; // Usa a contagem da lista traduzida

        const parentQuery = `
            SELECT
                p.bling_id,
                p.sku,
                p.nome
            FROM cached_products p
            WHERE
                p.bling_account = $1
            AND
                -- Garante que o produto contenha TODOS os SKUs da lista traduzida
                (SELECT COUNT(DISTINCT component_sku)
                 FROM cached_structures s1
                 WHERE s1.parent_product_bling_id = p.bling_id
                   AND s1.component_sku = ANY($2::text[]) -- Usa trueComponentSkus
                ) = $3 -- Usa skuCount
            AND
                -- Garante que o produto tenha EXATAMENTE esse número de estruturas
                (SELECT COUNT(DISTINCT component_sku)
                 FROM cached_structures s2
                 WHERE s2.parent_product_bling_id = p.bling_id
                ) = $3; -- Usa skuCount
        `;
        
        // Passa os parâmetros corretos
        const parentResult = await client.query(parentQuery, [blingAccount, trueComponentSkus, skuCount]);

        if (parentResult.rows.length === 0) {
            return { success: false, message: 'Nenhum produto encontrado que corresponda exatamente a esta combinação de estruturas.' };
        }
        
        // --- LÓGICA DE ITERAÇÃO CORRIGIDA ---
        
        // Agora iteramos por CADA produto estruturalmente idêntico (ex: "Kit-Berço" e "Combo-Berço")
        for (const row of parentResult.rows) {
            const parentProduct = {
                sku: row.sku,
                name: row.nome,
                id: row.bling_id
            };

            // 2. Conta o total de etiquetas PENDENTES para ESTE produto pai específico
            const pendingQuery = `
                SELECT COUNT(DISTINCT e.chave_acesso) AS totalPendente
                FROM cached_etiquetas_ml e
                LEFT JOIN cached_nfe n ON e.nfe_numero = n.nfe_numero
                WHERE e.situacao = 'pendente'
                AND (
                    $1 = ANY(string_to_array(e.skus, ','))
                    OR 
                    (e.skus LIKE '%[object Object]%' AND n.product_ids_list LIKE '%' || $2::text || '%')
                );
            `;
            const pendingResult = await client.query(pendingQuery, [parentProduct.sku, parentProduct.id]);
            const totalPendente = parseInt(pendingResult.rows[0]?.totalpendente || 0, 10);
            
            // 3. Se este produto tiver etiquetas pendentes, ele é o vencedor!
            if (totalPendente > 0) {
                console.log(`[Validar Produto] Match encontrado: Produto ${parentProduct.sku} tem ${totalPendente} etiquetas pendentes.`);
                // Retorna o produto validado e para a iteração
                return {
                    success: true,
                    productFound: {
                        parentProduct: parentProduct,
                        requiredSkus: trueComponentSkus, // Retorna os SKUs que o formaram
                        totalPendente: totalPendente
                    }
                };
            }
            
            // Se totalPendente === 0, o loop continua e testa o próximo produto da lista.
            console.log(`[Validar Produto] Match estrutural ${parentProduct.sku} ignorado (0 etiquetas pendentes).`);
        }

        // 4. Se o loop terminar e NENHUM produto tiver etiquetas pendentes
        return { success: false, message: 'Produto(s) estruturalmente corretos foram encontrados, mas nenhum deles possui etiquetas pendentes.' };

    } catch (error) {
        console.error(`[Service - Validar Produto] Erro ao validar conjunto ${scannedCodes.join(',')}:`, error);
        return { success: false, message: `Erro interno no servidor: ${error.message}` };
    } finally {
        if (client) client.release();
    }
}

async function finalizarBipagem(scanList) {
    console.log('[Finalizar Bipagem] Iniciando processamento da lista...');
    let client;
    const blingAccount = 'lucas'; // Assumindo
    
    // Mapas para gerenciar o estado durante o processamento
    const productAggregates = new Map(); // Key: parentSku, Value: { requiredSkus: Set, scannedSkus: Set, totalPendente: int, timesCompleted: int }
    const labelsToPrint = []; // Array ordenado de { chave_acesso, pdf_arquivo_origem, pdf_pagina }
    const palletMarkers = []; // Array de { index: int, number: int }
    const labelsToUpdate = new Set(); // Set de 'chave_acesso' para atualizar no DB

    try {
        client = await pool.connect();

        for (const item of scanList) {
            if (item.type === 'pallet') {
                // Adiciona um marcador de palete. O 'index' é o número de etiquetas já processadas.
                palletMarkers.push({ index: labelsToPrint.length, number: item.number });
                console.log(`[Finalizar Bipagem] Marcador de Palete ${item.number} adicionado no índice ${labelsToPrint.length}`);
                continue;
            }

            if (item.type === 'item') {
                const parentSku = item.parentProduct.sku;
                // O frontend já fez a varredura e nos deu o ID (bling_id) correto
                const parentProductId = item.parentProduct.id; 
                
                let agg = productAggregates.get(parentSku);

                // Se for a primeira vez que vemos este produto *nesta transação*,
                // buscamos seus dados (requiredSkus e totalPendente) UMA VEZ.
                if (!agg) {
                    console.log(`[Finalizar Bipagem] Primeira vez do SKU ${parentSku}. Buscando dados de agregação...`);

                    // 1. Busca as estruturas necessárias UMA VEZ
                    const requiredQuery = `
                        SELECT component_sku 
                        FROM cached_structures 
                        WHERE parent_product_bling_id = $1;
                    `;
                    const requiredResult = await client.query(requiredQuery, [parentProductId]);
                    const requiredSkus = new Set(requiredResult.rows.map(r => r.component_sku));

                    // 2. Busca o total pendente UMA VEZ (usando a lógica robusta)
                    const pendingQuery = `
                        SELECT COUNT(DISTINCT e.chave_acesso) AS totalPendente
                        FROM cached_etiquetas_ml e
                        LEFT JOIN cached_nfe n ON e.nfe_numero = n.nfe_numero
                        WHERE e.situacao = 'pendente'
                        AND (
                            $1 = ANY(string_to_array(e.skus, ','))
                            OR 
                            (e.skus LIKE '%[object Object]%' AND n.product_ids_list LIKE '%' || $2::text || '%')
                        );
                    `;
                    const pendingResult = await client.query(pendingQuery, [parentSku, parentProductId]);
                    const totalPendente = parseInt(pendingResult.rows[0]?.totalpendente || 0, 10);
                    
                    agg = {
                        requiredSkus: requiredSkus,
                        scannedSkus: new Set(),
                        totalPendente: totalPendente,
                        timesCompleted: 0,
                        parentProductId: parentProductId // Salva o ID
                    };
                    productAggregates.set(parentSku, agg);
                    console.log(`[Finalizar Bipagem] Agregado para ${parentSku} criado. ${requiredSkus.size} estruturas necessárias. ${totalPendente} pendentes.`);
                }

                // Adiciona a estrutura bipada ao conjunto
                agg.scannedSkus.add(item.scannedComponent);

                // Verifica se o produto foi completado
                if (agg.scannedSkus.size === agg.requiredSkus.size) {
                    console.log(`[Finalizar Bipagem] Produto ${parentSku} (completado ${agg.timesCompleted + 1} vez(es)) está completo.`);
                    agg.timesCompleted++;
                    agg.scannedSkus.clear(); // Reseta para o próximo produto do mesmo tipo

                    // Busca a próxima etiqueta PENDENTE para este produto (Query Corrigida)
                    const labelQuery = `
                        SELECT e.chave_acesso, e.pdf_arquivo_origem, e.pdf_pagina
                        FROM cached_etiquetas_ml e
                        LEFT JOIN cached_nfe n ON e.nfe_numero = n.nfe_numero
                        WHERE e.situacao = 'pendente' 
                          AND (
                              $1 = ANY(string_to_array(e.skus, ',')) -- Lógica 1 (SKU)
                              OR 
                              (
                                  e.skus LIKE '%[object Object]%' -- Lógica 2 (Fallback)
                                  AND n.product_ids_list LIKE '%' || $2::text || '%'
                              )
                          )
                        LIMIT 1;
                    `;
                    // Passa os DOIS argumentos (SKU e ID) para a query
                    const labelResult = await client.query(labelQuery, [parentSku, agg.parentProductId]);

                    if (labelResult.rows.length === 0) {
                        // Isso pode acontecer se o frontend e o backend ficarem fora de sincronia
                        console.warn(`[Finalizar Bipagem] Produto ${parentSku} completado, mas NENHUMA etiqueta 'pendente' foi encontrada!`);
                        // Não lança erro, mas loga. O PDF não terá esta etiqueta.
                    } else {
                        const labelInfo = labelResult.rows[0];
                        labelsToPrint.push(labelInfo);
                        labelsToUpdate.add(labelInfo.chave_acesso);
                        console.log(`[Finalizar Bipagem] Etiqueta ${labelInfo.chave_acesso} adicionada à fila de impressão.`);
                        
                        // Marca a etiqueta como 'associado' (em transação) para não ser pega 2x
                        // Usamos UPDATE ... RETURNING para garantir que pegamos apenas uma
                        const updateTempQuery = `
                            UPDATE cached_etiquetas_ml 
                            SET situacao = 'associado' 
                            WHERE chave_acesso = $1 
                            RETURNING chave_acesso;
                        `;
                        await client.query(updateTempQuery, [labelInfo.chave_acesso]);
                    }
                }
            }
        }

        // Todos os itens processados, agora gera o PDF
        console.log(`[Finalizar Bipagem] Gerando PDF com ${labelsToPrint.length} etiquetas e ${palletMarkers.length} paletes...`);
        const pdfBytes = await gerarPdfBipagem(labelsToPrint, palletMarkers);

        // Se o PDF foi gerado, atualiza o status de todas as etiquetas para 'impresso'
        if (labelsToUpdate.size > 0) {
            console.log(`[Finalizar Bipagem] Atualizando ${labelsToUpdate.size} etiquetas para 'impresso'...`);
            const finalUpdateQuery = `
                UPDATE cached_etiquetas_ml
                SET situacao = 'impresso'
                WHERE chave_acesso = ANY($1::text[]);
            `;
            await client.query(finalUpdateQuery, [Array.from(labelsToUpdate)]);
        }

        return pdfBytes;

    } catch (error) {
        console.error('[Service - Finalizar Bipagem] Erro:', error);
        // Rollback das etiquetas 'associado' para 'pendente' em caso de falha na geração do PDF
        if (labelsToUpdate.size > 0) {
            console.log("[Finalizar Bipagem] Revertendo status das etiquetas para 'pendente'...");
            const rollbackQuery = `
                UPDATE cached_etiquetas_ml
                SET situacao = 'pendente'
                WHERE chave_acesso = ANY($1::text[]);
            `;
            await client.query(rollbackQuery, [Array.from(labelsToUpdate)]);
        }
        throw error; // Lança o erro para o controller
    } finally {
        if (client) client.release();
    }
}

async function gerarPdfBipagem(labelsToPrint, palletMarkers) {
    const finalPdfDoc = await PDFDocument.create();
    const font = await finalPdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Agrupa as etiquetas por arquivo de origem para carregar cada PDF apenas uma vez
    const sourceFileMap = new Map(); 
    
    for (const label of labelsToPrint) {
        if (!sourceFileMap.has(label.pdf_arquivo_origem)) {
            sourceFileMap.set(label.pdf_arquivo_origem, { doc: null, labels: [] });
        }
        sourceFileMap.get(label.pdf_arquivo_origem).labels.push(label);
    }

    // Carrega os PDFs de origem
    for (const [filename, data] of sourceFileMap.entries()) {
        try {
            const filePath = path.join(PDF_STORAGE_DIR, filename);
            const pdfBytes = await fs.readFile(filePath);
            data.doc = await PDFDocument.load(pdfBytes);
        } catch (e) {
            console.error(`Erro ao carregar o PDF de origem ${filename}: ${e.message}`);
            throw new Error(`Arquivo ${filename} não encontrado ou corrompido.`);
        }
    }

    let labelCounter = 0;
    
    // Fazemos uma cópia da fila de paletes para manipular com segurança
    const palletsQueue = [...palletMarkers]; 
    let currentPallet = palletsQueue.shift();

    // 1. Verifica se há paletes ANTES da primeira etiqueta (índice 0)
    while (currentPallet && currentPallet.index === labelCounter) {
        const page = finalPdfDoc.addPage();
        page.drawText(`Palete ${currentPallet.number}`, { x: 50, y: page.getHeight() / 2, size: 50, font: font });
        currentPallet = palletsQueue.shift();
    }

    // 2. Itera sobre as etiquetas de produtos
    for (const label of labelsToPrint) {
        // Copia a página da etiqueta
        const source = sourceFileMap.get(label.pdf_arquivo_origem);
        if (source && source.doc) {
            const [copiedPage] = await finalPdfDoc.copyPages(source.doc, [label.pdf_pagina]);
            finalPdfDoc.addPage(copiedPage);
        }
        
        // Incrementa o contador POIS acabamos de adicionar uma etiqueta
        labelCounter++;

        // 3. Verifica se há paletes logo APÓS esta etiqueta
        while (currentPallet && currentPallet.index === labelCounter) {
            const page = finalPdfDoc.addPage();
            page.drawText(`Palete ${currentPallet.number}`, { x: 50, y: page.getHeight() / 2, size: 50, font: font });
            currentPallet = palletsQueue.shift();
        }
    }

    // 4. CORREÇÃO PRINCIPAL: "Trailing Pallets"
    // Se sobraram paletes que foram adicionados APÓS o último produto (no final da lista), eles são processados aqui.
    while (currentPallet) {
        const page = finalPdfDoc.addPage();
        page.drawText(`Palete ${currentPallet.number}`, { x: 50, y: page.getHeight() / 2, size: 50, font: font });
        currentPallet = palletsQueue.shift();
    }

    const pdfBytes = await finalPdfDoc.save();
    return Buffer.from(pdfBytes);
}

async function lerExcel(buffer) {
    const nfs = [];
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0]; // Pega a primeira planilha

        // Itera sobre a Coluna A
        worksheet.getColumn(1).eachCell((cell, rowNumber) => {
            if (rowNumber > 1) { // Pula a linha 1 (cabeçalho)
                const nfValue = cell.value ? cell.value.toString().trim() : '';
                if (nfValue.length > 0 && /^\d+$/.test(nfValue)) {
                    nfs.push(nfValue);
                }
            }
        });
        
        return [...new Set(nfs)]; // Retorna apenas NFs únicas
    } catch (error) {
        console.error('[Service - Ler Excel] Erro ao ler o arquivo Excel:', error);
        throw new Error('Não foi possível ler o arquivo Excel. Verifique se o formato está correto.');
    }
}

async function processarLoteNf(excelBuffer) {
    console.log('[Service - Lote NF] Iniciando processamento do lote...');
    const nfList = await lerExcel(excelBuffer);
    
    if (nfList.length === 0) {
        throw new Error('Nenhuma NF válida encontrada na Coluna A do Excel (pulando a linha 1).');
    }

    console.log(`[Service - Lote NF] ${nfList.length} NFs únicas encontradas no Excel. Buscando etiquetas...`);

    const foundLabelsBuffers = [];
    const notFoundNfs = [];

    for (const nf of nfList) {
        try {
            // Reutiliza a função de busca individual existente
            const resultado = await buscarEtiquetaPorNF(nf);

            if (resultado.success && resultado.pdfBuffer) {
                foundLabelsBuffers.push(resultado.pdfBuffer);
            } else {
                notFoundNfs.push(nf);
            }
        } catch (error) {
            console.error(`[Service - Lote NF] Erro ao buscar NF ${nf}:`, error);
            notFoundNfs.push(nf);
        }
    }

    if (foundLabelsBuffers.length === 0) {
        throw new Error('Nenhuma das NFs fornecidas foi encontrada ou pôde ser processada.');
    }

    // Mescla todos os PDFs encontrados
    console.log(`[Service - Lote NF] Mesclando ${foundLabelsBuffers.length} etiquetas encontradas...`);
    const mergedPdf = await PDFDocument.create();

    for (const pdfBuffer of foundLabelsBuffers) {
        const individualPdf = await PDFDocument.load(pdfBuffer);
        // Assumindo que buscarEtiquetaPorNF sempre retorna 1 página
        const [copiedPage] = await mergedPdf.copyPages(individualPdf, [0]);
        mergedPdf.addPage(copiedPage);
    }

    const pdfBytes = await mergedPdf.save();
    console.log(`[Service - Lote NF] PDF mesclado gerado. ${notFoundNfs.length} NFs não encontradas.`);

    return {
        pdfBuffer: Buffer.from(pdfBytes),
        notFoundNfs: notFoundNfs
    };
}


module.exports = {
    processarEtiquetas,
    buscarEtiquetaPorNF,
    validarProdutoPorEstruturas,
    finalizarBipagem,
    processarLoteNf
};