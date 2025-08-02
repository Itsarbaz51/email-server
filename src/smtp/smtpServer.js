import { SMTPServer } from "smtp-server";
import mailauth from "mailauth";
import mailauth from "mailauth";
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
      // Read full raw email from stream
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const rawEmail = Buffer.concat(chunks);

      // DKIM Verification
      const result = await mailauth.verifyDKIM(rawEmail);
      const validSig = result.signatures?.find((sig) => sig.verified);

      if (!validSig) {
        console.warn("❌ DKIM verification failed");
        return callback(new Error("DKIM verification failed"));
      }

      console.log("✅ DKIM verified for:", validSig.signer);
      console.log("🔐 Selector:", validSig.selector);

      // 📦 Parse the email
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
