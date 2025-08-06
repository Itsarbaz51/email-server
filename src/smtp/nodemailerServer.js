import nodemailer from "nodemailer";
import dotenv from "dotenv";
import Prisma from "../db/db.js";

dotenv.config();

export const getMailTransporter = async (fullEmail) => {
  const email = fullEmail.trim().toLowerCase();

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      address: email,
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

  if (!mailbox) throw new Error("Mailbox not found or domain not verified");
  if (!mailbox.domain?.dkimPrivateKey) throw new Error("DKIM key missing");

  const { name: domainName, dkimPrivateKey, dkimSelector } = mailbox.domain;

  const transporter = nodemailer.createTransport({
    host: "127.0.0.1", // Local Postfix
    port: 25,
    secure: false, // Postfix usually doesn't use TLS on port 25 from localhost
    tls: {
      rejectUnauthorized: false, // in dev, accept self-signed
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
    logger: process.env.NODE_ENV !== "production",
    debug: process.env.NODE_ENV !== "production",
  });

  await transporter.verify(); // ensure it's reachable
  return transporter;
};
