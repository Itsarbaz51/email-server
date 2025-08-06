import { Router } from "express";
import {
  generateDNSRecordsHandler,
  verifyDNSRecordsHandler,
} from "../controller/dnsController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/generate-dns-records", authMiddleware, generateDNSRecordsHandler);
router.get("/verify-dns-record/:id", verifyDNSRecordsHandler);

export default router;
