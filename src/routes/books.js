import { Router } from "express";
import { ObjectId } from "mongodb";

const fields = {
  title: { label: "Title", maxLength: 150, required: true },
  author: { label: "Author", maxLength: 100, required: true },
  category: { label: "Category", maxLength: 60, required: true },
  description: { label: "Description", maxLength: 1200, required: false },
  availableCopies: { label: "Available copies", required: false },
  isShared: { label: "Catalog sharing", required: false },
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
      } else if (!partial && field === "availableCopies") {
        input[field] = 0;
      } else if (!partial && field === "isShared") {
        input[field] = false;
      } else if (!partial && rules.required) {
        return { error: `${rules.label} is required.` };
      }
      continue;
    }

    if (field === "availableCopies") {
      if (!Number.isSafeInteger(value) || value < 0 || value > 10000) {
        return { error: "Available copies must be a whole number between 0 and 10000." };
      }
      input[field] = value;
      continue;
    }

    if (field === "isShared") {
      if (typeof value !== "boolean") {
        return { error: "Catalog sharing must be true or false." };
      }
      input[field] = value;
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

function serializeBook(book, userId) {
  return {
    id: book._id.toString(),
    title: book.title,
    author: book.author,
    category: book.category,
    description: book.description,
    availableCopies: book.availableCopies ?? 0,
    isShared: book.isShared === true,
    canBorrow: book.ownerId !== userId && book.isShared === true,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

class ActiveBorrowError extends Error {}

export function createBooksRouter({
  collection,
  authenticate,
  borrowsCollection,
  client,
}) {
  const router = Router();
  router.use(authenticate);

  router.get("/catalog", async (req, res) => {
    const books = await collection
      .find({ isShared: true })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    return res.status(200).json({
      books: books.map((book) => serializeBook(book, req.auth.userId)),
    });
  });

  router.get("/catalog/:id", async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
      return res.status(404).json({ message: "Book not found." });
    }

    const book = await collection.findOne({ _id: id, isShared: true });
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }
    return res.status(200).json({ book: serializeBook(book, req.auth.userId) });
  });

  router.get("/:id", async (req, res) => {
    const id = toObjectId(req.params.id);
    if (!id) {
      return res.status(404).json({ message: "Book not found." });
    }

    let book = await collection.findOne({
      _id: id,
      ownerId: req.auth.userId,
    });
    if (!book) {
      book = await collection.findOne({ _id: id, isShared: true });
    }
    if (!book) {
      return res.status(404).json({ message: "Book not found." });
    }
    return res.status(200).json({ book: serializeBook(book, req.auth.userId) });
  });

  router.get("/", async (req, res) => {
    const books = await collection
      .find({ ownerId: req.auth.userId })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    res.status(200).json({
      books: books.map((book) => serializeBook(book, req.auth.userId)),
    });
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

    const deleteBook = async (session) => {
      const options = session ? { session } : undefined;
      const ownedBook = await collection.findOne(
        { _id: id, ownerId: req.auth.userId },
        options,
      );
      if (!ownedBook) {
        return { deletedCount: 0 };
      }

      if (borrowsCollection) {
        const activeBorrow = await borrowsCollection.findOne(
          { bookId: id, status: "active" },
          options,
        );
        if (activeBorrow) {
          throw new ActiveBorrowError("Return active loans before removing this book.");
        }
      }

      return collection.deleteOne(
        { _id: id, ownerId: req.auth.userId },
        options,
      );
    };

    try {
      let result;
      if (client && borrowsCollection) {
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            result = await deleteBook(session);
          });
        } finally {
          await session.endSession();
        }
      } else {
        result = await deleteBook();
      }

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Book not found." });
      }
      return res.status(204).end();
    } catch (error) {
      if (error instanceof ActiveBorrowError) {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }
  });

  return router;
}
