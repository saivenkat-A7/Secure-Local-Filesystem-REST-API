FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data

ENV API_PORT=8080 \
    BASE_DIRECTORY=/app/data

EXPOSE 8080

CMD ["node", "src/server.js"]
