FROM node:23-alpine AS builder

WORKDIR /usr/src/app/static

COPY static/package*.json ./
RUN npm ci --production

COPY static ./
RUN npm run build

FROM node:23-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production

COPY --from=builder /usr/src/app/static/dist ./static/dist
COPY main.js ./
COPY servers.config.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "./main.js"]
