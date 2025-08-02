import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("getMailTransporter called for:", fullEmail);

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: fullEmail.toLowerCase(),
      domain: {
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

  // Use environment SMTP settings or fallback to mail.<domain>
  const smtpHost = process.env.SMTP_HOST || `mail.${domainName}`;
  const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
  const smtpSecure = process.env.SMTP_SECURE === "true";

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
    pool: false,
    maxConnections: 1,
    maxMessages: 1,
  });

  try {
    await transporter.verify();
    console.log("SMTP transporter verified successfully");
  } catch (error) {
    console.error("SMTP transporter verification failed:", error);
    throw new Error(`SMTP configuration error: ${error.message}`);
  }

  return transporter;
};
