export function errorHandler(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON request body." });
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }

  console.error("An unexpected error occurred while handling a request.");
  return res.status(500).json({ message: "Internal server error." });
}
