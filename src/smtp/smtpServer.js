import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";
import dns from "dns/promises";

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
        callback(); // Always accept (greylisting allowed)
      })
      .catch((err) => {
        console.error("❌ RCPT TO DB error:", err);
        callback(err);
      });
  },

  onData(stream, session, callback) {
    console.log("📬 Receiving email data...");
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);

      const toRaw = parsed.to?.value?.[0]?.address;
      const to = toRaw?.toLowerCase?.();
      if (!to || !to.includes("@")) {
        console.error("❌ Invalid recipient address in email:", toRaw);
        return callback(new Error("Invalid recipient address"));
      }

      try {
        // Lookup mailbox by full address
        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: to,
            domain: {
              verified: true,
            },
          },
          include: {
            domain: true,
          },
        });

        if (!mailbox) {
          console.log("📭 Email for unknown mailbox:", to);
          return callback(); // still accept to avoid bounce
        }

        // ✅ DKIM DNS verification
        const dkimSelector = mailbox.domain.dkimSelector || "dkim";
        const dkimRecordName = `${dkimSelector}._domainkey.${mailbox.domain.name}`;

        try {
          const dnsRecords = await dns.resolveTxt(dkimRecordName);
          const flattened = dnsRecords
            .flat()
            .join("")
            .replace(/\s+/g, "")
            .toLowerCase();
          const expected =
            `v=dkim1;k=rsa;p=${mailbox.domain.dkimPublicKey}`.toLowerCase();

          if (
            !flattened.includes(
              mailbox.domain.dkimPublicKey.replace(/\s+/g, "").toLowerCase()
            )
          ) {
            console.warn(
              "⚠️ DKIM public key mismatch in DNS for:",
              mailbox.domain.name
            );
          } else {
            console.log("🔐 DKIM verified for domain:", mailbox.domain.name);
          }
        } catch (dnsErr) {
          console.warn("⚠️ DKIM DNS TXT lookup failed:", dnsErr.message);
        }

        // ✅ Store the email
        await Prisma.message.create({
          data: {
            from: parsed.from?.text || "",
            to,
            subject: parsed.subject || "(No subject)",
            body: parsed.html || parsed.text || "(No content)",
            mailboxId: mailbox.id,
          },
        });

        console.log("✅ Email stored for:", to);
        callback();
      } catch (e) {
        console.error("❌ Error processing email:", e);
        callback(e);
      }
    });
  },
});
