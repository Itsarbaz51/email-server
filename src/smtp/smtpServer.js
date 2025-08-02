import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";
import { comparePassword } from "../utils/utils.js";

export const server = new SMTPServer({
  authOptional: false, // ✅ Now login is required
  allowInsecureAuth: false,
  onAuth(auth, session, callback) {
    const { username, password } = auth;
    console.log("SMTP Auth attempt for:", username);

    // Split email and domain
    const [localPart, domain] = username.split("@");

    if (!localPart || !domain) {
      return callback(new Error("Invalid email format"));
    }

    Prisma.mailbox
      .findFirst({
        where: {
          address: localPart,
          domain: {
            name: domain,
            verified: true, // Only allow verified domains
          },
        },
        include: {
          domain: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
      .then(async (mailbox) => {
        if (!mailbox) {
          console.log("Mailbox not found:", username);
          return callback(new Error("Mailbox not found"));
        }

        // Compare password
        const isValid = await comparePassword(password, mailbox.password);

        if (!isValid) {
          console.log("Invalid password for:", username);
          return callback(new Error("Invalid password"));
        }

        console.log("SMTP Auth successful for:", username);
        session.mailbox = mailbox;
        return callback(null, { user: username });
      })
      .catch((err) => {
        console.error("SMTP Auth error:", err);
        callback(err);
      });
  },

  onConnect(session, callback) {
    console.log("SMTP Connect:", session.id);
    callback();
  },

  onMailFrom(address, session, callback) {
    console.log("SMTP MailFrom:", address.address, session.id);

    // Verify sender is authenticated
    if (!session.mailbox) {
      return callback(new Error("Authentication required"));
    }

    // Check if sender matches authenticated user
    const senderEmail = address.address;
    const [senderLocal, senderDomain] = senderEmail.split("@");

    if (
      senderLocal !== session.mailbox.address ||
      senderDomain !== session.mailbox.domain.name
    ) {
      return callback(new Error("Sender address mismatch"));
    }

    callback();
  },

  onRcptTo(address, session, callback) {
    console.log("SMTP RcptTo:", address.address, session.id);

    if (!address.address) {
      return callback(new Error("Invalid recipient address"));
    }

    const [recipientLocal, recipientDomain] = address.address.split("@");

    if (!recipientLocal || !recipientDomain) {
      return callback(new Error("Invalid recipient format"));
    }

    // Check if recipient mailbox exists
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
          console.log("Recipient mailbox found:", address.address);
          callback();
        } else {
          console.log("Recipient mailbox not found:", address.address);
          // For external domains, we still accept but won't store locally
          callback();
        }
      })
      .catch((err) => {
        console.error("RcptTo error:", err);
        callback(err);
      });
  },

  onData(stream, session, callback) {
    console.log("SMTP Data received");

    simpleParser(stream, {}, async (err, parsed) => {
      if (err) {
        console.error("Mail parsing error:", err);
        return callback(err);
      }

      try {
        const from =
          parsed.from?.text || parsed.from?.value?.[0]?.address || "";
        const to = parsed.to?.value?.[0]?.address || parsed.to?.text || "";
        const subject = parsed.subject || "";
        const text = parsed.text || "";
        const html = parsed.html || "";

        console.log("Parsed email:", { from, to, subject });

        if (!to) {
          console.error("No recipient found in email");
          return callback(new Error("No recipient found"));
        }

        const [recipientLocal, recipientDomain] = to.split("@");

        if (!recipientLocal || !recipientDomain) {
          console.error("Invalid recipient format:", to);
          return callback(new Error("Invalid recipient format"));
        }

        // Find recipient mailbox
        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: recipientLocal,
            domain: {
              name: recipientDomain,
              verified: true,
            },
          },
        });

        if (mailbox) {
          console.log("Storing email for local mailbox:", mailbox.address);

          // Store the email
          await Prisma.message.create({
            data: {
              from,
              to,
              subject,
              body: html || text,
              mailboxId: mailbox.id,
            },
          });

          console.log("Email stored successfully");
        } else {
          console.log("External recipient, not storing locally:", to);
        }

        callback();
      } catch (err) {
        console.error("Email processing error:", err);
        return callback(err);
      }
    });
  },
});
