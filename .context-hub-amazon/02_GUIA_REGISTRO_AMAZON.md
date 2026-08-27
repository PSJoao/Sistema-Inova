# 🔧 Guia: Registrar Aplicação na Amazon SP-API (Passo a Passo)

Este guia te leva do zero até ter a aplicação Amazon registrada, com todas as credenciais necessárias para o Hub funcionar.

---

## Pré-Requisitos

Antes de começar, confirme que você tem:
- ✅ Uma **conta de vendedor ativa** na Amazon Brasil (Seller Central)
- ✅ Acesso à **AWS** (conta Amazon Web Services) — se não tiver, vai criar durante o processo

---

## ETAPA 1: Criar Conta de Desenvolvedor na Amazon

1. Acesse **https://developer.amazonservices.com.br/** (ou https://developer.amazonservices.com para global)
2. Faça login com **a mesma conta que você usa no Seller Central**
3. Se for a primeira vez, será pedido para preencher o **Developer Profile**

### Preenchimento do Developer Profile:
| Campo | O que preencher |
|---|---|
| **Organization Name** | Nome da sua empresa (ex: "Inova Xpress") |
| **Primary Contact** | Seu nome e email |
| **Data Access** | Marque que é para uso próprio ("I want to integrate Amazon's APIs into my own systems") |
| **Use Case Description** | "Order management hub for tracking and monitoring seller orders across multiple Amazon accounts. The application retrieves order data, order items, and shipping status to provide a centralized order management dashboard." |

**Nota:** Escolha **Private** se o hub será apenas para clientes seus (que você controla). Escolha **Public** se qualquer vendedor Amazon poderá se conectar. Para começar, **Private** é mais rápido de aprovar.

---

## ETAPA 2: Registrar o IAM User na AWS (Obrigatório)

A Amazon exige que você tenha um **IAM ARN** (Amazon Resource Name) da AWS para assinar as chamadas à API, embora para a maioria dos endpoints (como Orders API) baste usar o **LWA Access Token** na autenticação.

### Criar o IAM User na AWS:
1. Acesse **https://console.aws.amazon.com/iam/**
2. Login com sua conta AWS (se não tiver, crie uma em https://aws.amazon.com — é grátis para o nível básico)
3. No menu lateral, clique em **Users** → **Create User**
4. **Nome do usuário**: `sp-api-hub-inova`
5. **Não marque** "Provide user access to the AWS Management Console"
6. Clique **Next**
7. Em **Set permissions**, escolha **"Attach policies directly"**
8. Procure e marque a policy: **`AmazonSellingPartnerAPIAccess`** (se não aparecer, crie uma policy inline vazia por enquanto).
9. Clique **Create user**
10. Anote o **ARN** do usuário criado. Ele será algo como:
    ```
    arn:aws:iam::123456789012::user/sp-api-hub-inova
    ```

---

## ETAPA 3: Registrar a Aplicação no Seller Central

1. Acesse **https://sellercentral.amazon.com.br/** e faça login
2. Vá em **Aplicativos** (Apps) → **Desenvolver aplicativos** (Develop Apps)
   - Caminho alternativo: Menu **⚙️ Configurações** → **Credenciais de desenvolvedor** ou acesse direto: **https://sellercentral.amazon.com.br/sellingpartner/developerconsole**
3. Clique em **"Adicionar novo aplicativo"** (ou "Add new app client")

### Preenchimento do formulário de registro:
| Campo | O que preencher |
|---|---|
| **App name** | `Hub Inova Amazon` (ou nome que preferir) |
| **API Type** | `SP API` |
| **IAM ARN** | Cole o ARN do IAM User criado na Etapa 2 |

4. Clique em **Save and Exit** ou **Registrar**

---

## ETAPA 4: Configurar as Credenciais LWA (Login With Amazon)

Após criar a app, você será redirecionado ou poderá acessar os detalhes da aplicação:

1. Na página da sua aplicação registrada, você verá:
   - **LWA Client ID** → Este é o `AMZ_CLIENT_ID` do seu `.env` ✅
   - **LWA Client Secret** → Este é o `AMZ_CLIENT_SECRET` do seu `.env` ✅

2. **Configurar o OAuth Redirect URI**:
   - Procure a seção **"OAuth Login Configuration"** ou **"Allowed Return URLs"**
   - Adicione a URL de callback do seu hub:
     ```
     https://inovaxpress.org/hub/auth/amazon/callback
     ```

3. **Atualize o `.env`** com as credenciais reais:
   ```env
   AMZ_CLIENT_ID=amzn1.application-oa2-client.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   AMZ_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

---

## ETAPA 5: Configurar as Permissões da API (Roles)

Na página da sua aplicação no Seller Central:

1. Procure a seção **"App roles"** ou **"API Permissions"**
2. Solicite/ative os seguintes roles:
   - ✅ **Direct to Consumer Shipping (Shipping)**
   - ✅ **Amazon Fulfillment**
   - ✅ **Orders** (Muitas vezes já embutido no role básico)

---

## ETAPA 6: Testar o Fluxo Completo

Após configurar tudo:

### 1. Teste do OAuth:
Acesse no navegador:
```
https://inovaxpress.org/hub/auth/amazon?cliente_id=1
```

### 2. Após a autorização:
O vendedor será redirecionado de volta para o hub e o controller salvará os tokens na tabela `hub_amazon_contas`.

### 3. Verificar no banco:
```sql
SELECT * FROM hub_amazon_contas;
```

---

## ETAPA 7: Após Aprovação — Próximos Passos

1. ✅ Atualize o `.env`
2. ✅ Me avise que está tudo pronto para eu implementar o código
3. ✅ Execute os comandos SQL
4. ✅ Teste a captura de pedidos!
