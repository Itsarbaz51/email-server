import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { server } from "./smtp/smtpServer.js";

dotenv.config({ path: "./.env" });

// Start everything inside an async function
(async function main() {
  try {
    // 1. Connect to DB
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED SUCCESSFULLY");

    // 2. Start SMTP server (only in dev)
    if (process.env.NODE_ENV !== "production") {
      const SMTP_PORT = process.env.SMTP_PORT || 25;
      server.listen(SMTP_PORT, "0.0.0.0", () => {
        console.log(`📨 SMTP SERVER RUNNING ON PORT ${SMTP_PORT}`);
      });
    }

    // 3. Start HTTP server
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP SERVER RUNNING ON http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ SERVER START FAILED:", error);
    process.exit(1);
  }
})();
