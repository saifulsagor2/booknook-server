# BookNook Server

The BookNook backend is a standalone Express API using the MongoDB Native Driver.

## Requirements

- Node.js 20 or newer
- A MongoDB deployment, such as MongoDB Atlas

## Setup

Install dependencies and make a local environment file:

```sh
npm install
Copy-Item .env.example .env
```

Set `MONGODB_URI`, `MONGODB_DB_NAME`, and `CLIENT_URL` in `.env`. `PORT` is optional and defaults to `8000`. Keep `.env` private; only `.env.example` belongs in version control.

## Development

```sh
npm run dev
```

The server verifies the MongoDB connection before listening. `GET /health` is the liveness endpoint and returns a JSON status response.

## Scripts

- `npm run dev` — start with Node.js watch mode
- `npm start` — start the API
- `npm test` — run the backend tests
