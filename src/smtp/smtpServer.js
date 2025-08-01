import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";

export const server = new SMTPServer({
  authOptional: false, // ✅ Now login is required
  allowInsecureAuth: true,
  // onAuth(auth, session, callback) {
  //   const { username, password } = auth;

  //   // Split email and domain
  //   const [localPart, domain] = username.split("@");

  //   Prisma.mailbox
  //     .findFirst({
  //       where: {
  //         address: localPart,
  //         domain: {
  //           name: domain,
  //         },
  //       },
  //       include: { domain: true },
  //     })
  //     .then(async (mailbox) => {
  //       if (!mailbox) return callback(new Error("Mailbox not found"));

  //       // Compare password (assuming hashed password in DB)
  //       const { comparePassword } = await import("../utils/utils.js");

  //       const isValid = await comparePassword(password, mailbox.password);

  //       if (!isValid) return callback(new Error("Invalid password"));

  //       return callback(null, { user: username });
  //     })
  //     .catch((err) => callback(err));
  // },
  onConnect(session, callback) {
    console.log("onConnect", session.id);
    callback();
  },
  onMailFrom(address, session, callback) {
    console.log("onMailFrom", address.address, session.id);
    callback();
  },

  onRcptTo(address, session, callback) {
    console.log("onRcptTo", address.address, session.id);
    if (address.address) {
      const mailbox = Prisma.mailbox.findUnique({
        where: {
          address: address.address,
        },
        include: {
          domain: true,
        },
      });
      if (mailbox) {
        callback();
      } else {
        callback(new Error("Mailbox not found"));
      }
    }
  },

  onData(stream, session, callback) {
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);

      try {
        const from = parsed.from?.text || "";
        const to = parsed.to?.value?.[0]?.address;

        if (!to) return callback(new Error("No recipient found"));

        const mailbox = await Prisma.mailbox.findFirst({
          where: { address: to },
        });

        if (!mailbox) {
          console.warn("Recipient mailbox not found:", to);
          return callback(); // silently ignore
        }

        await Prisma.message.create({
          data: {
            from,
            to,
            subject: parsed.subject || "",
            text: parsed.text || "",
            html: parsed.html || "",
            mailboxId: mailbox.id,
          },
        });

        callback();
      } catch (err) {
        return callback(err);
      }
    });
  },
});
