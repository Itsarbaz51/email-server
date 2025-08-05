import Prisma from "../db/db.js";
import nodemailer from "nodemailer";
import { decrypt } from "../utils/encryption.js";

export const getMailTransporter = async (fullEmail) => {
  try {
    // 1. DB se mailbox fetch karo
    const mailbox = await Prisma.mailbox.findFirst({
      where: {
        address: fullEmail.toLowerCase(),
        domain: { verified: true },
      },
      include: {
        domain: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!mailbox) throw new Error("Mailbox not found");

    // 2. SMTP password decrypt karo
    const decryptedPassword = decrypt(mailbox.smtpPasswordEncrypted);
    if (!decryptedPassword) throw new Error("Failed to decrypt SMTP password");

    console.log("Decrypted SMTP Password:", decryptedPassword);

    // 3. SMTP host aur port decide karo
    const smtpHost = process.env.SMTP_HOST || `mail.${mailbox.domain.name}`;
    const smtpPort = Number(process.env.SMTP_PORT) || 587;

    // 4. Nodemailer transporter bina DKIM ya extra config ke banao sirf auth verify ke liye
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: fullEmail.toLowerCase(),
        pass: decryptedPassword,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
      logger: true,
      debug: true,
    });

    // 5. Verify credentials
    await transporter.verify();
    console.log("SMTP credentials are valid!");

    return true;
  } catch (error) {
    console.error("SMTP verification failed:", error.message);
    return false;
  }
};

// Example usage:
(async () => {
  const emailToTest = "info@primewebdev.in";
  const result = await verifySMTPCredentials(emailToTest);
  console.log("Verification result:", result);
})();
