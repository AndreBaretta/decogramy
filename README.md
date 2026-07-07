# Decogramy — rede social de fotos

Decogramy é uma rede social simples, focada só em fotos, feita para o trabalho final de Sistemas Distribuídos. A ideia não é competir com Instagram; o produto é pequeno de propósito para deixar a arquitetura distribuída mais clara.

O usuário consegue criar conta, fazer login, postar fotos, seguir outras pessoas, curtir posts, ver feeds e receber notificações. A parte mais importante do projeto está no backend: tarefas que não precisam bloquear a requisição passam por uma outbox no PostgreSQL e são processadas depois com RabbitMQ, worker, Redis Pub/Sub e Server-Sent Events.

O PostgreSQL é a fonte de verdade. Coisas como geração de thumbnail, limpeza de objetos e entrega de notificação ao vivo rodam de forma assíncrona.

Veja [`architecture.md`](./architecture.md) para a descrição completa da arquitetura.

## O que já está implementado

- Autenticação: cadastro/login, hash de senha com Argon2id e JWT access token.
- Pipeline de upload: API cria o post + URL PUT assinada → navegador envia direto para o object storage → finalize publica o post e grava eventos na outbox.
- Worker assíncrono: publicador da outbox (Postgres → RabbitMQ com publisher confirms), geração de thumbnail com Sharp, fan-out de notificações, limpeza de objetos e scanner de uploads expirados.
- Social: home feed (usuários seguidos + próprio usuário) e explore, ambos com paginação por cursor; grid de perfil; follow/unfollow; likes com contagem transacional.
- Notificações: linhas duráveis gravadas na mesma transação da ação original; entrega ao vivo por SSE usando Redis Pub/Sub, funcionando mesmo com múltiplas instâncias da API.
- Tratamento de falhas: cache Redis e rate limiting em janela fixa falham em modo aberto; RabbitMQ reconecta automaticamente; retries em níveis (10s → 30s → 2m) e dead-letter queue.
- Web: cliente React + Vite com auth, feed, explore, upload com visão do pipeline em tempo real, grid de perfil e notificações ao vivo.

## Arquitetura em resumo

```
Navegador ──REST+JWT──▶ API (NestJS) ──tx──▶ PostgreSQL (fonte de verdade)
   │  ▲                 │  grava outbox_events na MESMA tx
   │  │ SSE             ▼
   │  └──────────── Redis Pub/Sub ◀── Worker publica notificações ao vivo
   │                                    ▲
   └──PUT assinado──▶ MinIO (R2/CDN)    │
                         ▲               │
   Worker (NestJS) ─────┘  consulta outbox (FOR UPDATE SKIP LOCKED)
        └─ publica no RabbitMQ (confirms) ─▶ consumidores:
             • thumbnail  (Sharp, 400×400 webp)
             • notificações (→ Redis Pub/Sub)
             • cleanup   (apaga objetos em post.deleted)
           idempotência via processed_events; retries + DLQ
```

## Pré-requisitos

- Docker + Docker Compose
- Node.js 20+ (só é necessário para rodar o servidor web de desenvolvimento ou as apps fora do Docker)

## Rodar tudo com Docker

```bash
cp .env.example .env
# Se já existir um Postgres local usando a porta 5432, defina POSTGRES_HOST_PORT=5433 no .env
# e ajuste a porta do DATABASE_URL para bater.

docker compose up -d --build
```

Isso sobe PostgreSQL, Redis, RabbitMQ, MinIO, API e worker. A API aplica as migrations do Prisma ao iniciar. Depois rode o cliente web:

```bash
npm install
npm run dev:web        # http://localhost:5173  (fala com a API em :3000)
```

Endpoints e UIs úteis:

| Serviço            | URL                                            |
| ------------------ | ---------------------------------------------- |
| Web app            | http://localhost:5173                          |
| API                | http://localhost:3000  (health: `/health`)     |
| RabbitMQ mgmt UI   | http://localhost:15672  (pastatop / pastatop)  |
| Console do MinIO   | http://localhost:9001   (pastatop / pastatoppastatop) |

## Rodar as apps fora do Docker (dev)

Suba só a infraestrutura no Docker e rode API + worker com hot reload:

```bash
docker compose up -d postgres redis rabbitmq minio minio-init
npm install
npm run prisma:generate
npm run prisma:migrate      # só na primeira vez, cria o schema
npm run dev                 # api + worker com ts-node-dev
npm run dev:web             # cliente web
```

## Estrutura do repositório

```
apps/
  api/      API HTTP NestJS + endpoints SSE
  worker/   Worker NestJS: publicador da outbox, consumidores RabbitMQ, Sharp, scanner
  web/      Cliente React + Vite
packages/
  shared/   Schema/client Prisma + contratos de eventos compartilhados
docker-compose.yml
```

## Pontos de Sistemas Distribuídos

- Outbox transacional: `outbox_events` é gravada na mesma transação do banco que a mudança de negócio (`apps/api/src/common/outbox.service.ts`). Isso evita perder eventos ou publicar eventos de mudanças que sofreram rollback. O relay fica em `apps/worker/src/outbox/outbox-publisher.service.ts` usando `FOR UPDATE SKIP LOCKED` (seguro para múltiplas réplicas de worker) + publisher confirms.
- Consumidores idempotentes: `processed_events (event_id, handler_name)` protege cada handler contra reentrega at-least-once do RabbitMQ (`apps/worker/src/idempotency`).
- Retry + DLQ: handlers com falha são republicados para filas de atraso (10s/30s/2m) e depois para uma dead-letter queue (`apps/worker/src/rabbit`).
- Fan-out ao vivo entre instâncias: o worker publica no Redis Pub/Sub e cada instância da API encaminha para seus clientes SSE conectados, permitindo escalar horizontalmente.
- Tolerância a falhas: cache/rate-limit com Redis falham em modo aberto; queda do RabbitMQ ou do worker atrasa efeitos colaterais sem derrubar as ações do usuário.

> Observação sobre storage: o MinIO faz o papel de um object storage compatível com S3/R2, e suas URLs públicas representam o caminho de mídia que poderia ser servido por uma CDN.
