const anuncio = {
  preco: '699.00',
  preco_promocional: '376.00',
  tarifa: '10.50',
  imposto: '6.00',
  custo_produto: '216.91',
  frete: '107.05',
  promocoes_json: [
    { id: 'P-MLB17755008', status: 'candidate', price: 339 },
    { id: 'C-MLB4800468', name: 'Mobi A', type: 'SELLER_CAMPAIGN', price: 402, status: 'started', original_price: 699 },
    { id: 'P-MLB17919004', name: 'NOVA 8.8 - VENDA Casa', type: 'SMART', price: 376, status: 'started', original_price: 699, meli_percentage: 5.4 }
  ]
};

function calculateAnuncioMarginFixed(anuncio) {
    const custo = Number(anuncio.custo_produto) || 0;
    if (custo <= 0) return null;

    let promos = [];
    if (anuncio.promocoes_json) {
        try {
            promos = typeof anuncio.promocoes_json === 'string' ? JSON.parse(anuncio.promocoes_json) : anuncio.promocoes_json;
        } catch (e) { promos = []; }
    }
    promos = Array.isArray(promos) ? promos : [];

    const activePromos = promos.filter(p => p && (p.status === 'started' || p.status === 'active') && p.price != null && Number(p.price) > 0);
    activePromos.sort((a, b) => Number(a.price) - Number(b.price));
    const activePromo = activePromos[0] || null;

    console.log('Selected activePromo:', activePromo);

    const precoOriginal = Number(anuncio.preco) || 0;
    let venda = 0;
    let meliPct = 0;

    if (activePromo) {
        venda = Number(activePromo.price);
        meliPct = activePromo.meli_percentage != null ? Number(activePromo.meli_percentage) : 0;
    } else if (anuncio.preco_promocional != null && Number(anuncio.preco_promocional) > 0) {
        venda = Number(anuncio.preco_promocional);
    } else {
        venda = precoOriginal;
    }

    if (venda <= 0) return null;

    const impostoPct = Number(anuncio.imposto) || 0;
    const tarifaBasePct = Number(anuncio.tarifa) || 0;
    const freteVal = Number(anuncio.frete) || 0;

    const reembolsoVal = Number(((meliPct / 100.0) * precoOriginal).toFixed(2));
    const comissaoReais = venda * (tarifaBasePct / 100.0);
    const comissaoEfetiva = comissaoReais - reembolsoVal;
    const impostoReais = venda * (impostoPct / 100.0);

    const despesas = custo + freteVal + comissaoEfetiva + impostoReais;
    const lucro = venda - despesas;
    return (lucro / venda) * 100.0;
}

console.log('Fixed margin:', calculateAnuncioMarginFixed(anuncio).toFixed(2) + '%');
