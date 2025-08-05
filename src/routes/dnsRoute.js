import { Router } from "express";
import {
  generateDNSRecords,
  verifyDnsHandler,
} from "../controller/dnsController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = Router();

// POST /dns - generate DKIM, SPF, DMARC, A, MX records
router.post("/dns", authMiddleware, generateDNSRecords);

// GET /dns/:id/verify?type=TXT|A|MX - verify DNS records
router.get("/dns/:id/verify", authMiddleware, verifyDnsHandler);

export default router;
