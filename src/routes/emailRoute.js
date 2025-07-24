import express from "express";
import { getMessages, sendEmail } from "../controller/emailController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/send-email", authMiddleware, sendEmail);
router.get("/get-message/:mailboxId", authMiddleware, getMessages);

export default router;
