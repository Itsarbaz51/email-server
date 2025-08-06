import dotenv from "dotenv";
import { SMTPServer } from "smtp-server";
import { serverOptions } from "./smtp/smtpServer.js";
import app from "./app.js";
import Prisma from "./db/db.js";

dotenv.config({ path: "./.env" });

(async function main() {
  try {
    console.log("Connecting to database...");
    await Prisma.$connect();
    console.log("✅ Database connected");

    // SMTP सर्वर कॉन्फिगरेशन
    const smtpServer = new SMTPServer({
      ...serverOptions,
      name: "my-mail-server",
      banner: "Welcome to My Mail Server",
      logger: true,
    });

    smtpServer.on("error", (err) => {
      console.error("SMTP Server Error:", err);
    });

    // पोर्ट 25 पर सर्वर स्टार्ट करें
    smtpServer.listen(25, "0.0.0.0", () => {
      console.log("🚀 SMTP server running on port 25");
    });

    // HTTP API सर्वर
    app.listen(9000, "0.0.0.0", () => {
      console.log("🚀 HTTP server running on port 9000");
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
})();
