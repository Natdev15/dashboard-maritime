const express = require('express');
const axios = require('axios');
const protobuf = require('protobufjs');
const path = require('path');
const DatabaseService = require('./database');

const app = express();
const dashboardApp = express();

// Load protobuf schema
let ContainerData;
const protobufReady = protobuf
    .load('./container_data.proto')
    .then(root => {
        ContainerData = root.lookupType('container.ContainerData');
        console.log('Protocol Buffer schema loaded successfully');
    })
    .catch(err => {
        console.error('Failed to load protobuf schema:', err.message);
        process.exit(1);
    });

// Configuration
const PORT = process.env.PORT || 3001;
const QUEUE_PROCESS_INTERVAL = 5000; // 7 seconds
const OUTBOUND_URL = process.env.OUTBOUND_URL || null; // External M2M endpoint
const OUTBOUND_RETRY_INTERVAL = 5000; // 5 seconds between retry attempts
const MAX_RETRY_ATTEMPTS = 100; // Maximum retry attempts before giving up

// Data structure for container fields in order (exact field order as provided)
const CONTAINER_FIELDS = [
    'msisdn',      // SIM ID
    'iso6346',     // Container ID  
    'time',        // UTC time DDMMYY hhmmss.s
    'rssi',        // RSSI
    'cgi',         // Cell ID Location
    'ble-m',       // BLE source node
    'bat-soc',     // Battery %
    'acc',         // Accelerometer mg
    'temperature', // °C
    'humidity',    // %RH
    'pressure',    // hPa
    'door',        // Door status
    'gnss',        // GPS status
    'latitude',    // DD
    'longitude',   // DD
    'altitude',    // meters
    'speed',       // m/s
    'heading',     // degrees
    'nsat',        // Number of satellites
    'hdop'         // HDOP
];

// Protocol Buffer decompression: reverse of Python protobuf_compress
function protobufDecompress(compressedData) {
    try {
        // Parse protobuf message
        const pbMessage = ContainerData.decode(compressedData);
        
        // Helper function to safely convert values to strings
        const safeToString = (value, defaultValue = '0') => {
            if (value === undefined || value === null) {
                return defaultValue;
            }
            return value.toString();
        };
        
        // Helper function to safely format floats
        const safeToFixed = (value, decimals = 2, defaultValue = '0.00') => {
            if (value === undefined || value === null) {
                return defaultValue;
            }
            return Number(value).toFixed(decimals);
        };
        
        // Convert back to original format with safe conversions
        const containerData = {
            // String fields (protobuf strings are never undefined)
            msisdn: pbMessage.msisdn || '',
            iso6346: pbMessage.iso6346 || '',
            time: pbMessage.time || '',
            cgi: pbMessage.cgi || '',
            door: pbMessage.door || '',
            
            // Integer fields (convert back to strings with safe conversion)
            rssi: safeToString(pbMessage.rssi, '0'),
            'ble-m': safeToString(pbMessage.ble_m, '0'),
            'bat-soc': safeToString(pbMessage.bat_soc, '0'),
            gnss: safeToString(pbMessage.gnss, '0'),
            nsat: safeToString(pbMessage.nsat, '00').padStart(2, '0'), // Ensure 2 digits
            
            // Accelerometer (combine back to string with safe conversion)
            acc: `${safeToFixed(pbMessage.acc_x, 4, '0.0000')} ${safeToFixed(pbMessage.acc_y, 4, '0.0000')} ${safeToFixed(pbMessage.acc_z, 4, '0.0000')}`,
            
            // Float fields (format according to requirements with safe conversion)
            temperature: safeToFixed(pbMessage.temperature, 2, '0.00'),
            humidity: safeToFixed(pbMessage.humidity, 2, '0.00'),
            pressure: safeToFixed(pbMessage.pressure, 4, '0.0000'),
            latitude: safeToFixed(pbMessage.latitude, 2, '0.00'),
            longitude: safeToFixed(pbMessage.longitude, 2, '0.00'),
            altitude: safeToFixed(pbMessage.altitude, 2, '0.00'),
            speed: safeToFixed(pbMessage.speed, 1, '0.0'),
            heading: safeToFixed(pbMessage.heading, 2, '0.00'),
            hdop: safeToFixed(pbMessage.hdop, 1, '0.0')
        };
        
        return containerData;
        
    } catch (error) {
        throw new Error(`Protocol Buffer decompression failed: ${error.message}`);
    }
}

