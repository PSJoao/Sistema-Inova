const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Configuração do banco de dados PostgreSQL
const pool = new Pool({
    user: process.env.DB_MON_USER,
    host: process.env.DB_MON_HOST,
    database: process.env.DB_MON_DATABASE,
    password: process.env.DB_MON_PASSWORD,
    port: process.env.DB_MON_PORT,
});

function extractVendorName(text) {
  if (!text) {
    return null; // Retorna null se text for undefined ou vazio
  }

  // Remover espaços desnecessários
  const cleanedText = String(text).replace(/\s+/g, ' ').trim();

  // Nova expressão regular para capturar corretamente o nome do vendedor
  const regex = /(?:por\s+)([^\s]+(?:\s[^\s]+)*)(?=\s+e\s+entregue\s+por|$)/i;
  const match = cleanedText.match(regex);

  if (match && match.length > 1) {
    return match[1].trim();  // Retorna o nome do vendedor, removendo espaços em branco extras
  }

  return null; // Retorna null se não encontrar o nome do vendedor
}

function cleanAndParsePrice(price) {
  if (!price || typeof price !== 'string') {
    return NaN; // Retorna NaN se o preço não for uma string válida
  }
  
  // Substituir ponto por nada (remover milhar) e vírgula por ponto (separador decimal)
  const cleanedPrice = price.replace(/\./g, '').replace(/,/g, '.');
  return parseFloat(cleanedPrice);
}


/*const filePath = 'C:\\Local Macro\\via_dados.xlsx';

exports.processViaVarejoSheet = async (req, res) => {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    // Função para garantir que o SKU é uma string e aplicar trim e toUpperCase
    const normalizeSKU = (sku) => {
      if (typeof sku === 'string') {
        return sku.trim().toUpperCase();
      }
      return String(sku).trim().toUpperCase();
    };

    // Extrair todos os SKUs da planilha e garantir que estão formatados corretamente
    const currentSKUs = data.map(row => normalizeSKU(row['SKU']));
    
    // Buscar todos os SKUs existentes no banco de dados e garantir que estão formatados corretamente
    const result = await pool.query('SELECT sku FROM via_dados');
    const existingSKUs = result.rows.map(row => normalizeSKU(row.sku));

    // Identificar os SKUs que estão no banco de dados mas não na planilha
    const SKUsToDelete = existingSKUs.filter(sku => !currentSKUs.includes(sku));

    // Excluir esses SKUs do banco de dados
    if (SKUsToDelete.length > 0) {
      await pool.query('DELETE FROM via_dados WHERE sku = ANY($1)', [SKUsToDelete]);
    }

    // Inserir/atualizar os dados da planilha no banco de dados
    for (let row of data) {
      const SKU = normalizeSKU(row['SKU']);
      const Produto = row['Produto'];
      const NomeGanhador = row['Nome Ganhador'];
      const PrazoGanhador = cleanAndParsePrice(row['Prazo Ganhador']);
      const AVistaGanhador = cleanAndParsePrice(row['A Vista Ganhador']);
      const NossoPreco = cleanAndParsePrice(row['Nosso Preço']);
      const MenorConcorrente = row['Menor Concorrente'];
      const ValorMenorConcorrente = cleanAndParsePrice(row['Valor Menor Concorrente']);

      const Ganhador = extractVendorName(NomeGanhador);
      
      if (SKU) {
        await pool.query(
          `INSERT INTO via_dados (sku, produto, nome_ganhador, prazo_ganhador, a_vista_ganhador, nosso_preco, menor_concorrente, valor_menor_concorrente)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (sku) DO UPDATE SET produto = $2, nome_ganhador = $3, prazo_ganhador = $4, a_vista_ganhador = $5, nosso_preco = $6, menor_concorrente = $7, valor_menor_concorrente = $8`,
          [SKU, Produto, Ganhador, PrazoGanhador, AVistaGanhador, NossoPreco, MenorConcorrente, ValorMenorConcorrente]
        );
      }
    }

    console.log('Upload realizado com sucesso!');

    this.atualizaProds();
  } catch (err) {
    console.error('Erro ao processar a planilha:', err);
    res.status(500).send('Erro ao processar a planilha');
  }
};*/


exports.atualizaProds = async () => {
  try {
    const urlsResult = await pool.query(`
      SELECT sku, produto FROM via_dados
      WHERE a_vista_ganhador = 'NaN'
    `);
    const urls = urlsResult.rows;

  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar os URLs');
  }
};

