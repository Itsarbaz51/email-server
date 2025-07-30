import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
  console.log("getMailTransporter called for:", fullEmail);

  const [username, domainPart] = fullEmail.split("@");

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: username,
      domain: {
        name: domainPart,
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

  if (!mailbox || !mailbox.domain?.dkimPrivateKey) {
    throw new Error("Mailbox or domain not found for transporter");
  }

  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

  console.log("Creating nodemailer transport with:", {
    host: `mail.${domainName}`,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    user: fullEmail,
  });

  return nodemailer.createTransport({
    host: `mail.${domainName}`,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
    secure: false,
    auth: {
      user: fullEmail,
      pass: rawPassword,
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
  });
};
