import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import Prisma from "../db/db.js";
import dns from "dns/promises";

export const verifyDkimRecord = async (domain) => {
  try {
    const domainInfo = await Prisma.domain.findFirst({
      where: { name: domain, verified: true },
    });

    if (!domainInfo) {
      console.warn("❌ Domain not found or not verified:", domain);
      return false;
    }

    const selector = domainInfo.dkimSelector || "dkim";
    const lookupName = `${selector}._domainkey.${domain}`;

    const txtRecords = await dns.resolveTxt(lookupName);
    const dnsValue = txtRecords.map((r) => r.join("")).join("");

    const actualDnsPublicKey = dnsValue;
    const expectedPublicKey = domainInfo.dkimPublicKey;

    if (!actualDnsPublicKey || !expectedPublicKey) {
      console.warn("⚠️ Missing DKIM keys for domain:", domain);
      return false;
    }

    const match = actualDnsPublicKey === expectedPublicKey;

    console.log("DNS Public Key:", actualDnsPublicKey);
    console.log("Expected Key :", expectedPublicKey);
    console.log("Match:", match);

    if (!match) {
      console.warn("❌ DKIM public key mismatch for domain:", domain);
    }

    return match;
  } catch (err) {
    console.error("⚠️ DKIM DNS TXT lookup failed:", err.message);
    return false;
  }
};

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
      return callback(new Error("Invalid RCPT TO address format"));

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
    console.log("📬 Receiving email data...");
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);

      const toRaw = parsed.to?.value?.[0]?.address;
      const to = toRaw?.toLowerCase?.();
      if (!to || !to.includes("@"))
        return callback(new Error("Invalid 'to' address"));

      const [_, domain] = to.split("@");

      const isDkimValid = await verifyDkimRecord(domain);
      if (!isDkimValid) {
        console.warn("❌ Email rejected: DKIM validation failed");
        return callback(new Error("DKIM validation failed"));
      }

      try {
        const mailbox = await Prisma.mailbox.findFirst({
          where: {
            address: to,
            domain: {
              name: domain,
              verified: true,
            },
          },
        });

        if (!mailbox) {
          console.warn("📭 Mailbox not found for recipient:", to);
        }

        await Prisma.message.create({
          data: {
            from: parsed.from?.text || "",
            to,
            subject: parsed.subject || "",
            body: parsed.html || parsed.text || "",
            mailboxId: mailbox?.id ?? null,
          },
        });

        console.log(`✅ Email stored for: ${to}`);
        callback();
      } catch (err) {
        console.error("❌ Email processing error:", err);
        callback(err);
      }
    });
  },
});
