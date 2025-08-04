import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { server } from "./smtp/smtpServer.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED SUCCESSFULLY");

    // Listen on 25 & 587 both
    const RECEIVE_PORTS = [25, 587];
    RECEIVE_PORTS.forEach((port) => {
      server.listen(port, "0.0.0.0", () => {
        console.log(
          `📨 SMTP SERVER RUNNING ON PORT ${port} (Receiving emails)`
        );
      });
    });

    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP SERVER RUNNING ON http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ SERVER START FAILED:", error);
    process.exit(1);
  }
})();
