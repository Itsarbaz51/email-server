import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
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

  if (!mailbox || !mailbox.domain?.dkimPrivateKey) {
    throw new Error("Mailbox or DKIM not found");
  }

  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;
  const smtpHost = process.env.SMTP_HOST || `mail.${domainName}`;
  const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
  const smtpSecure = process.env.SMTP_SECURE === "true";

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
  });

  await transporter.verify();
  return transporter;
};
