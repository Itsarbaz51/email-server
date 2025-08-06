export const serverOptions = {
  authOptional: true, // बाहरी मेल सर्वर्स के लिए ऑथेंटिकेशन ऑप्शनल

  // ऑथेंटिकेशन हेंडलर
  async onAuth(auth, session, callback) {
    // बाहरी मेल सर्वर्स के लिए ऑथेंटिकेशन नहीं मांगेगा
    if (!auth) {
      session.anonymous = true;
      return callback(null, {});
    }

    // आपके अपने यूजर्स के लिए ऑथेंटिकेशन
    try {
      if (auth.method !== "PLAIN" && auth.method !== "LOGIN") {
        return callback(new Error("Only PLAIN/LOGIN auth supported"));
      }

      const credentials = Buffer.from(auth.password, "base64").toString("utf8");
      const [username, password] = credentials.split("\x00").slice(1);

      const user = await Prisma.mailbox.findFirst({
        where: {
          address: username.toLowerCase(),
          password: decrypt(password),
          domain: { verified: true },
        },
      });

      if (!user) {
        return callback(new Error("Invalid credentials"));
      }

      session.user = user;
      callback(null, { user: username });
    } catch (err) {
      callback(new Error("Authentication failed"));
    }
  },

  // मेल फ्रॉम वैलिडेशन
  async onMailFrom(address, session, callback) {
    try {
      // सिर्फ आपके अपने यूजर्स के लिए ऑथेंटिकेशन चेक करें
      if (!session.anonymous && !session.user) {
        return callback(new Error("Authentication required for sending"));
      }

      // बाहरी मेल के लिए कोई ऑथेंटिकेशन नहीं
      console.log(`✉️ Mail from ${address.address}`);
      callback();
    } catch (err) {
      callback(err);
    }
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
