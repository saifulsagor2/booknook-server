import { createRemoteJWKSet, jwtVerify } from "jose";

export function requireAuth({ jwksUrl, issuer, audience }) {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return async (req, res, next) => {
    const authorization = req.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({ message: "Authentication is required." });
    }

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        return res.status(401).json({ message: "The authentication token is invalid." });
      }

      req.auth = {
        userId: payload.sub,
        email: typeof payload.email === "string" ? payload.email : null,
        name: typeof payload.name === "string" ? payload.name : null,
      };
      return next();
    } catch {
      return res.status(401).json({ message: "The authentication token is invalid or expired." });
    }
  };
}
