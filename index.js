import "dotenv/config";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "./src/app.js";
import { closeDatabase, connectToDatabase, getDatabase, getMongoClient } from "./src/config/db.js";
import { createAuth } from "./src/config/auth.js";
import { getConfig } from "./src/config/env.js";

export async function startServer() {
  let server;

  try {
    const config = getConfig();
    await connectToDatabase(config.mongoUri, config.mongoDbName);
    const auth = createAuth({
      database: getDatabase(),
      client: getMongoClient(),
      config,
    });

    server = createApp(config.clientUrl, { auth, config }).listen(config.port, () => {
      console.log(`BookNook API listening on port ${config.port}.`);
    });
    await once(server, "listening");

    server.on("error", (error) => {
      console.error("The BookNook API server encountered an error.");
      process.exitCode = 1;
    });

    const shutdown = (signal) => {
      console.log(`${signal} received. Closing the BookNook API.`);
      server.close(async (error) => {
        if (error) {
          console.error("Could not close the HTTP server cleanly:", error);
          process.exitCode = 1;
        }

        try {
          await closeDatabase();
        } catch (closeError) {
          console.error("Could not close the MongoDB connection cleanly:", closeError);
          process.exitCode = 1;
        }
      });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    return server;
  } catch (error) {
    console.error(formatStartupError(error));
    if (server?.listening) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    try {
      await closeDatabase();
    } catch (closeError) {
      console.error(formatStartupError(closeError).replace("Failed to start", "Failed to close"));
    }
    process.exitCode = 1;
    return undefined;
  }
}

export function formatStartupError(error) {
  const cause =
    error instanceof AggregateError && error.errors.length > 0
      ? error.errors[0]
      : error;
  const message = cause instanceof Error ? cause.message : String(cause);
  const safeMessage = message.replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
    "[REDACTED_MONGODB_URI]",
  );
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  const safeCode =
    typeof code === "number" ||
    (typeof code === "string" && /^[A-Za-z0-9_.-]+$/.test(code))
      ? ` (code: ${code})`
      : "";
  const cleanupNote =
    error instanceof AggregateError
      ? " (MongoDB client cleanup also failed)"
      : "";

  return `Failed to start the BookNook API: ${safeMessage}${safeCode}${cleanupNote}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startServer();
}
