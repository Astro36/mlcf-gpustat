FROM node:23-alpine

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

COPY . ./

EXPOSE 3000
CMD ["node", "./main.js"]
