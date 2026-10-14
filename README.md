# RemateYa — live livestock auction over gRPC (Connect)

Case study for demonstrating gRPC concepts: Contract-First, Protobuf, unary + server streaming, HTTP/2 discussion.
Single Next.js project (frontend + backend) deployed on Vercel, PostgreSQL via Prisma.

Actors: **Auctioneer** (opens/closes lots, protected by a PIN), **Bidder** (bids), **Observer** (watches, no login).

## Architecture

```
Browser (connect-web, Protobuf binary)
   │  POST /api/rpc/remateya.v1.AuctionService/<Method>
   ▼
Next.js route handler (Connect router)  ──►  AuctionService (business rules)
                                                  │ transaction + SELECT ... FOR UPDATE
                                                  ▼
                                            PostgreSQL (auctions, lots, bids, events)
```

- `proto/remateya/v1/auction.proto` — single source of truth (Contract-First). Code generated with `buf` into `gen/`.
- `lib/domain/rules.ts` — pure rules (minimum increment, anti-sniping 10 s window / +10 s). Unit tested.
- `lib/server/auction-service.ts` — transactional logic. Bids on a lot are serialized with `SELECT ... FOR UPDATE`.
  Each event gets a monotonic `sequence` allocated inside the same transaction (row lock on the auction), so commit
  order equals sequence order and pollers cannot skip events.
- `lib/server/handlers.ts` — Connect handlers, Zod validation at the edges, gRPC status codes
  (`INVALID_ARGUMENT`, `FAILED_PRECONDITION`, `NOT_FOUND`, `ABORTED`, `UNAUTHENTICATED`, `PERMISSION_DENIED`).
- `WatchAuction` (server streaming): polls the `events` table every ~500 ms for `sequence > last_seen_sequence`,
  emits events plus the server time, and ends the stream after 50 s (`maxDuration = 60`). The client reconnects
  automatically with the last seen sequence.
- Idempotency: `PlaceBid` takes an `idempotency_key` (unique per lot); replays return the current state.
- Lots close lazily (no timers in serverless): expired lots are settled when state/stream/bid is requested,
  and the winner is stored. Time is always the **server** clock.
- Auth: JWT (HS256, `jose`). Auctioneer login requires `AUCTIONEER_PIN`. No `as` casts on external data (Zod).

### RPCs

| RPC | Type | Deployed |
|---|---|---|
| Login, CreateAuction, OpenLot, PlaceBid, CloseLot, GetAuctionState | Unary | yes |
| WatchAuction | Server streaming | yes |
| AuctionChannel | Bidirectional | contract only (see below) |

## Run locally

```bash
npm install
cp .env.example .env.local        # fill in values
npx prisma db push                # create tables
npm run dev                       # http://localhost:3000
npm test                          # unit tests (business rules)
npm run smoke                     # end-to-end check against a running server
npm run proto                     # regenerate code after editing the .proto
```

Local Postgres quick start: `docker run -d -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=remateya -p 5433:5432 postgres:16`
and use `postgresql://postgres:pg@localhost:5433/remateya` for both DB variables.

Environment variables: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `JWT_SECRET` (16+ chars), `AUCTIONEER_PIN`.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Vercel → **Add New → Project** → import the repo (framework: Next.js, defaults).
3. Project → **Storage** → create/connect a Postgres database from the Marketplace (Neon). This injects
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
4. Project → **Settings → Environment Variables**: add `JWT_SECRET` and `AUCTIONEER_PIN`.
5. Deploy. The build runs `prisma generate && prisma db push && next build` (MVP shortcut: no migrations).

## Native gRPC vs Connect / gRPC-Web

| | Native gRPC | gRPC-Web | Connect |
|---|---|---|---|
| Transport | HTTP/2 only | HTTP/1.1 or 2 | HTTP/1.1 or 2 |
| Status delivery | HTTP/2 **trailers** | Encoded in the body | Header/JSON error body (unary), end-of-stream frame (streaming) |
| Browser support | No (fetch cannot read trailers / full-duplex) | Yes, via proxy | Yes, direct |
| Payload | Protobuf | Protobuf | Protobuf (or JSON) |

All three share the same `.proto`. We use **Connect** with Protobuf binary: it works in the browser and in a
plain Next.js route handler, with no proxy (Envoy) in between.

## Vercel limitations

- **Native gRPC (HTTP/2 end-to-end with trailers) is not documented as supported by Vercel Functions.** We did not
  find official support, so we did not rely on it. This is why Connect over HTTP was chosen.
- Functions are stateless and have a maximum duration (`maxDuration`): on Hobby 300 s default and max; on
  Pro/Enterprise 300 s default, up to 800 s (longer is beta). Hence the stream ends at 50 s and clients reconnect.
- No in-memory state or timers between invocations → state lives in Postgres; closing is lazy.
- **Bidirectional streaming (`AuctionChannel`) is not deployed**: it needs a long-lived full-duplex connection;
  serverless functions are request/response with a time limit, and browsers' `fetch` cannot do full-duplex
  gRPC streaming. It is defined in the `.proto` for completeness only.

## When to use — and when NOT to use — gRPC

Use it for: internal service-to-service calls, strict typed contracts across languages, low-latency/high-throughput
APIs, streaming (HTTP/2 multiplexing), small binary payloads.

Avoid it for: public browser-first APIs (needs gRPC-Web/Connect), simple CRUD where REST/GraphQL is enough,
teams that need human-readable payloads/curl debugging, or platforms without HTTP/2 + trailers (like our case).

Quick comparison with the course topics: REST (simple, cacheable), GraphQL (flexible queries), tRPC (TypeScript-only,
no contract file; type erasure means types vanish at runtime, so Zod validates at the edge), gRPC (contract-first,
binary, streaming).
