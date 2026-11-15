# BookNook Server

The BookNook backend is a standalone Express API using the MongoDB Native Driver.

## Requirements

- Node.js 20 or newer
- A MongoDB deployment, such as MongoDB Atlas

## Setup

Install dependencies and create a local environment file without replacing an existing one:

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Configure `MONGODB_URI`, `MONGODB_DB_NAME`, `CLIENT_URL`, `BETTER_AUTH_URL`, and `BETTER_AUTH_SECRET` in `.env`. `PORT` is optional and defaults to `8000`. `BETTER_AUTH_SECRET` must be a high-entropy secret of at least 32 characters; generate one with `openssl rand -base64 32`. Keep `.env` private.

Google sign-in is enabled when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. In Google Cloud Console, allow the redirect URI `http://localhost:8000/api/auth/callback/google` for local development.

Better Auth stores users, sessions, accounts, verifications, and signing keys in the existing `MONGODB_DB_NAME` database. It does not create a separate authentication database.

## Development

```sh
npm run dev
```

The server validates its environment settings and verifies the MongoDB connection before listening. Better Auth handles `/api/auth/*`; `GET /api/me` requires a Better Auth JWT verified against its JWKS endpoint. `GET /` and `GET /health` return the API liveness response. Unhandled request errors are returned through centralized error middleware, and `SIGINT`/`SIGTERM` gracefully close the HTTP server and MongoDB connection.

## Book API

All `/api/books` routes require a Better Auth JWT. `GET` lists the authenticated user's books, `POST` creates a book with `title`, `author`, and `category` (and optional `description`, `availableCopies`, and `isShared`), `PATCH /:id` updates supplied fields, and `DELETE /:id` removes a book. Books are private by default; only books explicitly shared by their owner appear at `GET /api/books/catalog` and `GET /api/books/catalog/:id`.

`GET /api/borrows` lists the authenticated user's borrowing history. `POST /api/borrows` accepts only a `bookId`; `PATCH /api/borrows/:id/return` returns that user's active loan. Borrowing and returning use MongoDB transactions to keep stock and loan records in sync, so the database must support transactions (MongoDB Atlas does).

## Scripts

- `npm run dev` — start with Node.js watch mode
- `npm start` — start the API
- `npm test` — run the backend tests
