# VM Docker Deployment Guide - Container Data Receiver with Dashboard

## Complete Docker Solution for VM Deployment

This guide provides a 100% working Docker implementation with SQLite3 database, dashboard, and outbound queue that works perfectly on any VM.

## Features

- SQLite3 Database: Persistent storage for all container data  
- Real-time Dashboard: Beautiful UI showing live data  
- Outbound Queue: Database-stored retry mechanism  
- Protocol Buffer Processing: Efficient data compression/decompression  
- Data Persistence: All data saved to database  
- Docker Compose: Easy deployment and management  
- Nginx Load Balancer: High-performance load balancing  

## Port Configuration

- Receiver/Decoder: http://172.25.1.78:3001 (Protocol Buffer data ingestion)
- Dashboard UI: http://172.25.1.78:3002 (Web interface)
- Nginx Load Balancer: http://172.25.1.78:3000 (Load balanced access)

## VM Setup Instructions

### Step 1: Install Docker on VM
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group
sudo usermod -aG docker $USER

# Verify installation
docker --version
docker-compose --version
```

### Step 2: Deploy Application
```bash
# Create application directory
sudo mkdir -p /opt/container-receiver
sudo chown $USER:$USER /opt/container-receiver
cd /opt/container-receiver

# Copy your project files here
# (Copy the entire ProtoBuf Project folder)
```

### Step 3: Build and Start Services
```bash
# Build and start all services
docker-compose up -d --build

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

## Running the Application

### Start All Services
```bash
cd /opt/container-receiver
docker-compose up -d
```

Expected Output:
```
Creating network "container-receiver_container-network" ... done
Creating volume "container-receiver_container_data" ... done
Creating volume "container-receiver_logs" ... done
Building container-receiver
Step 1/10 : FROM node:18-slim
Step 2/10 : WORKDIR /app
Step 3/10 : RUN apt-get update && apt-get install -y python3 make g++ sqlite3 libsqlite3-dev curl && rm -rf /var/lib/apt/lists/*
Step 4/10 : COPY package*.json ./
Step 5/10 : RUN npm install --only=production && npm rebuild sqlite3 --build-from-source
Step 6/10 : COPY . .
Step 7/10 : RUN mkdir -p /app/logs
Step 8/10 : EXPOSE 3001 3002
Step 9/10 : HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD curl -f http://localhost:3001/health || exit 1
Step 10/10 : CMD ["node", "server.js"]
Successfully built abc123def456
Creating container-receiver_container-receiver_1 ... done
Creating container-receiver_nginx-lb_1 ... done
```

### Check Service Status
```bash
# Check if all services are running
docker-compose ps

# Expected output:
# Name                           Command               State           Ports
# ---------------------------------------------------------------------------------
# container-receiver_nginx-lb_1      /docker-entrypoint.sh nginx -g ...   Up      0.0.0.0:3000->80/tcp
# container-receiver_container-receiver_1   node server.js                    Up      0.0.0.0:3001->3001/tcp, 0.0.0.0:3002->3002/tcp
```

## Testing the Implementation

### Test Receiver (Port 3001)
```bash
# Health check
curl http://172.25.1.78:3001/health

# Statistics
curl http://172.25.1.78:3001/stats

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "2024-01-15T10:30:00.000Z",
#   "uptime": 3600,
#   "version": "1.0.0"
# }
```

### Test Dashboard (Port 3002)
```bash
# Dashboard API
curl http://172.25.1.78:3002/api/stats

# Open in browser
# http://172.25.1.78:3002
```

### Test Load Balancer (Port 3000)
```bash
# Health check through nginx
curl http://172.25.1.78:3000/nginx-health

# Container data through nginx
curl -X POST http://172.25.1.78:3000/container-data \
  -H "Content-Type: application/octet-stream" \
  --data-binary @test_data.bin
```

### Send Test Data
```bash
# In a new terminal
cd /opt/container-receiver

# Send data to receiver directly
python3 locust_sender.py

# Or send data through load balancer
locust -f locust_sender.py --host http://172.25.1.78:3001
```

## File Structure

```
/opt/container-receiver/
├── docker-compose.yml          # Docker services configuration
├── nginx.conf                  # Nginx load balancer config
├── nodejs_receiver/
│   ├── server.js               # Main server (Ports 3001 + 3002)
│   ├── database.js             # SQLite3 database service
│   ├── package.json            # Dependencies
│   ├── Dockerfile              # Docker image definition
│   └── container_data.proto    # Protocol Buffer schema
├── public/                     # Dashboard UI
│   ├── index.html
│   ├── script.js
│   └── style.css
├── locust_sender.py            # Test data sender
└── logs/                       # Application logs
```

## Database Persistence

