import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";

export const server = new SMTPServer({
  authOptional: true, // Add auth logic later
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

