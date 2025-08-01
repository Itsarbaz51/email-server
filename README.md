# Email Server

A complete email server with SMTP sending/receiving capabilities, domain management, and mailbox administration.

## Features

- ✅ SMTP Email Sending
- ✅ SMTP Email Receiving
- ✅ Domain Management with DNS Records
- ✅ Mailbox Creation and Management
- ✅ DKIM Support
- ✅ File Attachments
- ✅ JWT Authentication
- ✅ Role-based Access Control

## Setup Instructions

### 1. Environment Variables

Create a `.env` file in the root directory:

```env
# Database Configuration
DATABASE_URL="mysql://username:password@localhost:3306/email_server"

# JWT Configuration
ACCESS_TOKEN_SECRET="your-access-token-secret-key-here"
REFRESH_TOKEN_SECRET="your-refresh-token-secret-key-here"
ACCESS_TOKEN_EXPIRY="7d"
REFRESH_TOKEN_EXPIRY="90d"

# Encryption
ENCRYPTION_SECRET="your-encryption-secret-key-here"

# Server Configuration
PORT=9000
NODE_ENV="development"

# SMTP Configuration
SMTP_HOST="mail.yourdomain.com"
SMTP_PORT=587
SMTP_SECURE=false

# SMTP Server (for receiving emails)
SMTP_PORT_RECEIVE=2626

# Client Configuration
CLIENT_URI="http://localhost:3000"

# Server IP (for DNS records)
SERVER_IP="13.203.241.137"
```

### 2. Database Setup

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed database (optional)
npm run seed
```

### 3. Start Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication

#### Register Admin

```
POST /api/auth/register
Content-Type: application/json

{
  "fullName": "Admin User",
  "email": "admin@example.com",
  "password": "password123"
}
```

#### Login

```
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "password123"
}
```

### Domain Management

#### Generate DNS Records

```
POST /api/dns/generate-dns-records
Authorization: Bearer <token>
Content-Type: application/json

{
  "domain": "example.com"
}
```

#### Verify DNS Records

```
GET /api/dns/verify-dns-record/:domainId?type=MX
```

### Mailbox Management

#### Create Mailbox

```
POST /api/mailboxes/create-mailbox
Authorization: Bearer <token>
Content-Type: application/json

{
  "address": "user",
  "password": "password123",
  "domainId": "domain-uuid"
}
```

#### Get Mailboxes

```
GET /api/mailboxes/get-mailbox
Authorization: Bearer <token>
```

#### Update Mailbox Password

```
PUT /api/mailboxes/update-mailbox/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "password": "newpassword123"
}
```

#### Delete Mailbox

```
DELETE /api/mailboxes/delete-mailbox/:id
Authorization: Bearer <token>
```

### Email Operations

#### Send Email

```
POST /api/email/send-email
Authorization: Bearer <token>
Content-Type: multipart/form-data

{
  "from": "user@example.com",
  "to": "recipient@example.com",
  "subject": "Test Email",
  "body": "<h1>Hello World</h1>",
  "attachments": [file1, file2, ...]
}
```

#### Get Messages

```
GET /api/email/messages/:mailboxId
Authorization: Bearer <token>
```

#### Get My Messages

```
GET /api/email/my-messages
Authorization: Bearer <token>
```

## SMTP Configuration

### Sending Emails

- Host: `mail.yourdomain.com`
- Port: `587`
- Security: `STARTTLS`
- Authentication: Required

### Receiving Emails

- Host: `your-server-ip`
- Port: `2626` (development)
- Authentication: Required

## DNS Records Required

For each domain, the following DNS records are automatically generated:

1. **A Record**: `mail.example.com` → Server IP
2. **MX Record**: `@` → `mail.example.com` (Priority: 10)
3. **SPF Record**: `@` → `v=spf1 a mx ip4:SERVER_IP ~all`
4. **DKIM Record**: `dkim._domainkey` → Generated public key
5. **DMARC Record**: `_dmarc` → `v=DMARC1; p=quarantine; sp=quarantine; adkim=s; aspf=s; rua=mailto:dmarc@example.com`

## Troubleshooting

### Common Issues

1. **SMTP Authentication Failed**
   - Ensure mailbox SMTP password is correctly encrypted
   - Verify domain is verified before sending emails

2. **DNS Verification Failed**
   - Wait for DNS propagation (can take up to 48 hours)
   - Verify DNS records are correctly configured
   - Check domain verification status

3. **Email Not Received**
   - Check SMTP server is running on port 2626
   - Verify mailbox exists and domain is verified
   - Check firewall settings

4. **Database Connection Issues**
   - Verify DATABASE_URL is correct
   - Ensure MySQL server is running
   - Check database permissions

## Development

### Project Structure

```
src/
├── controller/          # API controllers
├── db/                 # Database configuration
├── middlewares/        # Express middlewares
├── routes/             # API routes
├── smtp/               # SMTP server configuration
├── utils/              # Utility functions
├── app.js              # Express app setup
└── index.js            # Server entry point
```

### Adding New Features

1. Create controller in `src/controller/`
2. Add routes in `src/routes/`
3. Update database schema if needed
4. Test with Postman or similar tool

## License

ISC
