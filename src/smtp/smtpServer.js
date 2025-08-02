import Prisma from "../db/db.js";
import { SMTPServer } from "smtp-server";
import { verify } from "mailauth"; // Change this import


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
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const rawEmail = Buffer.concat(chunks);

      // ✅ DKIM Verification using verify() instead of createDKIMVerifier()
      const result = await verify(rawEmail.toString("utf8")); // Changed this line
      const validSig = result.results?.dkim?.find(
        (sig) => sig.result === "pass"
      );

      if (!validSig) {
        console.warn("❌ DKIM verification failed");
        return callback(new Error("DKIM verification failed"));
      }

      console.log("✅ DKIM verified for:", validSig.domain);
      console.log("🔐 Selector:", validSig.selector);

      // ... rest of your onData function remains the same ...
    } catch (err) {
      console.error("❌ Error processing email:", err.message);
      callback(err);
    }
  },
});
