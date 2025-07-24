import nodemailer from "nodemailer";
import Prisma from "../db/db.js";

export const getMailTransporter = async (address, rawPassword) => {
  // 1. Find the mailbox in your DB
  const mailbox = await Prisma.mailbox.findFirst({
    where: { address },
    include: {
      domain: {
        select: { name: true, dkimPrivateKey: true },
      },
    },
  });

  if (!mailbox || !mailbox.domain?.dkimPrivateKey) {
    throw new Error("Mailbox or domain not found for transporter");
  }

  const dkimPrivateKey = mailbox.domain.dkimPrivateKey;
  const domainName = mailbox.domain.name;
  const selector = "DKIM"; // must match selector used in DNS

  // 2. Create the transporter
  return nodemailer.createTransport({
    host: "mail.yoursaas.com", // your VPS mail server
    port: 587,
    secure: false,
    auth: {
      user: address,
      pass: rawPassword,
    },
    dkim: {
      domainName,
      keySelector: selector,
      privateKey: dkimPrivateKey,
    },
  });
};
