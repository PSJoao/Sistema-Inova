const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Configuração do banco de dados PostgreSQL
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});
// Configuração do multer para armazenar arquivos de upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Cria a pasta 'uploads' se não existir
    const uploadPath = path.join(__dirname, '../uploads'); // Assume que 'controllers' está um nível abaixo da raiz do projeto
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname); // Adiciona timestamp para evitar sobreposição
  }
});
const upload = multer({ storage: storage });

// Função para extrair o ID do produto do URL (MadeiraMadeira)
const extractProductId = (url) => {
  const match = url.match(/-(\d+)\.html/);
  return match ? match[1] : null;
};

// Função auxiliar para remover espaços em branco
const trimFields = (fields) => {
  const trimmedFields = {};
  for (const key in fields) {
    if (Object.hasOwnProperty.call(fields, key) && typeof fields[key] === 'string') {
      trimmedFields[key] = fields[key].trim();
    } else {
      trimmedFields[key] = fields[key]; // Mantém não-strings como estão
    }
  }
  return trimmedFields;
};

// ROTA DE REDIRECIONAMENTO PADRÃO PARA ESTE MÓDULO APÓS AÇÕES
const REDIRECT_URL_MADEIRA = '/madeiramadeira/urls'; // Ajuste se for outra
const REDIRECT_URL_MONITORING = '/madeiramadeira/monitoring'; // Ajuste se for outra rota de monitoramento

function formatMadeiraMadeiraUrl(productName, productId) {
    if (!productName || !productId) return null;

    const slug = productName
        .toString()
        .toLowerCase()
        .normalize("NFD") // Remove acentos
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, '') // Remove caracteres especiais
        .trim()
        .replace(/\s+/g, '-'); // Substitui espaços por hífens

    return `https://www.madeiramadeira.com.br/parceiros/${slug}-${productId}.html`;
}


exports.bulkAddProductsFromFile = async (req, res) => {
    if (!req.file) {
        req.flash('error', 'Nenhum arquivo foi enviado. Por favor, selecione uma planilha.');
        return res.redirect('back');
    }

    const client = await pool.connect(); // Pega a conexão com o banco mais cedo

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const headers = data[0];
        const idProdutoIndex = headers.findIndex(h => h && h.toLowerCase().trim() === 'id produto');
        const skuSellerIndex = headers.findIndex(h => h && h.toLowerCase().trim() === 'sku seller');
        const nomeIndex = headers.findIndex(h => h && h.toLowerCase().trim() === 'nome');

        if (idProdutoIndex === -1 || skuSellerIndex === -1 || nomeIndex === -1) {
            req.flash('error', 'A planilha não contém os cabeçalhos necessários: "ID Produto", "SKU Seller" e "Nome". Verifique o arquivo e tente novamente.');
            return res.redirect('back');
        }
        
        // --- INÍCIO DA CORREÇÃO ---
        
        // 1. Busca todos os SKUs já existentes no banco e armazena em um Set para performance.
        const existingSkusResult = await client.query('SELECT sku FROM urls');
        const existingSkus = new Set(existingSkusResult.rows.map(row => row.sku));
        
        const produtosParaInserir = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const sku = row[skuSellerIndex] ? row[skuSellerIndex].toString().trim() : null;

            // 2. Verifica se o SKU da planilha já existe no banco. Se sim, pula para o próximo.
            if (!sku || existingSkus.has(sku)) {
                continue;
            }

            const productId = row[idProdutoIndex];
            const name = row[nomeIndex];

            if (!productId || !name) {
                continue;
            }

            const url = formatMadeiraMadeiraUrl(name, productId);
            if (url) {
                produtosParaInserir.push({
                    url: url,
                    description: name.toString().trim(),
                    sku: sku
                });
                // Adiciona o novo SKU ao Set para evitar duplicatas da mesma planilha
                existingSkus.add(sku); 
            }
        }

        if (produtosParaInserir.length === 0) {
            req.flash('info', 'Nenhum produto novo para adicionar foi encontrado na planilha. Itens duplicados foram ignorados.');
            return res.redirect('/madeiramadeira/urls');
        }

        // 3. A query de inserção agora é um INSERT simples, sem ON CONFLICT.
        const insertQuery = `
            INSERT INTO urls (url, description, sku, vendedor)
            VALUES ($1, $2, $3, 'Moveis Magazine');
        `;
        
        await client.query('BEGIN');
        for (const produto of produtosParaInserir) {
            await client.query(insertQuery, [produto.url, produto.description, produto.sku]);
        }
        await client.query('COMMIT');
        
        // --- FIM DA CORREÇÃO ---

        req.flash('success', `${produtosParaInserir.length} produtos novos foram adicionados com sucesso!`);
        res.redirect('/madeiramadeira/urls');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao processar o arquivo de produtos:', error);
        req.flash('error', 'Ocorreu um erro inesperado ao processar a planilha.');
        res.redirect('back');
    } finally {
        client.release();
    }
};

