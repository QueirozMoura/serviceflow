<div align="center">

# ServiceFlow

**Gestão de ordens de serviço, orçamentos, pagamentos e garantias para pequenas assistências técnicas.**

SaaS multi-organização com autenticação por sessão segura, controle de acesso por papel e integridade financeira testada contra concorrência.

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)

[Sobre](#sobre-o-projeto) · [Funcionalidades](#funcionalidades) · [Arquitetura](#arquitetura-e-stack) · [Instalação](#instalação-local) · [Testes](#testes) · [Segurança](#autenticação-permissões-e-multi-tenancy) · [Limitações](#limitações-conhecidas)

</div>

---

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Funcionalidades](#funcionalidades)
  - [Ciclo de vida da ordem de serviço](#ciclo-de-vida-da-ordem-de-serviço)
  - [Integridade financeira](#integridade-financeira)
- [Arquitetura e stack](#arquitetura-e-stack)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Pré-requisitos](#pré-requisitos)
- [Instalação local](#instalação-local)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados e migrations](#banco-de-dados-e-migrations)
- [Executando o projeto](#executando-o-projeto)
- [Scripts disponíveis](#scripts-disponíveis)
- [Testes](#testes)
- [Autenticação, permissões e multi-tenancy](#autenticação-permissões-e-multi-tenancy)
- [Visão geral da API](#visão-geral-da-api)
- [Implantação](#implantação)
- [Limitações conhecidas](#limitações-conhecidas)
- [Próximos passos](#próximos-passos)
- [Repositório e autoria](#repositório-e-autoria)

---

## Sobre o projeto

Pequenas assistências técnicas costumam controlar clientes, aparelhos, orçamentos e pagamentos em cadernos, planilhas e mensagens soltas. O resultado é retrabalho, orçamentos perdidos, cobranças inconsistentes e nenhuma visão clara do que está em andamento.

O **ServiceFlow** reúne esse fluxo em um único sistema: do recebimento do equipamento ao pagamento e à garantia, com histórico de cada ordem de serviço e permissões diferentes para o dono, os administradores e os técnicos. Cada empresa (organização) enxerga apenas os próprios dados.

O projeto é composto por duas aplicações independentes neste repositório:

| Aplicação | Pasta | Descrição |
| --- | --- | --- |
| API | [`backend/`](backend) | Fastify + TypeScript + Prisma + PostgreSQL |
| Interface web | [`frontend/`](frontend) | React + TypeScript + Vite (SPA) |

> **Status:** projeto em desenvolvimento ativo. Não há licença definida no repositório e, por enquanto, nenhuma captura de tela versionada.

## Funcionalidades

Tudo o que está listado abaixo está implementado no código e, com exceção da página de demonstração, é coberto por testes automatizados.

| Área | O que o sistema faz |
| --- | --- |
| **Acesso** | Login por e-mail e senha, login com Google (OAuth 2.0), sessão por cookie HttpOnly, logout, edição do próprio perfil, cadastro público de uma nova empresa (cria a organização e o proprietário) e **recuperação de senha por e-mail** (exige um provedor de e-mail configurado). |
| **Equipe** | O proprietário convida administradores e técnicos por link (gerado no aplicativo, sem envio de e-mail), consulta membros e convites pendentes e revoga convites. |
| **Clientes e equipamentos** | CRUD com busca, filtros e paginação no servidor. Equipamentos pertencem a um cliente. |
| **Ordens de serviço** | Abertura vinculada a cliente e equipamento, número legível no formato `OS-AAAAMMDD-XXXXXXXX`, valores estimado e final, máquina de estados com histórico (quem mudou, de qual para qual status e quando). |
| **Diagnóstico** | Um diagnóstico por ordem, com custo estimado. |
| **Orçamentos** | Um orçamento por ordem, com itens (peças e serviços), quantidades com 3 casas decimais, total recalculado no banco e decisão (aprovar, rejeitar ou expirar). |
| **Pagamentos** | Pagamentos parciais por PIX, dinheiro, cartão, transferência ou outro, com status (pendente, pago, falhou, cancelado, estornado), saldo devido e idempotência. |
| **Garantias** | Uma garantia por ordem entregue, com período, descrição e status. A expiração é calculada na leitura. |
| **Comunicação** | Gera textos prontos (recebimento, diagnóstico, orçamento, andamento, entrega, garantia) para WhatsApp ou e-mail e registra o histórico como **rascunho**. O sistema **não envia** mensagens. |
| **Painel** | Indicadores operacionais (ordens por status, orçamentos, pagamentos, garantias) e listagens agregadas de orçamentos, pagamentos e garantias, com paginação e filtros. |
| **Demonstração** | Página pública inicial (`/`) que apresenta o produto com dados fictícios embutidos no frontend (não lê dados reais). |

### Ciclo de vida da ordem de serviço

```mermaid
stateDiagram-v2
    [*] --> RECEIVED
    RECEIVED --> WAITING_DIAGNOSIS
    WAITING_DIAGNOSIS --> WAITING_APPROVAL
    WAITING_APPROVAL --> APPROVED
    APPROVED --> IN_PROGRESS
    IN_PROGRESS --> READY
    READY --> DELIVERED
    DELIVERED --> [*]
    RECEIVED --> CANCELLED
    WAITING_DIAGNOSIS --> CANCELLED
    WAITING_APPROVAL --> CANCELLED
    APPROVED --> CANCELLED
    IN_PROGRESS --> CANCELLED
    READY --> CANCELLED
    CANCELLED --> [*]
```

Regras aplicadas dentro de transações, com a linha da ordem travada no PostgreSQL:

- Duas mudanças de status simultâneas se serializam: a segunda enxerga o resultado da primeira.
- **Aprovar** a ordem exige orçamento aprovado quando existe orçamento. Aprovar o orçamento de uma ordem em `WAITING_APPROVAL` a leva para `APPROVED` na mesma transação.
- **Entregar** exige que não haja pagamentos pendentes e, quando existe valor devido, que ele esteja totalmente quitado (ordem sem valor devido e sem pagamentos pode ser entregue).
- **Cancelar** não é possível com pagamento confirmado (`PAID`): o pagamento precisa ser estornado antes.
- `DELIVERED` e `CANCELLED` são estados terminais. Neles ficam bloqueadas as alterações da ordem, do diagnóstico, do orçamento e dos pagamentos. Continuam permitidos a leitura, a garantia, os rascunhos de mensagem e as transições de pagamento que apenas liberam saldo (falha, cancelamento e estorno).

### Integridade financeira

- Valores monetários usam `Decimal` (`NUMERIC` no PostgreSQL e `Prisma.Decimal` no código), nunca ponto flutuante.
- **Valor devido:** o valor final da ordem, quando maior que zero; senão, o total do orçamento **aprovado**. Sem nenhum dos dois, o pagamento é recusado. O valor estimado nunca substitui o final.
- **Saldo:** pagamentos `PENDING` e `PAID` reservam saldo; `FAILED`, `CANCELLED` e `REFUNDED` o liberam. Um pagamento acima do saldo é recusado, mesmo com requisições simultâneas.
- **Idempotência:** `POST /api/service-orders/:id/payments` exige o cabeçalho `Idempotency-Key`. Repetir a mesma operação devolve o pagamento original; reutilizar a chave com dados diferentes resulta em `409`. A unicidade é garantida por índice único no banco, por organização.
- **Valor devido protegido:** alterar `finalValue`, itens ou status do orçamento é recusado (`409`) se deixasse pagamentos ativos acima do valor devido.
- Apenas proprietário e administrador definem valores da ordem e preços de itens; o técnico não.

## Arquitetura e stack

```mermaid
flowchart LR
    U[Navegador] -->|HTTPS, cookie HttpOnly| F[Frontend<br/>React + Vite]
    F -->|/api| A[API Fastify]
    A --> M[Módulos<br/>schemas Zod · repositórios · regras]
    M -->|Prisma Client| D[(PostgreSQL)]
    A -.->|OAuth 2.0| G[Google]
```

| Camada | Tecnologias (versões instaladas no lockfile) |
| --- | --- |
| Backend | Node.js 20+, Fastify 5, TypeScript 6, Prisma 6.19, Zod 4, `bcryptjs`, `jose` (validação do `id_token` do Google), `@fastify/cookie`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` |
| Frontend | React 19, React Router 7, Vite 8, TypeScript 6, `lucide-react` |
| Banco | PostgreSQL (migrations versionadas em `backend/prisma/migrations`) |
| Testes | Vitest 5 (backend e frontend), Testing Library, Playwright 1.64 (E2E) |
| Qualidade | ESLint, Prettier, `tsc` em modo estrito |

Decisões de arquitetura que valem conhecer:

- **Modular por domínio.** Cada módulo em `backend/src/modules/<domínio>` reúne schemas de validação (Zod), repositório (acesso ao banco via Prisma) e regras. As rotas em `backend/src/routes` só orquestram autenticação, autorização e respostas HTTP.
- **Repositórios injetáveis.** `buildApp()` aceita repositórios alternativos, o que permite testes unitários rápidos sem banco, enquanto os testes de integração usam PostgreSQL real.
- **Autorização centralizada** em `backend/src/modules/auth/permissions.ts` (matriz `recurso:ação` por papel, negada por padrão).
- **Concorrência no banco.** Operações financeiras e de ciclo de vida usam transações com `SELECT … FOR UPDATE` em ordem fixa (ordem de serviço, depois orçamento), evitando condições de corrida e deadlocks.
- **Erros previsíveis.** Mensagens de erro não expõem detalhes internos; violações de integridade conhecidas viram `409`.

> **Observação sobre versões:** muitos pacotes estão declarados como `latest` nos `package.json`. O `package-lock.json` de cada aplicação fixa as versões efetivamente usadas; prefira `npm ci` para reproduzir o ambiente.

## Estrutura de pastas

```text
serviceflow/
├── .github/workflows/ci.yml        # integração contínua (GitHub Actions)
├── docs/OPERACAO.md                # roteiro de deploy, migrations, backup e pendências
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma            # modelos e enums
│   │   └── migrations/              # migrations SQL versionadas
│   ├── src/
│   │   ├── config/env.ts            # leitura e validação das variáveis de ambiente
│   │   ├── middlewares/             # authenticate, authorize
│   │   ├── modules/                 # auth, customers, equipment, service-orders, diagnosis,
│   │   │                            # quotes, payments, warranties, messages, dashboard,
│   │   │                            # overview, team, shared (locks, ciclo de vida, paginação)
│   │   ├── plugins/security.ts      # Helmet, CORS e rate limit
│   │   ├── routes/                  # rotas HTTP por domínio
│   │   ├── app.ts                   # montagem da aplicação Fastify
│   │   └── server.ts                # ponto de entrada
│   ├── tests/                       # testes unitários (*.test.ts)
│   │   └── integration/             # testes com PostgreSQL real
│   └── .env.example
└── frontend/
    ├── e2e/                         # testes ponta a ponta (Playwright)
    ├── src/
    │   ├── components/              # layout (Sidebar, Header) e UI reutilizável
    │   ├── contexts/                # AuthContext (sessão e permissões)
    │   ├── pages/                   # auth, dashboard, customers, equipment,
    │   │                            # service-orders, financial, team, profile, demo
    │   ├── routes/                  # rotas e proteção por autenticação/permissão
    │   ├── services/                # clientes HTTP da API
    │   ├── types/ · utils/ · hooks/
    │   └── main.tsx
    ├── vercel.json                  # rewrites usados na hospedagem na Vercel
    └── .env.example
```

## Pré-requisitos

| Item | Versão | Observação |
| --- | --- | --- |
| Node.js | 20 ou superior (`engines` do backend) | Validado com Node 24 |
| npm | acompanha o Node | |
| PostgreSQL | servidor local | Validado com PostgreSQL 18 |
| `psql` | no `PATH` | Necessário para os testes de integração e E2E, que criam e removem bancos temporários |
| Navegador do Playwright | opcional | Apenas para o E2E: `npx playwright install chromium` (em Linux sem as bibliotecas do sistema, pode ser necessário `--with-deps`) |

## Instalação local

### 1. Clonar o repositório

```bash
git clone https://github.com/QueirozMoura/serviceflow.git
cd serviceflow
```

### 2. Criar o banco PostgreSQL

Abra o `psql` como administrador do seu servidor local (por exemplo, `sudo -u postgres psql` no Linux, ou `psql -U postgres` se você tiver o usuário `postgres` com senha) e execute os comandos abaixo. **Troque a senha de exemplo** e use a mesma no `DATABASE_URL` do passo seguinte.

```sql
CREATE ROLE serviceflow WITH LOGIN PASSWORD 'change-me' CREATEDB;
CREATE DATABASE serviceflow OWNER serviceflow;
```

A permissão `CREATEDB` só é necessária para executar os testes de integração e E2E.

### 3. Configurar e iniciar o backend

```bash
cd backend
npm ci
cp .env.example .env        # edite DATABASE_URL e demais valores
npm run prisma:generate
npm run prisma:deploy       # aplica as migrations
npm run dev                 # http://127.0.0.1:3333
```

Verifique: `curl http://127.0.0.1:3333/api/health` deve responder `{"status":"ok"}`.

> `npm ci` instala exatamente as versões do `package-lock.json`. O npm 11 pode avisar (`allow-scripts`) que alguns pacotes têm scripts de instalação ainda não aprovados; por isso o passo `npm run prisma:generate` é obrigatório, mesmo que o `npm ci` tenha terminado sem erro.

### 4. Iniciar o frontend

Em outro terminal:

```bash
cd frontend
npm ci
npm run dev                 # http://localhost:3000
```

Em desenvolvimento **não é necessário** criar `frontend/.env`: o Vite encaminha `/api` para `http://127.0.0.1:3333` (veja `frontend/vite.config.ts`), mantendo front e API na mesma origem para o navegador, que é como os testes E2E rodam.

### 5. Criar a primeira conta

Abra `http://localhost:3000/signup` e cadastre sua empresa (também é possível chegar lá por **Entrar** → **Criar conta**). O endereço `http://localhost:3000/` mostra apenas a página de demonstração. O primeiro usuário é o **proprietário** e pode convidar o restante da equipe em **Equipe**.

## Variáveis de ambiente

Os valores abaixo são placeholders. **Nunca versione o `.env`** (ele já está no `.gitignore`).

### Backend (`backend/.env`)

| Variável | Obrigatória | Padrão | Descrição |
| --- | :---: | --- | --- |
| `DATABASE_URL` | sim | — | URL de conexão, ex.: `postgresql://serviceflow:change-me@localhost:5432/serviceflow?schema=public` |
| `NODE_ENV` | não | `development` | `development`, `test` ou `production` |
| `HOST` | não | `127.0.0.1` | Em produção precisa ser um endereço público (ex.: `0.0.0.0`) |
| `PORT` | não | `3333` | Porta da API |
| `CORS_ORIGIN` | não | `http://localhost:3000` | Origem(ns) do frontend, separadas por vírgula. Em produção não aceita `localhost` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | não | `100` / `1 minute` | Limite global de requisições por IP |
| `AUTH_RATE_LIMIT_MAX` | não | `5` | Tentativas por minuto em login e cadastro (aceitar convite usa o dobro; consultar convite, o quádruplo) |
| `AUTH_SESSION_TTL_SECONDS` | não | `604800` (7 dias) | Duração da sessão |
| `AUTH_COOKIE_NAME` | não | `serviceflow_session` | Nome do cookie de sessão |
| `AUTH_COOKIE_SAME_SITE` | não | `lax` | `lax`, `strict` ou `none` (`none` só é aceito em produção, com HTTPS) |
| `TRUST_PROXY` | não | `false` | `true`, `false` ou o número de proxies reversos confiáveis, para obter o IP real |
| `MAIL_PROVIDER` | não | — | `resend` (envio real pela API do Resend) ou `outbox` (memória, **somente fora de produção**). Sem ele, nenhum e-mail é enviado e a recuperação de senha fica inoperante |
| `RESEND_API_KEY`, `MAIL_FROM` | com `resend` | — | Chave da API e remetente (ex.: `ServiceFlow <no-reply@seudominio.com>`, de um domínio verificado no Resend) |
| `APP_BASE_URL` | não | primeira `CORS_ORIGIN` | Origem do frontend usada nos links dos e-mails |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_SUCCESS_REDIRECT` | não | — | Habilitam o login com Google. Em produção, se uma for definida, todas devem ser |
| `OAUTH_FAILURE_REDIRECT` | não | primeira `CORS_ORIGIN` | Para onde o navegador volta quando o login com Google falha |

> Em produção, o backend recusa iniciar se `HOST` for local, se `CORS_ORIGIN` listar `localhost` ou se o Google OAuth estiver configurado pela metade.

### Frontend (`frontend/.env`, opcional)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | vazio (caminhos relativos) | URL pública da API, definida no momento do build. Deixe vazio em desenvolvimento e quando o front e a API são servidos no mesmo domínio por proxy reverso |

### Apenas para testes

| Variável | Descrição |
| --- | --- |
| `SERVICEFLOW_TEST_DATABASE_URL` | Servidor usado pelos testes de integração. Se ausente, usa o `DATABASE_URL` do `backend/.env`. Só aceita `localhost` |
| `SERVICEFLOW_E2E_BASE_URL` | Servidor usado pelo E2E. Se ausente, usa o `DATABASE_URL` do `backend/.env`. Só aceita `localhost` |

## Banco de dados e migrations

O esquema é gerenciado pelo Prisma (`backend/prisma/schema.prisma`). Comandos, sempre a partir de `backend/`:

| Objetivo | Comando |
| --- | --- |
| Gerar o Prisma Client | `npm run prisma:generate` |
| Aplicar as migrations existentes (ambientes local, de teste e produção) | `npm run prisma:deploy` |
| Criar e aplicar uma nova migration em desenvolvimento | `npm run prisma:migrate` |

Boas práticas adotadas: migrations antigas nunca são editadas (alterações viram uma nova migration) e a unicidade e a integridade (chaves compostas por organização, índices únicos, `CHECK`) são garantidas no banco, não apenas na aplicação.

## Executando o projeto

| Ação | Backend (`backend/`) | Frontend (`frontend/`) |
| --- | --- | --- |
| Desenvolvimento | `npm run dev` | `npm run dev` |
| Build de produção | `npm run build` | `npm run build` |
| Executar o build | `npm start` (`node dist/server.js`) | `npm run preview` |

URLs locais: API em `http://127.0.0.1:3333` (saúde em `GET /api/health`) e interface em `http://localhost:3000`.

> **Demonstração × aplicação real.** A rota `/` é uma página de apresentação com **dados fictícios** embutidos no frontend; ela não exibe nem grava dados reais (a aplicação apenas consulta `GET /api/auth/session` ali, para redirecionar quem já está logado ao painel). `/login`, `/signup`, `/invite` e as demais telas após o login são a **aplicação real**, conectada à API e ao PostgreSQL.

## Scripts disponíveis

### Backend

| Script | O que faz |
| --- | --- |
| `npm run dev` | API com recarga automática (`tsx watch`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Executa a versão compilada |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc` incluindo os testes |
| `npm run format` | Prettier |
| `npm test` | Testes unitários |
| `npm run test:watch` | Testes unitários em modo watch |
| `npm run test:integration` | Testes de integração (PostgreSQL real) |
| `npm run prisma:generate` / `prisma:migrate` / `prisma:deploy` | Prisma (veja [Banco de dados](#banco-de-dados-e-migrations)) |

### Frontend

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento do Vite (porta 3000) |
| `npm run build` | `tsc -b` (verificação de tipos) seguido de `vite build` |
| `npm run preview` | Serve o build gerado |
| `npm run lint` | ESLint |
| `npm test` | Testes unitários e de componentes (Vitest) |
| `npm run e2e` / `npm run e2e:ui` | Testes ponta a ponta (Playwright) |

O frontend não tem script `typecheck` separado: a verificação de tipos faz parte do `npm run build` (`tsc -b`) e também pode ser executada com `npx tsc -b`.

## Testes

```bash
# Backend (a partir de backend/)
npm run typecheck
npm run lint
npm test                    # unitários, sem banco
npm run test:integration    # PostgreSQL real
npm run build

# Frontend (a partir de frontend/)
npx tsc -b
npm run lint
npm test
npm run build
npm run e2e                 # Playwright
```

| Tipo | Ferramenta | O que cobre | Requisitos |
| --- | --- | --- | --- |
| Unitários do backend | Vitest | Rotas e regras com repositórios em memória: autenticação, matriz de permissões, validações, erros | Nenhum banco |
| Integração do backend | Vitest + PostgreSQL | Concorrência e transações reais: totais de orçamento, idempotência e saldo de pagamentos, ciclo de vida da ordem, convites, cadastro, isolamento entre organizações, vínculo com Google | PostgreSQL local, `psql` e um usuário com `CREATEDB` |
| Frontend | Vitest + Testing Library | Páginas, formulários, permissões na interface, ciclo de vida da chave de idempotência | Nenhum |
| E2E | Playwright | Fluxos completos no navegador: cadastro, convite, ordens, permissões por papel | PostgreSQL local, `psql`, `backend/.env`, dependências do backend instaladas com o Prisma Client gerado, portas 3000 e 3333 livres e `npx playwright install chromium` |

Como os testes tratam o banco:

- Os testes de integração criam bancos temporários `serviceflow_it_*`, aplicam as migrations e os removem ao final. Recusam qualquer servidor que não seja local.
- O E2E recria o banco `serviceflow_e2e` e o remove no término. Ele **não** usa o banco de desenvolvimento.
- O E2E sobe o backend e o frontend sozinho; não é preciso iniciá-los antes. Como ele executa o código do backend a partir do `frontend/`, exige `npm ci` e `npm run prisma:generate` já feitos em `backend/` e um `backend/.env` válido. O `tsx` usado para iniciar o backend não é dependência do `frontend/`: o `npx` o baixa do registro do npm na primeira execução (requer internet).
- O Playwright gera `frontend/playwright-report/` e `frontend/test-results/`; parte desses arquivos já está versionada, então confira `git status` depois de rodar o E2E.

## Autenticação, permissões e multi-tenancy

### Autenticação

- **Sessão por cookie HttpOnly**: um token aleatório de 256 bits vai no cookie; no banco fica apenas o hash SHA-256. `Secure` em produção e `SameSite` configurável. O logout revoga a sessão.
- **Senhas** com `bcrypt` (custo 12). Regra de senha nova: 8 a 128 caracteres, com letra minúscula, maiúscula e número.
- **Rate limit** por IP (global e mais estrito em login, cadastro e convites), Helmet e CORS restrito às origens configuradas.
- **Login com Google (OAuth 2.0)** com parâmetro `state`, validação do `id_token` (assinatura via JWKS, emissor, público e `email_verified`). Uma identidade Google **nunca é vinculada por correspondência de e-mail** a uma conta já existente: o acesso é recusado, evitando tomada de conta.
- **Recuperação de senha** (`/api/auth/password/*`): token de 256 bits (só o hash é guardado), validade de 30 minutos e uso único, enviado por e-mail com o token no fragmento do link. A resposta pública é idêntica exista a conta ou não, e o envio acontece depois dela. Ao trocar a senha, todas as sessões da conta são revogadas e nenhuma sessão nova é criada. Contas só Google (sem senha local) nunca recebem senha por este fluxo. Há limite de taxa por rota e intervalo mínimo de 1 minuto entre e-mails da mesma conta. No login, o tempo de resposta não distingue e-mail inexistente, conta só Google e senha errada.
- **Convites** de equipe: token de 256 bits (somente o hash é guardado), validade de 7 dias, uso único, revogável; o papel e a organização vêm do convite, nunca do destinatário.

### Papéis e permissões

A matriz completa fica em [`backend/src/modules/auth/permissions.ts`](backend/src/modules/auth/permissions.ts) e é negada por padrão. Resumo:

| Capacidade | Proprietário | Administrador | Técnico |
| --- | :---: | :---: | :---: |
| Clientes, equipamentos, ordens, diagnósticos, garantias (ler e editar) | sim | sim | sim |
| Avançar o status da ordem (exceto aprovar e cancelar) e entregar | sim | sim | sim |
| Aprovar e cancelar ordens | sim | sim | não |
| Definir valor estimado e final da ordem | sim | sim | não |
| Criar, remover ou alterar preço e quantidade de itens do orçamento | sim | sim | não |
| Aprovar, rejeitar ou expirar orçamentos | sim | sim | não |
| Pagamentos (ver e registrar) | sim | sim | não |
| Excluir registros (clientes, equipamentos, ordens, diagnósticos, orçamentos, pagamentos, garantias) | sim | sim | não |
| Alterar o status da garantia | sim | sim | não |
| Ler orçamentos, criar o orçamento (sem itens), editar suas notas e a descrição/tipo dos itens | sim | sim | sim |
| Gerar mensagens e consultar o histórico | sim | sim | sim |
| Ver o painel (o técnico não recebe os indicadores de pagamentos) | sim | sim | sim |
| Gerenciar a equipe (convites e lista de membros) | sim | não | não |

O frontend usa as permissões devolvidas pela API apenas para exibir ou ocultar ações; a barreira real é a autorização do backend, que responde `403`, na grande maioria dos casos, antes de consultar o recurso. A exceção é a alteração dos valores de uma ordem (`PATCH`): o backend primeiro confirma que a ordem pertence à organização e recusa com `403` somente se o valor de fato mudar.

### Isolamento multi-tenant

- Todo registro pertence a uma organização. O `organizationId` vem **exclusivamente da sessão autenticada**; nunca do corpo, da URL ou de cabeçalhos.
- Todas as consultas e mutações filtram por `organizationId`. Relações no banco usam chaves compostas `(id, organizationId)`, impedindo vincular registros de organizações diferentes.
- Recursos de outra organização respondem `404`, como se não existissem. Os testes de integração verificam esse comportamento para cada módulo.
- O `slug` da organização é só um identificador público; nunca é usado em autorização.

## Visão geral da API

Todas as rotas ficam sob `/api`. Exceto as públicas indicadas, exigem sessão válida.

| Prefixo | Recursos |
| --- | --- |
| `GET /api/health` | Verificação de saúde da API e do banco (pública) |
| `/api/auth` | `register`, `login`, `logout`, `session`, `me` (leitura e edição do nome), `google` e `google/callback` |
| `/api/auth/password` | `forgot`, `validate` e `reset`: recuperação de senha (públicas, com limite de taxa) |
| `/api/auth/invitations` | `inspect` e `accept`: consulta e aceite de convite (públicas, com rate limit) |
| `/api/team` | `members`, `invitations` (listar, criar, revogar) |
| `/api/customers` · `/api/equipment` | CRUD, `options` para seletores, busca e paginação |
| `/api/service-orders` | CRUD, `PATCH /:id/status` e, aninhados por ordem: `diagnosis`, `quote` (com `items` e `status`), `payments` (com `status`), `warranty` (com `status`) e `messages` (com `history`) |
| `/api/quotes` · `/api/payments` · `/api/warranties` | Listagens agregadas, paginadas e com filtros, usadas pelas telas de módulo |
| `/api/dashboard` | Indicadores operacionais |

As respostas de erro seguem o formato `{ statusCode, error, message }`.

## Implantação

O roteiro operacional completo está em **[`docs/OPERACAO.md`](docs/OPERACAO.md)**: variáveis obrigatórias, opcionais e por funcionalidade; ordem de deploy; migrations em produção; verificação de saúde; backup e restauração; recuperação de um deploy problemático; e-mail (Resend); proxy, cookies e Google OAuth; estado das dependências; e a lista de pendências classificada (bloqueadores, necessário antes de usuários reais, melhorias futuras).

Resumo do que o repositório contém e do que **não** contém:

- [`frontend/vercel.json`](frontend/vercel.json): hospedagem do frontend na Vercel, reescrevendo `/api/*` para o backend publicado e as demais rotas para `index.html` (SPA).
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml): integração contínua (veja [Integração contínua](#integração-contínua)).
- Backend: `npm ci && npx prisma generate && npm run build`, `npm run prisma:deploy` (migrations; **nunca** `migrate dev`/`reset` em produção) e `npm start`.
- **Não há** Dockerfile, manifesto do Render nem configuração do banco no repositório: plano, política de backup e valores reais das variáveis precisam ser confirmados manualmente nos painéis dos provedores.

Verificação rápida após um deploy: `GET /api/health` deve responder `{"status":"ok"}` (HTTP 503 se a API não alcançar o banco).

> **A recuperação de senha só funciona depois que o Resend for configurado e testado de verdade** (domínio remetente verificado, `RESEND_API_KEY` e `MAIL_FROM`). Isso ainda não foi feito em produção.

### Integração contínua

O workflow roda em *pull requests* e em *pushes* na `main`, sem segredos, com PostgreSQL efêmero: `npm ci`, tipos, lint, testes unitários e build do backend; divergência entre migrations e schema; testes de integração; tipos, lint, testes e build do frontend; E2E com Playwright; e uma auditoria de dependências informativa. O workflow foi validado localmente (schema oficial e execução dos mesmos passos em cópia limpa), mas **ainda não foi executado no GitHub Actions**: confira a aba *Actions* após o push.

## Limitações conhecidas

- **E-mail não verificado.** O cadastro por e-mail e senha não confirma a posse do e-mail.
- **A recuperação de senha só funciona com um provedor de e-mail configurado** (`MAIL_PROVIDER=resend`, `RESEND_API_KEY` e `MAIL_FROM` válidos). A integração com o Resend foi testada com respostas simuladas, não com uma conta real. Sem configuração, o pedido responde normalmente, mas nenhum e-mail é enviado.
- **Fora a recuperação de senha, nenhum e-mail ou mensagem é enviado.** Convites são links copiados e entregues manualmente; as mensagens de comunicação são apenas rascunhos registrados.
- **Equipe:** ainda não é possível remover membros nem trocar o papel de um membro. Um mesmo e-mail pode existir em equipes diferentes e o login distingue as contas pela senha (não há seletor de organização).
- **Ordem sem orçamento** pode ser aprovada diretamente (a exigência de orçamento aprovado vale quando existe orçamento).
- **Orçamento aprovado** continua editável por proprietário e administrador, desde que não deixe pagamentos ativos acima do valor devido.
- **Sem trilha de auditoria geral.** Há histórico de status das ordens, mas não de quem alterou valores, itens ou pagamentos.
- **Observabilidade básica:** apenas o log padrão do Fastify e o endpoint de saúde.
- **Sem licença definida** no repositório. A CI existe, mas sua primeira execução no GitHub ainda não foi confirmada.
- **Dependências com `latest`** nos `package.json` (versões fixadas apenas pelo lockfile; use `npm ci`) e **3 alertas de severidade alta no `npm audit` do backend**, todos da mesma cadeia transitiva do Prisma CLI (`deepmerge-ts`), sem correção compatível na linha 6 do Prisma. Detalhes e mitigação em [`docs/OPERACAO.md`](docs/OPERACAO.md#9-dependências-e-vulnerabilidades).

## Próximos passos

Itens ainda **não implementados** e considerados para as próximas etapas:

- Verificação de e-mail.
- Remoção de membros e troca de papéis.
- Trilha de auditoria de alterações financeiras e observabilidade (identificador de requisição, rastreio de erros).
- Fixação das versões `latest` das dependências e atualização automatizada (por exemplo, Dependabot).
- Impressão ou PDF de ordens e orçamentos.
- Envio real de mensagens (WhatsApp e e-mail).

## Repositório e autoria

- Repositório: <https://github.com/QueirozMoura/serviceflow>
- Autor: Gustavo Moura de Queiroz — [@QueirozMoura](https://github.com/QueirozMoura)

Não há demonstração pública confirmada neste momento; a página inicial (`/`) da aplicação local apresenta uma demonstração com dados fictícios.
