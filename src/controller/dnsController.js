import dns from "dns/promises";
import crypto from "crypto";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import Prisma from "../db/db.js";

const DKIM_SELECTOR = "default";
const SERVER_IP = process.env.SERVER_IP;

const generateDKIMKeys = () => {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
};

// DNS Record Generator
const generateDNSRecords = (domain, publicKey) => {
  return [
    // A Records
    { type: "A", name: "mail", value: SERVER_IP, ttl: 3600 },
    { type: "A", name: "@", value: SERVER_IP, ttl: 3600 },

    // MX Record
    {
      type: "MX",
      name: "@",
      value: `mail.${domain}`,
      priority: 10,
      ttl: 3600,
    },

    // SPF Record
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 ip4:${SERVER_IP} include:${domain} ~all`,
      ttl: 3600,
    },

    // DKIM Record
    {
      type: "TXT",
      name: `${DKIM_SELECTOR}._domainkey`,
      value: `v=DKIM1; k=rsa; p=${publicKey
        .replace(/-----BEGIN PUBLIC KEY-----/, "")
        .replace(/-----END PUBLIC KEY-----/, "")
        .replace(/\n/g, "")}`,
      ttl: 3600,
    },

    // DMARC Record
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=none; rua=mailto:admin@${domain}`,
      ttl: 3600,
    },
  ];
};

// Generate DNS Records (API Endpoint)
export const generateDNSRecordsHandler = asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const userId = req.user.id;

  if (!domain) {
    throw new ApiError(400, "Domain name is required");
  }

  // Validate domain format
  if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(domain)) {
    throw new ApiError(400, "Invalid domain format");
  }

  const existingDomain = await Prisma.domain.findFirst({
    where: { name: domain, adminId: userId },
  });

  if (existingDomain) {
    throw new ApiError(409, "Domain already exists");
  }

  // Generate keys
  const { privateKey, publicKey } = generateDKIMKeys();

  // Create domain
  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: userId,
      dkimPrivateKey: privateKey,
      dkimPublicKey: publicKey,
      dkimSelector: DKIM_SELECTOR,
    },
  });

  // Create DNS records
  const records = generateDNSRecords(domain, publicKey);
  const createdRecords = await Promise.all(
    records.map((record) =>
      Prisma.dnsRecord.create({
        data: { ...record, domainId: newDomain.id },
      })
    )
  );

  res.status(201).json(
    new ApiResponse(201, "DNS records generated", {
      domain: newDomain,
      records: createdRecords,
    })
  );
});

// Actual DNS Verification
const verifyRecord = async (domain, type, expectedValue) => {
  try {
    const records = await dns.resolve(domain, type);
    return {
      verified: records.includes(expectedValue),
      expected: expectedValue,
      actual: records,
    };
  } catch (err) {
    return {
      verified: false,
      error: err.message,
    };
  }
};

// Verify DNS Records (API Endpoint)
export const verifyDNSRecordsHandler = asyncHandler(async (req, res) => {
  const { id: domainId } = req.params;
  const { type } = req.query;

  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: { dnsRecords: true },
  });

  if (!domain) {
    throw new ApiError(404, "Domain not found");
  }

  // If specific type requested
  if (type) {
    const record = domain.dnsRecords.find((r) => r.type === type.toUpperCase());
    if (!record) {
      throw new ApiError(404, `${type} record not found`);
    }

    const result = await verifyRecord(
      record.name === "@" ? domain.name : `${record.name}.${domain.name}`,
      record.type,
      record.value
    );

    return res.json(
      new ApiResponse(200, "Verification result", {
        type,
        ...result,
      })
    );
  }

  // Verify all records
  const verificationResults = await Promise.all(
    domain.dnsRecords.map(async (record) => {
      const result = await verifyRecord(
        record.name === "@" ? domain.name : `${record.name}.${domain.name}`,
        record.type,
        record.value
      );
      return {
        type: record.type,
        name: record.name,
        ...result,
      };
    })
  );

  // Update verification status
  const allVerified = verificationResults.every((r) => r.verified);
  await Prisma.domain.update({
    where: { id: domainId },
    data: { verified: allVerified },
  });

  res.json(
    new ApiResponse(200, "DNS verification completed", {
      domain: domain.name,
      verified: allVerified,
      results: verificationResults,
    })
  );
});
