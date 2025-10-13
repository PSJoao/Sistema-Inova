module.exports = {
  // Seus helpers existentes (mantidos intactos)
  subtract: (a, b) => a - b,
  divide: (a, b) => (b !== 0) ? a / b : 0,
  multiply: (a, b) => a * b,
  formatPrice: (price) => {
    if (price === null || price === undefined || isNaN(parseFloat(price))) {
      return "R$ 0,00";
    }
    const numericPrice = parseFloat(String(price).replace(',', '.'));
    if (isNaN(numericPrice)) return "R$ 0,00";
    return `R$ ${numericPrice.toFixed(2).replace('.', ',')}`;
  },
  formatMargin: (newPrice, custo) => {
    const numericPrice = parseFloat(newPrice);
    const numericCusto = parseFloat(custo);
    if (!isNaN(numericCusto) && !isNaN(numericPrice) && numericPrice > 0) {
      const margin = ((numericPrice - numericCusto) / numericPrice) * 100;
      if (isNaN(margin) || !isFinite(margin)) return 'N/A';
      return `${margin.toFixed(2)}%`;
    }
    return 'N/A';
  },
  eq: (a, b) => a === b,
  isSelected: (a, b) => a === b ? 'selected' : '',
  neq: (value, test) => value !== test,
  isLowMargin: function (marginValue, options) {
    const threshold = options && options.hash && typeof options.hash.limit === 'number' 
                      ? options.hash.limit 
                      : 30;
    if (marginValue === null || marginValue === undefined || 
        (typeof marginValue === 'string' && marginValue.trim().toUpperCase() === 'N/A')) {
      return false;
    }
    const numericMargin = parseFloat(String(marginValue).replace(/[^\d.-]/g, ''));
    if (isNaN(numericMargin)) {
      return false;
    }
    return numericMargin < threshold;
  },
  section: function(name, options) {
    if (!this._sections) {
      this._sections = {};
    }
    this._sections[name] = options.fn(this);
    return null;
  },
  times: function(n, start, block) {
        let accum = '';
        for (let i = start; i < n; ++i) {
            accum += block.fn(i);
        }
        return accum;
  },
  times1: function(n, block) {
        let accum = '';
        for(let i = 1; i <= n; ++i) {
            accum += block.fn(i);
        }
        return accum;
  },
  gt: function(a, b) {
    return a > b;
  },
  json: function(context) {
        return JSON.stringify(context || {});
  },
  toFixed: (number, digits) => {
    if (typeof number !== 'number' || isNaN(number)) {
      return '0.00';
    }
    return number.toFixed(digits);
  },

  // --- [NOVOS HELPERS ADICIONADOS PARA O MÓDULO DE RASTREIO] ---

  /**
   * Formata uma string de data para o padrão 'dd/mm/yyyy'.
   */
  formatDate: (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Data Inválida';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  },

  /**
   * Trunca uma string para um comprimento máximo.
   */
  truncate: function(str, len) {
    if (str && str.length > len && str.length > 0) {
      let new_str = str + " ";
      new_str = str.substr(0, len);
      new_str = str.substr(0, new_str.lastIndexOf(" "));
      new_str = (new_str.length > 0) ? new_str : str.substr(0, len);
      return new_str + '...';
    }
    return str;
  },

  /**
   * Verifica se uma data de previsão já passou.
   */
  isAtrasado: function (dataPrevisao) {
    if (!dataPrevisao) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0); // Zera a hora para comparar apenas a data
    const previsao = new Date(dataPrevisao);
    return previsao < hoje;
  },

  script: function(name, options) {
    if (!this._scripts) {
      this._scripts = {};
    }
    this._scripts[name] = options.fn(this);
    return null;
  },
  
  formatDateTime: function(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Data/Hora Inválida';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  },

  containsCode80: function (historico) {
      if (!historico || !Array.isArray(historico)) {
          return false;
      }
      console.log('Verificando histórico:', historico);
      return historico.some(evento => evento.codigo_ssw === '80');
  },

  normalizeStatus: (status) => {
      if (!status) return 'pendente';
      if (status.includes('Entregue - Confirmado')) return 'entregue-confirmado';
      if (status.includes('Entregue - Conferir')) return 'entregue-conferir';
      if (status.includes('Fora do Prazo')) return 'atrasado';
      return 'transito';
  },

  content: function(name, options) {
        if (this._sections && this._sections[name]) {
            return this._sections[name];
        }
        return null;
  },

  formatDateYMD: function(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      
      // Usa o fuso horário local para evitar problemas de um dia a menos
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      
      return `${year}-${month}-${day}`;
  },

  isRissoOrJew: function(transportadora) {
      if (typeof transportadora !== 'string') {
          return false;
      }
      const upperTransportadora = transportadora.toUpperCase();
      return upperTransportadora.includes('RISSO') || upperTransportadora.includes('JEW');
  },

  /**
   * Adiciona 1 a um número (útil para índices de arrays que começam em 0).
   */
  addOne: function(index) {
      return index + 1;
  },

  toLowerCase: function(str) {
    if (typeof str === 'string') {
      return str.toLowerCase();
    }
    return '';
  },

  isNotStock: (descricao) => {
        const stockTypes = ['PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE'];
        return !stockTypes.includes(String(descricao).toUpperCase());
  },

  isNotResolved: function (situacao) {
      return situacao !== 'Email - Resolvido';
  },

  canEdit: (situacao) => {
        return situacao !== 'Resolvida';
  },

  isStock: (descricao) => {
        const stockTypes = ['PEÇA PARA REPOR VOLUME', 'PEÇA PARA ESTOQUE'];
        return stockTypes.includes(String(descricao).toUpperCase());
  },

  eqf: function(a, b) {
    // [ADIÇÃO PARA DEBUG] - Mostra os valores e seus tipos no console do servidor
    console.log(`--- Debug Helper 'eqf' ---`);
    console.log(`Valor A: ${a}, Tipo: ${typeof a}`);
    console.log(`Valor B: ${b}, Tipo: ${typeof b}`);
    
    // Mantém a lógica de comparação original
    const resultado = Number(a) === Number(b);
    
    // [ADIÇÃO PARA DEBUG] - Mostra o resultado da comparação
    console.log(`Resultado da Comparação (Number(a) === Number(b)): ${resultado}`);
    console.log(`--------------------------`);

    return resultado;
  },

  numberArray: function(n) {
    const arr = [];
    for (let i = 1; i <= n; i++) {
        arr.push(i);
    }
    return arr;
  }
  
};