exports.generateReport = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT u.sku, u.description, u.custo,
             dp.price AS inovaMóveisPrice,
             (SELECT MIN(price) FROM dados_produtos WHERE url_id = u.id AND seller != 'Moveis Magazine') AS concorrentePrice
      FROM urls u
      LEFT JOIN dados_produtos dp ON u.id = dp.url_id AND dp.seller = 'Moveis Magazine'
    `);
    const urlsData = urlsResult.rows; // Renomeado para evitar conflito com a variável 'urls' do escopo superior

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Produtos MadeiraMadeira');

    sheet.columns = [
      { header: 'SKU', key: 'sku', width: 20 },
      { header: 'Produto', key: 'description', width: 50 },
      { header: 'Custo', key: 'custo', width: 15, style: { numFmt: '"R$"#,##0.00' } },
      { header: 'Nosso Preço', key: 'inovaMóveisPrice', width: 15, style: { numFmt: '"R$"#,##0.00' } },
      { header: 'Menor Preço Concorrente', key: 'concorrentePrice', width: 20, style: { numFmt: '"R$"#,##0.00' } },
      { header: 'Nossa Margem', key: 'margin', width: 15 },
      { header: 'Margem Concorrente', key: 'concorrenteMargin', width: 20 }
    ];

    urlsData.forEach(item => { // Renomeado 'url' para 'item' para evitar confusão
      const custo = parseFloat(item.custo);
      const inovaMóveisPrice = parseFloat(item.inovamóveisprice); // PostgreSQL retorna em minúsculas
      const concorrentePrice = parseFloat(item.concorrenteprice); // PostgreSQL retorna em minúsculas

      const margin = !isNaN(custo) && !isNaN(inovaMóveisPrice) && inovaMóveisPrice > 0
        ? (((inovaMóveisPrice / 0.8) - custo) / (inovaMóveisPrice / 0.8)) * 100
        : null; // Usar null para facilitar formatação no Excel
      const concorrenteMargin = !isNaN(custo) && !isNaN(concorrentePrice) && concorrentePrice > 0
        ? (((concorrentePrice / 0.8) - custo) / (concorrentePrice / 0.8)) * 100
        : null;

      sheet.addRow({
        sku: item.sku,
        description: item.description,
        custo: !isNaN(custo) ? custo : null,
        inovaMóveisPrice: !isNaN(inovaMóveisPrice) ? inovaMóveisPrice : null,
        concorrentePrice: !isNaN(concorrentePrice) ? concorrentePrice : null,
        margin: margin !== null ? `${margin.toFixed(2)}%` : 'N/A',
        concorrenteMargin: concorrenteMargin !== null ? `${concorrenteMargin.toFixed(2)}%` : 'N/A'
      });
    });
    
    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)){
        fs.mkdirSync(reportsDir, { recursive: true });
    }
    const filePath = path.join(reportsDir, 'Relatorio_Produtos_Madeira.xlsx');
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, 'Relatorio_Produtos_Madeira.xlsx', err => {
      if (err) {
        console.error('Erro ao baixar o relatório:', err);
        // Não podemos mais enviar um res.status aqui se o download já iniciou/falhou parcialmente
      }
      // Remover o arquivo após o download (ou tentativa)
      fs.unlink(filePath, unlinkErr => {
        if (unlinkErr) console.error('Erro ao remover arquivo temporário do relatório:', unlinkErr);
      });
    });
  } catch (err) {
    console.error('Erro ao gerar relatório:', err);
    req.flash('error', 'Erro ao gerar o relatório. Tente novamente.');
    res.redirect(REDIRECT_URL_MADEIRA); // Ou para uma página de erro
  }
};

exports.generateMonitoringReport = async (req, res) => {
    console.log('[generateMonitoringReport] Iniciando geração de relatório de produtos em alerta...');
    try {
        // --- 1. BUSCA E PROCESSAMENTO DE DADOS (Lógica idêntica à sua getMonitoringProducts) ---
        const urlsResult = await pool.query(`SELECT u.id, u.sku, u.url, u.description, u.custo FROM urls u`);
        const urlsData = urlsResult.rows;
        const productDataResult = await pool.query(`SELECT dp.url_id, dp.product_id, dp.price, dp.seller FROM dados_produtos dp`);
        const productData = productDataResult.rows;

        const productsToMonitor = urlsData.map(urlItem => {
            const productPrices = productData.filter(pd => pd.url_id === urlItem.id);
            const inovaMoveisData = productPrices.find(pd => pd.seller === 'Moveis Magazine');
            const inovaMoveisPrice = inovaMoveisData ? parseFloat(inovaMoveisData.price) : null;
            const lowestPriceData = productPrices.filter(pd => pd.seller !== 'Moveis Magazine').sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
            const lowestPrice = lowestPriceData ? parseFloat(lowestPriceData.price) : null;
            const product_id = productPrices.find(pd => pd.product_id)?.product_id || null;
            let newPrice = null;
            if (inovaMoveisPrice !== null && lowestPrice !== null && lowestPrice < inovaMoveisPrice) {
                newPrice = (lowestPrice / 0.8) - 0.1;
            }

            let margin = 'N/A';
            if (newPrice !== null && urlItem.custo !== null) {
                const numericCusto = parseFloat(urlItem.custo);
                if (!isNaN(numericCusto) && newPrice > 0) {
                    margin = ((newPrice - numericCusto) / newPrice) * 100;
                }
            }

            let precoBruto = null;
            let atualMargin = 'N/A';
            if (inovaMoveisPrice !== null && urlItem.custo !== null) {
              precoBruto = inovaMoveisPrice / 0.8; // Preço bruto
              const numericCusto = parseFloat(urlItem.custo);
              if (!isNaN(numericCusto) && inovaMoveisPrice > 0) { // Evita divisão por zero ou NaN
                  atualMargin = ((precoBruto - numericCusto) / precoBruto) * 100;
              }
            }

            
            
            return { ...urlItem, inovaMoveisPrice, lowestPrice, lowestSeller: lowestPriceData ? lowestPriceData.seller : 'N/A', newPrice, margin: typeof margin === 'number' ? margin.toFixed(2) : 'N/A', atualMargin: typeof atualMargin === 'number' ? atualMargin.toFixed(2) : 'N/A', precoBruto, product_id };
        }).filter(product => product.inovaMoveisPrice !== null && product.lowestPrice !== null && product.lowestPrice < product.inovaMoveisPrice);
        
        if (productsToMonitor.length === 0) {
            req.flash('info', 'Não há produtos em alerta para gerar o relatório no momento.');
            return res.redirect('/monitoring'); // Volta para a página de monitoramento
        }
        
        // --- 2. CRIAÇÃO DA PLANILHA EXCEL ---
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Produtos em Alerta');

        // Definindo as colunas, seus cabeçalhos e larguras
        worksheet.columns = [
            { header: 'SKU', key: 'sku', width: 35 },
            { header: 'ID', key: 'id', width: 40 },
            { header: 'Produto', key: 'description', width: 50 },
            { header: 'Custo', key: 'custo', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Nosso Preço (A Vista)', key: 'inovaMoveisPrice', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Menor Preço', key: 'lowestPrice', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Concorrente', key: 'lowestSeller', width: 30 },
            { header: 'Nosso Preço (A Prazo)', key: 'precoBruto', width: 15, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Rentabilidade Atual (%)', key: 'atualMargin', width: 20, style: { numFmt: '0.00"%"' } },
            { header: 'Novo Preço Sugerido', key: 'newPrice', width: 20, style: { numFmt: '"R$"#,##0.00' } },
            { header: 'Rentabilidade Sugerida (%)', key: 'margin', width: 20, style: { numFmt: '0.00"%"' } }
        ];
        
        // Estilizando o cabeçalho
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };

        // Adicionando os dados dos produtos à planilha
        productsToMonitor.forEach(product => {
            worksheet.addRow({
                sku: product.sku,
                id: product.product_id,
                description: product.description,
                custo: parseFloat(product.custo) || 0,
                inovaMoveisPrice: product.inovaMoveisPrice,
                lowestPrice: product.lowestPrice,
                lowestSeller: product.lowestSeller,
                precoBruto: product.precoBruto,
                atualMargin: product.atualMargin,
                newPrice: product.newPrice,
                margin: parseFloat(product.margin) || 0
            });
        });
        
        // --- 3. ENVIO DO ARQUIVO PARA DOWNLOAD ---
        const fileName = `Relatorio_Produtos_Alerta_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Erro ao gerar relatório:', err);
        req.flash('error', 'Erro ao gerar o relatório. Tente novamente.');
        res.redirect(REDIRECT_URL_MADEIRA);
    }
};

