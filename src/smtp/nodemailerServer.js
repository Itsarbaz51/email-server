import nodemailer from "nodemailer";
import dotenv from "dotenv";
import Prisma from "../db/db.js";
dotenv.config();

export const getMailTransporter = async (fullEmail, rawPassword) => {
  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: fullEmail.toLowerCase(),
      domain: { is: { verified: true } },
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
    secure: false,
    requireTLS: true,
    auth: {
      user: fullEmail.trim().toLowerCase(),
      pass: rawPassword,
    },
    dkim: {
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

  await transporter.verify();
  return transporter;
};
