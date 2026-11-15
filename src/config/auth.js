import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";

export const API_JWT_AUDIENCE = "booknook-api";

export function getAuthOptions(config) {
  const options = {
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    trustedOrigins: [config.clientUrl],
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      jwt({
        jwt: {
          issuer: config.betterAuthUrl,
          audience: API_JWT_AUDIENCE,
          expirationTime: "15m",
          definePayload: ({ user }) => ({
            email: user.email,
            name: user.name,
          }),
        },
      }),
    ],
  };

  if (config.googleClientId && config.googleClientSecret) {
    options.socialProviders = {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    };
  }

  return options;
}

export function createAuth({ database, client, config }) {
  if (!database || !client) {
    throw new Error("A connected MongoDB database and client are required for authentication.");
  }

  return betterAuth({
    ...getAuthOptions(config),
    database: mongodbAdapter(database, { client }),
  });
}
