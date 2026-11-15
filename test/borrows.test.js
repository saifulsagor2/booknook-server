import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { ObjectId } from "mongodb";
import test from "node:test";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createBorrowsRouter } from "../src/routes/borrows.js";

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (expected instanceof ObjectId) {
      return actual instanceof ObjectId && actual.equals(expected);
    }
    if (expected && typeof expected === "object") {
      if ("$gt" in expected) {
        return actual > expected.$gt;
      }
      if ("$ne" in expected) {
        return actual !== expected.$ne;
      }
    }
    return actual === expected;
  });
}

function createMemoryCollection(initialDocuments = []) {
  const documents = [...initialDocuments];
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
      for (const [key, increment] of Object.entries(update.$inc ?? {})) {
        document[key] = (document[key] ?? 0) + increment;
      }
      Object.assign(document, update.$set);
      return { matchedCount: 1 };
    },
  };
}

function createTransactionClient() {
  let queue = Promise.resolve();
  return {
    startSession() {
      return {
        async withTransaction(callback) {
          const previous = queue;
          let release;
          queue = new Promise((resolve) => {
            release = resolve;
          });
          await previous;
          try {
            return await callback();
          } finally {
            release();
          }
        },
        async endSession() {},
      };
    },
  };
}

async function startBorrowServer(t, booksCollection, borrowsCollection) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/borrows",
    createBorrowsRouter({
      booksCollection,
      borrowsCollection,
      client: createTransactionClient(),
      authenticate(req, res, next) {
        const userId = req.get("authorization")?.match(/^Bearer (reader-\w+|owner)$/)?.[1];
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
  return `http://127.0.0.1:${server.address().port}/api/borrows`;
}

function createBook(availableCopies = 1) {
  return {
    _id: new ObjectId(),
    ownerId: "owner",
    title: "A Shared Book",
    author: "A. Writer",
    category: "Fiction",
    description: "",
    isShared: true,
    availableCopies,
  };
}

function headers(userId, body) {
  const result = { Authorization: `Bearer ${userId}` };
  if (body !== undefined) {
    result["Content-Type"] = "application/json";
  }
  return result;
}

test("borrow and return are owner-scoped, duplicate-safe, and restore one copy", async (t) => {
  const book = createBook();
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const unauthenticated = await fetch(url);
  assert.equal(unauthenticated.status, 401);

  const createdResponse = await fetch(url, {
    method: "POST",
    headers: headers("reader-one", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  assert.equal(createdResponse.status, 201);
  const { borrow } = await createdResponse.json();
  assert.equal(borrow.status, "active");
  assert.equal(borrow.book.title, book.title);
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 0);

  const duplicate = await fetch(url, {
    method: "POST",
    headers: headers("reader-one", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  assert.equal(duplicate.status, 409);

  const forgedUser = await fetch(url, {
    method: "POST",
    headers: headers("reader-two", { bookId: book._id.toString(), borrowerId: "reader-one" }),
    body: JSON.stringify({ bookId: book._id.toString(), borrowerId: "reader-one" }),
  });
  assert.equal(forgedUser.status, 400);

  const records = await fetch(url, { headers: headers("reader-one") });
  assert.equal((await records.json()).borrows.length, 1);
  const otherReaderRecords = await fetch(url, { headers: headers("reader-two") });
  assert.deepEqual((await otherReaderRecords.json()).borrows, []);

  const wrongOwnerReturn = await fetch(`${url}/${borrow.id}/return`, {
    method: "PATCH",
    headers: headers("reader-two"),
  });
  assert.equal(wrongOwnerReturn.status, 404);

  const returnedResponse = await fetch(`${url}/${borrow.id}/return`, {
    method: "PATCH",
    headers: headers("reader-one"),
  });
  assert.equal(returnedResponse.status, 200);
  assert.equal((await returnedResponse.json()).borrow.status, "returned");
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);

  const repeatedReturn = await fetch(`${url}/${borrow.id}/return`, {
    method: "PATCH",
    headers: headers("reader-one"),
  });
  assert.equal(repeatedReturn.status, 409);
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);
});

test("DELETE /:id returns the borrow and keeps its history", async (t) => {
  const book = createBook();
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const createdResponse = await fetch(url, {
    method: "POST",
    headers: headers("reader-one", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  const { borrow } = await createdResponse.json();

  const returnedResponse = await fetch(`${url}/${borrow.id}`, {
    method: "DELETE",
    headers: headers("reader-one"),
  });
  assert.equal(returnedResponse.status, 200);
  assert.equal((await returnedResponse.json()).borrow.status, "returned");
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);

  const historyResponse = await fetch(url, { headers: headers("reader-one") });
  assert.equal((await historyResponse.json()).borrows[0].status, "returned");

  const repeatedReturn = await fetch(`${url}/${borrow.id}`, {
    method: "DELETE",
    headers: headers("reader-one"),
  });
  assert.equal(repeatedReturn.status, 409);
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);
});

test("stock limits concurrent borrowing and owners cannot borrow their own books", async (t) => {
  const book = createBook();
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const responses = await Promise.all(
    ["reader-one", "reader-two"].map((userId) =>
      fetch(url, {
        method: "POST",
        headers: headers(userId, { bookId: book._id.toString() }),
        body: JSON.stringify({ bookId: book._id.toString() }),
      }),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 0);
  assert.equal(
    (await borrowsCollection.find({}).toArray()).filter((borrow) => borrow.status === "active")
      .length,
    1,
  );

  const ownerBorrow = await fetch(url, {
    method: "POST",
    headers: headers("owner", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  assert.equal(ownerBorrow.status, 403);
});

test("concurrent duplicate requests create only one active loan", async (t) => {
  const book = createBook(2);
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const responses = await Promise.all(
    [0, 1].map(() =>
      fetch(url, {
        method: "POST",
        headers: headers("reader-one", { bookId: book._id.toString() }),
        body: JSON.stringify({ bookId: book._id.toString() }),
      }),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);
  assert.equal(
    (await borrowsCollection.find({ borrowerId: "reader-one", status: "active" }).toArray())
      .length,
    1,
  );
});

test("a shared book with no available copies cannot be borrowed", async (t) => {
  const book = createBook(0);
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const response = await fetch(url, {
    method: "POST",
    headers: headers("reader-one", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await borrowsCollection.find({}).toArray(), []);
});

test("private books cannot be borrowed", async (t) => {
  const book = { ...createBook(1), isShared: false };
  const booksCollection = createMemoryCollection([book]);
  const borrowsCollection = createMemoryCollection();
  const url = await startBorrowServer(t, booksCollection, borrowsCollection);

  const response = await fetch(url, {
    method: "POST",
    headers: headers("reader-one", { bookId: book._id.toString() }),
    body: JSON.stringify({ bookId: book._id.toString() }),
  });
  assert.equal(response.status, 404);
  assert.equal((await booksCollection.findOne({ _id: book._id })).availableCopies, 1);
});
