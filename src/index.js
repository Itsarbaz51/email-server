import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { plainSMTPServer } from "./smtp/smtpPlain.js";
import { secureSMTPServer } from "./smtp/smtpTls.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    // 1. Connect to DB
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED");

    // 2. Start Plain SMTP (Receiving on port 25)
    const SMTP_PORT = parseInt(process.env.SMTP_PORT_RECEIVE) || 25;
    plainSMTPServer.listen(SMTP_PORT, "0.0.0.0", () => {
      console.log(`📨 PLAIN SMTP SERVER RUNNING ON PORT ${SMTP_PORT}`);
    });

    // 3. Start Secure SMTPS (Receiving on port 465)
    const SMTPS_PORT = 465;
    secureSMTPServer.listen(SMTPS_PORT, "0.0.0.0", () => {
      console.log(`🔐 SMTPS SERVER RUNNING ON PORT ${SMTPS_PORT}`);
    });

    // 4. Start HTTP Express server (API / Send endpoint)
    const PORT = parseInt(process.env.PORT) || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP API SERVER RUNNING AT http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ SERVER START FAILED:", err);
    process.exit(1);
  }
})();
