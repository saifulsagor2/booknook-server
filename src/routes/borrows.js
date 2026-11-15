import { Router } from "express";
import { ObjectId } from "mongodb";

class BorrowingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toObjectId(id) {
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id)
    ? new ObjectId(id)
    : undefined;
}

function serializeBorrow(borrow) {
  return {
    id: borrow._id.toString(),
    bookId: borrow.bookId.toString(),
    book: borrow.book,
    status: borrow.status,
    borrowedAt: borrow.borrowedAt,
    returnedAt: borrow.returnedAt,
  };
}

function respondToError(error, res, next) {
  if (error instanceof BorrowingError) {
    return res.status(error.status).json({ message: error.message });
  }
  return next(error);
}

export function createBorrowsRouter({
  booksCollection,
  borrowsCollection,
  client,
  authenticate,
}) {
  const router = Router();
  router.use(authenticate);

  router.get("/", async (req, res) => {
    const borrows = await borrowsCollection
      .find({ borrowerId: req.auth.userId })
      .sort({ borrowedAt: -1, _id: -1 })
      .toArray();
    return res.status(200).json({ borrows: borrows.map(serializeBorrow) });
  });

  router.post("/", async (req, res, next) => {
    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== "bookId")
    ) {
      return res.status(400).json({ message: "A bookId is required." });
    }

    const bookId = toObjectId(req.body.bookId);
    if (!bookId) {
      return res.status(400).json({ message: "A valid bookId is required." });
    }

    const borrowerId = req.auth.userId;
    const session = client.startSession();
    try {
      const borrow = await session.withTransaction(async () => {
        const activeBorrow = await borrowsCollection.findOne(
          { bookId, borrowerId, status: "active" },
          { session },
        );
        if (activeBorrow) {
          throw new BorrowingError(409, "You already have an active loan for this book.");
        }

        const book = await booksCollection.findOne(
          { _id: bookId, isShared: true },
          { session },
        );
        if (!book) {
          throw new BorrowingError(404, "Book not found.");
        }
        if (book.ownerId === borrowerId) {
          throw new BorrowingError(403, "You cannot borrow your own book.");
        }

        const stockUpdate = await booksCollection.updateOne(
          {
            _id: bookId,
            isShared: true,
            ownerId: { $ne: borrowerId },
            availableCopies: { $gt: 0 },
          },
          { $inc: { availableCopies: -1 } },
          { session },
        );
        if (stockUpdate.matchedCount !== 1) {
          throw new BorrowingError(409, "No copies are currently available.");
        }

        const borrow = {
          bookId,
          borrowerId,
          book: {
            title: book.title,
            author: book.author,
            category: book.category,
            description: book.description ?? "",
          },
          status: "active",
          borrowedAt: new Date(),
          returnedAt: null,
        };
        const result = await borrowsCollection.insertOne(borrow, { session });
        return serializeBorrow({ ...borrow, _id: result.insertedId });
      });

      return res.status(201).json({ borrow });
    } catch (error) {
      return respondToError(error, res, next);
    } finally {
      await session.endSession();
    }
  });

  router.patch("/:id/return", async (req, res, next) => {
    const borrowId = toObjectId(req.params.id);
    if (!borrowId) {
      return res.status(404).json({ message: "Borrow record not found." });
    }

    const borrowerId = req.auth.userId;
    const session = client.startSession();
    try {
      const borrow = await session.withTransaction(async () => {
        const existing = await borrowsCollection.findOne(
          { _id: borrowId, borrowerId },
          { session },
        );
        if (!existing) {
          throw new BorrowingError(404, "Borrow record not found.");
        }
        if (existing.status !== "active") {
          throw new BorrowingError(409, "This book has already been returned.");
        }

        const returnedAt = new Date();
        const result = await borrowsCollection.updateOne(
          { _id: borrowId, borrowerId, status: "active" },
          { $set: { status: "returned", returnedAt } },
          { session },
        );
        if (result.matchedCount !== 1) {
          throw new BorrowingError(409, "This book has already been returned.");
        }

        const stockUpdate = await booksCollection.updateOne(
          { _id: existing.bookId },
          { $inc: { availableCopies: 1 } },
          { session },
        );
        if (stockUpdate.matchedCount !== 1) {
          throw new BorrowingError(409, "The book is no longer available to return.");
        }

        return serializeBorrow({ ...existing, status: "returned", returnedAt });
      });

      return res.status(200).json({ borrow });
    } catch (error) {
      return respondToError(error, res, next);
    } finally {
      await session.endSession();
    }
  });

  return router;
}
