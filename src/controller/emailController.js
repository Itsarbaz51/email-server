import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import Prisma from "../db/db.js";
import { decrypt } from "../utils/encryption.js";
import nodemailer from "nodemailer";
import dns from "dns/promises";

const sendEmail = asyncHandler(async (req, res) => {
  console.log("sendEmail called with:", req.body);

  const { from, to, subject, body } = req.body;
  const files = req.files || [];
  const senderMailboxId = req.mailbox?.id;

  if (!from || !to || !subject || !body) {
    return ApiError.send(
      res,
      400,
      "All fields (from, to, subject, body) are required"
    );
  }

  if (!senderMailboxId) {
    return ApiError.send(res, 403, "Sender mailbox not identified.");
  }

  const fromMailbox = await Prisma.mailbox.findFirst({
    where: {
      id: senderMailboxId,
      address: from.toLowerCase(),
      domain: {
        verified: true,
      },
    },
    include: {
      domain: true,
    },
  });

  if (!fromMailbox) {
    return ApiError.send(res, 403, "Unauthorized sender or unverified domain.");
  }

  if (!fromMailbox.smtpPasswordEncrypted) {
    return ApiError.send(res, 500, "Missing SMTP password for sender mailbox.");
  }

  const rawPassword = decrypt(fromMailbox.smtpPasswordEncrypted);
  if (!rawPassword) {
    return ApiError.send(res, 500, "SMTP password decryption failed.");
  }

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

  try {
    // Use MX lookup for recipient domain
    const recipientDomain = to.split("@")[1];
    const mxRecords = await dns.resolveMx(recipientDomain);
    if (!mxRecords || mxRecords.length === 0) {
      return ApiError.send(res, 500, "No MX records found for recipient.");
    }

    // Choose lowest priority mail server
    const mxHost = mxRecords.sort((a, b) => a.priority - b.priority)[0]
      .exchange;

    const transporter = nodemailer.createTransport({
      host: mxHost,
      port: 25,
      secure: false,
      tls: {
        rejectUnauthorized: false,
      },
    });

    const mailOptions = {
      from,
      to,
      subject,
      html: body,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);

    // Check if recipient is local and save
    const toMailbox = await Prisma.mailbox.findFirst({
      where: {
        address: to.toLowerCase(),
        domain: {
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

      return res
        .status(201)
        .json(new ApiResponse(201, "Email sent and stored locally", message));
    }

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
      return ApiError.send(
        res,
        500,
        "Could not connect to recipient SMTP server"
      );
    }

    if (error.code === "EAUTH") {
      return ApiError.send(res, 401, "SMTP authentication failed");
    }

    return ApiError.send(res, 500, `Failed to send email: ${error.message}`);
  }
});

export { sendEmail };
