# ServiceFlow Backend

Fundacao do backend do ServiceFlow, usando Node.js, TypeScript, Fastify, PostgreSQL e Prisma.

## Requisitos

- Node.js 20+
- PostgreSQL para uso do Prisma e das futuras funcionalidades

## Configuracao local

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

A API fica disponivel em `http://127.0.0.1:3333` e o health check em `GET /api/health`.

## Scripts

- `npm run dev`: desenvolvimento com recarga automatica
- `npm run build`: compilacao TypeScript
- `npm start`: inicia a versao compilada
- `npm run lint`: verifica o codigo com ESLint
- `npm run format`: formata os arquivos com Prettier
- `npm test`: executa os testes
- `npm run test:watch`: executa os testes em modo watch
- `npm run prisma:generate`: gera o Prisma Client
- `npm run prisma:migrate`: cria/aplica uma migration de desenvolvimento

O arquivo `.env.example` documenta as variaveis necessarias. Nunca versionar `.env` ou credenciais reais.

## Cadastro por e-mail, equipe e convites

- **Cadastro público** (`POST /api/auth/register`): cria a organização e o OWNER numa única transação. O cliente não escolhe papel nem organização (campos extras são rejeitados). O slug da organização recebe um sufixo aleatório, então duas empresas podem ter o mesmo nome; colisões (inclusive concorrentes) são resolvidas pelo índice único do PostgreSQL com nova tentativa limitada.
- **Convites** (`/api/team/*`, somente OWNER): o OWNER convida ADMIN ou TECHNICIAN por e-mail. O token (256 bits) é devolvido **uma única vez** na criação e só o hash fica no banco; vale 7 dias e uma única vez, e pode ser revogado. **Nenhum e-mail é enviado**: o OWNER copia o link (`/invite#t=<token>`) e o entrega manualmente. O token vai no fragmento da URL do frontend e no corpo das requisições, nunca em URLs da API.
- **Aceite** (`POST /api/auth/invitations/accept`): cria o membro com e-mail, papel e organização **do convite**, marca o convite como usado e abre a sessão, tudo na mesma transação.
- **Limitações conhecidas**: o e-mail informado no cadastro por senha **não é verificado** (a recuperação de senha por e-mail existe, mas exige um provedor configurado; a verificação do e-mail ainda não); quem recebe o link prova a posse apenas por tê-lo; um e-mail pode ter contas em equipes diferentes e o login as distingue pela senha (por isso o aceite recusa reutilizar a senha de outra conta com o mesmo e-mail); ainda não há remoção de membros nem troca de papel; o cadastro por senha não vincula identidades externas (Google) por e-mail.
- Limites por IP e minuto: `AUTH_RATE_LIMIT_MAX` (padrão 5) no cadastro e no login; aceitar convite usa o dobro e consultar convite o quádruplo.
