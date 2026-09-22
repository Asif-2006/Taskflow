# ─── API Dockerfile ───────────────────────────────────────────────────────────
#
# We use Node.js 20 Alpine (small image).
# The build context is the ./api directory.

FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first (Docker layer caching optimization)
# If package.json hasn't changed, Docker reuses the cached npm install layer
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Expose the port Express listens on
EXPOSE 3000

# Default command: start the server
CMD ["npm", "start"]
