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

  // Generate DKIM Key Pair
  const dkimKeys = generateDKIMKeys();

  // ✅ Create new domain including public key
  const newDomain = await Prisma.domain.create({
    data: {
      name: domain,
      adminId: currentUserId,
      dkimPrivateKey: dkimKeys.privateKey,
      dkimPublicKey: dkimKeys.publicKey, // <-- Added this line
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
