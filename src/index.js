import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { SMTPServer } from "smtp-server";
import { serverOptions } from "./smtp/smtpServer.js"; // export server config instead of single instance

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED SUCCESSFULLY");

    // Create two SMTP server instances for port 25 and 587
    const ports = [25, 587];
    ports.forEach((port) => {
      const smtp = new SMTPServer(serverOptions);
      smtp.listen(port, "0.0.0.0", () => {
        console.log(
          `📨 SMTP SERVER RUNNING ON PORT ${port} (Receiving emails)`
        );
      });
    });

    // HTTP API Server
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP SERVER RUNNING ON http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ SERVER START FAILED:", error);
    process.exit(1);
  }
})();
