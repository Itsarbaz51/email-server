import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import Prisma from "../db/db.js";
import { getMailTransporter } from "../smtp/nodemailerServer.js";
import { decrypt } from "../utils/encryption.js";

const sendEmail = asyncHandler(async (req, res) => {
  console.log("sendEmail called with:", req.body);

  const { from, to, subject, body } = req.body;
  const files = req.files || [];
  const senderMailboxId = req.mailbox?.id;

  if (!from || !to || !subject || !body) {
    console.log("Missing required fields");
    return ApiError.send(
      res,
      400,
      "All fields (from, to, subject, body) are required"
    );
  }

  if (!senderMailboxId) {
    console.log("Sender mailbox not identified");
    return ApiError.send(res, 403, "Sender mailbox not identified.");
  }

  // Extract local part from sender email
  const [fromUser, fromDomain] = from.split("@");

  if (!fromUser || !fromDomain) {
    return ApiError.send(res, 400, "Invalid sender email format.");
  }

  // Find sender mailbox with domain verification
  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: fromUser,
      domain: {
        name: fromDomain,
        verified: true, // Only allow verified domains
      },
    },
    include: {
      domain: true,
    },
  });

  console.log("fromMailbox fetched:", fromMailbox);

  if (!fromMailbox) {
    console.log("Unauthorized sender or unverified domain");
    return ApiError.send(res, 403, "Unauthorized sender or unverified domain.");
  }

  if (!fromMailbox.smtpPasswordEncrypted) {
    console.log("Missing SMTP password");
    return ApiError.send(res, 500, "Missing SMTP password for sender mailbox.");
  }

  const rawPassword = decrypt(fromMailbox.smtpPasswordEncrypted);
  if (!rawPassword) {
    console.log("SMTP password decryption failed");
    return ApiError.send(res, 500, "SMTP password decryption failed.");
  }

  // Handle attachments (if any)
  const attachments = [];
  if (files.length > 0) {
    const uploadDir = path.join(process.cwd(), "uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    for (const file of files) {
      const fileExt = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExt}`;
      const savePath = path.join(uploadDir, fileName);
      await fs.writeFile(savePath, file.buffer);

      attachments.push({
        filename: file.originalname,
        path: savePath,
        contentType: file.mimetype,
      });
    }
  }

  // Validate recipient email format
  const [toUser, toDomain] = to.split("@");
  if (!toUser || !toDomain) {
    console.log("Invalid recipient email format");
    return ApiError.send(res, 400, "Invalid recipient email format.");
  }

  try {
    console.log("Creating mail transporter...");
    const transporter = await getMailTransporter(from, rawPassword);
    console.log("Transporter created successfully");

    const mailOptions = {
      from: `"${fromUser}" <${from}>`,
      to,
      subject,
      html: body,
      attachments,
    };

    console.log("Sending email...", { from, to, subject });
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);

    // Check if recipient is a local mailbox
    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: toUser,
        domain: {
          name: toDomain,
          verified: true,
        },
      },
      include: {
        domain: true,
      },
    });

    if (toMailbox) {
      console.log("Storing email for local recipient:", toMailbox.address);

      const message = await Prisma.message.create({
        data: {
          from,
          to,
          subject,
          body,
          mailboxId: toMailbox.id,
          attachments: {
            create: attachments.map((att) => ({
              fileName: att.filename,
              fileType: att.contentType,
              fileUrl: `/uploads/${path.basename(att.path)}`,
            })),
          },
        },
        include: {
          attachments: true,
        },
      });

      console.log("Email stored locally:", message.id);
      return res
        .status(201)
        .json(new ApiResponse(201, "Email sent and stored locally", message));
    }

    console.log("Email sent to external recipient");
    return res.status(201).json(
      new ApiResponse(201, "Email sent successfully", {
        messageId: info.messageId,
        envelope: info.envelope,
      })
    );
  } catch (error) {
    console.error("SMTP Error:", error);

    if (["EDNS", "ENOTFOUND"].includes(error.code)) {
      return ApiError.send(
        res,
        500,
        "DNS resolution failed for recipient domain"
      );
    }

    if (error.code === "ECONNECTION") {
      return ApiError.send(res, 500, "Could not connect to SMTP server");
    }

    if (error.code === "EAUTH") {
      return ApiError.send(res, 401, "SMTP authentication failed");
    }

    return ApiError.send(res, 500, `Failed to send email: ${error.message}`);
  }
});

const getMessages = asyncHandler(async (req, res) => {
  console.log("getMessages called for mailbox:", req.mailbox);
  const { mailboxId } = req.params;
  const userId = req.mailbox?.id;

  if (!userId) {
    return ApiError.send(res, 401, "Authentication required");
  }

  // Verify mailbox ownership
  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      id: mailboxId,
      id: userId, // Ensure user can only access their own mailbox
    },
  });

  if (!mailbox) {
    return ApiError.send(res, 403, "Unauthorized access to mailbox");
  }

  const messages = await Prisma.message.findMany({
    where: { mailboxId },
    include: {
      attachments: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Messages retrieved successfully", messages));
});

export { sendEmail, getMessages };
