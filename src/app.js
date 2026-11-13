import cors from "cors";
import express from "express";

export function createApp(clientUrl = process.env.CLIENT_URL) {
  const app = express();

  app.use(
    cors({
      origin: clientUrl || false,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "booknook-api",
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ message: "Route not found." });
  });

  return app;
}