exports.getMonitoringProducts = async (req, res) => {
  try {
    const urlsResult = await pool.query(`SELECT u.id, u.sku, u.url, u.description, u.custo FROM urls u`);
    const urlsData = urlsResult.rows;
    const productDataResult = await pool.query(`SELECT dp.product_id, dp.url_id, dp.price, dp.seller FROM dados_produtos dp`);
    const productData = productDataResult.rows;

    const productsToMonitor = urlsData.map(urlItem => {
      const productPrices = productData.filter(pd => pd.url_id === urlItem.id);
      const product_id = productPrices.length > 0 ? productPrices[0].product_id : null;
      const inovaMóveisData = productPrices.find(pd => pd.seller === 'Moveis Magazine');
      const inovaMóveisPrice = inovaMóveisData ? parseFloat(inovaMóveisData.price) : null;
      const lowestPriceData = productPrices.filter(pd => pd.seller !== 'Moveis Magazine').sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
      const lowestPrice = lowestPriceData ? parseFloat(lowestPriceData.price) : null;
      let newPrice = null;
      if (inovaMóveisPrice !== null && lowestPrice !== null && lowestPrice < inovaMóveisPrice) {
        newPrice = (lowestPrice / 0.8) - 0.1;
      }
      let margin = 'N/A';
      if (newPrice !== null && urlItem.custo !== null) {
        const numericCusto = parseFloat(urlItem.custo);
        if (!isNaN(numericCusto) && newPrice > 0) { // Evita divisão por zero ou NaN
            margin = ((newPrice - numericCusto) / newPrice) * 100;
        }
      }

      let precoPrazo = null;

      if (inovaMóveisPrice !== null) {
        precoPrazo = inovaMóveisPrice / 0.8;
      }
        

      let atualMargin = 'N/A';
      if (inovaMóveisPrice !== null && urlItem.custo !== null) {
        const numericCusto = parseFloat(urlItem.custo);
        const precoBruto = inovaMóveisPrice / 0.8;
        if (!isNaN(numericCusto) && inovaMóveisPrice > 0) { // Evita divisão por zero ou NaN
            atualMargin = ((precoBruto - numericCusto) / precoBruto) * 100;
        }
      }

      const custo = parseFloat(urlItem.custo);

      return {
        ...urlItem,
        url: urlItem.url, // Garante que 'url' (link do produto) seja passado, não 'url' se for diferente
        inovaMóveisPrice: inovaMóveisPrice, // Envia como número
        product_id: product_id,
        prazoPrice: precoPrazo,
        lowestPrice: lowestPrice,
        lowestSeller: lowestPriceData ? lowestPriceData.seller : 'N/A',
        newPrice: newPrice,
        margin: typeof margin === 'number' ? margin.toFixed(2) : 'N/A',
        atualMargin: typeof atualMargin === 'number' ? atualMargin.toFixed(2) : 'N/A',
        custo: !isNaN(custo) ? custo : null // Passa o custo como número ou null
      };
    }).filter(product => product.inovaMóveisPrice !== null && product.lowestPrice !== null && product.lowestPrice < product.inovaMóveisPrice);

    res.render('mm/home', {
      title: 'Produtos em Alerta',
      productsToMonitor
    });
  } catch (err) {
    console.error("Erro em getMonitoringProducts:", err);
    req.flash('error', 'Erro ao buscar produtos em alerta.');
    res.redirect('/'); // Ou para uma página de erro
  }
};

