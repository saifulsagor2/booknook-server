export function getConfig(env = process.env) {
  const requiredNames = ["MONGODB_URI", "MONGODB_DB_NAME", "CLIENT_URL"];
  const missingNames = requiredNames.filter((name) => !env[name]?.trim());

  if (missingNames.length > 0) {
    throw new Error(`Missing required environment variables: ${missingNames.join(", ")}`);
  }

  const port = Number(env.PORT ?? 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  let clientUrl;
  try {
    clientUrl = new URL(env.CLIENT_URL);
  } catch {
    throw new Error("CLIENT_URL must be a valid URL.");
  }

  if (clientUrl.protocol !== "http:" && clientUrl.protocol !== "https:") {
    throw new Error("CLIENT_URL must use HTTP or HTTPS.");
  }

  return {
    port,
    mongoUri: env.MONGODB_URI,
    mongoDbName: env.MONGODB_DB_NAME,
    clientUrl: clientUrl.origin,
  };
}
