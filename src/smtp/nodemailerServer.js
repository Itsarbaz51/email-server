import nodemailer from "nodemailer";
import Prisma from "../db/db.js";

export const getMailTransporter = async (address, rawPassword) => {
  const mailbox = await Prisma.mailbox.findFirst({
    where: { address },
    include: {
      domain: {
        select: { name: true, dkimPrivateKey: true, dkimSelector: true },
      },
    },
  });

  if (!mailbox || !mailbox.domain?.dkimPrivateKey) {
    throw new Error("Mailbox or domain not found for transporter");
  }

  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

  return nodemailer.createTransport({
    host: "mail.primewebdev.in",
    port: 587,
    secure: false,
    auth: {
      user: address,
      pass: rawPassword,
    },
    dkim: {
      domainName,
      keySelector: dkimSelector || "dkim",
      privateKey: dkimPrivateKey,
    },
  });
};
