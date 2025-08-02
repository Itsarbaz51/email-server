import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { DKIMVerifier } from "mailauth";
import Prisma from "../db/db.js";

export const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: false,

  onConnect(session, callback) {
    console.log("📡 SMTP Connect:", session.id);
    callback();
  },

  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    if (!mailFrom) return callback(new Error("Invalid MAIL FROM address"));
    console.log("📨 MAIL FROM:", mailFrom);
    callback();
  },

  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to || !to.includes("@"))
      return callback(new Error("Invalid RCPT TO address format"));

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
        console.error("❌ RCPT TO DB error:", err);
        callback(err);
      });
  },

  async onData(stream, session, callback) {
    console.log("📬 Receiving email data...");

    try {
      // 1. Read raw email buffer
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const rawEmail = Buffer.concat(chunks);

      // 2. DKIM Verify
      const dkim = new DKIMVerifier();
      const result = await dkim.verify(rawEmail);

      if (!result.signatures?.length) {
        console.warn("❌ No DKIM signature found");
        return callback(new Error("No DKIM signature"));
      }

      const firstSig = result.signatures[0];
      if (!firstSig.verified) {
        console.warn("❌ DKIM verification failed:", firstSig.status.message);
        return callback(new Error("DKIM verification failed"));
      }

      console.log("✅ DKIM verified for:", firstSig.signer);
      console.log("🔐 Selector:", firstSig.selector);

      // 3. Parse the email
      const parsed = await simpleParser(rawEmail);
      const toRaw = parsed.to?.value?.[0]?.address;
      const to = toRaw?.toLowerCase?.();

      if (!to || !to.includes("@")) {
        return callback(new Error("Invalid TO address"));
      }

      const [_, domain] = to.split("@");

      const mailbox = await Prisma.mailbox.findFirst({
        where: {
          address: to,
          domain: { name: domain, verified: true },
        },
      });

      if (!mailbox) {
        console.warn("📭 Mailbox not found for:", to);
      }

      await Prisma.message.create({
        data: {
          from: parsed.from?.text || "",
          to,
          subject: parsed.subject || "",
          body: parsed.html || parsed.text || "",
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
