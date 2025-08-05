import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
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
    if (!mailbox.domain?.dkimPrivateKey) throw new Error("DKIM not configured");

    const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || `mail.${domainName}`,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // Use STARTTLS on port 587
      requireTLS: true, // Enforce TLS
      auth: {
        user: fullEmail.trim().toLowerCase(), // normalize email
        pass: rawPassword,
      },
      dkim: dkimPrivateKey && {
        domainName,
        keySelector: dkimSelector || "dkim",
        privateKey: dkimPrivateKey,
      },
      tls: {
        // Only use this in development if you have self-signed certs
        rejectUnauthorized: process.env.NODE_ENV === "production",
      },
      logger: process.env.NODE_ENV !== "production", // log only in dev
      debug: process.env.NODE_ENV !== "production", // debug only in dev
    });

    await transporter.verify();
    console.log("SMTP connection verified successfully");
    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw error;
  }
};
