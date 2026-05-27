require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

// Configuração do banco de dados idêntica ao do sistema
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

async function main() {
    const filenameOrigem = 'Etiquetas-Organizadas-1779702646833.pdf';
    const pdfPath = path.join(__dirname, filenameOrigem);

    // Verifica se o arquivo existe na raiz. Se não, tenta buscar na pasta pdfEtiquetas
    let finalPdfPath = pdfPath;
    if (!fs.existsSync(pdfPath)) {
        const altPath = path.join(__dirname, 'pdfEtiquetas', filenameOrigem);
        if (fs.existsSync(altPath)) {
            finalPdfPath = altPath;
        } else {
            console.error(`Arquivo PDF não encontrado: ${filenameOrigem}`);
            process.exit(1);
        }
    }

    console.log('1. Consultando banco de dados pelas etiquetas pendentes...');
    const client = await pool.connect();

    const nfePendentes = new Set();
    const lojasPendentes = new Set();
    const packsPendentes = new Set();

    try {
        // Busca as etiquetas usando a condição solicitada.
        // Adicionada a coluna situacao por segurança, já que o sistema utiliza ambas em alguns fluxos.
        const res = await client.query(`
            SELECT nfe_numero, numero_loja, pack_id
            FROM cached_etiquetas_ml
            WHERE pdf_arquivo_origem = $1
            AND status = 'pendente'
        `, [filenameOrigem]);

        res.rows.forEach(r => {
            if (r.nfe_numero) nfePendentes.add(r.nfe_numero.toString());
            if (r.numero_loja) lojasPendentes.add(r.numero_loja.toString());
            if (r.pack_id) packsPendentes.add(r.pack_id.toString());
        });
        console.log(`=> Encontradas ${res.rows.length} etiquetas pendentes (NFes únicas: ${nfePendentes.size}).`);
    } catch (err) {
        console.error('Erro ao consultar banco de dados:', err);
        process.exit(1);
    } finally {
        client.release();
    }

    if (nfePendentes.size === 0 && lojasPendentes.size === 0 && packsPendentes.size === 0) {
        console.log('Nenhuma etiqueta pendente encontrada para este PDF. Encerrando.');
        process.exit(0);
    }

    console.log('2. Carregando o PDF original...');
    const pdfBuffer = fs.readFileSync(finalPdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = pdfDoc.getPageCount();

    console.log('3. Extraindo texto de todas as páginas rapidamente (Modo Turbo)...');
    // Em vez de criar um tempDoc para cada página (muito lento), usamos um pagerender customizado
    // que lê o PDF todo em uma única passagem e salva o texto indexado por página.
    const paginasTexto = [];

    function render_page(pageData) {
        let render_options = {
            normalizeWhitespace: false,
            disableCombineTextItems: false
        };
        return pageData.getTextContent(render_options).then(function (textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY) {
                    text += item.str;
                } else {
                    text += '\\n' + item.str;
                }
                lastY = item.transform[5];
            }
            // pageNumber é 1-based no pdf-parse
            paginasTexto[pageData.pageNumber - 1] = text;
            return text;
        });
    }

    await pdfParse(pdfBuffer, { pagerender: render_page });

    console.log('4. Buscando etiquetas correspondentes no texto extraído...');
    const paginasParaManter = [];

    for (let i = 0; i < totalPages; i++) {
        const textoPagina = paginasTexto[i] || '';

        // Expressões regulares idênticas às do "ordenador"
        const nfMatch = textoPagina.match(/NF:\\s*(\\d{5,})/);
        const vendaMatch = textoPagina.match(/Venda:\\s*(\\d+)/);
        const packIdMatch = textoPagina.match(/Pack ID:\\s*(\\d+)/);

        let keepPage = false;

        // Hierarquia de busca: NF > Venda > Pack ID (Igual no ordenador)
        if (nfMatch && nfePendentes.has(nfMatch[1])) {
            keepPage = true;
        } else if (vendaMatch && lojasPendentes.has(vendaMatch[1])) {
            keepPage = true;
        } else if (packIdMatch && packsPendentes.has(packIdMatch[1])) {
            keepPage = true;
        }

        if (keepPage) {
            paginasParaManter.push(i);
        }
    }

    console.log(`=> Encontradas ${paginasParaManter.length} páginas correspondentes no PDF.`);

    if (paginasParaManter.length === 0) {
        console.log('Nenhuma das etiquetas pendentes foi localizada no PDF original. Encerrando.');
        process.exit(0);
    }

    console.log('5. Montando o novo PDF...');
    const novoPdfDoc = await PDFDocument.create();

    // Copia as páginas identificadas
    const paginasCopiadas = await novoPdfDoc.copyPages(pdfDoc, paginasParaManter);
    paginasCopiadas.forEach(page => {
        novoPdfDoc.addPage(page);
    });

    const outputFilename = `Pendentes-${filenameOrigem}`;
    const outputPath = path.join(__dirname, outputFilename);

    const novoPdfBytes = await novoPdfDoc.save();
    fs.writeFileSync(outputPath, novoPdfBytes);

    console.log(`\n=========================================`);
    console.log(`SUCESSO! Novo PDF gerado rapidamente.`);
    console.log(`Arquivo salvo em: ${outputPath}`);
    console.log(`Total de páginas no novo PDF: ${paginasParaManter.length}`);
    console.log(`=========================================\n`);

    process.exit(0);
}

main().catch(console.error);
