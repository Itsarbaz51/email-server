import Prisma from "../db/db.js";
import { simpleParser } from "mailparser";
import fs from "fs";
import { decrypt } from "../utils/encryption.js";

export const serverOptions = {
  authOptional: false, // Require auth for all connections
  allowInsecureAuth: false,
  key: fs.readFileSync("/etc/letsencrypt/live/mail.primewebdev.in/privkey.pem"),
  cert: fs.readFileSync(
    "/etc/letsencrypt/live/mail.primewebdev.in/fullchain.pem"
  ),
  secure: false, // Use STARTTLS
  hideSTARTTLS: false, // Explicitly show we support STARTTLS
  logger: true, // Enable verbose logging

  // Enhanced auth handler
  onAuth(auth, session, callback) {
    const { username, password } = auth;
    console.log(`🔐 Auth attempt for: ${username}`);

    Prisma.mailbox
      .findFirst({
        where: {
          address: username.toLowerCase(),
          smtpPasswordEncrypted: { not: null },
          domain: { verified: true },
        },
      })
      .then((mailbox) => {
        if (!mailbox) {
          console.log(`❌ Mailbox not found: ${username}`);
          return callback(new Error("Invalid credentials"));
        }

        const decrypted = decrypt(mailbox.smtpPasswordEncrypted);
        if (password === decrypted) {
          session.relaying = true;
          console.log(`✅ Authenticated: ${username}`);
          return callback(null, { user: mailbox });
        } else {
          console.log(`❌ Invalid password for: ${username}`);
          return callback(new Error("Invalid credentials"));
        }
      })
      .catch((err) => {
        console.error("Auth error:", err);
        callback(new Error("Authentication failed"));
      });
  },

  onConnect(session, callback) {
    console.log(`📡 New connection from: ${session.remoteAddress}`);
    if (session.remoteAddress === "127.0.0.1") {
      session.relaying = true;
    }
    callback();
  },

  onMailFrom(address, session, callback) {
    const mailFrom = address?.address?.toLowerCase?.();
    if (!mailFrom) return callback(new Error("Invalid MAIL FROM"));

    console.log(`📨 MAIL FROM: ${mailFrom}`);
    session.envelope = session.envelope || {};
    session.envelope.mailFrom = mailFrom;
    callback();
  },

  onRcptTo(address, session, callback) {
    let to = typeof address === "string" ? address : address?.address;

    if (!to || !to.includes("@")) {
      return callback(new Error("Invalid RCPT TO"));
    }

    to = to.toLowerCase();
    console.log(`📥 RCPT TO: ${to}`);

    session.envelope = session.envelope || {};
    session.envelope.rcptTo = session.envelope.rcptTo || [];

    // 👇 Store as object, not string
    session.envelope.rcptTo.push({ address: to });

    callback();
  },

  async onData(stream, session, callback) {
    console.log("📬 Processing email data...");
    try {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const rawEmail = Buffer.concat(chunks);

      const parsed = await simpleParser(rawEmail);
      console.log(
        `📧 Email received from ${session.envelope.mailFrom} to ${session.envelope.rcptTo}`
      );

      // Process local deliveries
      for (const to of session.envelope.rcptTo) {
        const [_, domain] = to.split("@");
        const mailbox = await Prisma.mailbox.findFirst({
          where: { address: to, domain: { name: domain, verified: true } },
        });

        if (mailbox) {
          await Prisma.message.create({
            data: {
              from: session.envelope.mailFrom,
              to,
              subject: parsed.subject || "(No Subject)",
              body: parsed.text || "",
              mailboxId: mailbox.id,
            },
          });
          console.log(`✅ Stored local email for: ${to}`);
        }
      }

      callback();
    } catch (err) {
      console.error("❌ Email processing failed:", err);
      callback(err);
    }
  },
};