exports.getProductsOutOfPromotion = async (req, res) => {
  try {
    const urlsResult = await pool.query(`SELECT u.id, u.sku, u.url, u.description, u.custo FROM urls u`);
    const urlsData = urlsResult.rows;
    const productDataResult = await pool.query(`SELECT dp.url_id, dp.price, dp.seller FROM dados_produtos dp`);
    const productData = productDataResult.rows;

    const productsOutOfPromotion = urlsData.map(urlItem => {
      const productPrices = productData.filter(pd => pd.url_id === urlItem.id);
      const inovaMóveisData = productPrices.find(pd => pd.seller === 'Moveis Magazine');
      const inovaMóveisPrice = inovaMóveisData ? parseFloat(inovaMóveisData.price) : null;
      const lowestPriceData = productPrices.filter(pd => pd.seller !== 'Moveis Magazine').sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
      const lowestPrice = lowestPriceData ? parseFloat(lowestPriceData.price) : null;
      let newPrice = null;
      if (inovaMóveisPrice !== null && lowestPrice !== null && lowestPrice < inovaMóveisPrice) {
        newPrice = (lowestPrice / 0.8) - 0.1;
      }
      if (newPrice !== null && inovaMóveisPrice !== null && inovaMóveisPrice.toFixed(2) === newPrice.toFixed(2)) {
        return { sku: urlItem.sku, description: urlItem.description, url: urlItem.url };
      }
      return null;
    }).filter(product => product !== null);

    res.render('mm/productsOutOfPromotion', {
      title: 'Produtos Fora de Promoção',
      productsOutOfPromotion
    });
  } catch (err) {
    console.error("Erro em getProductsOutOfPromotion:", err);
    req.flash('error', 'Erro ao buscar produtos fora de promoção.');
    res.redirect('/');
  }
};

