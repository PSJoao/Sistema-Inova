# 🔄 Contexto Completo — Hub Amazon SP-API (Pedidos)
# Data: 2026-08-27

---

## 📌 RESUMO EXECUTIVO

Estamos implementando a integração completa da **Amazon Selling Partner API (SP-API)** para **pedidos** no Hub do Sistema Inova. O hub já possui uma integração robusta e funcional com o Mercado Livre, e agora estamos replicando todas as funcionalidades de pedidos para a Amazon, mantendo a mesma arquitetura e padrões.

**Status atual**: Planejamento completo finalizado, guia de registro da app Amazon entregue. Aguardando registro da app na Amazon + aprovação do plano para iniciar implementação do código.

---

## 🏗️ ARQUITETURA DO SISTEMA

### Localização do Projeto
```
c:\Users\lucca\Documents\Trabalho Inova\Sistema\Sistema-Inova\
├── index.js                    # Index principal (NÃO tem crons do hub ML)
├── uploads/
│   └── index.js                # Index secundário (TEM os crons do hub ML - linhas 216-267)
├── hub/
│   ├── config/
│   │   └── database.js         # Pool PostgreSQL (poolHub = banco 'meli_hub', poolProdutos)
│   ├── middleware/
│   │   └── auth.js             # JWT middleware (verifyHubToken)
│   ├── controllers/
│   │   ├── hubApiController.js         # 1021 linhas - Endpoints REST do hub
│   │   ├── hubOAuthController.js       # OAuth do Mercado Livre
│   │   ├── hubAmazonOAuthController.js # OAuth da Amazon (JÁ EXISTE ✅)
│   │   └── hubWebhookController.js     # Webhook do ML
│   ├── services/
│   │   ├── hubMercadoLivreService.js   # 3139 linhas - CORAÇÃO do hub ML
│   │   ├── hubAmazonTokenService.js    # Token LWA da Amazon (JÁ EXISTE ✅)
│   │   ├── hubTokenService.js          # Token do ML
│   │   └── hubProdutosService.js       # Produtos/Anúncios ML
│   └── routes/
│       └── hubRoutes.js                # Todas as rotas do hub (60 linhas)
└── services/
    └── HubPedidosService.js    # Consome API do hub para expedição local
```

### Banco de Dados
- **Engine**: PostgreSQL
- **Database**: `meli_hub` (acessado via `poolHub`)
- **Tabelas existentes relevantes**:
  - `hub_clientes` — Clientes do hub (login, email, senha_hash)
  - `hub_ml_contas` — Contas ML vinculadas a clientes (seller_id, access_token, refresh_token, etc.)
  - `hub_amazon_contas` — Contas Amazon vinculadas (JÁ EXISTE ✅)
  - `pedidos_mercado_livre` — Pedidos ML (modelo a replicar para Amazon)

### Tabela `hub_amazon_contas` (já existe)
Colunas confirmadas: `id`, `cliente_id`, `seller_id` (VARCHAR 100), `nickname`, `lwa_access_token`, `lwa_refresh_token`, `token_expiration`, `region`, `marketplace_id`, `ativo`, `last_update`

---

## 🟢 O QUE JÁ EXISTE PARA AMAZON

### 1. hubAmazonTokenService.js (90 linhas)
- Localização: `hub/services/hubAmazonTokenService.js`
- Funcionalidade: Renovação de tokens LWA (Login With Amazon)
- Usa mesma estratégia de lock/concorrência do ML (Map de promessas)
- Endpoint de renovação: `https://api.amazon.com/auth/o2/token`
- Margem de 5 min antes da expiração (token Amazon dura 1h)
- Credenciais via env: `AMZ_CLIENT_ID`, `AMZ_CLIENT_SECRET`

### 2. hubAmazonOAuthController.js (87 linhas)
- Localização: `hub/controllers/hubAmazonOAuthController.js`
- Funcionalidade: Fluxo OAuth completo (iniciar auth + callback)
- Redirect URI: `https://inovaxpress.org/hub/auth/amazon/callback`
- Recebe: `spapi_oauth_code`, `state` (cliente_id), `selling_partner_id`
- Salva na tabela `hub_amazon_contas` com UPSERT por `seller_id`

### 3. Rotas OAuth (em hubRoutes.js)
- `GET /auth/amazon` → `hubAmazonOAuthController.iniciarAuth`
- `GET /auth/amazon/callback` → `hubAmazonOAuthController.processarCallback`

