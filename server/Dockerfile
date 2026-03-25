FROM node:22-alpine
RUN apk add --no-cache python3 py3-pip make g++ linux-headers
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npm run build
CMD ["npm", "run", "serve"]
