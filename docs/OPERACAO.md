# ServiceFlow — Operação, implantação e entrega

Este documento é o roteiro operacional do projeto: variáveis de ambiente, ordem de implantação, migrations, verificação de saúde, backup e restauração, recuperação de um deploy problemático, e-mail, OAuth, proxy, CI, estado das dependências e a lista final de pendências.

> **Leia primeiro: o que este documento confirma e o que não confirma.**
> O repositório só contém a configuração do **frontend na Vercel** (`frontend/vercel.json`) e a pipeline de **CI** (`.github/workflows/ci.yml`). Não há Dockerfile, `render.yaml` nem qualquer manifesto do backend ou do banco. Portanto **o plano do Render, o provedor do PostgreSQL, a política de backup do banco e os valores reais das variáveis em produção não podem ser confirmados a partir do código**. Onde isso importa, o texto marca **[CONFIRMAR NO PAINEL]**. Nada aqui foi executado contra produção.

## Sumário

1. [Variáveis de ambiente](#1-variáveis-de-ambiente)
2. [Ordem de implantação e migrations](#2-ordem-de-implantação-e-migrations)
3. [Validação de saúde após o deploy](#3-validação-de-saúde-após-o-deploy)
4. [Backup e restauração do PostgreSQL](#4-backup-e-restauração-do-postgresql)
5. [Recuperar-se de um deploy problemático](#5-recuperar-se-de-um-deploy-problemático)
6. [E-mail (recuperação de senha)](#6-e-mail-recuperação-de-senha)
7. [Proxy, rate limit, cookies e Google OAuth em produção](#7-proxy-rate-limit-cookies-e-google-oauth-em-produção)
8. [Integração contínua (CI)](#8-integração-contínua-ci)
9. [Dependências e vulnerabilidades](#9-dependências-e-vulnerabilidades)
10. [Pendências finais](#10-pendências-finais)

---

## 1. Variáveis de ambiente

Os valores abaixo são exemplos/placeholders. **Nunca** registre valores reais em arquivos versionados, issues ou logs. A leitura e a validação ficam em `backend/src/config/env.ts`: em produção o servidor **recusa iniciar** com configuração inválida.

### Backend (serviço no Render) — `NODE_ENV=production`

| Variável | Situação | Valor / observação |
| --- | --- | --- |
| `NODE_ENV` | **Obrigatória** | `production` (ativa cookies `Secure` e as validações estritas) |
| `DATABASE_URL` | **Obrigatória** | `postgresql://USUARIO:SENHA@HOST:5432/BANCO?schema=public`; acrescente `&sslmode=require` se o provedor exigir SSL **[CONFIRMAR NO PAINEL]** |
| `HOST` | **Obrigatória** | `0.0.0.0` (em produção `127.0.0.1`/`localhost` é recusado) |
| `PORT` | Opcional | O Render define `PORT` sozinho; o app já o lê (padrão `3333`) |
| `CORS_ORIGIN` | **Obrigatória na prática** | Origem do frontend, ex.: `https://SEU-APP.vercel.app` (ou o domínio próprio). `localhost` é recusado em produção. Vários valores, separados por vírgula |
| `TRUST_PROXY` | **Obrigatória na prática** | Número de proxies confiáveis (veja [seção 7](#7-proxy-rate-limit-cookies-e-google-oauth-em-produção)). O padrão `false` faz o rate limit enxergar o IP do proxy |
| `AUTH_COOKIE_SAME_SITE` | Opcional | Padrão `lax`, correto quando o navegador fala só com o domínio do frontend (rewrite da Vercel). `none` só se front e API estiverem em sites diferentes sem rewrite |
| `AUTH_COOKIE_NAME`, `AUTH_SESSION_TTL_SECONDS` | Opcionais | Padrões: `serviceflow_session` e `604800` (7 dias) |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `AUTH_RATE_LIMIT_MAX` | Opcionais | Padrões: `100`, `1 minute`, `5` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_SUCCESS_REDIRECT` (+ `OAUTH_FAILURE_REDIRECT`) | **Só para login com Google** | Em produção, se uma das quatro primeiras for definida, **todas** devem ser |
| `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` (+ `APP_BASE_URL`) | **Só para recuperação de senha** | Veja a [seção 6](#6-e-mail-recuperação-de-senha). Sem elas o sistema funciona, mas **ninguém consegue recuperar a senha** |

`MAIL_PROVIDER=outbox` existe apenas para desenvolvimento e é **recusado** em produção.

Ambiente de execução: Node.js 20 ou superior (validado com Node 24). No Render, fixe a versão com a variável `NODE_VERSION` **[CONFIRMAR NO PAINEL]**.

### Frontend (projeto na Vercel)

| Variável | Situação | Valor / observação |
| --- | --- | --- |
| `VITE_API_URL` | Opcional | **Deixe vazia** com o rewrite da Vercel: o navegador chama `/api` no próprio domínio do frontend e a Vercel encaminha ao backend. É lida **no build** |

Configuração do projeto na Vercel **[CONFIRMAR NO PAINEL]**: *Root Directory* `frontend`; build `npm run build`; saída `dist`. O destino do rewrite está em `frontend/vercel.json` (`/api/:path*` → URL pública do serviço no Render): **se a URL do Render mudar, atualize esse arquivo e faça novo deploy do frontend.**

## 2. Ordem de implantação e migrations

**Regra: o banco e o backend vão primeiro; o frontend depois.** O frontend depende do contrato da API; uma API nova costuma ser compatível com o frontend antigo, o inverso não.

Nunca use, em produção: `prisma migrate dev` (cria migrations e pode pedir reset), `prisma migrate reset` e `prisma db push`. O único comando para aplicar o esquema é:

```bash
cd backend
npm run prisma:deploy        # = prisma migrate deploy: aplica somente as migrations ainda pendentes, sem apagar nada
```

### Checklist de um deploy

1. **Pré-condições:** a CI da `main` está verde (aba *Actions*) e há um **backup recente** (seção 4). Se houver migration nova, leia o SQL em `backend/prisma/migrations/` e confirme que é **aditiva** (nova tabela/coluna anulável/índice). Alterações destrutivas (remover/renomear coluna) devem ser feitas em duas etapas (adicionar → migrar o uso → remover depois), para que a versão anterior do app continue funcionando durante a troca.
2. **Backend (Render):** o *build* deve instalar com `npm ci`, gerar o Prisma Client e compilar:
   `npm ci && npx prisma generate && npm run build` (*Root Directory* `backend`).
   As migrations devem rodar **antes** de o novo código receber tráfego:
   - com *Pre-Deploy Command* `npm run prisma:deploy` (recurso do Render; a disponibilidade depende do plano **[CONFIRMAR NO PAINEL]**), ou
   - alternativamente, no comando de início: `npm run prisma:deploy && npm start` (aceitável para uma única instância).
   Comando de início: `npm start` (`node dist/server.js`).
3. **Validar a API** (seção 3).
4. **Frontend (Vercel):** só depois que a API nova estiver saudável, faça o deploy do frontend (push na `main` com o projeto conectado, ou *Redeploy*).
5. **Teste de fumaça manual** (seção 3).

> Se o `prisma migrate deploy` falhar, o Render **não** deve promover a versão nova. Não rode comandos corretivos às cegas: veja a seção 5.

## 3. Validação de saúde após o deploy

**Saúde da API** (pública):

```bash
curl -fsS https://SEU-BACKEND.onrender.com/api/health          # direto no Render
curl -fsS https://SEU-APP.vercel.app/api/health                # pelo rewrite da Vercel
# esperado nos dois: {"status":"ok"} com HTTP 200
# HTTP 503 {"status":"error"} = a API está no ar, mas não alcança o banco
```

Dica: configure um monitor de disponibilidade (do próprio provedor ou externo) apontando para `/api/health`.

**Migrations aplicadas** (somente leitura; use a `DATABASE_URL` de produção apenas no seu terminal, nunca em arquivos):

```bash
cd backend
DATABASE_URL='<url de produção>' npx prisma migrate status    # esperado: "Database schema is up to date!"
```

**Teste de fumaça manual:** entrar com uma conta existente; abrir uma ordem de serviço; verificar que `/api/auth/me` devolve o usuário (cookie `Secure; HttpOnly` presente no navegador); se o login com Google estiver ativo, fazer um login com Google; se o e-mail estiver configurado, pedir uma recuperação de senha com uma conta de teste.

## 4. Backup e restauração do PostgreSQL

### O que se sabe e o que precisa ser confirmado

O banco é "hospedado externamente", mas **o provedor, o plano, a frequência de backup, a retenção e a possibilidade de restauração pontual (PITR) não constam no repositório**. **[CONFIRMAR NO PAINEL DO PROVEDOR]**: (a) se há backup automático, (b) com que frequência e retenção, (c) como restaurar, (d) se o plano contratado inclui isso. **Enquanto isso não for confirmado, trate o banco como sem backup.**

### Backup manual (independente do provedor)

Requer o cliente PostgreSQL (`pg_dump`) em versão igual ou superior à do servidor. Rode a partir de uma máquina de confiança, **antes de cada deploy com migration** e periodicamente (por exemplo, diário via agendador):

```bash
pg_dump --format=custom --no-owner --no-privileges \
        --file="serviceflow-$(date +%F-%H%M).dump" \
        "$DATABASE_URL"        # a URL vem do ambiente; não a escreva em scripts versionados
```

- Guarde o arquivo **criptografado** e fora da máquina/serviço que hospeda o banco; ele contém dados pessoais de clientes e hashes de senha. Nunca o versione.
- Defina retenção (ex.: 7 diários + 4 semanais) e **teste a restauração periodicamente**: um backup nunca restaurado não é um backup confirmado.

### Restauração (sempre em um banco NOVO e seguro)

Nunca restaure por cima do banco em uso. Restaure em um banco novo, valide, e só então decida se ele passa a ser o oficial.

```bash
# 1) criar um banco vazio (servidor de teste/staging ou uma instância temporária)
psql "$ADMIN_URL_DO_SERVIDOR_DE_TESTE/postgres" -c 'CREATE DATABASE serviceflow_restore'

# 2) restaurar
pg_restore --no-owner --no-privileges --exit-on-error \
           --dbname="$ADMIN_URL_DO_SERVIDOR_DE_TESTE/serviceflow_restore" serviceflow-AAAA-MM-DD-HHMM.dump

# 3) validar: contagens, migrations e esquema
psql "$ADMIN_URL_DO_SERVIDOR_DE_TESTE/serviceflow_restore" -c 'SELECT count(*) FROM "Organization"'
psql "$ADMIN_URL_DO_SERVIDOR_DE_TESTE/serviceflow_restore" -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'
cd backend && DATABASE_URL="$ADMIN_URL_DO_SERVIDOR_DE_TESTE/serviceflow_restore" npx prisma migrate status
```

Para subir uma API de verificação contra o banco restaurado, use um `.env` local com essa `DATABASE_URL` e **sem** `MAIL_PROVIDER`/Google (para não enviar e-mails nem usar credenciais reais).

> **Estado da validação:** esta sequência (dump em formato custom → restauração em banco novo → contagens, 9 migrations concluídas e `migrate status` "up to date") foi **executada com sucesso apenas contra bancos PostgreSQL locais e descartáveis**, já removidos. **Nenhum backup ou restauração foi feito, nem testado, no banco de produção ou no provedor real.** Isso continua pendente.

## 5. Recuperar-se de um deploy problemático

Princípios: **não apague dados, não use `migrate reset` e não edite migrations já aplicadas.** O Prisma não tem migrations "para baixo": a recuperação é sempre *para frente* ou por restauração de backup.

| Situação | O que fazer |
| --- | --- |
| **Código novo com defeito, sem migration nova** | Faça *rollback* para o deploy anterior no Render (*Rollback*/redeploy do commit anterior) e, se o frontend também mudou, no histórico de *Deployments* da Vercel. Nenhum dado é tocado |
| **Código novo com defeito, com migration aditiva já aplicada** | Reverta só o código (como acima). A versão anterior ignora tabelas/colunas novas, por isso migrations aditivas são seguras. Corrija o defeito com um novo commit |
| **`migrate deploy` falhou no meio** | Não repita às cegas. Rode `npx prisma migrate status` para ver qual migration falhou; inspecione o banco (o que foi aplicado). Se necessário, corrija o estado manualmente com SQL cuidadoso e marque com `npx prisma migrate resolve --applied <nome>` (ou `--rolled-back <nome>`). Em dúvida, restaure o backup em um banco novo (seção 4) e investigue lá |
| **Migration aplicada com efeito indevido nos dados** | Crie uma **nova migration corretiva** (para frente). Se houve perda/corrupção, restaure o último backup em um banco novo, extraia o que for preciso e aplique no banco oficial com revisão; ou, em último caso, repasse a `DATABASE_URL` para o banco restaurado numa janela de manutenção |
| **Frontend quebrado, API íntegra** | Reverta apenas o deploy do frontend na Vercel |
| **Falta de variável de ambiente (servidor não inicia)** | A mensagem de erro de configuração (sem valores) aparece nos logs do Render; defina a variável e reimplante |

Antes de qualquer correção manual no banco de produção: faça um backup novo.

## 6. E-mail (recuperação de senha)

- **Implementação:** a recuperação de senha envia o link por e-mail usando a **API HTTP do Resend** (`backend/src/modules/mail/mailer.ts`), sem dependência nova. O token só existe no e-mail e no banco (como hash).
- **Estado:** a integração foi testada com **respostas simuladas** do Resend e com uma caixa de saída em memória (`outbox`) em desenvolvimento e no E2E. **Nunca foi testada com uma conta real do Resend.**
- **Para funcionar em produção é preciso (todos pendentes):**
  1. Conta no Resend e **domínio remetente verificado** (registros DNS exigidos pelo provedor).
  2. `MAIL_PROVIDER=resend`, `RESEND_API_KEY` (chave da API) e `MAIL_FROM` (ex.: `ServiceFlow <no-reply@seudominio.com>`, no domínio verificado) definidos no Render. **Nunca** registre a chave em arquivos versionados ou logs.
  3. `APP_BASE_URL` (ou `CORS_ORIGIN`) apontando para o domínio **real** do frontend, pois os links do e-mail usam essa origem.
  4. **Teste real:** com uma conta de teste, pedir a recuperação, confirmar o recebimento (inclusive verificar spam), abrir o link, trocar a senha, confirmar que a senha antiga deixa de funcionar e que o link não funciona uma segunda vez.
- **Sem configuração:** o servidor sobe e registra um aviso; o pedido de recuperação responde normalmente (resposta genérica), mas **nenhum e-mail é enviado e nenhum token é criado**. Ou seja, a recuperação fica **inoperante** — não insegura.
- A resposta HTTP nunca contém o token nem o link, e os logs não registram token, link, senha nem o e-mail do destinatário.

## 7. Proxy, rate limit, cookies e Google OAuth em produção

Estes itens **não podem ser validados fora do ambiente real**; estão aqui como procedimento.

### `TRUST_PROXY` e rate limit

O rate limit usa o IP do cliente. Atrás de Vercel (rewrite) + proxy do Render, se `TRUST_PROXY` ficar `false`, **todos os usuários compartilham o IP do proxy**: o limite de 5 tentativas/minuto de login valeria para o sistema inteiro (bloqueio geral por qualquer pessoa). Se for alto demais, um atacante poderia forjar `X-Forwarded-For` e fugir do limite. O valor correto depende da cadeia real de proxies (provavelmente `2`: proxy do Render + Vercel) **[CONFIRMAR]**.

Como verificar após o deploy, em duas redes diferentes (ex.: Wi-Fi e dados móveis), usando um e-mail de teste:
1. Da rede A, faça 6 tentativas de login com senha errada em menos de 1 minuto: a 6ª deve responder `429`.
2. Da rede B, imediatamente depois, uma tentativa deve responder `401` (e **não** `429`). Se der `429`, o limite está sendo contado por IP do proxy: aumente `TRUST_PROXY`.
3. Repita com cabeçalho forjado (`curl -H 'X-Forwarded-For: 1.2.3.4' ...`): ele **não** deve permitir contornar o limite da rede A.

### Cookies

O cookie de sessão é `HttpOnly`, `Secure` em produção e `SameSite=Lax` por padrão. Com o rewrite da Vercel o navegador só conversa com o domínio do frontend, então o cookie é de primeira parte e `Lax` funciona. Não use `AUTH_COOKIE_SAME_SITE=none` sem necessidade.

### Login com Google

O cookie de sessão é emitido pelo domínio que serve o callback do OAuth. Se `GOOGLE_REDIRECT_URI` apontar direto para o domínio do Render, o cookie ficaria no domínio do Render e **não seria enviado** nas chamadas feitas pelo domínio da Vercel. Recomendação a **validar na prática**: registrar no Google Cloud e usar `GOOGLE_REDIRECT_URI=https://SEU-APP.vercel.app/api/auth/google/callback` (o rewrite repassa ao backend), com `OAUTH_SUCCESS_REDIRECT`/`OAUTH_FAILURE_REDIRECT` no domínio do frontend. Teste o fluxo completo (login, retorno ao painel, sessão persistente após recarregar). Se não for validar agora, **não defina as variáveis do Google** — o botão deixa de funcionar de forma explícita, em vez de falhar no meio.

## 8. Integração contínua (CI)

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), disparado em **pull requests** e **pushes na `main`**. Permissões somente de leitura; não usa segredos nem acessa serviços externos; os bancos são contêineres PostgreSQL efêmeros do próprio job (credenciais fictícias).

| Job | O que executa |
| --- | --- |
| `backend` | `npm ci` → `prisma generate` → typecheck → lint → testes unitários → build → checagem de divergência migrations × schema (`prisma migrate diff`) → testes de integração em PostgreSQL real |
| `frontend` | `npm ci` → `tsc -b` → lint → testes → build |
| `e2e` | (após os dois acima) backend e frontend instalados, Chromium do Playwright, `npm run e2e` contra um PostgreSQL efêmero; anexa o relatório do Playwright se falhar |
| `audit` | `npm audit --audit-level=high` nos dois projetos. **Informativo** (`continue-on-error`): hoje reporta o alerta conhecido do Prisma CLI (seção 9) sem bloquear |

**Estado de verificação:**
- O YAML foi validado contra o schema oficial de workflows e **os mesmos comandos foram executados localmente em uma cópia limpa do repositório** (instalação com `npm ci`, sem `node_modules`).
- **A pipeline ainda não foi executada no GitHub Actions.** Os resultados locais não substituem a primeira execução remota; confira a aba *Actions* após o push. Diferenças possíveis: versão do PostgreSQL (CI usa 17), disponibilidade do `psql`/Chromium no runner e tempo de execução do E2E.
- Recomendado no GitHub: proteger a `main` exigindo os jobs `backend`, `frontend` e `e2e` antes do merge **[configuração manual do repositório]**.

## 9. Dependências e vulnerabilidades

`npm audit` executado em `backend/` e `frontend/` (todas as dependências e apenas produção):

| Projeto | Resultado |
| --- | --- |
| `frontend` | **0 vulnerabilidades** |
| `backend` | **3 "high"**, todas a **mesma cadeia transitiva** do Prisma CLI |

**Backend — `deepmerge-ts < 8.0.0` (GHSA-ggr8-5vv4-36mx, esgotamento de pilha ao mesclar grafos de objetos recursivos)**

- **Cadeia:** `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5` (e `@prisma/client` apenas referencia o `prisma`).
- **Tipo:** alerta **transitivo** em uma ferramenta de **linha de comando** (`prisma generate`/`migrate deploy`), usada na build/release. O servidor em execução (`node dist/server.js`) usa o `@prisma/client`, não o `@prisma/config`.
- **Impacto conhecido no ServiceFlow:** não há evidência de exploração. O mesclador processa a configuração do próprio Prisma, que é do repositório (não existe `prisma.config.ts` e nenhuma entrada de usuário chega a ele). O efeito possível seria derrubar o processo da CLI, não o servidor. Classificação: **risco potencial baixo, não confirmado como explorável**.
- **Correção:** a única "correção" oferecida pelo `npm audit` é `prisma@7.x`/`8.x`, uma **atualização major com quebras**. `6.19.3` é a última versão da linha 6. Não foi aplicada, conforme a regra de não fazer upgrade major só para silenciar alertas, e **não foi usado `overrides`** (forçar `deepmerge-ts@8` em um pacote feito para a 7.x poderia quebrar a CLI sem aviso).
- **Mitigação:** executar a CLI do Prisma apenas em build/release de confiança (CI e Render), com configuração do repositório; manter o job `audit` da CI visível; planejar a migração para o Prisma 7 como tarefa própria, com testes.
- **Pendência:** acompanhar um patch na linha 6 ou planejar a migração (melhoria futura).

Outros pontos: vários pacotes estão declarados como `latest` nos `package.json`; o `package-lock.json` fixa o que é instalado, por isso **sempre use `npm ci`** (a CI e o roteiro de deploy usam).

## 10. Pendências finais

Reavaliação dos achados da auditoria (etapa 14.0) e do que mudou desde então.

### Resolvido desde a auditoria
Cadastro e equipe/convites; ciclo de vida da ordem e regras financeiras; slug duplicado; recuperação de senha (com a ressalva de e-mail abaixo); enumeração de e-mail por tempo no login; CI; runbook de deploy/backup (este documento).

### Bloqueadores para produção (validar/configurar antes de abrir ao público)
1. **`TRUST_PROXY` correto e verificado** atrás de Vercel + Render (seção 7). Sem isso o rate limit pode bloquear todos os usuários de uma vez.
2. **Variáveis de produção válidas** e conexão com o banco com SSL quando exigido (seção 1).
3. **Backup do banco confirmado no provedor e uma restauração testada** no ambiente real (seção 4). Hoje o estado do backup é desconhecido.
4. **Login com Google validado de ponta a ponta em produção, ou desativado** (seção 7).

### Necessário antes de usuários reais
1. **Resend configurado e testado de verdade** (domínio verificado, chave, remetente, teste real). Sem isso a recuperação de senha não funciona.
2. **Primeira execução verde da CI no GitHub** e proteção da `main` exigindo os jobs.
3. **Verificação de e-mail no cadastro** (hoje o e-mail informado não é confirmado).
4. **Remover membros e trocar papéis** (hoje não é possível desligar alguém da equipe pelo sistema).
5. **Monitoramento mínimo:** monitor de disponibilidade em `/api/health` e acompanhamento dos logs do Render.
6. **Decisão sobre o alerta do Prisma CLI** (seção 9): aceitar o risco documentado ou migrar para o Prisma 7.

### Melhorias futuras
Trilha de auditoria de alterações financeiras; observabilidade (ID de requisição, rastreio de erros); limpeza periódica de sessões expiradas; seletor de organização para quem tem contas em mais de uma equipe; migração para o Prisma 7; automação de atualização de dependências e fixação de versões `latest`; PDF/impressão de ordens e orçamentos; envio real de mensagens (WhatsApp); exigir orçamento para aprovar ordens sem orçamento (decisão de negócio).
