FROM node:23-alpine

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

EXPOSE 8080
CMD ["npm", "run", "serve"]
