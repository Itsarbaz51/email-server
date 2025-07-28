FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["sh", "-c", "npx prisma generate && npx prisma db push && node src/index.js"]

EXPOSE 9000
