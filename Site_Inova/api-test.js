// Importa a biblioteca axios
const axios = require('axios');

// Função assíncrona para realizar a chamada da API
async function testarApiTransporte() {
  // Define os dados que serão enviados no corpo da requisição
  const data = {
    "cnpjEmbarcador": "40.062.295/0001-45",
    "listaNotasFiscais": ["234951/1"]
  };

  // Define os cabeçalhos da requisição
  // IMPORTANTE: Substitua 'SEU_TOKEN_AQUI' pelo seu token de autorização real
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sdlkjfldlk_7as6a'
  };

  // URL do endpoint da API
  const url = 'https://app.tmselite.com/api/ocorrencias/ocorrencianotafiscaldepara';

  console.log('Enviando requisição para:', url);

  try {
    // Realiza a requisição POST usando axios
    const response = await axios.post(url, data, { headers: headers });

    // Exibe a resposta da API no console
    console.log('--- Resposta da API ---');
    console.log(response.data);
    console.log('-----------------------');
    console.log('Status da resposta:', response.status);

  } catch (error) {
    // Em caso de erro, exibe as informações do erro no console
    console.error('--- Ocorreu um erro ao fazer a requisição ---');
    if (error.response) {
      // O servidor respondeu com um status de erro (4xx ou 5xx)
      console.error('Status:', error.response.status);
      console.error('Dados do erro:', error.response.data);
    } else if (error.request) {
      // A requisição foi feita, mas não houve resposta
      console.error('Nenhuma resposta recebida:', error.request);
    } else {
      // Algo aconteceu ao configurar a requisição que disparou um erro
      console.error('Erro na configuração da requisição:', error.message);
    }
    console.error('------------------------------------------');
  }
}

// Chama a função para executar o teste
testarApiTransporte();
