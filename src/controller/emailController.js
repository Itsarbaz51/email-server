import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import nodemailer from "nodemailer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import Prisma from "../db/db.js";
import { getMailTransporter } from "../smtp/nodemailerServer.js";

export const sendEmail = asyncHandler(async (req, res) => {
  const { from, to, subject, body } = req.body;
  const files = req.files || [];
  const senderMailboxId = req.mailbox.id;

  if (!from || !to || !subject || !body) {
    return ApiError.send(
      res,
      400,
      "All fields (from, to, subject, body) are required"
    );
  }

  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: from,
      domain: {
        verified: true,
      },
    },
  });

  if (!fromMailbox) {
    return ApiError.send(
      res,
      403,
      "Unauthorized sender or unverified mailbox."
    );
  }

  // WARNING: Ensure rawPassword is accessible. This must be stored securely or retrieved securely.
  const rawPassword = fromMailbox.rawPassword; // Make sure this is stored securely!
  if (!rawPassword) {
    return ApiError.send(res, 500, "Missing SMTP password for sender mailbox.");
  }

  // Process attachments
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
  const recipientDomain = to.split("@")[1];
  if (!recipientDomain) {
    return ApiError.send(res, 400, "Invalid recipient email format");
  }

  try {
    // Send the email via SMTP
    const transporter = await getMailTransporter(from, rawPassword);
    const mailOptions = {
      from: `"${from.split("@")[0]}" <${from}>`,
      to,
      subject,
      html: body,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);

    // Save to DB if recipient is local
    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: to,
        domain: { verified: true },
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
        include: { attachments: true },
      });

      return res
        .status(201)
        .json(new ApiResponse(201, "Email sent and stored", message));
    }

    // Return success for external delivery
    return res.status(201).json(
      new ApiResponse(201, "Email sent", {
        messageId: info.messageId,
        envelope: info.envelope,
      })
    );
  } catch (error) {
    console.error("SMTP Error:", error);

    if (error.code === "EDNS" || error.code === "ENOTFOUND") {
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

  // Verify user has access to this mailbox
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
