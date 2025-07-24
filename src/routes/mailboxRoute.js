import express from "express";
import {
  createMailbox,
  getMailboxes,
  updateMailbox,
  deleteMailbox,
} from "../controller/mailboxController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/create-mailbox", authMiddleware, createMailbox);
router.get("/get-mailbox", authMiddleware, getMailboxes);
router.put("/update-mailbox/:id", authMiddleware, updateMailbox);
router.delete("/delete-mailbox/:id", authMiddleware, deleteMailbox);

export default router;
