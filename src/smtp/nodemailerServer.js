export const getMailTransporter = async (email, password) => {
  console.log(`Creating transporter for: ${email}`);

  try {
    const mailbox = await Prisma.mailbox.findFirst({
      where: {
        address: email.toLowerCase(),
        domain: { verified: true },
      },
    });

    if (!mailbox) {
      throw new Error("Mailbox not found or domain not verified");
    }

    const transporter = nodemailer.createTransport({
      host: "13.203.241.137",
      port: 25,
      secure: false,
      auth: {
        user: email,
        pass: password || decrypt(mailbox.smtpPasswordEncrypted),
      },
      tls: {
        rejectUnauthorized: false, // टेस्टिंग के लिए
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
    });

    console.log("Verifying transporter...");
    await transporter.verify();
    console.log("Transporter verified successfully");

    return transporter;
  } catch (error) {
    console.error("Transporter creation failed:", error);
    throw new Error(`Failed to create transporter: ${error.message}`);
  }
};
