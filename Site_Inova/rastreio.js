#!/usr/bin/env node
const axios = require('axios');

// Função principal
async function consultarRastreio(chaveNfe) {
  try {
    const response = await axios.post(
      'https://ssw.inf.br/api/trackingdanfe',
      { chave_nfe: chaveNfe },
      { headers: { 'Content-Type': 'application/json' } }
    );

    console.log('==============================');
    console.log(`Status HTTP: ${response.status}`);
    console.log('Cabeçalhos:', response.headers);
    console.log('==============================');
    console.log('Dados completos da API:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('==============================');

    const dadosRastreioRaw = response.data;

    if (
      !dadosRastreioRaw ||
      !dadosRastreioRaw.success ||
      !dadosRastreioRaw.documento ||
      !dadosRastreioRaw.documento.tracking ||
      dadosRastreioRaw.documento.tracking.length === 0
    ) {
      console.log('Nenhum rastreio encontrado para esta chave.');
      return;
    }

    const historico = dadosRastreioRaw.documento.tracking;

    console.log('Histórico de rastreamento:');
    historico.forEach((evento, idx) => {
      console.log(`Evento ${idx + 1}:`);
      console.log(`  Código SSW: ${evento.codigo_ssw}`);
      console.log(`  Descrição: ${evento.descricao}`);
      console.log(`  Data/Hora: ${evento.data_hora}`);
      if (evento.data_hora_efetiva) {
        console.log(`  Data/Hora Efetiva: ${evento.data_hora_efetiva}`);
      }
      console.log('------------------------------');
    });

    const situacaoMaisRecente = historico[historico.length - 1];
    console.log('Situação mais recente:');
    console.log(situacaoMaisRecente);

  } catch (error) {
    console.error(`Erro ao consultar API para chave ${chaveNfe}:`, error.message);
  }
}

// Captura argumento da linha de comando
const chaveNfe = process.argv[2];
if (!chaveNfe) {
  console.error('Uso: node rastreio.js {chaveDeAcesso}');
  process.exit(1);
}

consultarRastreio(chaveNfe);