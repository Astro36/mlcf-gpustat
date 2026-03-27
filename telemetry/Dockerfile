FROM node:24-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production

COPY . ./
  
ENV NODE_ENV=production

EXPOSE 9090

HEALTHCHECK --interval=1m --timeout=30s --retries=3 --start-period=1m \
  CMD wget -q -O /dev/null http://localhost:9090/health || exit 1

CMD ["node", "./main.js"]
