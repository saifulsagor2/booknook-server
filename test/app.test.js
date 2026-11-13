import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";
import { getConfig } from "../src/config/env.js";

test("GET /health returns the API liveness response", async (t) => {
  const server = createApp("http://localhost:3000").listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "booknook-api",
  });
});

test("CORS allows the configured client origin", async (t) => {
  const server = createApp("http://localhost:3000").listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { Origin: "http://localhost:3000" },
  });

  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("environment configuration requires MongoDB and frontend settings", () => {
  assert.throws(
    () => getConfig({}),
    /Missing required environment variables: MONGODB_URI, MONGODB_DB_NAME, CLIENT_URL/,
  );
});

test("environment configuration validates port and returns normalized settings", () => {
  assert.deepEqual(
    getConfig({
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "booknook",
      CLIENT_URL: "http://localhost:3000/",
      PORT: "8001",
    }),
    {
      port: 8001,
      mongoUri: "mongodb://localhost:27017",
      mongoDbName: "booknook",
      clientUrl: "http://localhost:3000",
    },
  );
  assert.throws(
    () =>
      getConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "booknook",
        CLIENT_URL: "http://localhost:3000",
        PORT: "70000",
      }),
    /PORT must be an integer/,
  );
});
