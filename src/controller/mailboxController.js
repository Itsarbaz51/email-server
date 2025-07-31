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

  // Normalize mailbox address (local-part only)
  const mailboxAddress = address.includes("@")
    ? address.split("@")[0]
    : address;

  // Fetch domain and validate ownership
  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: { dnsRecords: true },
  });
  console.log('address, password, domainId', address, password, domainId);
  console.log('domain', domain);
  console.log('userId', userId);
  

  if (!domain || domain.adminId !== userId) {
    return ApiError.send(res, 403, "Unauthorized domain access");
  }

  // Ensure domain is verified
  if (!domain.verified) {
    return ApiError.send(
      res,
      400,
      "Domain must be verified before creating mailboxes"
    );
  }

  // Check for existing mailbox
  const existingMailbox = await Prisma.mailbox.findFirst({
    where: {
      address: mailboxAddress,
      domainId,
    },
  });

  if (existingMailbox) {
    const displayAddress = address.includes("@")
      ? address
      : `${mailboxAddress}@${domain.name}`;

    return ApiError.send(
      res,
      400,
      `Mailbox "${displayAddress}" already exists.`
    );
  }

  // Hash and encrypt password
  const hashedPassword = await hashPassword(password);
  const encryptedSmtpPassword = encrypt(password);

  // Create mailbox
  const mailbox = await Prisma.mailbox.create({
    data: {
      address: mailboxAddress,
      password: hashedPassword,
      smtpPasswordEncrypted: encryptedSmtpPassword,
      domainId,
      isActive: true,
      quota: 5120, // default quota in MB
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

  // Return success with IMAP/SMTP info
  return res.status(201).json(
    new ApiResponse(201, "Mailbox created with automatic routing", {
      mailbox,
      imap: `imap.${domain.name}:993`,
      smtp: `smtp.${domain.name}:587`,
      webmail: `https://webmail.${domain.name}`,
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
      domain: true,
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Mailboxes fetched", mailboxes));
});

// Update mailbox password
const updateMailbox = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const userId = req.user.id;

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
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Mailbox password updated", updated));
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

  await Prisma.mailbox.delete({ where: { id } });

  return res
    .status(200)
    .json(new ApiResponse(200, "Mailbox deleted successfully"));
});

export { createMailbox, getMailboxes, updateMailbox, deleteMailbox };
