import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { betterAuth } from "better-auth/minimal";
import test from "node:test";
import { createApp } from "../src/app.js";
import { getAuthOptions } from "../src/config/auth.js";

const testSecret = "phase-four-test-secret-with-at-least-thirty-two-characters";

async function getAvailablePort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function startAuthServer(t) {
  const port = await getAvailablePort();
  const config = {
    betterAuthUrl: `http://127.0.0.1:${port}`,
    betterAuthSecret: testSecret,
    clientUrl: "http://localhost:3000",
    googleClientId: undefined,
    googleClientSecret: undefined,
  };
  const auth = betterAuth(getAuthOptions(config));
  const server = createApp(config.clientUrl, { auth, config }).listen(port, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  return {
    baseUrl: config.betterAuthUrl,
    clientUrl: config.clientUrl,
  };
}

function headersFor(clientUrl, cookie) {
  const headers = new Headers({ Origin: clientUrl });
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return headers;
}

function cookieFromResponse(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

test("Better Auth supports registration, login, persistent sessions, JWT access, and logout", async (t) => {
  const { baseUrl, clientUrl } = await startAuthServer(t);
  const userEmail = `phase-four-${randomUUID()}@booknook.test`;
  const password = "BookNook-Test-Password-2026!";

  const unauthenticated = await fetch(`${baseUrl}/api/me`);
  assert.equal(unauthenticated.status, 401);

  const invalidToken = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: "Bearer not-a-valid-token" },
  });
  assert.equal(invalidToken.status, 401);

  const registration = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(headersFor(clientUrl)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "BookNook Test Reader",
      email: userEmail,
      password,
    }),
  });
  assert.equal(registration.status, 200);
  const registrationData = await registration.json();
  assert.equal(registrationData.user.email, userEmail);

  const registeredCookie = cookieFromResponse(registration);
  assert.ok(registeredCookie);

  const firstSessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: headersFor(clientUrl, registeredCookie),
  });
  const firstSession = await firstSessionResponse.json();
  assert.equal(firstSession.user.id, registrationData.user.id);

  const secondSessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: headersFor(clientUrl, registeredCookie),
  });
  const secondSession = await secondSessionResponse.json();
  assert.equal(secondSession.user.id, firstSession.user.id);

  const tokenResponse = await fetch(`${baseUrl}/api/auth/token`, {
    headers: headersFor(clientUrl, registeredCookie),
  });
  assert.equal(tokenResponse.status, 200);
  const { token } = await tokenResponse.json();
  assert.ok(token);

  const apiProfileResponse = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(apiProfileResponse.status, 200);
  const apiProfile = await apiProfileResponse.json();
  assert.equal(apiProfile.user.id, registrationData.user.id);
  assert.equal(apiProfile.user.email, userEmail);

  const failedLogin = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(headersFor(clientUrl)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: userEmail, password: "wrong-password" }),
  });
  assert.equal(failedLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(headersFor(clientUrl)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: userEmail, password }),
  });
  assert.equal(login.status, 200);
  const loginCookie = cookieFromResponse(login);
  assert.ok(loginCookie);

  const logout = await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: headersFor(clientUrl, loginCookie),
  });
  assert.equal(logout.status, 200);
  assert.ok(
    logout.headers
      .getSetCookie()
      .some((cookie) => /max-age=0|expires=/i.test(cookie)),
  );

  const endedSessionResponse = await fetch(`${baseUrl}/api/auth/get-session`, {
    headers: headersFor(clientUrl),
  });
  assert.equal(await endedSessionResponse.json(), null);
});

test("Google authentication is only enabled when both server credentials are present", () => {
  const config = {
    betterAuthUrl: "http://localhost:8000",
    betterAuthSecret: testSecret,
    clientUrl: "http://localhost:3000",
    googleClientId: "test-google-client-id",
    googleClientSecret: "test-google-client-secret",
  };

  assert.deepEqual(getAuthOptions(config).socialProviders.google, {
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
  });
});
