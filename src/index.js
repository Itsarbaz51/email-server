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

    // SMTP Submission Server (port 587)
    const submissionServer = new SMTPServer({
      ...serverOptions,
      name: "submission",
      authMethods: ["PLAIN", "LOGIN"],
      onConnect(session, callback) {
        console.log(`📡 Submission client connected: ${session.remoteAddress}`);
        serverOptions.onConnect(session, callback);
      },
    });

    // Error handling
    submissionServer.on("error", (err) => {
      console.error("❌ Submission server error:", err);
    });

    // Start Submission Server only (Postfix handles relay on port 25)
    submissionServer.listen(587, "0.0.0.0", () => {
      console.log("📤 Submission server running on port 587");
    });

    // Start HTTP API Server
    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP server running on port ${PORT}`);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down gracefully...");
      await Promise.all([
        new Promise((res) => submissionServer.close(res)),
        Prisma.$disconnect(),
      ]);
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
})();
