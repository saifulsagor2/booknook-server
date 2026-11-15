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

Google sign-in is enabled when both Google variables are set. In Google Cloud Console, allow the redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google` (for local development, `http://localhost:3000/api/auth/callback/google`).

Better Auth stores users, sessions, accounts, verifications, and signing keys in the existing `MONGODB_DB_NAME` database. It does not create a separate authentication database.

## MongoDB Atlas configuration

1. Create an Atlas cluster that supports multi-document transactions (a replica set or sharded cluster).
2. Create a dedicated database user with read/write access to the BookNook database. Do not use Atlas account credentials as application credentials.
3. In Atlas Network Access, allow the backend host's outbound IP addresses. Avoid allowing access from every IP address unless the deployment environment requires it and the risk is understood.
4. In Atlas, choose **Connect → Drivers** and copy the connection string into `MONGODB_URI`. It should use the `mongodb+srv://` scheme. URL-encode special characters in the database user's password.
5. Set `MONGODB_DB_NAME` to the database name BookNook should use (for example, `booknook`). The backend selects this database explicitly; the URI does not need to select a database.
6. Store both values in the backend host's private environment settings, never in source control or frontend environment variables.

The backend creates and uses the `books` and `borrows` collections in that database. Better Auth uses the same database for its own collections. Borrow and return operations use transactions, so a standalone MongoDB server without transaction support is not sufficient.

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

For Render, create a Web Service from the `booknook-server` repository with Node.js 20 or newer, build command `npm ci`, and start command `npm start`. Set the required environment variables listed above in the Render dashboard, plus `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together only if Google sign-in is enabled. Set both `CLIENT_URL` and `BETTER_AUTH_URL` to the exact public Vercel frontend origin. Vercel rewrites browser `/api/*` requests to the Render API, so Better Auth cookies and OAuth callbacks remain on the frontend origin. Render supplies `PORT`; the server uses it when present. Configure the health check path as `/health`.

If Google sign-in is enabled, configure both Google credentials and allow `${BETTER_AUTH_URL}/api/auth/callback/google` in Google Cloud Console. This repository has no provider-specific deployment configuration, and a production deployment has not been verified. See [MongoDB Atlas configuration](#mongodb-atlas-configuration) for database and transaction requirements.

### Post-deployment verification

These are checks to perform after deploying; production behavior has not yet been verified:

- Confirm the service starts and `GET /health` returns HTTP 200.
- Send a CORS preflight request from the deployed frontend origin and confirm that origin is allowed; requests from other origins should not receive credentialed CORS access.
- Confirm `GET /api/books` without a bearer token returns 401, then register/login and verify an authenticated JWT request succeeds.
- Using a disposable test account and database, create, list, view, update, and delete an owned book; confirm ownership restrictions for a second account.
- Borrow a shared book and confirm stock decreases, duplicate active borrowing is rejected, and return restores stock while preserving history.
- Confirm the frontend can refresh nested routes and complete these workflows without browser CORS, network, or authentication errors.

## Scripts

- `npm run dev` — start with Node.js watch mode
- `npm start` — start the API
- `npm test` — run the backend tests
