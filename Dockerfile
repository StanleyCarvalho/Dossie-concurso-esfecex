FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p data uploads
RUN npm run seed

EXPOSE 3000
CMD ["npm", "start"]
