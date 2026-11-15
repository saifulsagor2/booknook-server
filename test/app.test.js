import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";
import { getConfig } from "../src/config/env.js";
import { errorHandler } from "../src/middleware/error-handler.js";

test("GET / returns the API liveness response", async (t) => {
  const server = createApp("http://localhost:3000").listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "booknook-api",
  });
});

test("GET /health remains available", async (t) => {
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
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("invalid JSON receives a client error response", async (t) => {
  const server = createApp("http://localhost:3000").listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    message: "Invalid JSON request body.",
  });
});

test("JSON larger than the request limit receives a 413 response", async (t) => {
  const server = createApp("http://localhost:3000").listen(0);
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: "x".repeat(1024 * 1024) }),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    message: "Request body is too large.",
  });
});

test("central error handling hides internal error details", () => {
  let statusCode;
  let responseBody;
  const response = {
    headersSent: false,
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  errorHandler(new Error("private connection detail"), {}, response, () => {
    assert.fail("next should not be called before response headers are sent");
  });

  assert.equal(statusCode, 500);
  assert.deepEqual(responseBody, { message: "Internal server error." });
});

test("environment configuration requires MongoDB and frontend settings", () => {
  assert.throws(
    () => getConfig({}),
    /Missing required environment variables: MONGODB_URI, MONGODB_DB_NAME, CLIENT_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET/,
  );
});

test("environment configuration rejects an invalid MongoDB URI", () => {
  assert.throws(
    () =>
      getConfig({
        MONGODB_URI: "https://example.com",
        MONGODB_DB_NAME: "booknook",
        CLIENT_URL: "http://localhost:3000",
        BETTER_AUTH_URL: "http://localhost:8000",
        BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
      }),
    /MONGODB_URI must use mongodb/,
  );
});

test("environment configuration requires a strong Better Auth secret", () => {
  assert.throws(
    () =>
      getConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "booknook",
        CLIENT_URL: "http://localhost:3000",
        BETTER_AUTH_URL: "http://localhost:8000",
        BETTER_AUTH_SECRET: "too-short",
      }),
    /BETTER_AUTH_SECRET must be at least 32 characters/,
  );
});

test("environment configuration requires Google credentials as a pair", () => {
  assert.throws(
    () =>
      getConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "booknook",
        CLIENT_URL: "http://localhost:3000",
        BETTER_AUTH_URL: "http://localhost:8000",
        BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
        GOOGLE_CLIENT_ID: "test-google-client-id",
      }),
    /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be configured/,
  );
});

test("environment configuration validates port and returns normalized settings", () => {
  const defaults = getConfig({
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "booknook",
    CLIENT_URL: "http://localhost:3000",
    BETTER_AUTH_URL: "http://localhost:8000",
    BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
    PORT: "",
  });
  assert.equal(defaults.port, 8000);

  assert.deepEqual(
    getConfig({
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "booknook",
      CLIENT_URL: "http://localhost:3000/",
      BETTER_AUTH_URL: "http://localhost:8000/",
      BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
      PORT: "8001",
    }),
    {
      port: 8001,
      mongoUri: "mongodb://localhost:27017",
      mongoDbName: "booknook",
      clientUrl: "http://localhost:3000",
      betterAuthUrl: "http://localhost:8000",
      betterAuthSecret: "a-secure-test-secret-that-is-at-least-32-characters",
      googleClientId: undefined,
      googleClientSecret: undefined,
    },
  );
  assert.throws(
    () =>
      getConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "booknook",
        CLIENT_URL: "http://localhost:3000",
        BETTER_AUTH_URL: "http://localhost:8000",
        BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
        PORT: "70000",
      }),
    /PORT must be an integer/,
  );
});
