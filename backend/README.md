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
