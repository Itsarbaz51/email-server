import Prisma from "../db/db.js";
import nodemailer from "nodemailer";
import { decrypt } from "../utils/encryption.js";

export const getMailTransporter = async (fullEmail) => {
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

    if (!mailbox) throw new Error("Mailbox not found");
    if (!mailbox.domain?.dkimPrivateKey) {
      console.warn(
        "Warning: DKIM not configured for domain",
        mailbox.domain?.name
      );
    }

    const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

    // Decrypt SMTP password
    const decryptedPassword = decrypt(mailbox.smtpPasswordEncrypted);
    if (!decryptedPassword) throw new Error("Failed to decrypt SMTP password");
    console.log("Decrypted SMTP Password:", decryptedPassword);

    // Use env vars or fallback to mail.<domain>
    const smtpHost = process.env.SMTP_HOST || `mail.${domainName}`;
    const smtpPort = Number(process.env.SMTP_PORT) || 587;
    const isProduction = process.env.NODE_ENV === "production";

    const transporterOptions = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for SMTPS on port 465, false for STARTTLS on 587
      auth: {
        user: fullEmail.trim().toLowerCase(),
        pass: decryptedPassword,
      },
      dkim: dkimPrivateKey
        ? {
            domainName,
            keySelector: dkimSelector || "dkim",
            privateKey: dkimPrivateKey,
          }
        : undefined,
      tls: {
        // In production, verify certs; in dev, skip to avoid issues with self-signed certs
        rejectUnauthorized: isProduction,
      },
      logger: !isProduction,
      debug: !isProduction,
    };

    // For STARTTLS, set requireTLS only if not using secure port 465
    if (!transporterOptions.secure) {
      transporterOptions.requireTLS = true;
    }

    const transporter = nodemailer.createTransport(transporterOptions);

    // Verify SMTP connection
    await transporter.verify();
    console.log("SMTP connection verified successfully");

    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw error;
  }
};
