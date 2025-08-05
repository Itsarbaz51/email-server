import dns from "dns/promises";
import crypto from "crypto";
import Prisma from "../db/db.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";

const DKIM_SELECTOR = "dkim";
const normalizeTxt = (txt) =>
  txt.replace(/"/g, "").replace(/\s+/g, "").trim().toLowerCase();

const generateDKIMKeys = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    privateKey,
    publicKey: publicKey
      .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
      .replace(/\s+/g, "")
      .trim(),
  };
};

export const generateDNSRecords = asyncHandler(async (req, res) => {
  const { domain } = req.body;
  const userId = req.user.id;
  if (!domain) return ApiError.send(res, 400, "Domain is required");

  const exists = await Prisma.domain.findFirst({
    where: { name: domain, adminId: userId },
  });
  if (exists) return ApiError.send(res, 400, "Domain already exists");

  const dkim = generateDKIMKeys();
  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: userId,
      dkimPrivateKey: dkim.privateKey,
      dkimPublicKey: dkim.publicKey,
      dkimSelector: DKIM_SELECTOR,
    },
  });

  const pubKeyChunks = dkim.publicKey
    .match(/.{1,255}/g)
    .map((c) => `"${c}"`)
    .join(" ");
  const dnsRecords = [
    { type: "A", name: "mail", value: process.env.SERVER_IP },
    { type: "MX", name: "@", value: `mail.${domain}`, priority: 10 },
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 ip4:${process.env.SERVER_IP} -all`,
    },
    {
      type: "TXT",
      name: `${DKIM_SELECTOR}._domainkey`,
      value: `v=DKIM1; k=rsa; p=${pubKeyChunks}`,
    },
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    },
  ];

  const records = await Promise.all(
    dnsRecords.map((r) =>
      Prisma.dnsRecord.create({ data: { ...r, domainId: newDomain.id } })
    )
  );

  res.json(
    new ApiResponse(200, "DNS records generated", {
      domain: newDomain,
      dnsRecords: records.map((r) => ({
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

const verifyDNSRecord = async (domainId, type) => {
  const domain = await Prisma.domain.findUnique({
    where: { id: domainId },
    include: { dnsRecords: { where: { type } } },
  });
  if (!domain || !domain.dnsRecords.length)
    throw new ApiError(404, `No ${type} records`);

  return await Promise.all(
    domain.dnsRecords.map(async (record) => {
      const lookup =
        record.name === "@" ? domain.name : `${record.name}.${domain.name}`;
      try {
        let found = [];
        if (type === "MX")
          found = (await dns.resolveMx(lookup)).map((r) => r.exchange.trim());
        else if (type === "A")
          found = (await dns.resolve4(lookup)).map((ip) => ip.trim());
        else if (type === "TXT")
          found = (await dns.resolveTxt(lookup)).map((r) => r.join("").trim());

        const expected = record.value.trim();
        const matched = found.some((r) =>
          type === "TXT"
            ? normalizeTxt(r) === normalizeTxt(expected)
            : r === expected
        );

        if (!matched && found.length > 0) {
          await Prisma.dnsRecord.update({
            where: { id: record.id },
            data: { value: found[0] },
          });
        }

        return { matched, expected, found, record, lookupName: lookup };
      } catch (err) {
        return {
          matched: false,
          error: err.message,
          record,
          lookupName: lookup,
        };
      }
    })
  );
};

export const verifyDnsHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const type = req.query.type?.toUpperCase();
  if (!id) return ApiError.send(res, 400, "Domain ID required");

  try {
    if (type) {
      const results = await verifyDNSRecord(id, type);
      const allMatched = results.every((r) => r.matched);
      return res.json(
        new ApiResponse(
          allMatched ? 200 : 400,
          allMatched ? `${type} verified` : `${type} mismatch`,
          {
            results,
          }
        )
      );
    }

    const allResults = (
      await Promise.all(["A", "MX", "TXT"].map((t) => verifyDNSRecord(id, t)))
    ).flat();
    const allVerified = allResults.every((r) => r.matched);
    const domain = await Prisma.domain.update({
      where: { id },
      data: { verified: allVerified },
    });

    return res.json(
      new ApiResponse(
        allVerified ? 200 : 400,
        allVerified ? "All verified" : "Some records failed",
        {
          domain,
          results: allResults,
        }
      )
    );
  } catch (error) {
    return ApiError.send(res, 500, `Verification failed: ${error.message}`);
  }
});
