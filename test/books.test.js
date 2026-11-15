import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import express from "express";
import { betterAuth } from "better-auth/minimal";
import { ObjectId } from "mongodb";
import test from "node:test";
import { createApp } from "../src/app.js";
import { getAuthOptions } from "../src/config/auth.js";
import { createBooksRouter } from "../src/routes/books.js";
import { errorHandler } from "../src/middleware/error-handler.js";

function createMemoryCollection() {
  const documents = [];
  const matches = (document, filter) =>
    (!filter._id || document._id.equals(filter._id)) &&
    (!filter.ownerId || document.ownerId === filter.ownerId) &&
    (!Object.hasOwn(filter, "isShared") || document.isShared === filter.isShared);

  return {
    find(filter) {
      return {
        sort() {
          return this;
        },
        async toArray() {
          return documents.filter((document) => matches(document, filter));
        },
      };
    },
    async findOne(filter) {
      return documents.find((document) => matches(document, filter)) ?? null;
    },
    async insertOne(document) {
      const inserted = { ...document, _id: new ObjectId() };
      documents.push(inserted);
      return { insertedId: inserted._id };
    },
    async updateOne(filter, update) {
      const document = documents.find((item) => matches(item, filter));
      if (!document) {
        return { matchedCount: 0 };
      }
      Object.assign(document, update.$set);
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const index = documents.findIndex((document) => matches(document, filter));
      if (index === -1) {
        return { deletedCount: 0 };
      }
      documents.splice(index, 1);
      return { deletedCount: 1 };
    },
  };
}

async function startBooksServer(t, collection, options = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/books",
    createBooksRouter({
      collection,
      ...options,
      authenticate(req, res, next) {
        const userId = req.get("authorization")?.match(/^Bearer (reader-\w+)$/)?.[1];
        if (!userId) {
          return res.status(401).json({ message: "Authentication is required." });
        }
        req.auth = { userId };
        return next();
      },
    }),
  );
  app.use(errorHandler);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://127.0.0.1:${server.address().port}/api/books`;
}

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

async function startIntegratedBooksServer(t, collection) {
  const port = await getAvailablePort();
  const config = {
    betterAuthUrl: `http://127.0.0.1:${port}`,
    betterAuthSecret: "phase-five-test-secret-with-at-least-thirty-two-characters",
    clientUrl: "http://localhost:3000",
    googleClientId: undefined,
    googleClientSecret: undefined,
  };
  const auth = betterAuth(getAuthOptions(config));
  const app = createApp(config.clientUrl, {
    auth,
    config,
    database: { collection: () => collection },
  });
  const server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return { baseUrl: config.betterAuthUrl, clientUrl: config.clientUrl };
}

function jsonHeaders(userId) {
  return {
    Authorization: `Bearer ${userId}`,
    "Content-Type": "application/json",
  };
}

test("the integrated books route parses JSON after Better Auth verifies the JWT", async (t) => {
  const { baseUrl, clientUrl } = await startIntegratedBooksServer(
    t,
    createMemoryCollection(),
  );
  const registration = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      Origin: clientUrl,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "BookNook Test Reader",
      email: `phase-five-${randomUUID()}@booknook.test`,
      password: "BookNook-Test-Password-2026!",
    }),
  });
  assert.equal(registration.status, 200);

  const cookie = registration.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const tokenResponse = await fetch(`${baseUrl}/api/auth/token`, {
    headers: { Origin: clientUrl, Cookie: cookie },
  });
  assert.equal(tokenResponse.status, 200);
  const { token } = await tokenResponse.json();

  const response = await fetch(`${baseUrl}/api/books`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "A Test Book",
      author: "A. Reader",
      category: "Testing",
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).book.title, "A Test Book");
});

