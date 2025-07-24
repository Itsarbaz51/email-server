import dotenv from "dotenv";
import app from "./app.js";
import Prisma from "./db/db.js";
import { server } from "./smtp/smtpServer.js";
import serverless from "serverless-http"; // ✅ New line for Vercel

dotenv.config({ path: "./.env" });

// DB connect karo
async function db_connection() {
  try {
    await Prisma.$connect();
    console.log("DATABASE CONNECTED SUCCESSFULLY");
  } catch (error) {
    console.error("DATABASE CONNECTION FAILED ::", error);
    throw error;
  }
}

await db_connection(); // ✅ call without .then()

// ✅ SMTP server start karo (this part only runs locally or in custom hosting, not on Vercel)
if (process.env.NODE_ENV !== "production") {
  const SMTP_PORT = process.env.SMTP_PORT || 2525;
  server.listen(SMTP_PORT, () => {
    console.log(`SMTP SERVER RUNNING ON PORT ${SMTP_PORT}`);
  });
}

// ✅ Vercel ke liye Express app export karo as handler
export const handler = serverless(app);
