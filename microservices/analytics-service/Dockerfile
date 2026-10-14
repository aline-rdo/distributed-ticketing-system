FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
USER node
EXPOSE 8003
CMD ["node", "index.js"]
