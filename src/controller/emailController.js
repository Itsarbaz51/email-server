import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import Prisma from "../db/db.js";
import { getMailTransporter } from "./nodemailerServer.js";
import { decrypt } from "../utils/encryption.js";

export const sendEmail = asyncHandler(async (req, res) => {
  console.log("Send email request received:", req.body);

  const { from, to, subject, body } = req.body;
  const files = req.files || [];
  const senderMailboxId = req.mailbox?.id;

  // Validate input
  if (!from || !to || !subject || !body || !senderMailboxId) {
    throw new ApiError(400, "Missing required fields");
  }

  // Verify sender
  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: from.toLowerCase(),
      domain: { verified: true },
    },
  });

  if (!fromMailbox?.smtpPasswordEncrypted) {
    throw new ApiError(403, "Unauthorized sender or missing SMTP password");
  }

  // Process attachments
  const attachments = [];
  if (files.length > 0) {
    const uploadDir = path.join(process.cwd(), "uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    for (const file of files) {
      const fileName = `${uuidv4()}${path.extname(file.originalname)}`;
      const filePath = path.join(uploadDir, fileName);
      await fs.writeFile(filePath, file.buffer);

      attachments.push({
        filename: file.originalname,
        path: filePath,
        contentType: file.mimetype,
      });
    }
  }

  try {
    // Send email
    const transporter = await getMailTransporter(
      fromMailbox.address,
      decrypt(fromMailbox.smtpPasswordEncrypted)
    );

    const mailOptions = {
      from: `"${fromMailbox.name}" <${from}>`,
      to,
      subject,
      html: body,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);

    // Store in database
    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: to.toLowerCase(),
        domain: { verified: true },
      },
    });

    if (toMailbox) {
      await Prisma.message.create({
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
      });
    }

    return res.status(201).json(
      new ApiResponse(201, "Email sent successfully", {
        messageId: info.messageId,
        accepted: info.accepted,
      })
    );
  } catch (error) {
    console.error("Email sending failed:", error);
    throw new ApiError(500, `Failed to send email: ${error.message}`);
  }
});

export const getMessages = asyncHandler(async (req, res) => {
  const { mailboxId } = req.params;
  const userId = req.mailbox?.id;

  if (!userId) {
    throw new ApiError(401, "Authentication required");
  }

  const messages = await Prisma.message.findMany({
    where: {
      mailboxId,
      mailbox: { id: userId }, // Ensure mailbox belongs to user
    },
    include: { attachments: true },
    orderBy: { createdAt: "desc" },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Messages retrieved successfully", messages));
});
