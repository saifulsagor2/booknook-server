import "dotenv/config";
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

    server.on("error", (error) => {
      console.error("The BookNook API server encountered an error:", error);
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
    console.error("Failed to start the BookNook API:", error);
    await closeDatabase();
    process.exitCode = 1;
    return undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startServer();
}
