import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("getMailTransporter called for:", fullEmail);

  const [username, domainPart] = fullEmail.split("@");

  if (!username || !domainPart) {
    throw new Error("Invalid email format");
  }

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: username,
      domain: {
        name: domainPart,
        verified: true,
      },
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

  console.log("mailbox fetched:", mailbox);

  if (!mailbox) {
    throw new Error("Mailbox not found or domain not verified");
  }

  if (!mailbox.domain?.dkimPrivateKey) {
    throw new Error("Domain DKIM key not configured");
  }

  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

  // Use environment SMTP settings or default to domain-based
  const smtpHost = process.env.SMTP_HOST || `mail.${domainName}`;
  const smtpPort = process.env.SMTP_PORT || 587;
  const smtpSecure = process.env.SMTP_SECURE === "true" || false;

  console.log("Creating nodemailer transport with:", {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    user: fullEmail,
  });

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: fullEmail,
      pass: rawPassword,
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
    tls: {
      rejectUnauthorized: false,
    },
    // Additional options for better compatibility
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
  });

  // Verify transporter configuration
  try {
    await transporter.verify();
    console.log("SMTP transporter verified successfully");
  } catch (error) {
    console.error("SMTP transporter verification failed:", error);
    throw new Error(`SMTP configuration error: ${error.message}`);
  }

  return transporter;
};
