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

  const fromUser = from.split("@")[0];

  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: fromUser,
    },
    include: {
      domain: true,
    },
  });

  console.log("fromMailbox fetched:", fromMailbox);

  if (!fromMailbox || !fromMailbox.domain?.verified) {
    console.log("Unauthorized sender or unverified mailbox");
    return ApiError.send(
      res,
      403,
      "Unauthorized sender or unverified mailbox."
    );
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

  const recipientDomain = to.split("@")[1];
  if (!recipientDomain) {
    console.log("Invalid recipient email format");
    return ApiError.send(res, 400, "Invalid recipient email format.");
  }

  try {
    console.log("Creating mail transporter...");
    const transporter = await getMailTransporter(from, rawPassword);
    console.log("Transporter created:", transporter);

    const mailOptions = {
      from: `"${fromUser}" <${from}>`,
      to,
      subject,
      html: body,
      attachments,
    };

    console.log("Sending email...", mailOptions);
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info);

    const toUser = to.split("@")[0];

    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: toUser,
        domain: {
          name: recipientDomain,
          verified: true,
        },
      },
      include: {
        domain: true,
      },
    });

    if (toMailbox) {
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

      console.log("Email stored locally:", message);
      return res
        .status(201)
        .json(new ApiResponse(201, "Email sent and stored", message));
    }

    console.log("Email sent to external recipient");
    return res.status(201).json(
      new ApiResponse(201, "Email sent", {
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

    return ApiError.send(res, 500, `Failed to send email: ${error.message}`);
  }
});

const getMessages = asyncHandler(async (req, res) => {
  const { mailboxId } = req.params;
  const userId = req.user.id;
  console.log("mailbox", mailbox);
  console.log("userId", userId);

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      id: mailboxId,
      domain: {
        adminId: userId,
      },
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
    .json(new ApiResponse(200, "Messages retrieved", messages));
});

export { sendEmail, getMessages };