exports.getViaVarejoUrls = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT sku, produto, custo, nome_ganhador, prazo_ganhador, a_vista_ganhador, nosso_preco, menor_concorrente, valor_menor_concorrente
      FROM via_dados
      WHERE menor_concorrente IS NOT NULL AND menor_concorrente != '' AND nosso_preco IS NOT NULL AND nosso_preco != 'NaN'
    `);
    const urls = urlsResult.rows;
    const urlsWithCost = urls.filter(url => url.custo !== null && url.custo !== '');
    const urlsWithoutCost = urls.filter(url => url.custo === null || url.custo === '');

    const formattedUrls = urlsWithCost.map(url => {
      const custo = parseFloat(url.custo);
      const nosso_preco = url.nosso_preco !== null ? parseFloat(url.nosso_preco) : null;

      const margin = custo && nosso_preco
        ? ((nosso_preco - custo) / nosso_preco) * 100
        : 'N/A';

      return {
        ...url,
        custo: isNaN(custo) ? 'N/A' : custo,
        nosso_preco: isNaN(nosso_preco) ? 'N/A' : nosso_preco,
        margin: isNaN(margin) ? 'N/A' : margin.toFixed(2),
      };
    });

    res.render('viaVarejo/urls', {
      title: 'Gerenciar Produtos',
      urls: formattedUrls,
      hasUndefinedCost: urlsWithoutCost.length > 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar os URLs');
  }
};

exports.getEmptyProducts = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT sku, produto FROM via_dados
      WHERE a_vista_ganhador is null OR nosso_preco is null
    `);
    const urls = urlsResult.rows;

    res.render('viaVarejo/empty-products', {
      title: 'Produtos sem estoque',
      products: urls,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar os URLs');
  }
};

exports.getMonitoringProducts = async (req, res) => {
  try {
    const urlsResult = await pool.query(`
      SELECT sku, produto, custo, nome_ganhador, prazo_ganhador, a_vista_ganhador, nosso_preco, menor_concorrente, valor_menor_concorrente
      FROM via_dados
      WHERE nosso_preco IS NOT NULL AND nosso_preco != 'NaN' AND nosso_preco != 0
    `);
    const urls = urlsResult.rows;

    // Filtrar produtos com margem abaixo de 30% e nome do ganhador diferente de "INOVA MAGAZINE COMERCIO DE MOVEIS LTDA"
    const productsInAlert = urls.filter(product => {
      const custo = parseFloat(product.custo);
      const nossoPreco = parseFloat(product.nosso_preco);
      const nomeGanhador = product.nome_ganhador ? product.nome_ganhador : '';

      if (isNaN(custo) || isNaN(nossoPreco)) {
        return false;
      }

      const margin = ((nossoPreco - custo) / nossoPreco) * 100;
      return margin < 30 || nomeGanhador.trim() !== 'INOVA MAGAZINE COMERCIO DE MOVEIS LTDA';
    });

    // Calcular o novo valor recomendado para margem de 30%
    const productsWithRecommendations = productsInAlert.map(product => {
      const custo = parseFloat(product.custo);
      const nossoPreco = parseFloat(product.nosso_preco);
      var recommendedPrice = null;
      // Calcula a margem atual
      const margin = ((nossoPreco - custo) / nossoPreco) * 100;
      
      // Se a margem for menor que 30%, calcula o novo preço recomendado
      if (margin < 30) {
        recommendedPrice = custo / (1 - 0.3);
      }

      return {
        ...product,
        recommendedPrice: recommendedPrice,
        margin: margin.toFixed(2),
      };
    });

    // Renderizar os produtos na página viaVarejo/home
    res.render('viaVarejo/home', {
      title: 'Produtos em alerta',
      urls: productsWithRecommendations
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar os produtos em alerta');
  }
};


exports.getNonCompetitiveProducts = async (req, res) => {
  try {
    const nonCompetitiveResult = await pool.query(`
      SELECT sku, produto, custo, nome_ganhador, prazo_ganhador, a_vista_ganhador, nosso_preco, menor_concorrente, valor_menor_concorrente
      FROM via_dados
      WHERE (menor_concorrente IS NULL OR menor_concorrente = '') AND a_vista_ganhador IS NOT NULL AND nome_ganhador = 'INOVA MAGAZINE COMERCIO DE MOVEIS LTDA'
    `);

    const nonCompetitiveProducts = nonCompetitiveResult.rows;
    const ncWithVista = nonCompetitiveProducts.filter(url => !isNaN(url.a_vista_ganhador));
    
    const formattedUrls = ncWithVista.map(url => {
      const custo = parseFloat(url.custo);
      var nosso_preco = url.prazo_ganhador !== null ? parseFloat(url.prazo_ganhador) : null;
      if (isNaN(nosso_preco) || nosso_preco == 0.00) {
        nosso_preco = url.a_vista_ganhador !== null ? parseFloat(url.a_vista_ganhador) : null;
      }
      const margin = custo && nosso_preco
        ? ((nosso_preco - custo) / nosso_preco) * 100
        : 'N/A';

      return {
        ...url,
        custo: isNaN(custo) ? 'N/A' : custo,
        nosso_preco: isNaN(nosso_preco) ? 'N/A' : nosso_preco,
        margin: isNaN(margin) ? 'N/A' : margin.toFixed(2),
      };
    });

    res.render('viaVarejo/non-competitive-products', {
      title: 'Produtos sem concorrentes',
      products: formattedUrls
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro ao buscar os produtos sem concorrentes');
  }
};
