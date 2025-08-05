import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    await Prisma.$connect();
    console.log("✅ DATABASE CONNECTED SUCCESSFULLY");

    const PORT = process.env.PORT || 9000;
    app.listen(PORT, () => {
      console.log(`🚀 HTTP server running on port ${PORT}`);
    });

    process.on("SIGTERM", async () => {
      console.log("🛑 Shutting down gracefully...");
      await Prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
})();
