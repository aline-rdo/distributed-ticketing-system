FROM node:24-alpine

WORKDIR /app/microservices/tickets-service

ENV NODE_ENV=production

COPY microservices/tickets-service/package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund

COPY microservices/tickets-service/index.js ./index.js
COPY microservices/tickets-service/db.js ./db.js

COPY proto/ /app/proto/

USER node

EXPOSE 8001

CMD ["node", "index.js"]