// Pseudo queue for processing messages
class MessageQueue {
    constructor() {
        this.queue = [];
        this.processed = 0;
        this.errors = 0;
        this.startTime = Date.now();
        
        // Start queue processor
        this.startProcessor();
        
        console.log('Message queue initialized');
        console.log(`Processing interval: ${QUEUE_PROCESS_INTERVAL}ms`);
    }
    
    add(message) {
        this.queue.push({
            ...message,
            queuedAt: Date.now()
        });
        // console.log(`📥 Message queued (queue size: ${this.queue.length})`);
    }
    
    startProcessor() {
        setInterval(() => {
            this.processQueue();
        }, QUEUE_PROCESS_INTERVAL);
        
        console.log('Queue processor started');
    }
    
    processQueue() {
        if (this.queue.length === 0) {
            return;
        }
        
        console.log(`Processing ${this.queue.length} messages from queue...`);
        
        const batch = this.queue.splice(0); // Process all queued messages
        
        const batchStats = {
            processed: 0,
            errors: 0,
            avgQueueTime: 0,
            avgProcessingTime: 0,
            totalQueueTime: 0,
            totalProcessingTime: 0
        };
        
        batch.forEach(message => {
            try {
                this.processMessage(message);
                this.processed++;
                batchStats.processed++;
                
                // Collect timing stats if available
                if (message.processingStats) {
                    batchStats.totalQueueTime += message.processingStats.queueTime;
                    batchStats.totalProcessingTime += message.processingStats.processingTime;
                }
            } catch (error) {
                console.error('Error processing message:', error.message);
                this.errors++;
                batchStats.errors++;
            }
        });
        
        if (batch.length > 0) {
            // Calculate averages
            if (batchStats.processed > 0) {
                batchStats.avgQueueTime = Math.round(batchStats.totalQueueTime / batchStats.processed);
                batchStats.avgProcessingTime = Math.round(batchStats.totalProcessingTime / batchStats.processed);
            }
            
            console.log(`Batch processed: ${batchStats.processed} messages, ${batchStats.errors} errors`);
            console.log(`   Timing - Queue: ${batchStats.avgQueueTime}ms avg, Processing: ${batchStats.avgProcessingTime}ms avg`);
            console.log(`   Total: ${this.processed} processed, ${this.errors} errors, Rate: ${(this.processed / ((Date.now() - this.startTime) / 1000)).toFixed(1)} msg/sec`);
        }
    }
    
    processMessage(message) {
        const { compressedData, receivedAt, queuedAt } = message;
        
        // Protocol Buffer decompression
        const containerData = protobufDecompress(compressedData);
        
        // Validate reconstructed data
        const expectedFields = CONTAINER_FIELDS.length;
        const actualFields = Object.keys(containerData).length;
        
        if (actualFields !== expectedFields) {
            throw new Error(`Invalid field count: expected ${expectedFields}, got ${actualFields}`);
        }
        
        // Create full structure (matching stress.py format)
        const reconstructedData = {
            "m2m:cin": {
                "con": containerData
            }
        };
        
        // Calculate processing times (for internal tracking)
        const queueTime = queuedAt - receivedAt;
        const processingTime = Date.now() - queuedAt;
        const totalTime = Date.now() - receivedAt;
        
        // Store timing info for potential use (no console output for individual records)
        message.processingStats = {
            queueTime,
            processingTime,
            totalTime,
            containerId: containerData.iso6346,
            simId: containerData.msisdn
        };
        
        // Persist compressed record for dashboard analytics (ingestion timestamp)
        if (dbService) {
            const containerIdForDb = containerData.iso6346 || 'UNKNOWN';
            dbService
                .addToQueue(containerIdForDb, compressedData, new Date().toISOString())
                .catch(err => {
                    console.error('DB queue add failed:', err.message);
                });
                
            // Add to outbound queue for forwarding
            if (OUTBOUND_URL) {
                dbService.addToOutboundQueue(containerIdForDb, reconstructedData)
                    .catch(error => {
                        console.error('Failed to add to outbound queue:', error.message);
                    });
            }
        }

        // Forward to outbound queue, additional processing can be added
        this.onDataProcessed(reconstructedData);
    }
    
