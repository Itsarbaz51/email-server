import fs from "fs";
import path from "path";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";

const certPath = "/etc/letsencrypt/live/smtp.primewebdev.in";

export const secureSMTPServer = new SMTPServer({
  secure: true,
  key: fs.readFileSync(path.join(certPath, "privkey.pem")),
  cert: fs.readFileSync(path.join(certPath, "fullchain.pem")),
  authOptional: true,
  onConnect(session, callback) {
    console.log("🔐 SMTPS CONNECT:", session.id);
    callback();
  },
  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    console.log("🔐 MAIL FROM:", mailFrom);
    callback();
  },
  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    Prisma.mailbox.findFirst({
      where: { address: to, domain: { verified: true } },
    }).then(() => callback()).catch(callback);
  },
  async onData(stream, session, callback) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const parsed = await simpleParser(raw);
    const to = parsed.to?.value?.[0]?.address.toLowerCase();
    const [_, domain] = to.split("@");
    const mailbox = await Prisma.mailbox.findFirst({
      where: { address: to, domain: { name: domain, verified: true } },
    });
    await Prisma.message.create({
      data: {
        from: parsed.from?.text || "",
        to,
        subject: parsed.subject || "",
        body: parsed.text || "",
        mailboxId: mailbox?.id ?? null,
      },
    });
    callback();
  },
});
