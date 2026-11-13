import { MongoClient } from "mongodb";

let client;
let database;

export async function connectToDatabase(uri, dbName) {
  if (!uri || !dbName) {
    throw new Error("A MongoDB URI and database name are required.");
  }

  if (database) {
    return database;
  }

  const mongoClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await mongoClient.connect();
    const connectedDatabase = mongoClient.db(dbName);
    await connectedDatabase.command({ ping: 1 });
    client = mongoClient;
    database = connectedDatabase;
    return database;
  } catch (error) {
    await mongoClient.close();
    throw error;
  }
}

export function getDatabase() {
  if (!database) {
    throw new Error("MongoDB has not been connected.");
  }

  return database;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
}
