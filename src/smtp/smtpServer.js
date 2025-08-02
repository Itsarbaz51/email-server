import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";

export const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: false,

  onConnect(session, callback) {
    console.log("SMTP Connect:", session.id);
    callback();
  },

  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    if (!mailFrom) {
      return callback(new Error("Invalid MAIL FROM address"));
    }

    console.log("SMTP MailFrom:", mailFrom, session.id);
    callback();
  },

  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to || !to.includes("@")) {
      return callback(new Error("Invalid RCPT TO address format"));
    }

    Prisma.mailbox
      .findFirst({
        where: {
          address: to,
          domain: {
            verified: true,
          },
        },
      })
      .then((mailbox) => {
        if (mailbox) {
          console.log(`✅ RCPT TO accepted: ${to}`);
        } else {
          console.log(`📥 RCPT TO unknown (still accepted): ${to}`);
        }
        callback();
      })
      .catch((err) => {
        console.error("❌ RCPT TO DB error:", err);
        callback(err);
      });
  },

  onData(stream, session, callback) {
    console.log("SMTP Data received");
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);

      const toRaw = parsed.to?.value?.[0]?.address;
      const to = toRaw.toLowerCase?.();
      if (!to) {
        console.error("Invalid 'to' address in parsed email");
        return callback(new Error("Invalid 'to' address"));
      }

      const [recipientLocal, recipientDomain] = to.split("@");
      if (!recipientLocal || !recipientDomain) {
        console.error("Invalid recipient format in email body:", to);
        return callback(new Error("Invalid recipient format"));
      }

      try {
        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: recipientLocal,
            domain: { name: recipientDomain, verified: true },
          },
        });

        if (mailbox) {
          await Prisma.message.create({
            data: {
              from: parsed.from?.text,
              to,
              subject: parsed.subject,
              body: parsed.text,
              mailboxId: mailbox.id,
            },
          });
          console.log("✅ Stored email to:", to);
        } else {
          console.log("📭 Email for unknown mailbox:", to);
        }

        callback();
      } catch (err) {
        console.error("Email processing error:", err);
        callback(err);
      }
    });
  },
});
