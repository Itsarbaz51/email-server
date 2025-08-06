export const serverOptions = {
  authOptional: false,
  // logger: true,
  // secure: false,
  // disabledCommands: [],
  // banner: "Welcome to My SMTP Server",

  // async onAuth(auth, session, callback) {
  //   try {
  //     console.log(`Auth attempt: ${auth.method}`);

  //     if (auth.method !== "PLAIN" && auth.method !== "LOGIN") {
  //       return callback(new Error("Only PLAIN/LOGIN auth supported"));
  //     }

  //     const credentials = Buffer.from(auth.password, "base64").toString("utf8");
  //     const [username, password] = credentials.split("\x00").slice(1);

  //     console.log(`Auth attempt for: ${username}`);

  //     const user = await Prisma.mailbox.findFirst({
  //       where: {
  //         address: username.toLowerCase(),
  //         password: decrypt(password),
  //         domain: { verified: true },
  //       },
  //     });

  //     if (!user) {
  //       console.log("Invalid credentials");
  //       return callback(new Error("Invalid credentials"));
  //     }

  //     session.user = user;
  //     callback(null, { user: username });
  //   } catch (err) {
  //     console.error("Auth error:", err);
  //     callback(new Error("Authentication failed"));
  //   }
  // },

  async onConnect(session, callback) {
    console.log(`📡 SMTP connection from ${session.remoteAddress}`);
    callback();
  },

  async onMailFrom(address, session, callback) {
    try {
      // Check karo ki sender authenticated hai
      if (!session.user) {
        return callback(new Error("Authentication required"));
      }

      // Verify karo ki sender apna hi email use kar raha hai
      const fromEmail = address.address.toLowerCase();
      if (fromEmail !== session.user.address) {
        return callback(
          new Error("You can only send from your registered email")
        );
      }

      console.log(`✉️ Mail from ${fromEmail}`);
      callback();
    } catch (err) {
      callback(err);
    }
  },

  async onRcptTo(address, session, callback) {
    try {
      const to = address?.address?.toLowerCase?.();

      // Basic email format check
      if (!to || !to.includes("@")) {
        return callback(new Error("Invalid Email address"));
      }

      // Check karo ki recipient exists karta hai
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

  async onData(stream, session, callback) {
    try {
      let rawEmail = Buffer.from([]);

      stream.on("data", (chunk) => {
        rawEmail = Buffer.concat([rawEmail, chunk]);
      });

      stream.on("end", async () => {
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
              },
            });
          }
        }
        callback();
      });
    } catch (err) {
      callback(err);
    }
  },
};
