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
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false, // Use STARTTLS
      requireTLS: true,
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
        rejectUnauthorized: false, // For self-signed certs
      },
      logger: true,
      debug: true,
    });

    await transporter.verify();
    console.log("SMTP connection verified successfully");
    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw error;
  }
};
