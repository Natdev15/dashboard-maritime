# Use Node.js 18 with Debian slim for better SQLite3 support
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install system dependencies for SQLite3 compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    libsqlite3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies and rebuild SQLite3 for the target platform
RUN npm install --only=production && \
    npm rebuild sqlite3 --build-from-source

# Copy nodejs_receiver files
COPY nodejs_receiver/ .

# Copy public directory
COPY public/ ./public

# Create logs directory
RUN mkdir -p /app/logs

# Expose ports
EXPOSE 3001 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start the application
CMD ["node", "server.js"] 