FROM node:24-alpine

WORKDIR /app/microservices/payment-service

ENV NODE_ENV=production

COPY microservices/payment-service/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

COPY microservices/payment-service/index.js ./index.js
COPY microservices/payment-service/db.js ./db.js
COPY microservices/payment-service/middleware/ ./middleware/
COPY microservices/payment-service/entrega-3-memory.js ./entrega-3-memory.js

COPY proto/ /app/proto/

USER node

EXPOSE 8000

CMD ["node", "index.js"]