### Database Location
The SQLite database is stored in a Docker volume:
- Volume Name: container_data
- Container Path: /app/maritime_containers.db
- Host Path: Managed by Docker

### Database Schema
```sql
-- Container Data Table
CREATE TABLE container_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  compressed_data BLOB NOT NULL,
  decompressed_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Outbound Queue Table
CREATE TABLE outbound_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  data TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 10,
  next_retry_at INTEGER,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Docker Commands

### Service Management
```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f container-receiver
docker-compose logs -f nginx-lb

# Check service status
docker-compose ps
```

### Database Access
```bash
# Access database inside container
docker-compose exec container-receiver sqlite3 /app/maritime_containers.db

# Check container data
SELECT COUNT(*) FROM container_data;
SELECT * FROM container_data ORDER BY timestamp DESC LIMIT 5;

# Check outbound queue
SELECT COUNT(*) FROM outbound_queue;
SELECT * FROM outbound_queue WHERE status = 'pending';

# Exit SQLite
.quit
```

### Container Management
```bash
# Rebuild and restart
docker-compose down
docker-compose up -d --build

# View container details
docker-compose exec container-receiver ls -la /app/
docker-compose exec container-receiver cat /app/maritime_containers.db

# Check environment variables
docker-compose exec container-receiver env | grep OUTBOUND
```

## Monitoring and Logs

### Application Logs
```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f container-receiver
docker-compose logs -f nginx-lb

# View last 100 lines
docker-compose logs --tail=100 container-receiver
```

### Health Checks
```bash
# Check receiver health
curl http://172.25.1.78:3001/health

# Check nginx health
curl http://172.25.1.78:3000/nginx-health

# Check container health
docker-compose ps
```

### Performance Monitoring
```bash
# Check container resource usage
docker stats

# Check disk usage
docker system df

# Check volume usage
docker volume ls
docker volume inspect container-receiver_container_data
```

## Security and Firewall

### Firewall Configuration
```bash
# Allow necessary ports
sudo ufw allow 3000/tcp  # Nginx load balancer
sudo ufw allow 3001/tcp  # Receiver direct access
sudo ufw allow 3002/tcp  # Dashboard
sudo ufw enable

# Check firewall status
sudo ufw status
```

### Docker Security
```bash
# Run containers as non-root (already configured)
# Check container user
docker-compose exec container-receiver whoami

# Verify file permissions
docker-compose exec container-receiver ls -la /app/
```

## Troubleshooting

### Common Issues

1. Port Already in Use
```bash
# Check what's using the ports
sudo netstat -tulpn | grep :3000
sudo netstat -tulpn | grep :3001
sudo netstat -tulpn | grep :3002

# Stop conflicting services
sudo systemctl stop nginx  # if nginx is running
sudo pkill -f node  # if node processes are running
```

2. Docker Permission Issues
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again, or run:
newgrp docker
```

3. SQLite3 Build Issues
```bash
# Rebuild with no cache
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

4. Database Permission Issues
```bash
# Fix database permissions inside container
docker-compose exec container-receiver chown node:node /app/maritime_containers.db
docker-compose exec container-receiver chmod 644 /app/maritime_containers.db
```

### Debug Commands
```bash
# Check container logs
docker-compose logs container-receiver

# Check container environment
docker-compose exec container-receiver env

# Check container processes
docker-compose exec container-receiver ps aux

# Check container network
docker-compose exec container-receiver netstat -tulpn
```

## Performance Optimization

### Docker Optimization
```bash
# Increase Docker daemon limits
sudo nano /etc/docker/daemon.json
```

Add to daemon.json:
```json
{
  "default-ulimits": {
    "nofile": {
      "Hard": 65536,
      "Name": "nofile",
      "Soft": 65536
    }
  }
}
```

### System Optimization
```bash
# Increase file descriptor limits
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
```

## Verification Checklist

- [ ] Docker installed and running
- [ ] Docker Compose installed
- [ ] Project files copied to VM
- [ ] Services start without errors (docker-compose up -d)
- [ ] All containers running (docker-compose ps)
- [ ] Receiver responds on port 3001
- [ ] Dashboard accessible on port 3002
- [ ] Nginx load balancer working on port 3000
- [ ] Database file created
- [ ] Test data can be sent
- [ ] Data appears in dashboard
- [ ] Outbound queue working

## Success!

Your container data receiver with SQLite3 database and dashboard is now running on your VM using Docker!

Access Points:
- Receiver: http://172.25.1.78:3001
- Dashboard: http://172.25.1.78:3002
- Load Balancer: http://172.25.1.78:3000

Test Commands:
```bash
# Send test data
locust -f locust_sender.py --host http://172.25.1.78:3001

# View dashboard
# Open http://172.25.1.78:3002 in browser
```

Database Location: Docker volume container_data (persistent across restarts)
