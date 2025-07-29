// src/controllers/dnsController.js
import dns from "dns/promises";
import crypto from "crypto";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

const generateDKIMKeys = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Clean public key: remove header/footer and line breaks
  const cleanedPublicKey = publicKey
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "") // remove all whitespace
    .trim();

  return {
    privateKey,
    publicKey: cleanedPublicKey, // compact single-line public key
  };
};

export const generateDNSRecords = asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const currentUserId = req.user.id;

  if (!domain) throw new ApiError("Domain is required", 400);

  const existingDomain = await Prisma.domain.findFirst({
    where: { name: domain, adminId: currentUserId },
    include: { dnsRecords: true },
  });

  if (existingDomain) {
    return res.json(
      new ApiResponse(200, "Domain already exists", {
        domain: existingDomain,
        dnsRecords: existingDomain.dnsRecords.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name === "@" ? domain : `${r.name}.${domain}`,
          value: r.value,
          priority: r.priority,
          ttl: r.ttl,
        })),
      })
    );
  }

  const dkimKeys = generateDKIMKeys();

  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: currentUserId,
      dkimPrivateKey: dkimKeys.privateKey,
    },
  });

  const recordsToCreate = [
    {
      type: "MX",
      name: "@",
      value: "mail.yoursaas.com",
      priority: 10,
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: "@",
      value: "v=spf1 include:yoursaas.com ~all",
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: `mail._domainkey`,
      value: `v=DKIM1; k=rsa; p=${dkimKeys.publicKey}`,
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
      domainId: newDomain.id,
    },
  ];

  const createdRecords = await Promise.all(
    recordsToCreate.map((record) => Prisma.dnsRecord.create({ data: record }))
  );

  return res.json(
    new ApiResponse(200, "DNS records generated", {
      domain: newDomain,
      dnsRecords: createdRecords.map((r) => ({
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

  if (!domain) throw new ApiError("Domain not found", 404);
  if (!domain.dnsRecords.length)
    throw new ApiError(`No ${recordType} records found`, 404);

  const record = domain.dnsRecords[0];
  const lookupName =
    record.name === "@" ? domain.name : `${record.name}.${domain.name}`;

  try {
    const records =
      recordType === "MX"
        ? await dns.resolveMx(lookupName)
        : await dns.resolveTxt(lookupName);

    const flatRecords =
      recordType === "MX"
        ? records.map((r) => r.exchange)
        : records.map((arr) => arr.join(""));

    const expectedValue =
      recordType === "MX" ? record.value : record.value.replace(/"/g, "");

    const matched = flatRecords.some((r) => r.includes(expectedValue));

    return {
      matched,
      expected: expectedValue,
      found: flatRecords,
      record,
    };
  } catch (err) {
    return { matched: false, error: err.message };
  }
};

export const verifyDnsHandler = asyncHandler(async (req, res) => {
  const { id: domainId } = req.params;
  const { type } = req.query;

  if (!domainId) throw new ApiError("Domain ID is required", 400);

  try {
    if (type) {
      const result = await verifyDNSRecord(domainId, type);
      return res.json(
        new ApiResponse(
          result.matched ? 200 : 400,
          result.matched
            ? `${type} record verified`
            : `${type} record mismatch or DNS issue`,
          result
        )
      );
    }

    const types = ["TXT", "MX"];
    const results = await Promise.all(
      types.map((t) => verifyDNSRecord(domainId, t))
    );
    const allVerified = results.every((r) => r.matched);

    const domain = await Prisma.domain.update({
      where: { id: domainId },
      data: { verified: allVerified },
      select: { name: true, verified: true },
    });

    return res.json(
      new ApiResponse(
        allVerified ? 200 : 400,
        allVerified
          ? "All DNS records verified"
          : "Some DNS records failed verification",
        { domain, results }
      )
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return ApiError.send(res, error.statusCode, error.message, error.errors);
    }
    return ApiError.send(res, 500, `Verification failed: ${error.message}`);
  }
});
