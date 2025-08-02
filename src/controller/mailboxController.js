import Prisma from "../db/db.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { encrypt } from "../utils/encryption.js";
import { hashPassword } from "../utils/utils.js";

// Create Mailbox
const createMailbox = asyncHandler(async (req, res) => {
  const { address, password, domainId } = req.body;
  const userId = req.user.id;

  if (!address || !password || !domainId) {
    return ApiError.send(
      res,
      400,
      "Address, password, and domainId are required"
    );
  }

  // Fetch domain and validate ownership
  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: { dnsRecords: true },
  });

  if (!domain || domain.adminId !== userId) {
    return ApiError.send(res, 403, "Unauthorized domain access");
  }

  if (!domain.verified) {
    return ApiError.send(
      res,
      400,
      "Domain must be verified before creating mailboxes"
    );
  }

  // Normalize full email
  const fullEmail = address.includes("@")
    ? address.toLowerCase()
    : `${address.toLowerCase()}@${domain.name}`;

  const [localPart] = fullEmail.split("@");

  if (!/^[a-zA-Z0-9._%+-]+$/.test(localPart)) {
    return ApiError.send(res, 400, "Invalid mailbox address format");
  }

  // Check for existing mailbox
  const existingMailbox = await Prisma.mailbox.findFirst({
    where: {
      address: fullEmail, // ✅ match full email
      domainId,
    },
  });

  if (existingMailbox) {
    return ApiError.send(res, 400, `Mailbox "${fullEmail}" already exists.`);
  }

  // Hash and encrypt password
  const hashedPassword = await hashPassword(password);
  const encryptedSmtpPassword = encrypt(password);

  // ✅ Save full email address
  const mailbox = await Prisma.mailbox.create({
    data: {
      address: fullEmail, // ✅ full email
      password: hashedPassword,
      smtpPasswordEncrypted: encryptedSmtpPassword,
      domainId,
      isActive: true,
      quota: 5120,
    },
    include: {
      domain: {
        select: {
          name: true,
          dkimPrivateKey: true,
        },
      },
    },
  });

  return res.status(201).json(
    new ApiResponse(201, "Mailbox created successfully", {
      mailbox: {
        id: mailbox.id,
        address: mailbox.address, // full email
        domain: mailbox.domain.name,
        fullEmail: mailbox.address,
      },
      connection: {
        imap: `imap.${domain.name}:993`,
        smtp: `smtp.${domain.name}:587`,
        webmail: `https://webmail.${domain.name}`,
      },
    })
  );
});

// Get all mailboxes (Admin only)
const getMailboxes = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const user = await Prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.role !== "ADMIN") {
    return ApiError.send(res, 403, "Unauthorized to view mailboxes.");
  }

  const mailboxes = await Prisma.mailbox.findMany({
    where: {
      domain: {
        adminId: userId,
      },
    },
    include: {
      domain: {
        select: {
          name: true,
          verified: true,
        },
      },
      messages: {
        select: {
          id: true,
        },
      },
    },
  });

  // Add full email addresses and message counts
  const mailboxesWithStats = mailboxes.map((mailbox) => ({
    ...mailbox,
    fullEmail: `${mailbox.address}@${mailbox.domain.name}`,
    messageCount: mailbox.messages.length,
    messages: undefined, // Remove messages array from response
  }));

  return res
    .status(200)
    .json(
      new ApiResponse(200, "Mailboxes fetched successfully", mailboxesWithStats)
    );
});

// Update mailbox password
const updateMailbox = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const userId = req.user.id;

  if (!password) {
    return ApiError.send(res, 400, "Password is required");
  }

  const mailbox = await Prisma.mailbox.findUnique({
    where: { id },
    include: {
      domain: true,
    },
  });

  if (!mailbox || mailbox.domain.adminId !== userId) {
    return ApiError.send(res, 403, "Unauthorized to update mailbox.");
  }

  const hashedPassword = await hashPassword(password);
  const encryptedSmtpPassword = encrypt(password);

  const updated = await Prisma.mailbox.update({
    where: { id },
    data: {
      password: hashedPassword,
      smtpPasswordEncrypted: encryptedSmtpPassword,
    },
    include: {
      domain: {
        select: {
          name: true,
        },
      },
    },
  });

  return res.status(200).json(
    new ApiResponse(200, "Mailbox password updated successfully", {
      id: updated.id,
      address: updated.address,
      fullEmail: `${updated.address}@${updated.domain.name}`,
    })
  );
});

// Delete mailbox
const deleteMailbox = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const mailbox = await Prisma.mailbox.findUnique({
    where: { id },
    include: { domain: true },
  });

  if (!mailbox || mailbox.domain.adminId !== userId) {
    return ApiError.send(res, 403, "Unauthorized to delete mailbox.");
  }

  // Delete associated messages first
  await Prisma.message.deleteMany({
    where: { mailboxId: id },
  });

  // Delete the mailbox
  await Prisma.mailbox.delete({ where: { id } });

  return res
    .status(200)
    .json(new ApiResponse(200, "Mailbox deleted successfully"));
});

export { createMailbox, getMailboxes, updateMailbox, deleteMailbox };