### 4. Variáveis de Ambiente (.env)
- `AMZ_CLIENT_ID` — JÁ EXISTE ✅
- `AMZ_CLIENT_SECRET` — JÁ EXISTE ✅

---

## 🔴 O QUE FALTA IMPLEMENTAR

### 1. Registro da Aplicação na Amazon
**Status**: Guia passo-a-passo foi criado (`02_GUIA_REGISTRO_AMAZON.md`)
- Criar Developer Profile
- Criar IAM User na AWS (para obter ARN)
- Registrar app no Seller Central
- Configurar LWA credentials e redirect URI
- Solicitar permissões (Orders API)

### 2. Tabela `pedidos_amazon` (SQL)
Precisa ser criada pelo usuário no banco `meli_hub`. Schema definido no plano.

### 3. hubAmazonService.js (NOVO ARQUIVO - Principal)
Service completo espelhando `hubMercadoLivreService.js` com:
- `capturarNovosPedidos()` — Cron: percorre contas, busca via getOrders + getOrderItems
- `monitorarPedidosExistentes()` — Cron: recaptura dados de pedidos não-finais
- `capturarNovosPedidosCliente()` — On-Demand via HTTP
- `monitorarPedidosExistentesCliente()` — On-Demand via HTTP
- `resolverContasCliente()` — Helper multi-tenancy
- `verificarSePedidoExiste()` — Idempotência
- `salvarPedidoNoBanco()` — UPSERT com ON CONFLICT
- `processarConta()` — Processar conta individual

### 4. Endpoints no hubApiController.js
- `getPedidosAmazon` — Listar pedidos Amazon do cliente
- `sincronizarNovosPedidosAmazon` — Trigger on-demand
- `sincronizarPedidosExistentesAmazon` — Trigger on-demand
- `getPedidoAmazonPorId` — Busca por amazon_order_id

### 5. Rotas no hubRoutes.js
```
GET  /api/amazon/pedidos
GET  /api/amazon/pedidos/:amazon_order_id
POST /api/amazon/pedidos/sincronizar/novos
POST /api/amazon/pedidos/sincronizar/existentes
```

### 6. Cron Jobs (em AMBOS os index.js)
- `index.js` (raiz) — Adicionar crons Amazon
- `uploads/index.js` — Adicionar crons Amazon
- Padrão: mesmo formato dos crons ML (com lock flag `isRunning`)

---

## 📊 CONHECIMENTO TÉCNICO DA AMAZON SP-API

### Endpoints Principais (Orders API v0)
| Endpoint | Método | URL | Rate | Burst |
|---|---|---|---|---|
| getOrders | GET | `/orders/v0/orders` | 0.0167/s | 20 |
| getOrder | GET | `/orders/v0/orders/{orderId}` | 0.0167/s | 20 |
| getOrderItems | GET | `/orders/v0/orders/{orderId}/orderItems` | 1.0/s | 1 |

### Configuração Brasil
- **Base URL**: `https://sellingpartnerapi-na.amazon.com`
- **Marketplace ID Brasil**: `A2Q3Y263D00KWC`
- **AWS Region**: `us-east-1`

### Headers Obrigatórios
```
x-amz-access-token: <LWA Access Token>
Content-Type: application/json
```

### Status de Pedido Amazon
`Pending`, `Unshipped`, `PartiallyShipped`, `Shipped`, `Canceled`, `Unfulfillable`, `PendingAvailability`

### Fulfillment Channels
- `AFN` — Fulfilled by Amazon (FBA)
- `MFN` — Fulfilled by Merchant (vendedor)

### Rate Limits — Estratégia
- getOrders: 0.0167 req/s = ~1 req a cada 60s, MAS burst de 20 (pode disparar 20 seguidos)
- getOrderItems: 1 req/s com burst de 1 (deve ser serializado)
- Estratégia: processar em chunks de 20 (aproveitando burst), com delays estratégicos

### Paginação
- getOrders usa `NextToken` (não offset/limit como ML)
- getOrderItems também usa `NextToken` para pedidos com muitos itens

### Autenticação
- NÃO precisa mais de AWS SigV4 (descontinuado para maioria dos endpoints)
- Basta o LWA Access Token no header `x-amz-access-token`
- O `hubAmazonTokenService.js` já gerencia renovação automática

---

