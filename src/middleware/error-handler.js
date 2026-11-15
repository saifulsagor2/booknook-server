export function errorHandler(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON request body." });
  }

  console.error("An unexpected error occurred while handling a request.");
  return res.status(500).json({ message: "Internal server error." });
}
