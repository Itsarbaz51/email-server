import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { SMTPServer } from "smtp-server";
import { serverOptions } from "./smtp/smtpServer.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED SUCCESSFULLY");

    const relayServer = new SMTPServer({
      ...serverOptions,
      name: "relay",
      authOptional: true,
      onConnect(session, callback) {
        console.log(`📡 Relay client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    relayServer.on("error", (err) => {
      console.error("❌ Relay server error:", err);
    });

    relayServer.listen(25, "0.0.0.0", () => {
      console.log("📥 Relay server running on port 25");
    });

    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP server running on port ${PORT}`);
    });

    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down gracefully...");
      await Promise.all([
        new Promise((res) => relayServer.close(res)),
        Prisma.$disconnect(),
      ]);
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
})();