exports.getNonCompetitiveProducts = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT u.sku, u.url, u.description
      FROM urls u
      LEFT JOIN dados_produtos dp ON u.id = dp.url_id AND dp.seller != 'Moveis Magazine'
      WHERE dp.url_id IS NULL
    `);
    res.render('mm/non-competitive-products', {
      title: 'Produtos sem Concorrentes',
      urls: urlsResult.rows // 'urls' é o nome esperado pelo template
    });
  } catch (err) {
    console.error("Erro em getNonCompetitiveProducts:", err);
    req.flash('error', 'Erro ao buscar produtos sem concorrentes.');
    res.redirect('/');
  }
};

exports.getUrls = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT u.id, u.sku, u.url, u.description, u.custo,
             dp.price AS inovaMóveisPrice, 
             (SELECT MIN(price) FROM dados_produtos WHERE url_id = u.id AND seller != 'Moveis Magazine') AS concorrentePrice
      FROM urls u
      LEFT JOIN dados_produtos dp ON u.id = dp.url_id AND dp.seller = 'Moveis Magazine'
      WHERE u.vendedor = 'Moveis Magazine'
      ORDER BY u.id ASC
    `);
    const urlsData = urlsResult.rows;

    const urlsWithoutCost = urlsData.filter(urlItem => urlItem.custo === null || String(urlItem.custo).trim() === '');

    const formattedUrls = urlsData.map(urlItem => {
      const custo = parseFloat(urlItem.custo);
      const inovaMóveisPrice = urlItem.inovamóveisprice !== null ? parseFloat(urlItem.inovamóveisprice) : null;
      const concorrentePrice = urlItem.concorrenteprice !== null ? parseFloat(urlItem.concorrenteprice) : null;
      let margin = 'N/A';
      let concorrenteMargin = 'N/A';

      if (!isNaN(custo) && inovaMóveisPrice !== null && inovaMóveisPrice > 0) {
        const precoBrutoNosso = inovaMóveisPrice / 0.8;
        if (precoBrutoNosso > 0) { // Evita divisão por zero se precoBrutoNosso for zero
            margin = ((precoBrutoNosso - custo) / precoBrutoNosso) * 100;
        }
      }
      if (!isNaN(custo) && concorrentePrice !== null && concorrentePrice > 0) {
        const precoBrutoConcorrente = concorrentePrice / 0.8;
        if (precoBrutoConcorrente > 0) {
            concorrenteMargin = ((precoBrutoConcorrente - custo) / precoBrutoConcorrente) * 100;
        }
      }
      return {
        ...urlItem,
        url: urlItem.url, // Passa a URL do produto para o link no template
        custo: custo, // Passa o valor numérico ou NaN
        inovaMóveisPrice: inovaMóveisPrice,
        concorrentePrice: concorrentePrice,
        margin: typeof margin === 'number' ? margin.toFixed(2) : 'N/A',
        concorrenteMargin: typeof concorrenteMargin === 'number' ? concorrenteMargin.toFixed(2) : 'N/A'
      };
    });

    res.render('mm/urls', {
      title: 'Gerenciar Produtos',
      urls: formattedUrls,
      hasUndefinedCost: urlsWithoutCost.length > 0
    });
  } catch (err) {
    console.error("Erro em getUrls:", err);
    req.flash('error', 'Erro ao buscar a lista de produtos.');
    res.redirect('/');
  }
};
 