    onDataProcessed(data) {
        // Forward processed data to external M2M endpoint via outbound queue
        outboundQueue.add(data);
        
        // Additional processing can be added here (database, other APIs, etc.)
        // console.log('Data ready for further processing');
    }
    
    getStats() {
        const uptime = Date.now() - this.startTime;
        return {
            processed: this.processed,
            errors: this.errors,
            queueSize: this.queue.length,
            uptimeMs: uptime,
            ratePerSecond: this.processed / (uptime / 1000)
        };
    }
}

// Outbound queue for forwarding processed data to external M2M endpoint
class OutboundQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.totalSent = 0;
        this.totalErrors = 0;
        this.startTime = Date.now();
        
        // Start processing if URL is configured
        if (OUTBOUND_URL) {
            this.startProcessor();
            console.log('Outbound queue initialized');
            console.log(`Target URL: ${OUTBOUND_URL}`);
        } else {
            console.log('OUTBOUND_URL not configured - outbound queue disabled');
        }
    }
    
    add(data) {
        if (!OUTBOUND_URL) {
            return; // Skip if no URL configured
        }
        
        const queueItem = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            data: data,
            attempts: 0,
            createdAt: Date.now(),
            lastAttemptAt: null,
            nextRetryAt: Date.now() // Can send immediately
        };
        
        this.queue.push(queueItem);
        // console.log(`📤 Added to outbound queue (size: ${this.queue.length}) - ID: ${queueItem.id}`);
    }
    
    startProcessor() {
        setInterval(() => {
            this.processQueue();
        }, OUTBOUND_RETRY_INTERVAL);
    }
    
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        const now = Date.now();
        
        // Find items ready for retry
        const readyItems = this.queue.filter(item => item.nextRetryAt <= now);
        
        if (readyItems.length === 0) {
            this.processing = false;
            return;
        }
        
        // console.log(`🔄 Processing ${readyItems.length} outbound messages...`);
        
        for (const item of readyItems) {
            await this.sendItem(item);
        }
        
        // Remove successfully sent items (those with attempts = 0 after processing)
        const beforeCount = this.queue.length;
        this.queue = this.queue.filter(item => item.attempts > 0 && item.attempts <= MAX_RETRY_ATTEMPTS);
        const removedCount = beforeCount - this.queue.length;
        
        if (removedCount > 0) {
            // console.log(`Removed ${removedCount} completed/failed items from outbound queue`);
        }
        
        this.processing = false;
    }
    
    async sendItem(item) {
        try {
            item.attempts++;
            item.lastAttemptAt = Date.now();
            
            // Create M2M format payload (same as http-client.js)
            const payload = {
                "m2m:cin": {
                    "con": item.data["m2m:cin"]["con"]
                }
            };
            
            const response = await axios.post(OUTBOUND_URL, payload, {
                headers: {
                    'Content-Type': 'application/json;ty=4',
                    'X-M2M-RI': new Date().toISOString(),
                    'X-M2M-ORIGIN': 'Natesh'
                },
                timeout: 10000 // 10 second timeout
            });
            
            if (response.status === 201) {
                // Success! Mark for removal
                item.attempts = 0;
                this.totalSent++;
                // console.log(`Successfully sent item ${item.id} (attempt ${item.attempts})`);
            } else {
                throw new Error(`Unexpected status: ${response.status}`);
            }
            
        } catch (error) {
                            // console.log(`Failed to send item ${item.id} (attempt ${item.attempts}/${MAX_RETRY_ATTEMPTS}): ${error.message}`);
            
            if (item.attempts >= MAX_RETRY_ATTEMPTS) {
                // Give up after max attempts
                this.totalErrors++;
                console.log(`Giving up on item ${item.id} after ${MAX_RETRY_ATTEMPTS} attempts`);
                item.attempts = 0; // Mark for removal
            } else {
                // Schedule retry with exponential backoff
                const delay = Math.min(OUTBOUND_RETRY_INTERVAL * Math.pow(2, item.attempts - 1), 60000); // Max 60s
                item.nextRetryAt = Date.now() + delay;
                console.log(`Retrying item ${item.id} in ${delay}ms`);
            }
        }
    }
    
    getStats() {
        const uptime = Date.now() - this.startTime;
        return {
            queueSize: this.queue.length,
            totalSent: this.totalSent,
            totalErrors: this.totalErrors,
            uptimeMs: uptime,
            ratePerSecond: this.totalSent / (uptime / 1000),
            enabled: !!OUTBOUND_URL,
            targetUrl: OUTBOUND_URL
        };
    }
}

