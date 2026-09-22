# ─── Worker Dockerfile ────────────────────────────────────────────────────────
#
# Identical structure to the API Dockerfile.
# No EXPOSE needed — the Worker never listens for HTTP traffic.
# It only connects OUT to Redis and MongoDB.

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# No EXPOSE — the Worker doesn't accept incoming connections.
# It polls Redis and updates MongoDB; both connections are outbound.

CMD ["npm", "start"]