exports.addUrl = async (req, res) => {
  let { url, description, sku } = req.body; // 'url' aqui é a url
  ({ url, description, sku } = trimFields({ url, description, sku }));

  try {
    const existingProduct = await pool.query('SELECT * FROM urls WHERE url = $1 OR sku = $2', [url, sku]);
    if (existingProduct.rows.length > 0) {
      req.flash('error', 'Produto já existente (mesmo SKU ou URL). Ação cancelada.');
      return res.redirect(REDIRECT_URL_MADEIRA);
    }

    // A coluna no banco é 'url', não 'url' para a tabela 'urls' deste controller
    const result = await pool.query(
      'INSERT INTO urls (url, description, sku) VALUES ($1, $2, $3) RETURNING id',
      [url, description, sku]
    );
    // const urlId = result.rows[0].id; // Se precisar do ID para 'dados_produtos' imediatamente

    // Lógica de scraping movida para um job/botão separado para não atrasar a resposta.
    // Se quiser buscar dados iniciais aqui, pode fazer, mas pode ser lento.

    req.flash('success', 'Produto Adicionado com Sucesso!');
    res.redirect(REDIRECT_URL_MADEIRA);
  } catch (err) {
    console.error('Erro ao inserir URL:', err);
    req.flash('error', 'Erro ao adicionar o produto. Tente novamente.');
    res.redirect('back'); // Volta para a página do formulário com erro
  }
};
 