## 🔄 CRON JOBS DO ML (REFERÊNCIA PARA REPLICAR)

### Em `uploads/index.js`:
```javascript
// Linha 216 - Devoluções diário às 18h
cron.schedule('0 18 * * *', async () => { hubMlService.monitorarDevolucoes() });

// Linha 241 - Hub principal a cada 1 minuto
cron.schedule('*/1 * * * *', async () => {
    hubMlService.capturarNovosPedidos();
    hubMlService.monitorarPedidosDiferentes();
    hubMlService.monitorarPedidosExistentes();
});

// Linha 296 - Produtos diário às 6h
cron.schedule('0 6 * * *', async () => { hubProdutosService.sincronizarAnuncios() });

// Linha 556 - HubPedidosService a cada 10 min
cron.schedule('*/10 * * * *', async () => { HubPedidosService.monitorarPadrao() });

// Linha 564 - HubPedidosService diário 12h
cron.schedule('0 12 * * *', async () => { HubPedidosService.monitorarAprofundado() });
```

### Em `index.js` (raiz):
```javascript
// Linha 539 - HubPedidosService a cada 1 min
cron.schedule('* * * * *', async () => { HubPedidosService.monitorarPadrao() });

// Linha 547 - HubPedidosService diário 12h
cron.schedule('0 12 * * *', async () => { HubPedidosService.monitorarAprofundado() });
```

### Decisão para Amazon:
- Crons Amazon terão intervalo MAIOR que ML (devido rate limits mais restritivos)
- Sugestão: captura a cada 5-10 min (não 1 min como ML)
- Usarão o mesmo padrão de lock (`isHubAmazonSyncRunning`)

---

## 📋 DECISÕES TOMADAS

1. **Usar Orders API v0** (não v2026-01-01) — mais documentada e estável
2. **Tabela separada `pedidos_amazon`** — não misturar com `pedidos_mercado_livre`
3. **Mesmo padrão de UPSERT** com ON CONFLICT por `amazon_order_id`
4. **Processamento em chunks de 20** — aproveitando burst capacity
5. **Itens do pedido em JSONB** — mesmo padrão do ML (`itens_pedido`)
6. **Endereço de envio em JSONB** — flexibilidade para diferentes estruturas
7. **SEM devoluções/mediações por enquanto** — Amazon tem sistema diferente (Claims/Returns)
8. **SEM etiquetas ZPL** — Amazon gerencia envio de forma diferente (FBA/MFN)
9. **Crons em AMBOS index.js** — raiz e uploads (mesmo padrão do ML)
10. **Namespace de rotas `/api/amazon/`** — separado das rotas ML existentes

---

## 📁 ARQUIVOS A CRIAR/MODIFICAR

| Ação | Arquivo | Status |
|---|---|---|
| **CRIAR** | `hub/services/hubAmazonService.js` | ⏳ Pendente |
| **MODIFICAR** | `hub/controllers/hubApiController.js` | ⏳ Pendente |
| **MODIFICAR** | `hub/routes/hubRoutes.js` | ⏳ Pendente |
| **MODIFICAR** | `hub/services/hubAmazonTokenService.js` | ⏳ Ajuste minor pendente |
| **MODIFICAR** | `index.js` (raiz) | ⏳ Adicionar crons Amazon |
| **MODIFICAR** | `uploads/index.js` | ⏳ Adicionar crons Amazon |
| **SQL** | Tabela `pedidos_amazon` | ⏳ Usuário executa manualmente |

---

## ⏭️ PRÓXIMOS PASSOS

1. **Usuário**: Registrar app na Amazon (seguir guia `02_GUIA_REGISTRO_AMAZON.md`)
2. **Usuário**: Atualizar `.env` com credenciais reais
3. **Usuário**: Aprovar o plano de implementação
4. **Dev (IA)**: Implementar `hubAmazonService.js`
5. **Dev (IA)**: Modificar `hubApiController.js` (novos endpoints)
6. **Dev (IA)**: Modificar `hubRoutes.js` (novas rotas)
7. **Dev (IA)**: Ajustar `hubAmazonTokenService.js`
8. **Dev (IA)**: Adicionar crons nos dois `index.js`
9. **Usuário**: Executar SQL para criar tabela `pedidos_amazon`
10. **Usuário**: Conectar primeira conta Amazon via OAuth
11. **Teste**: Captura de pedidos e monitoramento
