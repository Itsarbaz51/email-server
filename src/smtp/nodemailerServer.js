import Prisma from "../db/db.js";
import nodemailer from "nodemailer";

export const getMailTransporter = async (fullEmail, rawPassword) => {
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

  console.log('mailbox', mailbox);
  if (!mailbox || !mailbox.domain?.dkimPrivateKey) {
    throw new Error("Mailbox or domain not found for transporter");
  }

  console.log('mailbox.domain', mailbox.domain);
  
  const { dkimPrivateKey, name: domainName, dkimSelector } = mailbox.domain;

  return nodemailer.createTransport({
    host: `mail.${domainName}`,
    port: 587,
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
