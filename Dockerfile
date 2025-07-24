# Use official Node.js image
FROM node:22

# Step 1: Install system dependencies (mysql client, openssl etc.)
RUN apt-get update && \
    apt-get install -y default-mysql-client openssl && \
    rm -rf /var/lib/apt/lists/*

# Step 2: Set working directory
WORKDIR /app

# Step 3: Copy package files and install deps
COPY package*.json ./
RUN npm install

# Step 4: Install Prisma CLI globally
RUN npm install -g prisma

# Step 5: Copy the rest of the source code
COPY . .

# Step 6: Generate Prisma Client
RUN npx prisma generate

# Step 7: Set environment
ENV NODE_ENV=production

# Step 8: Expose HTTP and SMTP ports
EXPOSE 9000
EXPOSE 2626

# Step 9: Start your app
CMD ["node", "server.js"]