exports.editUrl = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM urls WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      req.flash('error', 'Produto não encontrado.');
      return res.redirect(REDIRECT_URL_MADEIRA);
    }
    const urlData = result.rows[0]; // 'urlData' contém o objeto do produto
    res.render('mm/edit-url', { 
        title: 'Editar Produto', 
        url: urlData // Passa o objeto 'urlData' como 'url' para o template
    });
  } catch (err) {
    console.error('Erro ao buscar URL para edição:', err);
    req.flash('error', 'Erro ao carregar dados para edição.');
    res.redirect(REDIRECT_URL_MADEIRA);
  }
};

exports.updateUrl = async (req, res) => {
  let { url, description, sku } = req.body; // No form de edição, os names são estes.
  ({ url, description, sku } = trimFields({ url, description, sku }));
  
  const { id } = req.params;

  try {
    // A tabela 'urls' deste controller usa a coluna 'url' para a URL principal.
    // Se você tem 'url_concorrentes' no formulário e na tabela, adicione aqui.
    await pool.query(
      'UPDATE urls SET url = $1, description = $2, sku = $3 WHERE id = $4', 
      [url, description, sku, id]
    );

    // A lógica de apagar e re-popular 'dados_produtos' após update de URL é complexa e
    // pode ser melhor acionada por um botão "Re-analisar Produto" ou um job.
    // Por agora, apenas atualizamos os dados principais da URL.

    req.flash('success', 'Produto Atualizado com Sucesso!');
    res.redirect(REDIRECT_URL_MADEIRA);
  } catch (err) {
    console.error('Erro ao atualizar URL:', err);
    req.flash('error', 'Erro ao atualizar o produto.');
    res.redirect(`/madeiramadeira/edit-url/${id}`); // Tenta voltar para a edição
  }
};

exports.updatePrices = async (req, res) => {
  // Esta função está marcada como "Abandonado!" no seu código.
  // Se for reativar, lembre-se de usar req.flash e redirects.
  try {
    // ... (sua lógica de scraping e update de dados_produtos) ...
    // No final:
    req.flash('info', 'Processo de atualização de preços iniciado/concluído (verificar logs).');
    res.redirect(REDIRECT_URL_MADEIRA); 
  } catch (err) {
    console.error('Erro ao atualizar os preços:', err);
    req.flash('error', 'Erro durante a atualização de preços.');
    res.redirect(REDIRECT_URL_MADEIRA);
  }
};

exports.removeUrl = async (req, res) => {
  const { id } = req.body; // Vem do input hidden no formulário
  try {
    // ON DELETE CASCADE deve cuidar de dados_produtos se configurado no DB.
    // Se não, precisa deletar de dados_produtos primeiro.
    // Assumindo que dados_produtos não tem ON DELETE CASCADE para url_id de urls:
    await pool.query('DELETE FROM dados_produtos WHERE url_id = $1', [id]);
    const result = await pool.query('DELETE FROM urls WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount > 0) {
      req.flash('success', 'Produto Removido com Sucesso!');
    } else {
      req.flash('error', 'Produto não encontrado para remoção.');
    }
    res.redirect(REDIRECT_URL_MADEIRA);
  } catch (err) {
    console.error('Erro ao remover URL:', err);
    req.flash('error', 'Erro ao remover o produto.');
    res.redirect(REDIRECT_URL_MADEIRA);
  }
};