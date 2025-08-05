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

    const submissionServer = new SMTPServer({
      ...serverOptions,
      name: "submission",
      authMethods: ["PLAIN", "LOGIN"],
      onConnect(session, callback) {
        console.log(`📡 Submission client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    const relayServer = new SMTPServer({
      ...serverOptions,
      name: "relay",
      authOptional: true,
      onConnect(session, callback) {
        console.log(`📡 Relay client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    // Error handling
    submissionServer.on("error", (err) => {
      console.error("❌ Submission server error:", err);
    });

    relayServer.on("error", (err) => {
      console.error("❌ Relay server error:", err);
    });

    // Start servers
    submissionServer.listen(587, "0.0.0.0", () => {
      console.log("📤 Submission server running on port 587");
    });

    relayServer.listen(25, "0.0.0.0", () => {
      console.log("📥 Relay server running on port 25");
    });

    // HTTP Server
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP server running on port ${PORT}`);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down gracefully...");
      await Promise.all([
        new Promise((res) => submissionServer.close(res)),
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
