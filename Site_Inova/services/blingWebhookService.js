const { poolMonitora } = require('../config/db'); // Ajuste o caminho para seu arquivo de conexão com o PG

// Função principal que roteia o evento
const processWebhook = async (payload) => {
    console.log(`[Bling Webhook] Recebido evento: ${payload.tipo} - ${payload.evento}`);

    const { tipo, data } = payload;

    if (!data) {
        console.warn('[Bling Webhook] Payload sem campo "data".');
        return;
    }

    try {
        switch (tipo) {
            case 'produto':
                await upsertProduto(data);
                break;
            case 'pedido.venda':
                await upsertPedidoVenda(data);
                break;
            case 'notafiscal':
                await upsertNfe(data);
                break;
            default:
                console.log(`[Bling Webhook] Tipo de payload não tratado: ${tipo}`);
        }
    } catch (err) {
        console.error(`[Bling Webhook] Erro ao processar ${tipo}:`, err.message);
    }
};

// --- FUNÇÕES DE UPSERT PARA CADA TABELA ---

async function upsertProduto(produto) {
    // IMPORTANTE: Defina a conta do Bling que está sendo usada.
    // Você pode ter isso em variáveis de ambiente (process.env.BLING_ACCOUNT)
    const blingAccount = 'sua-conta'; // Substitua por sua lógica

    // 1. Lógica de UPSERT para cached_products
    const productQuery = `
        INSERT INTO cached_products
        (bling_id, bling_account, sku, nome, preco_custo, peso_bruto, volumes, last_updated_at, tipo_ml)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
        ON CONFLICT (bling_id, bling_account) DO UPDATE SET
            sku = EXCLUDED.sku,
            nome = EXCLUDED.nome,
            preco_custo = EXCLUDED.preco_custo,
            peso_bruto = EXCLUDED.peso_bruto,
            volumes = EXCLUDED.volumes,
            last_updated_at = NOW(),
            tipo_ml = EXCLUDED.tipo_ml
    `;
    const productValues = [
        produto.id,
        blingAccount,
        produto.codigo, // sku
        produto.nome,
        produto.precoCusto,
        produto.pesoBruto,
        produto.volumes,
        null // tipo_ml (ajuste se você tiver essa info)
    ];
    await poolMonitora.query(productQuery, productValues);

    // 2. Lógica de UPSERT para cached_structures (ESSENCIAL)
    // Se o produto for do tipo "Composto" (E), atualizamos a estrutura
    if (produto.tipo === 'E' && produto.estrutura && produto.estrutura.componentes) {
        const client = await poolMonitora.connect();
        try {
            await client.query('BEGIN');
            
            // 2.1. Limpa a estrutura antiga deste produto
            const deleteQuery = 'DELETE FROM cached_structures WHERE parent_product_bling_id = $1 AND parent_product_bling_account = $2';
            await client.query(deleteQuery, [produto.id, blingAccount]);

            // 2.2. Insere a nova estrutura
            const insertStructureQuery = `
                INSERT INTO cached_structures
                (parent_product_bling_id, parent_product_bling_account, component_sku, structure_name, gtin, gtin_embalagem)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            
            for (const comp of produto.estrutura.componentes) {
                // Assumindo que 'comp.produto.codigo' é o SKU do componente
                await client.query(insertStructureQuery, [
                    produto.id,
                    blingAccount,
                    comp.produto.codigo, // component_sku
                    comp.nome,           // structure_name
                    comp.produto.gtin,   // gtin
                    comp.produto.gtinEmbalagem // gtin_embalagem
                    // 'component_location' não parece vir no payload, você talvez precise buscar isso depois
                ]);
            }
            
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}

async function upsertPedidoVenda(pedido) {
    const blingAccount = 'sua-conta'; // Substitua

    const query = `
        INSERT INTO cached_pedido_venda
        (bling_id, bling_account, numero, numero_loja, data_pedido, total_produtos, total_pedido, contato_id, contato_nome, situacao_id, loja_id, notafiscal_id, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (bling_id, bling_account) DO UPDATE SET
            numero = EXCLUDED.numero,
            numero_loja = EXCLUDED.numero_loja,
            data_pedido = EXCLUDED.data_pedido,
            total_produtos = EXCLUDED.total_produtos,
            total_pedido = EXCLUDED.total_pedido,
            contato_id = EXCLUDED.contato_id,
            contato_nome = EXCLUDED.contato_nome,
            situacao_id = EXCLUDED.situacao_id,
            loja_id = EXCLUDED.loja_id,
            notafiscal_id = EXCLUDED.notafiscal_id,
            updated_at = NOW()
    `;
    
    // Mapeamento cuidadoso dos campos
    const values = [
        pedido.id,
        blingAccount,
        pedido.numero,
        pedido.numeroLoja,
        pedido.data, // data_pedido
        pedido.totalProdutos,
        pedido.total, // total_pedido
        pedido.contato.id,
        pedido.contato.nome,
        pedido.situacao.id, // situacao_id
        pedido.loja.id,
        pedido.notaFiscal ? pedido.notaFiscal.id : null // notafiscal_id
        // Adicione outros campos conforme sua necessidade
    ];
    await poolMonitora.query(query, values);
}

async function upsertNfe(nfe) {
    const blingAccount = 'sua-conta'; // Substitua

    const query = `
        INSERT INTO cached_nfe
        (bling_id, bling_account, nfe_numero, chave_acesso, transportador_nome, total_volumes, data_emissao, situacao, last_updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (bling_id, bling_account) DO UPDATE SET
            nfe_numero = EXCLUDED.nfe_numero,
            chave_acesso = EXCLUDED.chave_acesso,
            transportador_nome = EXCLUDED.transportador_nome,
            total_volumes = EXCLUDED.total_volumes,
            data_emissao = EXCLUDED.data_emissao,
            situacao = EXCLUDED.situacao,
            last_updated_at = NOW()
    `;
    
    const values = [
        nfe.id,
        blingAccount,
        nfe.numero,
        nfe.chaveAcesso,
        nfe.transportador.nome, // transportador_nome
        nfe.transporte.volumes, // total_volumes
        nfe.dataEmissao,
        nfe.situacao.id // situacao
        // Adicione os campos de etiqueta (etiqueta_nome, etc.) se eles vierem no payload
        // Se não vierem, eles terão que ser preenchidos por outra automação
    ];
    await poolMonitora.query(query, values);
}


module.exports = {
    processWebhook
};