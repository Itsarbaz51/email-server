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
      dkimSelector: DKIM_SELECTOR,
    },
  });

  const recordsToCreate = [
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
      value: "v=spf1 a mx include:primewebdev.in ~all",
      domainId: newDomain.id,
    },
    {
      type: "TXT",
      name: `${DKIM_SELECTOR}._domainkey`,
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
