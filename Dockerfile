FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# generate client at container startup, not build time
CMD ["sh", "-c", "npx prisma generate && node src/index.js"]

EXPOSE 9000
