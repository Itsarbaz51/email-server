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

    // Create separate SMTP servers for submission and relay
    const submissionServer = new SMTPServer({
      ...serverOptions,
      name: "submission",
      secure: true, // Force TLS for submission port
      authMethods: ["PLAIN", "LOGIN"], // Standard auth methods
      onAuth(auth, session, callback) {
        console.log(`🔐 Submission auth attempt: ${auth.username}`);
        serverOptions.onAuth(auth, session, callback);
      },
      onConnect(session, callback) {
        console.log(`📡 Submission client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    const relayServer = new SMTPServer({
      ...serverOptions,
      name: "relay",
      secure: false, // Allow plaintext for compatibility
      authOptional: true, // For relaying
      onConnect(session, callback) {
        console.log(`📡 Relay client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    // Error handling for SMTP servers
    submissionServer.on("error", (err) => {
      console.error("❌ Submission server error:", err);
    });

    relayServer.on("error", (err) => {
      console.error("❌ Relay server error:", err);
    });

    // Start servers
    submissionServer.listen(587, "0.0.0.0", () => {
      console.log("📤 Submission server running on port 587 (Sending emails)");
    });

    relayServer.listen(25, "0.0.0.0", () => {
      console.log("📥 Relay server running on port 25 (Receiving emails)");
    });

    // HTTP API Server
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP SERVER RUNNING ON http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down servers gracefully...");
      await new Promise((resolve) => submissionServer.close(resolve));
      await new Promise((resolve) => relayServer.close(resolve));
      await Prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ SERVER START FAILED:", error);
    process.exit(1);
  }
})();