test("book CRUD is authenticated and scoped to the owning user", async (t) => {
  const url = await startBooksServer(t, createMemoryCollection());

  const unauthenticated = await fetch(url);
  assert.equal(unauthenticated.status, 401);

  const createdResponse = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "The Quiet Between Tides",
      author: "Mira Ellery",
      category: "Fiction",
      description: "A story by the sea.",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const { book: createdBook } = await createdResponse.json();
  assert.equal(createdBook.title, "The Quiet Between Tides");
  assert.equal(createdBook.description, "A story by the sea.");
  assert.equal("ownerId" in createdBook, false);

  const ownerDetailsResponse = await fetch(`${url}/${createdBook.id}`, {
    headers: jsonHeaders("reader-one"),
  });
  assert.equal(ownerDetailsResponse.status, 200);
  assert.equal((await ownerDetailsResponse.json()).book.id, createdBook.id);

  const privateDetailsResponse = await fetch(`${url}/${createdBook.id}`, {
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(privateDetailsResponse.status, 404);

  const ownerBooksResponse = await fetch(url, {
    headers: jsonHeaders("reader-one"),
  });
  assert.deepEqual((await ownerBooksResponse.json()).books.map((book) => book.id), [
    createdBook.id,
  ]);
  const otherReaderBooksResponse = await fetch(url, {
    headers: jsonHeaders("reader-two"),
  });
  assert.deepEqual((await otherReaderBooksResponse.json()).books, []);

  const otherReaderUpdate = await fetch(`${url}/${createdBook.id}`, {
    method: "PATCH",
    headers: jsonHeaders("reader-two"),
    body: JSON.stringify({ title: "Changed title" }),
  });
  assert.equal(otherReaderUpdate.status, 404);
  const otherReaderDelete = await fetch(`${url}/${createdBook.id}`, {
    method: "DELETE",
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(otherReaderDelete.status, 404);

  const updatedResponse = await fetch(`${url}/${createdBook.id}`, {
    method: "PATCH",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({ title: "The Quiet Between Tides (Revised)" }),
  });
  assert.equal(updatedResponse.status, 200);
  assert.equal(
    (await updatedResponse.json()).book.title,
    "The Quiet Between Tides (Revised)",
  );

  const deletedResponse = await fetch(`${url}/${createdBook.id}`, {
    method: "DELETE",
    headers: jsonHeaders("reader-one"),
  });
  assert.equal(deletedResponse.status, 204);
  assert.deepEqual((await (await fetch(url, { headers: jsonHeaders("reader-one") })).json()).books, []);
});

test("book creation validates fields and does not accept a client-supplied owner", async (t) => {
  const url = await startBooksServer(t, createMemoryCollection());

  const missingTitle = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({ title: " ", author: "Mira Ellery", category: "Fiction" }),
  });
  assert.equal(missingTitle.status, 400);
  assert.equal((await missingTitle.json()).message, "Title is required.");

  const clientOwner = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "A Map of Small Things",
      author: "Jonah Wren",
      category: "Reflection",
      ownerId: "reader-two",
    }),
  });
  assert.equal(clientOwner.status, 400);
  assert.equal(
    (await clientOwner.json()).message,
    "The book contains an unsupported field.",
  );

  const invalidId = await fetch(`${url}/not-an-object-id`, {
    method: "DELETE",
    headers: jsonHeaders("reader-one"),
  });
  assert.equal(invalidId.status, 404);
});

test("only explicitly shared books appear in the authenticated catalog", async (t) => {
  const url = await startBooksServer(t, createMemoryCollection());
  const privateBookResponse = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "Private Shelf",
      author: "A. Reader",
      category: "Fiction",
    }),
  });
  const { book: privateBook } = await privateBookResponse.json();
  assert.equal(privateBook.isShared, false);
  assert.equal(privateBook.availableCopies, 0);

  const sharedBookResponse = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "Shared Shelf",
      author: "A. Reader",
      category: "Fiction",
      isShared: true,
      availableCopies: 2,
    }),
  });
  assert.equal(sharedBookResponse.status, 201);
  const { book: sharedBook } = await sharedBookResponse.json();

  const catalogResponse = await fetch(`${url}/catalog`, {
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog.books.map((book) => book.id), [sharedBook.id]);
  assert.equal(catalog.books[0].canBorrow, true);

  const sharedDetails = await fetch(`${url}/${sharedBook.id}`, {
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(sharedDetails.status, 200);
  assert.equal((await sharedDetails.json()).book.id, sharedBook.id);

  const privateDetails = await fetch(`${url}/catalog/${privateBook.id}`, {
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(privateDetails.status, 404);

  const invalidCopies = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "Invalid Copies",
      author: "A. Reader",
      category: "Fiction",
      availableCopies: -1,
    }),
  });
  assert.equal(invalidCopies.status, 400);
});

test("a book with an active loan cannot be removed", async (t) => {
  const url = await startBooksServer(t, createMemoryCollection(), {
    borrowsCollection: { findOne: async () => ({ status: "active" }) },
  });
  const createdResponse = await fetch(url, {
    method: "POST",
    headers: jsonHeaders("reader-one"),
    body: JSON.stringify({
      title: "Currently Borrowed",
      author: "A. Reader",
      category: "Fiction",
    }),
  });
  const { book } = await createdResponse.json();

  const otherReaderDelete = await fetch(`${url}/${book.id}`, {
    method: "DELETE",
    headers: jsonHeaders("reader-two"),
  });
  assert.equal(otherReaderDelete.status, 404);

  const response = await fetch(`${url}/${book.id}`, {
    method: "DELETE",
    headers: jsonHeaders("reader-one"),
  });
  assert.equal(response.status, 409);
});
