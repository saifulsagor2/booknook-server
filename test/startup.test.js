import assert from "node:assert/strict";
import test from "node:test";
import { formatStartupError } from "../index.js";

test("startup errors include their message and code without MongoDB credentials", () => {
  const error = new Error(
    "Authentication failed for mongodb://booknook-user:private-password@db.example/booknook",
  );
  error.code = 18;

  assert.equal(
    formatStartupError(error),
    "Failed to start the BookNook API: Authentication failed for [REDACTED_MONGODB_URI] (code: 18)",
  );
});

test("startup errors retain missing configuration details", () => {
  assert.equal(
    formatStartupError(
      new Error("Missing required environment variables: BETTER_AUTH_URL, BETTER_AUTH_SECRET"),
    ),
    "Failed to start the BookNook API: Missing required environment variables: BETTER_AUTH_URL, BETTER_AUTH_SECRET",
  );
});

test("startup errors preserve the primary MongoDB error when cleanup also fails", () => {
  const error = new Error(
    "Authentication failed for mongodb://booknook-user:private-password@db.example/booknook",
  );
  error.code = "AuthenticationFailed";

  assert.equal(
    formatStartupError(
      new AggregateError(
        [error, new Error("Secondary cleanup failure")],
        "MongoDB connection failed and its client could not be closed.",
      ),
    ),
    "Failed to start the BookNook API: Authentication failed for [REDACTED_MONGODB_URI] (code: AuthenticationFailed) (MongoDB client cleanup also failed)",
  );
});
