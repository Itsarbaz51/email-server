import { Router } from "express";
import {
  generateDNSRecords,
  verifyDnsHandler,
} from "../controller/dnsController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/generate-dns-records", authMiddleware, generateDNSRecords);
router.get("/verify-dns-record/:id", verifyDnsHandler);

export default router;
