import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { plainSMTPServer } from "./smtp/smtpPlain.js";
import { secureSMTPServer } from "./smtp/smtpTls.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED");

    // Receive Plain SMTP (Optional)
    const SMTP_PORT = process.env.SMTP_PORT_RECEIVE || 25;
    plainSMTPServer.listen(SMTP_PORT, "0.0.0.0", () => {
      console.log(`📨 PLAIN SMTP SERVER RUNNING ON ${SMTP_PORT}`);
    });

    // Receive Secure SMTPS
    const SMTPS_PORT = 465;
    secureSMTPServer.listen(SMTPS_PORT, "0.0.0.0", () => {
      console.log(`🔐 SMTPS SERVER RUNNING ON ${SMTPS_PORT}`);
    });

    // HTTP Express API
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP SERVER RUNNING ON http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ SERVER START FAILED:", err);
    process.exit(1);
  }
})();