// Initialize message and outbound queues (instances assigned after definition for stats access)
const messageQueue = new MessageQueue();
const outboundQueue = new OutboundQueue();

// Database service instance (initialized during startup)
let dbService = null;

// Middleware
app.use(express.raw({ type: 'application/octet-stream', limit: '1mb' }));
app.use(express.json());

// CORS middleware for cross-origin requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
    }
    
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    const inboundStats = messageQueue.getStats();
    const outboundStats = outboundQueue.getStats();
    
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        inbound: inboundStats,
        outbound: outboundStats
    });
});

// Statistics endpoint
app.get('/stats', (req, res) => {
    const inboundStats = messageQueue.getStats();
    const outboundStats = outboundQueue.getStats();
    
    res.json({
        timestamp: new Date().toISOString(),
        inbound: inboundStats,
        outbound: outboundStats
    });
});

// Main container data endpoint
app.post('/container-data', (req, res) => {
    try {
        const compressedData = req.body;
        
        if (!Buffer.isBuffer(compressedData)) {
            return         res.status(400).json({
            error: 'Invalid data format',
            message: 'Expected binary data (protobuf compressed)'
        });
        }
        
        if (compressedData.length === 0) {
            return res.status(400).json({
                error: 'Empty payload',
                message: 'No data received'
            });
        }
        
        // console.log(`📡 Received container data (${compressedData.length} bytes)`);
        
        // Add to queue for processing
        messageQueue.add({
            compressedData: compressedData,
            receivedAt: Date.now(),
            size: compressedData.length
        });
        
        // Respond immediately
        res.status(200).json({
            status: 'received',
            timestamp: new Date().toISOString(),
            size: compressedData.length,
            queueSize: messageQueue.queue.length
        });
        
    } catch (error) {
        console.error('Error receiving container data:', error.message);
        res.status(500).json({
            error: 'Processing error',
            message: error.message
        });
    }
});

