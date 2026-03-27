FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for Docker layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the server code
COPY . .

# Final lean production stage
FROM node:20-alpine

WORKDIR /app

# Copy built assets from builder
COPY --from=builder /app ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the WebSocket port
EXPOSE 3001

# Drop privileges (security best practice)
USER node

CMD ["npm", "start"]
