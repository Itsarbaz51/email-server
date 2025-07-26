# Step 0: Use official Node.js base image
FROM node:22

# Step 1: Install system dependencies
RUN apt-get update && \
    apt-get install -y default-mysql-client openssl && \
    rm -rf /var/lib/apt/lists/*

# Step 2: Set working directory
WORKDIR /app

# Step 3: Copy package.json and package-lock.json first
COPY package*.json ./

# Step 4: Install app dependencies
RUN npm install

# Step 5: Install Prisma CLI globally (optional)
RUN npm install -g prisma

# Step 6: Copy Prisma schema and migrations
COPY prisma ./prisma

# Step 7: Generate Prisma client
RUN npx prisma generate

# Step 8: Copy the rest of the source code
COPY . .

# Step 9: Set environment
ENV NODE_ENV=production

# Step 10: Expose ports for HTTP and SMTP
EXPOSE 9000
EXPOSE 2626

# Step 11: Start the app
CMD ["node", "src/index.js"]
