import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { incomingServer } from "./smtp/incomingServer.js";
import { outgoingServer } from "./smtp/outgoingServer.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    console.log("Connecting to database...");
    await Prisma.$connect();
    console.log("✅ Database connected");

    outgoingServer.listen(587, "0.0.0.0", () => {
      console.log("🚀 Outgoing SMTP server running on port 587");
    });

    incomingServer.listen(25, "0.0.0.0", () => {
      console.log("🚀 SMTP server running on port 25");
    });

    app.listen(9000, "0.0.0.0", () => {
      console.log("🚀 HTTP server running on port 9000");
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
})();
