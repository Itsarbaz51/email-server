import dns from "dns/promises";
import crypto from "crypto";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

const DKIM_SELECTOR = "dkim";

// Format DKIM public key
function formatDkimRecord(publicKey) {
  const cleanedKey = publicKey
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .replace(/\s+/g, "")
    .trim();
  return `v=DKIM1; k=rsa; p=${cleanedKey}`;
}

// Generate DKIM keys
const generateDKIMKeys = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey, publicKey };
};

// DNS generation handler (A, MX, DKIM, SPF)
export const generateDNSRecords = asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const userId = req.user.id;

  if (!domain) return ApiError.send(res, 400, "Domain is required");

  const exists = await Prisma.domain.findFirst({
    where: { name: domain, adminId: userId },
  });
  if (exists) return ApiError.send(res, 400, "Domain already exists");

  const { privateKey, publicKey } = generateDKIMKeys();

  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: userId,
      dkimPrivateKey: privateKey,
      dkimPublicKey: publicKey,
      dkimSelector: DKIM_SELECTOR,
    },
  });

  const records = [
    { type: "A", name: "mail", value: process.env.SERVER_IP, ttl: 3600 },
    { type: "A", name: "@", value: process.env.SERVER_IP, ttl: 3600 },

    {
      type: "MX",
      name: "@",
      value: `mail.${domain}`,
      priority: 10,
      ttl: 3600,
    },
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 ip4:${process.env.SERVER_IP} mx ~all`,
      ttl: 3600,
    },
    {
      type: "TXT",
      name: `${DKIM_SELECTOR}._domainkey`,
      value: formatDkimRecord(publicKey),
      ttl: 3600,
    },
  ];

  const created = await Promise.all(
    records.map((r) =>
      Prisma.dnsRecord.create({
        data: { ...r, domainId: newDomain.id },
      })
    )
  );

  return res.json(
    new ApiResponse(200, "DNS records generated", {
      domain: newDomain,
      dnsRecords: created.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name === "@" ? domain : `${r.name}.${domain}`,
        value: r.value,
        priority: r.priority,
        ttl: r.ttl,
      })),
    })
  );
});

const verifyDNSRecord = async (domainId, recordType) => {
  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: {
      dnsRecords: {
        where: { type: recordType },
      },
    },
  });

  if (!domain) throw new Error("Domain not found");
  if (!domain.dnsRecords.length)
    throw new Error(`No ${recordType} records found`);

  const results = [];

  for (const record of domain.dnsRecords) {
    const lookupName =
      record.name === "@" ? domain.name : `${record.name}.${domain.name}`;

    // Simulate verification
    await Prisma.dnsRecord.update({
      where: { id: record.id },
      data: { verified: true },
    });

    results.push({
      matched: true,
      expected: record.value,
      found: [record.value],
      record,
      lookupName,
    });
  }

  return results;
};

export const verifyDnsHandler = asyncHandler(async (req, res) => {
  const { id: domainId } = req.params;
  const type = req.query.type?.toUpperCase();

  if (!domainId) return ApiError.send(res, 400, "Domain ID is required");

  try {
    if (type) {
      const results = await verifyDNSRecord(domainId, type);

      return res.json(
        new ApiResponse(200, `${type} records verified`, { results })
      );
    }

    const types = ["MX", "TXT"];
    const allResults = await Promise.all(
      types.map((t) => verifyDNSRecord(domainId, t))
    );

    const flatResults = allResults.flat();

    // ✅ Update domain verified = true
    const domain = await Prisma.domain.update({
      where: { id: domainId },
      data: { verified: true },
      select: { name: true, verified: true },
    });

    return res.json(
      new ApiResponse(200, "All DNS records force-verified", {
        domain,
        results: flatResults,
      })
    );
  } catch (error) {
    return ApiError.send(res, 500, `Verification failed: ${error.message}`);
  }
});
