import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

// Test SMTP Configuration
const testSMTPConfig = {
  host: "localhost",
  port: 2626,
  secure: false,
  auth: {
    user: "test@example.com",
    pass: "password123",
  },
  tls: {
    rejectUnauthorized: false,
  },
};

// Test Email Data
const testEmail = {
  from: "test@example.com",
  to: "recipient@example.com",
  subject: "Test Email from Email Server",
  html: "<h1>Hello from Email Server!</h1><p>This is a test email sent from the email server.</p>",
};

// Test SMTP Server
const testServer = new SMTPServer({
  authOptional: false,
  allowInsecureAuth: true,
  onAuth(auth, session, callback) {
    console.log("🔐 SMTP Auth attempt:", auth.username);
    // For testing, accept any credentials
    callback(null, { user: auth.username });
  },
  onConnect(session, callback) {
    console.log("📡 SMTP Connect:", session.id);
    callback();
  },
  onMailFrom(address, session, callback) {
    console.log("📤 SMTP MailFrom:", address.address);
    callback();
  },
  onRcptTo(address, session, callback) {
    console.log("📥 SMTP RcptTo:", address.address);
    callback();
  },
  onData(stream, session, callback) {
    console.log("📨 SMTP Data received");
    simpleParser(stream, {}, (err, parsed) => {
      if (err) {
        console.error("❌ Mail parsing error:", err);
        return callback(err);
      }

      console.log("✅ Email received successfully:");
      console.log("   From:", parsed.from?.text);
      console.log("   To:", parsed.to?.text);
      console.log("   Subject:", parsed.subject);
      console.log("   Body:", parsed.html || parsed.text);

      callback();
    });
  },
});

// Test Functions
async function testEmailSending() {
  console.log("\n🚀 Testing Email Sending...");

  try {
    const transporter = nodemailer.createTransporter(testSMTPConfig);

    console.log("📧 Sending test email...");
    const info = await transporter.sendMail(testEmail);

    console.log("✅ Email sent successfully!");
    console.log("   Message ID:", info.messageId);
    console.log("   Envelope:", info.envelope);

    return true;
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    return false;
  }
}

async function testEmailReceiving() {
  console.log("\n📥 Testing Email Receiving...");

  return new Promise((resolve) => {
    const server = testServer.listen(2627, "localhost", () => {
      console.log("📡 Test SMTP server running on port 2627");

      // Send test email to our test server
      setTimeout(async () => {
        try {
          const testTransporter = nodemailer.createTransporter({
            host: "localhost",
            port: 2627,
            secure: false,
            tls: { rejectUnauthorized: false },
          });

          await testTransporter.sendMail(testEmail);
          console.log("✅ Test email sent to test server");

          // Close server after test
          setTimeout(() => {
            server.close(() => {
              console.log("📡 Test SMTP server closed");
              resolve(true);
            });
          }, 1000);
        } catch (error) {
          console.error("❌ Test email sending failed:", error.message);
          server.close();
          resolve(false);
        }
      }, 1000);
    });
  });
}

// Main Test Function
async function runTests() {
  console.log("🧪 Starting Email Server Tests...\n");

  const sendingTest = await testEmailSending();
  const receivingTest = await testEmailReceiving();

  console.log("\n📊 Test Results:");
  console.log("   Email Sending:", sendingTest ? "✅ PASS" : "❌ FAIL");
  console.log("   Email Receiving:", receivingTest ? "✅ PASS" : "❌ FAIL");

  if (sendingTest && receivingTest) {
    console.log("\n🎉 All tests passed! Email server is working correctly.");
  } else {
    console.log("\n⚠️  Some tests failed. Please check the configuration.");
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { testEmailSending, testEmailReceiving, runTests };
