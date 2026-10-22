FROM node:24-alpine

WORKDIR /app/microservices/analytics-service

ENV NODE_ENV=production

COPY microservices/analytics-service/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

COPY microservices/analytics-service/index.js ./index.js

COPY proto/ /app/proto/

USER node

EXPOSE 8003

CMD ["node", "index.js"]
