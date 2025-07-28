# Use latest stable Node.js version
FROM node:20

# Set working directory inside container
WORKDIR /app

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy entire project files
COPY . .

# Expose backend port
EXPOSE 9000

# Start the application
CMD ["node", "src/index.js"]
