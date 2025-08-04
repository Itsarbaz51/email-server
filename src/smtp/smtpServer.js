import Prisma from "../db/db.js";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import fs from "fs";

export const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: false,
  key: fs.readFileSync("/etc/letsencrypt/live/mail.primewebdev.in/privkey.pem"),
  cert: fs.readFileSync(
    "/etc/letsencrypt/live/mail.primewebdev.in/fullchain.pem"
  ),

  onConnect(session, callback) {
    console.log("📡 SMTP Connect:", session.id);
    callback();
  },

  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    console.log("📨 MAIL FROM:", mailFrom);
    callback();
  },

  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to || !to.includes("@"))
      return callback(new Error("Invalid RCPT TO address"));
    Prisma.mailbox
      .findFirst({
        where: {
          address: to,
          domain: { verified: true },
        },
      })
      .then((mailbox) => {
        console.log(
          mailbox ? `✅ RCPT TO accepted: ${to}` : `📥 Unknown RCPT TO: ${to}`
        );
        callback();
      })
      .catch((err) => {
        console.error("❌ RCPT TO DB error:", err.message);
        callback(err);
      });
  },

  async onData(stream, session, callback) {
    console.log("📬 Receiving email data...");
    try {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const rawEmail = Buffer.concat(chunks);

      const parsed = await simpleParser(rawEmail);
      const to = parsed.to?.value?.[0]?.address?.toLowerCase();
      if (!to || !to.includes("@"))
        return callback(new Error("Invalid TO address"));

      const [_, domain] = to.split("@");
      const mailbox = await Prisma.mailbox.findFirst({
        where: {
          address: to,
          domain: { name: domain, verified: true },
        },
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

      console.log(`✅ Email stored for: ${to}`);
      callback();
    } catch (err) {
      console.error("❌ Error processing email:", err.message);
      callback(err);
    }
  },
});
