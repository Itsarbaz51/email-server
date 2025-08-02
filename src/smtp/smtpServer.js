import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";
import { comparePassword } from "../utils/utils.js";

export const server = new SMTPServer({
  authOptional: true, // ✅ Gmail needs this
  allowInsecureAuth: false,

  onConnect(session, callback) {
    console.log("SMTP Connect:", session.id);
    callback();
  },

  onMailFrom(address, session, callback) {
    console.log("SMTP MailFrom:", address.address.toLowerCase(), session.id); // Lowercased
    callback();
  },

  onRcptTo(address, session, callback) {
    const lowerAddress = address.address.toLowerCase(); // Lowercase the full address
    const [recipientLocal, recipientDomain] = lowerAddress.split("@");

    Prisma.mailbox
      .findFirst({
        where: {
          address: recipientLocal,
          domain: {
            name: recipientDomain,
            verified: true,
          },
        },
      })
      .then((mailbox) => {
        if (mailbox) {
          console.log("Accepted recipient:", lowerAddress);
        } else {
          console.log(
            "Recipient not found (but still accepted):",
            lowerAddress
          );
        }
        callback();
      })
      .catch((err) => {
        console.error("RcptTo error:", err);
        callback(err);
      });
  },

  onData(stream, session, callback) {
    console.log("SMTP Data received");
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);

      const toRaw = parsed.to?.value?.[0]?.address || "";
      const to = toRaw.toLowerCase(); // ✅ Force lowercase
      const [recipientLocal, recipientDomain] = to.split("@");

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
              from: parsed.from?.text || "",
              to,
              subject: parsed.subject || "",
              body: parsed.html || parsed.text || "",
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
