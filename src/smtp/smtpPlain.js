import { SMTPServer } from "smtp-server";
import Prisma from "../db/db.js";
import { simpleParser } from "mailparser";

export const plainSMTPServer = new SMTPServer({
  secure: false,
  authOptional: true,
  onConnect(session, callback) {
    console.log("📡 PLAIN SMTP CONNECT:", session.id);
    callback();
  },
  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    console.log("📨 MAIL FROM:", mailFrom);
    callback();
  },
  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to) return callback(new Error("Invalid RCPT TO address"));
    Prisma.mailbox.findFirst({
      where: { address: to, domain: { verified: true } },
    })
    .then((mailbox) => callback())
    .catch(callback);
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
