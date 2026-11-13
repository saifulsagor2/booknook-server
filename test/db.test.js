import assert from "node:assert/strict";
import test from "node:test";
import { closeDatabase, connectToDatabase, getDatabase } from "../src/config/db.js";

test("getDatabase reports when the database has not been connected", () => {
  assert.throws(() => getDatabase(), /MongoDB has not been connected/);
});

test("connectToDatabase rejects an invalid MongoDB URI without setting a database", async () => {
  await assert.rejects(
    connectToDatabase("not-a-mongodb-uri", "booknook"),
    /Invalid scheme/,
  );
  assert.throws(() => getDatabase(), /MongoDB has not been connected/);
  await closeDatabase();
});

test("closeDatabase is safe when no database connection exists", async () => {
  await assert.doesNotReject(closeDatabase());
});
