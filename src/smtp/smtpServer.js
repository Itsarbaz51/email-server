export const server = new SMTPServer({
  authOptional: true, // ✅ Gmail needs this
  allowInsecureAuth: false, // fine
  onConnect(session, callback) {
    console.log("SMTP Connect:", session.id);
    callback();
  },
  onMailFrom(address, session, callback) {
    console.log("SMTP MailFrom:", address.address, session.id);

    // ✅ Allow Gmail to send without session.mailbox
    callback();
  },
  onRcptTo(address, session, callback) {
    const [recipientLocal, recipientDomain] = address.address.split("@");
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
          console.log("Accepted recipient:", address.address);
        } else {
          console.log(
            "Recipient not found (but still accepted):",
            address.address
          );
        }
        callback();
      })
      .catch((err) => {
        console.error("RcptTo error:", err);
        callback(err);
      });
  },
  onData(stream, session, callback) {
    console.log("SMTP Data received");
    simpleParser(stream, {}, async (err, parsed) => {
      if (err) return callback(err);
      const to = parsed.to?.value?.[0]?.address;
      const [recipientLocal, recipientDomain] = to.split("@");

      const mailbox = await Prisma.mailbox.findFirst({
        where: {
          address: recipientLocal,
          domain: { name: recipientDomain, verified: true },
        },
      });

      if (mailbox) {
        await Prisma.message.create({
          data: {
            from: parsed.from?.text,
            to,
            subject: parsed.subject || "",
            body: parsed.html || parsed.text || "",
            mailboxId: mailbox.id,
          },
        });
        console.log("✅ Stored email to:", to);
      } else {
        console.log("📭 Email for unknown mailbox:", to);
      }

      callback();
    });
  },
});
