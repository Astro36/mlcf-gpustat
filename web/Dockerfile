FROM node:24-alpine AS builder

WORKDIR /usr/src/app/static

COPY static/package*.json ./
RUN npm ci --production

COPY static ./
RUN npm run build

FROM node:24-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production

COPY --from=builder /usr/src/app/static/dist ./static/dist
COPY main.js ./

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=1m --timeout=30s --retries=3 --start-period=1m \
  CMD wget -q -O /dev/null http://localhost:8080/health || exit 1

CMD ["node", "./main.js"]
