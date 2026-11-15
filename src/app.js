import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { errorHandler } from "./middleware/error-handler.js";
import { API_JWT_AUDIENCE } from "./config/auth.js";
import { requireAuth } from "./middleware/require-auth.js";
import { createBooksRouter } from "./routes/books.js";

export function createApp(clientUrl = process.env.CLIENT_URL, authContext) {
  const app = express();

  app.use(
    cors({
      origin: clientUrl || false,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  let booksRouter;
  if (authContext) {
    const { auth, config, database } = authContext;
    app.all("/api/auth/*splat", toNodeHandler(auth));
    const authenticate = requireAuth({
      jwksUrl: new URL("/api/auth/jwks", config.betterAuthUrl).href,
      issuer: config.betterAuthUrl,
      audience: API_JWT_AUDIENCE,
    });
    app.get(
      "/api/me",
      authenticate,
      (req, res) => {
        res.status(200).json({
          user: {
            id: req.auth.userId,
            email: req.auth.email,
            name: req.auth.name,
          },
        });
      },
    );
    if (database) {
      booksRouter = createBooksRouter({
        collection: database.collection("books"),
        authenticate,
      });
    }
  }

  app.use(express.json({ limit: "1mb" }));
  if (booksRouter) {
    app.use("/api/books", booksRouter);
  }

  const healthCheck = (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "booknook-api",
    });
  };
  app.get("/", healthCheck);
  app.get("/health", healthCheck);

  app.use((_req, res) => {
    res.status(404).json({ message: "Route not found." });
  });
  app.use(errorHandler);

  return app;
}
