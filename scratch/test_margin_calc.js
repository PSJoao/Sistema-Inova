const row = {
  preco: '699.00',
  preco_promocional: '376.00',
  tarifa: '10.50',
  imposto: '6.00',
  custo_produto: '216.91',
  frete: '107.05',
  promocoes_json: [
    { id: 'P-MLB17755008', status: 'candidate' },
    { id: 'C-MLB4800468', name: 'Mobi A', type: 'SELLER_CAMPAIGN', price: 402, status: 'started', original_price: 699 },
    { id: 'P-MLB17919004', name: 'NOVA 8.8 - VENDA Casa', type: 'SMART', price: 376, status: 'started', original_price: 699, meli_percentage: 5.4 }
  ]
};

function calcularMargemLucro(anuncio) {
    const custo = Number(anuncio.custo_produto) || 0;
    const precoOriginal = Number(anuncio.preco) || 0;
    let venda = 0;
    let meliPct = 0;

    let promos = anuncio.promocoes_json || [];
    const activePromo = promos.find(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
    
    console.log('activePromo:', activePromo);

    if (activePromo) {
        venda = Number(activePromo.price);
        meliPct = activePromo.meli_percentage != null ? Number(activePromo.meli_percentage) : 0;
    } else if (anuncio.preco_promocional != null && Number(anuncio.preco_promocional) > 0) {
        venda = Number(anuncio.preco_promocional);
    } else {
        venda = precoOriginal;
    }

    const impostoPct = Number(anuncio.imposto) || 0;
    const tarifaBasePct = Number(anuncio.tarifa) || 0;
    const freteVal = Number(anuncio.frete) || 0;

    const reembolsoVal = Number(((meliPct / 100.0) * precoOriginal).toFixed(2));
    const comissaoReais = venda * (tarifaBasePct / 100.0);
    const comissaoEfetiva = comissaoReais - reembolsoVal;
    const impostoReais = venda * (impostoPct / 100.0);

    const despesas = custo + freteVal + comissaoEfetiva + impostoReais;
    const lucro = venda - despesas;
    const margem = (lucro / venda) * 100.0;

    console.log({
        venda,
        precoOriginal,
        custo,
        impostoPct,
        impostoReais,
        tarifaBasePct,
        comissaoReais,
        meliPct,
        reembolsoVal,
        comissaoEfetiva,
        freteVal,
        despesas,
        lucro,
        margem: margem.toFixed(2) + '%'
    });

    return margem;
}

// Case 1: with first started promo (price 402)
console.log('--- TEST 1 ---');
calcularMargemLucro(row);

// Case 2: with 376 promo (NOVA 8.8 - VENDA Casa, meliPct 5.4)
console.log('--- TEST 2 (if activePromo was price 376) ---');
const row2 = JSON.parse(JSON.stringify(row));
row2.promocoes_json = [row.promocoes_json[2]];
calcularMargemLucro(row2);

// Case 3: without promos (venda = 376)
console.log('--- TEST 3 (venda = 376 without promos) ---');
const row3 = JSON.parse(JSON.stringify(row));
row3.promocoes_json = [];
calcularMargemLucro(row3);
