import Prisma from "../db/db.js";
import nodemailer from "nodemailer";
import { decrypt } from "../utils/encryption.js"; // wherever you have it
import { comparePassword } from "../utils/utils.js";

export const getMailTransporter = async (fullEmail) => {
  console.log("Creating transporter for:", fullEmail);
  
  try {
    const mailbox = await Prisma.mailbox.findFirst({
      where: {
        address: fullEmail.toLowerCase(),
        domain: { verified: true },
      },
      include: {
        domain: {
          select: {
            name: true,
            dkimPrivateKey: true,
            dkimSelector: true,
          },
        },
      },
    });

    console.log("Mailbox found:", mailbox);
    if (!mailbox) throw new Error("Mailbox not found");
    if (!mailbox.domain?.dkimPrivateKey) throw new Error("DKIM not configured");

    const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;
    if (!dkimPrivateKey) {
      throw new Error("DKIM private key is missing for domain: " + domainName);
    }
    console.log("Using DKIM for domain:", domainName);
    console.log("DKIM Selector:", dkimSelector || "dkim");
    console.log("DKIM Private Key Length:", dkimPrivateKey.length);

    // 👇 Decrypt the encrypted password from DB
    const decryptedPassword = decrypt(mailbox.smtpPasswordEncrypted);

    console.log("Plain SMTP Password:", decryptedPassword);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || `mail.${domainName}`,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // Use STARTTLS on port 587
      requireTLS: true,
      auth: {
        user: fullEmail.trim().toLowerCase(),
        pass: decryptedPassword.trim(),
      },
      dkim: dkimPrivateKey && {
        domainName,
        keySelector: dkimSelector || "dkim",
        privateKey: dkimPrivateKey,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
      logger: process.env.NODE_ENV !== "production",
      debug: process.env.NODE_ENV !== "production",
    });
    console.log("Transporter created successfully for:", transporter);

    await transporter.verify();
    console.log("SMTP connection verified successfully");
    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw error;
  }
};
