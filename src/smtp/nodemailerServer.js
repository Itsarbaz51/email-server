import nodemailer from "nodemailer";
import dotenv from "dotenv";
import Prisma from "../db/db.js";

dotenv.config();

export const getMailTransporter = async (fullEmail, rawPassword) => {
  const email = fullEmail.trim().toLowerCase();

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: email,
      domain: {
        is: { verified: true },
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

  if (!mailbox) throw new Error("Mailbox not found or domain not verified");
  if (!mailbox.domain?.dkimPrivateKey) throw new Error("DKIM key missing");

  const { name: domainName, dkimPrivateKey, dkimSelector } = mailbox.domain;

  const transporter = nodemailer.createTransport({
    host: `mail.${domainName}`,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: email,
      pass: rawPassword,
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
    tls: {
      rejectUnauthorized: false, // skip cert check in dev
    },
    logger: process.env.NODE_ENV !== "production",
    debug: process.env.NODE_ENV !== "production",
  });

  await transporter.verify(); // throws error if not connected
  return transporter;
};
