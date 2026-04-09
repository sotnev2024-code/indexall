FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libsqlite3-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["npm", "run", "start:prod"]
