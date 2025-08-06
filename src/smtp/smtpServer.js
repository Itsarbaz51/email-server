export const serverOptions = {
  authOptional: true, 


  // मेल फ्रॉम वैलिडेशन
  async onMailFrom(address, session, callback) {
    // बाहरी मेल के लिए कोई ऑथेंटिकेशन नहीं
    console.log(`✉️ Mail from ${address.address}`);
    callback();
  },

  // रिसिपिएंट वैलिडेशन
  async onRcptTo(address, session, callback) {
    try {
      const to = address?.address?.toLowerCase?.();

      if (!to || !to.includes("@")) {
        return callback(new Error("Invalid Email address"));
      }

      const existingMailbox = await Prisma.mailbox.findFirst({
        where: {
          address: to,
          domain: { is: { verified: true } },
        },
      });

      if (!existingMailbox) {
        return callback(new Error("Recipient mailbox not found"));
      }

      callback();
    } catch (err) {
      callback(err);
    }
  },

  // डेटा प्रोसेसिंग
  async onData(stream, session, callback) {
    try {
      let rawEmail = Buffer.from([]);

      stream.on("data", (chunk) => {
        rawEmail = Buffer.concat([rawEmail, chunk]);
      });

      stream.on("end", async () => {
        try {
          const parsed = await simpleParser(rawEmail);

          for (const rcpt of session.envelope.rcptTo) {
            const to = rcpt.address.toLowerCase();
            const mailbox = await Prisma.mailbox.findFirst({
              where: {
                address: to,
                domain: { verified: true },
              },
            });

            if (mailbox) {
              await Prisma.message.create({
                data: {
                  from: session.envelope.mailFrom.address,
                  to,
                  subject: parsed.subject || "(No Subject)",
                  text: parsed.text || "",
                  html: parsed.html || "",
                  raw: rawEmail.toString("utf-8"),
                  mailboxId: mailbox.id,
                  isRead: false,
                  receivedAt: new Date(),
                },
              });
              console.log(`📨 Stored message for ${to}`);
            }
          }
          callback();
        } catch (err) {
          console.error("Error processing email:", err);
          callback(err);
        }
      });
    } catch (err) {
      console.error("Data handling error:", err);
      callback(err);
    }
  },
};
