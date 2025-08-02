import dns from "dns/promises";
import crypto from "crypto";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

const DKIM_SELECTOR = "dkim";

const generateDKIMKeys = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const cleanedPublicKey = publicKey
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "")
    .trim();

  return {
    privateKey,
    publicKey: cleanedPublicKey,
  };
};

const normalizeTxt = (txt) =>
  txt.replace(/"/g, "").replace(/\s+/g, "").trim().toLowerCase();

export const generateDNSRecords = asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const currentUserId = req.user.id;

  if (!domain) ApiError.send(res, "Domain is required", 400);

  const existingDomain = await Prisma.domain.findFirst({
    where: { name: domain, adminId: currentUserId },
    include: { dnsRecords: true },
  });

  if (existingDomain) {
    return ApiError.send(res, "Domain already exists", 400);
  }

  // Generate DKIM Key Pair
  const dkimKeys = generateDKIMKeys();

  // ✅ Create new domain including public key
  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: currentUserId,
      dkimPrivateKey: dkimKeys.privateKey,
      dkimPublicKey: dkimKeys.publicKey,
      dkimSelector: DKIM_SELECTOR,
    },
  });

  const recordsToCreate = [
    {
      type: "A",
      name: "mail",
      value: process.env.SERVER_IP,
      domainId: newDomain.id,
    },
    {
      type: "MX",
      name: "@",
      value: "mail.primewebdev.in",
      priority: 10,
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 a:mail.primewebdev.in mx ~all`,
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: `${DKIM_SELECTOR}._domainkey`,
      value: `v=DKIM1; k=rsa; p=${dkimKeys.publicKey.replace(/\n/g, "")}`,
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=quarantine; sp=quarantine; adkim=s; aspf=s; rua=mailto:dmarc@${domain}`,
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

  if (!domain) ApiError.send(res, "Domain not found", 404);
  if (!domain.dnsRecords.length)
    ApiError.send(res, `No ${recordType} records found`, 404);

  const results = [];

  for (const record of domain.dnsRecords) {
    const lookupName =
      record.name === "@" ? domain.name : `${record.name}.${domain.name}`;

    try {
      let rawRecords = [];

      if (recordType === "MX") {
        const mxRecords = await dns.resolveMx(lookupName);
        rawRecords = mxRecords.map((r) => r.exchange.trim());
      } else if (recordType === "TXT") {
        const txtRecords = await dns.resolveTxt(lookupName);
        rawRecords = txtRecords.map((r) => r.join("").trim());
      }

      const expected = record.value.trim();

      const matched = rawRecords.some((r) => {
        if (recordType === "TXT") {
          return normalizeTxt(r) === normalizeTxt(expected);
        }
        return r === expected;
      });

      if (!matched && rawRecords.length > 0) {
        await Prisma.dnsRecord.update({
          where: { id: record.id },
          data: { value: rawRecords[0] },
        });
      }

      results.push({
        matched,
        expected,
        found: rawRecords,
        record,
        lookupName,
      });
    } catch (err) {
      results.push({
        matched: false,
        error: err.message,
        record,
        lookupName,
      });
    }
  }

  return results;
};

export const verifyDnsHandler = asyncHandler(async (req, res) => {
  const { id: domainId } = req.params;
  const type = req.query.type?.toUpperCase();

  if (!domainId) ApiError.send(res, "Domain ID is required", 400);

  try {
    if (type) {
      const results = await verifyDNSRecord(domainId, type);
      const allMatched = results.every((r) => r.matched);

      return res.json(
        new ApiResponse(
          allMatched ? 200 : 400,
          allMatched
            ? `${type} record(s) verified`
            : `${type} record(s) mismatch or DNS issue`,
          { results }
        )
      );
    }

    const types = ["MX", "TXT"];
    const allResults = await Promise.all(
      types.map((t) => verifyDNSRecord(domainId, t))
    );

    const flatResults = allResults.flat();
    const allVerified = flatResults.every((r) => r.matched);

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
        { domain, results: flatResults }
      )
    );
  } catch (error) {
    return ApiError.send(res, 500, `Verification failed: ${error.message}`);
  }
});
