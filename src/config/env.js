export function getConfig(env = process.env) {
  const requiredNames = [
    "MONGODB_URI",
    "MONGODB_DB_NAME",
    "CLIENT_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
  ];
  const missingNames = requiredNames.filter((name) => !env[name]?.trim());

  if (missingNames.length > 0) {
    throw new Error(`Missing required environment variables: ${missingNames.join(", ")}`);
  }

  const mongoUri = env.MONGODB_URI.trim();
  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error("MONGODB_URI must use mongodb:// or mongodb+srv://.");
  }

  if (env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters long.");
  }

  const port = env.PORT?.trim() ? Number(env.PORT) : 8000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const clientUrl = getHttpOrigin(env.CLIENT_URL, "CLIENT_URL");
  const betterAuthUrl = getHttpOrigin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");

  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be configured.");
  }

  return {
    port,
    mongoUri,
    mongoDbName: env.MONGODB_DB_NAME.trim(),
    clientUrl,
    betterAuthUrl,
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    googleClientId,
    googleClientSecret,
  };
}

function getHttpOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }

  return url.origin;
}
