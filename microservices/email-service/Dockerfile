FROM node:24-alpine

WORKDIR /app/microservices/email-service

ENV NODE_ENV=production

COPY microservices/email-service/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

COPY microservices/email-service/index.js ./index.js
COPY microservices/email-service/db.js ./db.js

COPY proto/ /app/proto/

USER node

EXPOSE 8002

CMD ["node", "index.js"]
