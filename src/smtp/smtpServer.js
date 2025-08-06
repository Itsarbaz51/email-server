import crypto from "crypto";
import { decrypt } from "../utils/encryption.js";
import Prisma from "../db/db.js";
import { simpleParser } from "mailparser";

const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) return false;

  try {
    return crypto.timingSafeEqual(bufferA, bufferB);
  } catch {
    return false;
  }
};

export const serverOptions = {
  authOptional: false,
  allowInsecureAuth: false,

  async onAuth(auth, session, callback) {
    const { username, password } = auth;

    try {
      const mailbox = await Prisma.mailbox.findFirst({
        where: {
          address: username.toLowerCase(),
          smtpPasswordEncrypted: { not: null },
          domain: { is: { verified: true } },
        },
      });

      if (!mailbox) return callback(new Error("Invalid credentials"));

      const decrypted = decrypt(mailbox.smtpPasswordEncrypted);
      const match = safeCompare(password, decrypted);

      if (match) {
        session.relaying = true;
        return callback(null, { user: mailbox });
      }

      return callback(new Error("Invalid credentials"));
    } catch {
      return callback(new Error("Authentication failed"));
    }
  },

  onConnect(session, callback) {
    console.log(`📡 SMTP connection from ${session.remoteAddress}`);
    callback();
  },

  onMailFrom(address, session, callback) {
    session.envelope = session.envelope || {};
    session.envelope.mailFrom = address?.address?.toLowerCase?.();
    callback();
  },

  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to || !to.includes("@"))
      return callback(new Error("Invalid recipient"));

    session.envelope = session.envelope || {};
    session.envelope.rcptTo = session.envelope.rcptTo || [];
    session.envelope.rcptTo.push({ address: to });
    callback();
  },

  async onData(stream, session, callback) {
    try {
      const chunks = [];
      let size = 0;

      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024)
          return callback(new Error("Email too large"));
        chunks.push(chunk);
      }

      const rawEmail = Buffer.concat(chunks);
      const parsed = await simpleParser(rawEmail);

      for (const rcpt of session.envelope.rcptTo) {
        const to = rcpt.address.toLowerCase();
        const domain = to.split("@")[1];

        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: to,
            domain: { is: { name: domain, verified: true } },
          },
        });

        if (mailbox) {
          await Prisma.message.create({
            data: {
              from: session.envelope.mailFrom || "",
              to,
              subject: parsed.subject?.trim() || "(No Subject)",
              body: parsed.text?.trim() || parsed.html || "(Empty)",
              raw: rawEmail.toString("utf-8"),
              mailboxId: mailbox.id,
            },
          });

          console.log(`📨 Stored message for ${to}`);
        }
      }

      callback();
    } catch (err) {
      console.error("❌ Email parse/store failed:", err);
      callback(err);
    }
  },
};
