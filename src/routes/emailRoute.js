import express from "express";
import { getMessages, sendEmail } from "../controller/emailController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import multer from "multer";
import Prisma from "../db/db.js";

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Send email with optional attachments
router.post(
  "/send-email",
  authMiddleware,
  upload.array("attachments", 5),
  sendEmail
);

// Get messages for a specific mailbox (requires authentication)
router.get("/messages/:mailboxId", authMiddleware, getMessages);

// Get messages for the authenticated user's own mailbox
router.get("/my-messages", authMiddleware, async (req, res) => {
  const userId = req.mailbox?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    const messages = await Prisma.message.findMany({
      where: { mailboxId: userId },
      include: {
        attachments: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Messages retrieved successfully",
      data: messages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve messages",
      error: error.message,
    });
  }
});

export default router;
