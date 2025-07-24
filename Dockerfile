# Use official Node image
FROM node:22

# Create app directory
WORKDIR /app

# Copy dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Set environment
ENV NODE_ENV=production

# Expose HTTP and SMTP port
EXPOSE 5000
EXPOSE 2525

# Start app
CMD ["node", "server.js"]
