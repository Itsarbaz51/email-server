import { SMTPServer } from "smtp-server";
import Prisma from "../db/db.js";

export const outgoingServer = new SMTPServer({
  name: "smtp.yourdomain.com",
  authMethods: ["PLAIN", "LOGIN"],
  authOptional: false,
  onConnect(session, callback) {
    console.log(`📤 New outgoing connection from ${session.remoteAddress}`);
    callback();
  },
  async onAuth(auth, session, callback) {
    const user = await Prisma.mailbox.findUnique({
      where: { address: auth.username },
    });
    if (!user || !(await verifyPassword(auth.password, user.password))) {
      return callback(new Error("Invalid credentials"));
    }
    callback(null, { user });
  },
  async onMailFrom(address, session, callback) {
    if (address.address !== session.user.email) {
      return callback(new Error("Not authorized to send from this address"));
    }
    callback();
  },
  async onData(stream, session, callback) {
    console.log(`📩 Sending email from ${session.envelope.mailFrom.address}`);
    callback();
  },
});