// Test endpoint for manual testing
app.post('/test', (req, res) => {
    console.log('Test endpoint called');
    console.log('Headers:', req.headers);
    console.log('Body type:', typeof req.body);
    console.log('Body length:', req.body?.length || 0);
    
    res.json({
        status: 'test received',
        contentType: req.headers['content-type'],
        bodyType: typeof req.body,
        bodyLength: req.body?.length || 0
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.method} ${req.path} not found`
    });
});

// ------------------------
// Dashboard Server (Port 3001)
// ------------------------

// Serve static dashboard UI
dashboardApp.use(express.static(path.join(__dirname, '..', 'public')));

// API: Recent containers
dashboardApp.get('/api/containers', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
        const rows = await dbService.getRecentContainerData(limit, 0);

        const containers = rows.map(row => {
            let data;
            try {
                data = protobufDecompress(row.compressed_data);
            } catch (e) {
                data = {};
            }
            return {
                containerId: row.container_id,
                timestamp: row.timestamp,
                data
            };
        });

        res.json({ containers });
    } catch (error) {
        console.error('Failed to fetch containers:', error.message);
        res.status(500).json({ error: 'Failed to fetch containers' });
    }
});

// API: Container history
dashboardApp.get('/api/containers/:id', async (req, res) => {
    try {
        const containerId = req.params.id;
        const rows = await dbService.getContainerData(containerId, 500);
        const history = rows.map(row => {
            let data;
            try {
                data = protobufDecompress(row.compressed_data);
            } catch (e) {
                data = {};
            }
            return {
                timestamp: row.timestamp,
                data
            };
        });
        res.json({ history });
    } catch (error) {
        console.error('Failed to fetch container history:', error.message);
        res.status(500).json({ error: 'Failed to fetch container history' });
    }
});

// API: Stats
dashboardApp.get('/api/stats', async (req, res) => {
    try {
        const dbStats = await dbService.getStats();
        const outboundDbStats = await dbService.getOutboundStats();
        const inboundStats = messageQueue.getStats();
        const outboundStats = outboundQueue.getStats();
        const writeQueue = dbService.getQueueStatus();

        res.json({
            timestamp: new Date().toISOString(),
            uptime: inboundStats.uptimeMs,
            totalRequests: dbService.metrics.totalRequests,
            successfulWrites: dbService.metrics.totalInserted,
            database: dbStats,
            outboundDatabase: outboundDbStats,
            writeQueue: {
                queueLength: writeQueue.queue.currentLength,
                maxSize: writeQueue.queue.maxSize
            },
            inbound: inboundStats,
            outbound: outboundStats
        });
    } catch (error) {
        console.error('Failed to fetch stats:', error.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ------------------------
// Startup and graceful shutdown
// ------------------------

async function start() {
    try {
        dbService = new DatabaseService();
        await dbService.initialize();

        // Start receiver server
        app.listen(PORT, () => {
            console.log('Container Data Receiver Server Started (PROTOCOL BUFFERS)');
            console.log('='.repeat(60));
            console.log(`Listening on port ${PORT}`);
            console.log(`Main endpoint: POST /container-data`);
            console.log(`Health check: GET /health`);
            console.log(`Statistics: GET /stats`);
            console.log(`Test endpoint: POST /test`);
            console.log(`Queue processing: every ${QUEUE_PROCESS_INTERVAL}ms`);
            console.log(`Compression method: Protocol Buffers`);
            console.log(`Content-Type: application/octet-stream`);
            console.log('='.repeat(60));
        });

        // Start dashboard server on 3002
        const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3002;
        dashboardApp.listen(DASHBOARD_PORT, () => {
            console.log(`Dashboard UI available at http://localhost:${DASHBOARD_PORT}`);
        });
    } catch (err) {
        console.error('Startup error:', err);
        process.exit(1);
    }
}

Promise.all([protobufReady]).then(start);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');

    const stats = messageQueue.getStats();
    console.log('Final Statistics:');
    console.log(`   Processed: ${stats.processed} messages`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Rate: ${stats.ratePerSecond.toFixed(2)} msg/sec`);
    console.log(`   Uptime: ${(stats.uptimeMs / 1000).toFixed(2)}s`);

    if (dbService) {
        await dbService.close();
    }

    process.exit(0);
});

module.exports = app;