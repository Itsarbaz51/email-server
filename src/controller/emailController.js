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
  const { from, to, subject, body } = req.body;
  const files = req.files || [];
  const senderMailboxId = req.mailbox?.id;

  if (!from || !to || !subject || !body) {
    return ApiError.send(res, 400, "from, to, subject, and body are required.");
  }

  if (!senderMailboxId) {
    return ApiError.send(res, 403, "Sender mailbox not authenticated.");
  }

  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: from.toLowerCase(),
      domain: { verified: true },
    },
    include: { domain: true },
  });

  if (!fromMailbox || !fromMailbox.smtpPasswordEncrypted) {
    return ApiError.send(res, 403, "Invalid sender or SMTP password missing.");
  }

  const rawPassword = decrypt(fromMailbox.smtpPasswordEncrypted);
  if (!rawPassword) {
    return ApiError.send(res, 500, "Failed to decrypt SMTP password.");
  }

  const attachments = [];
  const uploadDir = path.join(process.cwd(), "uploads");
  await fs.mkdir(uploadDir, { recursive: true });

  for (const file of files) {
    const fileName = `${uuidv4()}${path.extname(file.originalname)}`;
    const savePath = path.join(uploadDir, fileName);
    await fs.writeFile(savePath, file.buffer);

    attachments.push({
      filename: file.originalname,
      path: savePath,
      contentType: file.mimetype,
    });
  }

  const transporter = await getMailTransporter(from, rawPassword);
  console.log("Transporter created for:", fromMailbox.address);
  
  const mailOptions = {
    from: fromMailbox.address,
    to,
    subject,
    html: body,
    attachments,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log("✅ Email sent:", info.messageId);

  const toMailbox = await Prisma.mailbox.findFirst({
    where: {
      address: to.toLowerCase(),
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

  return res.status(201).json(
    new ApiResponse(201, "Email sent", {
      messageId: info.messageId,
      envelope: info.envelope,
    })
  );
});

const getMessages = asyncHandler(async (req, res) => {
  console.log("getMessages called for mailbox:", req.mailbox);
  const { mailboxId } = req.params;
  const userId = req.mailbox?.id;

  if (!userId) {
    return ApiError.send(res, 401, "Authentication required");
  }

  const mailbox = await Prisma.mailbox.findFirst({
    where: {
      id: mailboxId,
      id: userId,
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
