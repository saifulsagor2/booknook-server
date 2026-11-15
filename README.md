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

Configure these values in `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string; contains private credentials |
| `MONGODB_DB_NAME` | Yes | Database used by BookNook and Better Auth |
| `CLIENT_URL` | Yes | Exact frontend origin allowed by CORS and Better Auth |
| `BETTER_AUTH_URL` | Yes | Public origin used by Better Auth |
| `BETTER_AUTH_SECRET` | Yes | High-entropy secret of at least 32 characters |
| `PORT` | No | HTTP port; defaults to `8000` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID; configure with its secret |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret; configure with its ID |

Generate a Better Auth secret with `openssl rand -base64 32`. Keep `.env` private and never commit credentials.

Google sign-in is enabled when both Google variables are set. In Google Cloud Console, allow the redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google` (for local development, `http://localhost:8000/api/auth/callback/google`).

Better Auth stores users, sessions, accounts, verifications, and signing keys in the existing `MONGODB_DB_NAME` database. It does not create a separate authentication database.

## Development

```sh
npm run dev
```

The server validates its environment settings and verifies the MongoDB connection before listening. Better Auth handles `/api/auth/*`; `GET /api/me` requires a Better Auth JWT verified against its JWKS endpoint. `GET /` and `GET /health` return the API liveness response. Unhandled request errors are returned through centralized error middleware, and `SIGINT`/`SIGTERM` gracefully close the HTTP server and MongoDB connection.

## API

All book and borrowing endpoints require a Better Auth JWT in the `Authorization: Bearer <token>` header.

| Method and path | Behavior |
| --- | --- |
| `GET /api/books` | List the signed-in user's books |
| `GET /api/books/:id` | Get a book owned by the user or explicitly shared by its owner |
| `POST /api/books` | Create a book with `title`, `author`, `category`, and optional `description`, `availableCopies`, and `isShared` |
| `PATCH /api/books/:id` | Update supplied fields on an owned book |
| `DELETE /api/books/:id` | Delete an owned book if it has no active loans |
| `GET /api/books/catalog` | List books owners have explicitly shared |
| `GET /api/books/catalog/:id` | Get a shared book |
| `GET /api/borrows` | List the signed-in user's borrowing history |
| `POST /api/borrows` | Borrow a shared book; body accepts only `bookId` |
| `PATCH /api/borrows/:id/return` | Return the user's active loan |
| `DELETE /api/borrows/:id` | Return the user's active loan without deleting its history |

Books are private by default. Book creation and updates validate field types and lengths; the authenticated user ID, not a client-supplied ID, determines ownership. Borrowing and returning use MongoDB transactions and atomic stock updates. The database must support transactions, such as a MongoDB Atlas replica set. Validation errors use 400, unauthenticated requests 401, inaccessible records 404, and stock/duplicate/return conflicts 409. Oversized JSON requests return 413.

## Image hosting

Book image upload and image-hosting integration are not implemented. No image provider or related environment variables are currently configured.

## Deployment

Deploy the API to a Node.js 20+ host and provide the required environment variables through that host's secret manager. Use a transaction-capable MongoDB deployment, configure its network access for the API host, set `CLIENT_URL` and `BETTER_AUTH_URL` to the deployed origins, and set `PORT` if required by the host. Start the service with `npm start` and configure the deployment health check to use `GET /health`.

If Google sign-in is enabled, configure both Google credentials and allow `${BETTER_AUTH_URL}/api/auth/callback/google` in Google Cloud Console. This repository has no provider-specific deployment configuration, and a production deployment has not been verified.

## Scripts

- `npm run dev` — start with Node.js watch mode
- `npm start` — start the API
- `npm test` — run the backend tests
