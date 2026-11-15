import { Router } from "express";
import { ObjectId } from "mongodb";

const fields = {
  title: { label: "Title", maxLength: 150, required: true },
  author: { label: "Author", maxLength: 100, required: true },
  category: { label: "Category", maxLength: 60, required: true },
  description: { label: "Description", maxLength: 1200, required: false },
};

function parseBookInput(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "A book object is required." };
  }

  const keys = Object.keys(body);
  if (keys.some((key) => !Object.hasOwn(fields, key))) {
    return { error: "The book contains an unsupported field." };
  }
  if (partial && keys.length === 0) {
    return { error: "At least one book field is required." };
  }

  const input = {};
  for (const [field, rules] of Object.entries(fields)) {
    const value = body[field];
    if (value === undefined) {
      if (!partial && field === "description") {
        input[field] = "";
      } else if (!partial && rules.required) {
        return { error: `${rules.label} is required.` };
      }
      continue;
    }

    if (typeof value !== "string") {
      return { error: `${rules.label} must be text.` };
    }

    const trimmedValue = value.trim();
    if (rules.required && !trimmedValue) {
      return { error: `${rules.label} is required.` };
    }
    if (trimmedValue.length > rules.maxLength) {
      return {
        error: `${rules.label} must be ${rules.maxLength} characters or fewer.`,
      };
    }

    input[field] = trimmedValue;
  }

  return { input };
}

function toObjectId(id) {
  return /^[a-f\d]{24}$/i.test(id) ? new ObjectId(id) : undefined;
}

function serializeBook(book) {
  return {
    id: book._id.toString(),
    title: book.title,
    author: book.author,
    category: book.category,
    description: book.description,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

export function createBooksRouter({ collection, authenticate }) {
  const router = Router();
  router.use(authenticate);

  router.get("/", async (req, res) => {
    const books = await collection
      .find({ ownerId: req.auth.userId })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    res.status(200).json({ books: books.map(serializeBook) });
  });

  router.post("/", async (req, res) => {
    const parsed = parseBookInput(req.body);
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const now = new Date();
    const book = {
      ...parsed.input,
      ownerId: req.auth.userId,
      createdAt: now,
      updatedAt: now,
    };
    const result = await collection.insertOne(book);
    return res
      .status(201)
      .json({ book: serializeBook({ ...book, _id: result.insertedId }) });
  });

  router.patch("/:id", async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
      return res.status(404).json({ message: "Book not found." });
    }

    const parsed = parseBookInput(req.body, true);
    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const result = await collection.updateOne(
      { _id: id, ownerId: req.auth.userId },
      { $set: { ...parsed.input, updatedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Book not found." });
    }

    const book = await collection.findOne({ _id: id, ownerId: req.auth.userId });
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }
    return res.status(200).json({ book: serializeBook(book) });
  });

  router.delete("/:id", async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
      return res.status(404).json({ message: "Book not found." });
    }

    const result = await collection.deleteOne({
      _id: id,
      ownerId: req.auth.userId,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Book not found." });
    }
    return res.status(204).end();
  });

  return router;
}
