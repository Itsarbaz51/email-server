// smtpServer.js
import crypto from "crypto";
import { decrypt } from "../utils/encryption.js";
import Prisma from "../db/db.js";

// Safe timing comparison with logging
const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") {
    console.log("❌ safeCompare: One or both values not strings");
    return false;
  }

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    console.log("❌ safeCompare: Buffer lengths differ");
    return false;
  }

  try {
    return crypto.timingSafeEqual(bufferA, bufferB);
  } catch (err) {
    console.error("❌ safeCompare error:", err);
    return false;
  }
};

export const serverOptions = {
  authOptional: false,
  allowInsecureAuth: false,

  async onAuth(auth, session, callback) {
    const { username, password } = auth;

    console.log(`🔐 Auth attempt`);
    console.log("👤 Username received:", username);
    console.log("🔑 Password received:", password);

    try {
      const mailbox = await Prisma.mailbox.findFirst({
        where: {
          address: username?.toLowerCase(),
          smtpPasswordEncrypted: { not: null },
          domain: { is: { verified: true } },
        },
      });

      if (!mailbox) {
        console.log("❌ Auth failed: Mailbox not found or domain not verified");
        return callback(new Error("Invalid credentials"));
      }

      const decrypted = decrypt(mailbox.smtpPasswordEncrypted);

      console.log("🔓 Decrypted password from DB:", decrypted);

      const match = safeCompare(password, decrypted);

      if (match) {
        console.log(`✅ Auth success for: ${username}`);
        session.relaying = true;
        return callback(null, { user: mailbox });
      } else {
        console.log(`❌ Auth failed: Password mismatch for ${username}`);
        return callback(new Error("Invalid credentials"));
      }
    } catch (err) {
      console.error("❌ Auth error:", err);
      return callback(new Error("Authentication failed"));
    }
  },

  onConnect(session, callback) {
    console.log(`📡 New SMTP connection from ${session.remoteAddress}`);
    callback();
  },

  onMailFrom(address, session, callback) {
    session.envelope = session.envelope || {};
    session.envelope.mailFrom = address?.address?.toLowerCase?.();
    console.log(`📨 MAIL FROM: ${session.envelope.mailFrom}`);
    callback();
  },

  onRcptTo(address, session, callback) {
    const to = address?.address?.toLowerCase?.();
    if (!to || !to.includes("@")) return callback(new Error("Invalid RCPT TO"));

    session.envelope = session.envelope || {};
    session.envelope.rcptTo = session.envelope.rcptTo || [];
    session.envelope.rcptTo.push({ address: to });
    console.log(`📥 RCPT TO: ${to}`);
    callback();
  },

  async onData(stream, session, callback) {
    try {
      const chunks = [];
      let size = 0;

      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024)
          return callback(new Error("Email too large")); // 10MB limit
        chunks.push(chunk);
      }

      const rawEmail = Buffer.concat(chunks);
      const parsed = await simpleParser(rawEmail);

      for (const rcpt of session.envelope.rcptTo) {
        const to = rcpt.address.toLowerCase();
        const [_, domain] = to.split("@");

        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: to,
            domain: {
              is: {
                name: domain,
                verified: true,
              },
            },
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

          console.log(`✅ Stored email for ${to}`);
        }
      }

      callback();
    } catch (err) {
      console.error("❌ Error processing email:", err);
      callback(err);
    }
  },
};
