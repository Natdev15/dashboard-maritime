const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class DatabaseService {
  constructor() {
    this.dbPath = path.join(__dirname, 'maritime_containers.db');
    this.db = null;
    
    // Queue-based batching system for high throughput
    this.pendingQueue = [];
    this.maxQueueSize = 50000;
    this.batchProcessInterval = 2000;
    this.batchTimer = null;
    this.isProcessingBatch = false;
    
    // Performance metrics
    this.metrics = {
      totalRequests: 0,
      totalBatches: 0,
      totalInserted: 0,
      lastBatchSize: 0,
      lastBatchTime: null,
      avgBatchSize: 0
    };
  }

  /**
   * Initialize database connection and setup
   */
  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }

        console.log('Connected to SQLite database');
        
        // Optimize SQLite for maximum performance
        this.db.serialize(() => {
          // WAL mode for better concurrent access
          this.db.run('PRAGMA journal_mode=WAL;');
          
          // Optimize for high-throughput batch writes
          this.db.run('PRAGMA synchronous=OFF;');
          this.db.run('PRAGMA cache_size=100000;');
          this.db.run('PRAGMA temp_store=MEMORY;');
          this.db.run('PRAGMA mmap_size=1073741824;');
          this.db.run('PRAGMA page_size=4096;');
          this.db.run('PRAGMA locking_mode=EXCLUSIVE;');
          this.db.run('PRAGMA auto_vacuum=NONE;');
          
          this.createTables()
            .then(() => {
              this.startBatchProcessor();
              console.log(`Queue-based batch processor started (${this.batchProcessInterval/1000}s intervals)`);
              resolve();
            })
            .catch(reject);
        });
      });
    });
  }

  /**
   * Create necessary tables
   */
  async createTables() {
    return new Promise((resolve, reject) => {
      const createTableSQL = `
        CREATE TABLE IF NOT EXISTS container_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          container_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          compressed_data BLOB NOT NULL,
          decompressed_data TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS outbound_queue (
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

        CREATE INDEX IF NOT EXISTS idx_container_id ON container_data(container_id);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON container_data(timestamp);
        CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_queue(status);
        CREATE INDEX IF NOT EXISTS idx_outbound_retry ON outbound_queue(next_retry_at);
      `;

      this.db.exec(createTableSQL, (err) => {
        if (err) {
          console.error('Error creating tables:', err);
          reject(err);
        } else {
          console.log('Database tables created/verified');
          resolve();
        }
      });
    });
  }

  /**
   * Add container data to queue - Returns immediately for fast response
   */
  async addToQueue(containerId, compressedData, timestamp = null) {
    return new Promise((resolve, reject) => {
      // Check queue size limit
      if (this.pendingQueue.length >= this.maxQueueSize) {
        reject(new Error(`Queue full (${this.maxQueueSize} items). High load detected.`));
        return;
      }

      // Convert timestamp to Unix timestamp for efficient storage
      const unixTimestamp = timestamp ? new Date(timestamp).getTime() : Date.now();

      // Add to queue
      this.pendingQueue.push({
        containerId,
        compressedData,
        timestamp: unixTimestamp,
        queuedAt: Date.now()
      });

      this.metrics.totalRequests++;

      // Resolve immediately - data is queued for processing
      resolve({
        success: true,
        queued: true,
        queuePosition: this.pendingQueue.length,
        nextBatchIn: this.getTimeUntilNextBatch()
      });
    });
  }

  /**
   * Start the batch processor
   */
  startBatchProcessor() {
    const processBatch = async () => {
      if (this.isProcessingBatch) {
        return;
      }

      if (this.pendingQueue.length === 0) {
        return;
      }

      this.isProcessingBatch = true;
      const batchStartTime = Date.now();
      
      try {
        // Take entire queue for processing
        const batchData = [...this.pendingQueue];
        this.pendingQueue = [];
        
                    console.log(`Processing batch: ${batchData.length} containers`);
        
        // Process the entire batch
        const insertedCount = await this.processBatchUpsert(batchData);
        
        // Update metrics
        this.metrics.totalBatches++;
        this.metrics.totalInserted += insertedCount;
        this.metrics.lastBatchSize = batchData.length;
        this.metrics.lastBatchTime = Date.now();
        this.metrics.avgBatchSize = this.metrics.totalInserted / this.metrics.totalBatches;
        
        const processingTime = Date.now() - batchStartTime;
                    console.log(`Batch completed: ${insertedCount} inserted in ${processingTime}ms (${(insertedCount/processingTime*1000).toFixed(0)} ops/sec)`);
        
      } catch (error) {
        console.error('❌ Batch processing error:', error);
      } finally {
        this.isProcessingBatch = false;
      }
    };

    // Start the interval processor
    this.batchTimer = setInterval(processBatch, this.batchProcessInterval);
    
    // Also process immediately if queue gets very large
    const checkLargeQueue = () => {
      if (this.pendingQueue.length > 1000 && !this.isProcessingBatch) {
                    console.log(`Large queue detected (${this.pendingQueue.length}), processing early`);
        processBatch();
      }
    };
    
    setInterval(checkLargeQueue, 1000);
  }

  /**
   * Process batch upsert with SQLite
   */
  async processBatchUpsert(batchData) {
    return new Promise((resolve, reject) => {
      if (batchData.length === 0) {
        resolve(0);
        return;
      }

      let insertedCount = 0;
      const db = this.db;

      db.serialize(() => {
        db.run('BEGIN IMMEDIATE TRANSACTION');

        // Use UPSERT for handling duplicates efficiently
        const stmt = db.prepare(`
          INSERT INTO container_data (container_id, timestamp, compressed_data)
          VALUES (?, ?, ?)
          ON CONFLICT(rowid) DO UPDATE SET
            timestamp = excluded.timestamp,
            compressed_data = excluded.compressed_data
        `);

        let errorOccurred = false;
        let processedCount = 0;

        // Process all items in the batch
        batchData.forEach((item) => {
          stmt.run([item.containerId, item.timestamp, item.compressedData], function(err) {
            processedCount++;
            
            if (err) {
              if (!errorOccurred) {
                errorOccurred = true;
                console.error('Batch insert error:', err);
              }
            } else {
              insertedCount++;
            }

            // When all items are processed, finalize transaction
            if (processedCount === batchData.length) {
              stmt.finalize((finalizeErr) => {
                if (finalizeErr || errorOccurred) {
                  db.run('ROLLBACK', (rollbackErr) => {
                    if (rollbackErr) console.error('Rollback error:', rollbackErr);
                    reject(new Error('Batch transaction failed'));
                  });
                } else {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Commit error:', commitErr);
                      reject(commitErr);
                    } else {
                      resolve(insertedCount);
                    }
                  });
                }
              });
            }
          });
        });
      });
    });
  }

  /**
   * Add data to outbound queue
   */
  async addToOutboundQueue(containerId, data) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO outbound_queue (container_id, data, next_retry_at)
        VALUES (?, ?, ?)
      `;
      
      const nextRetryAt = Date.now() + 5000; // 5 seconds from now
      
      this.db.run(sql, [containerId, JSON.stringify(data), nextRetryAt], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID });
        }
      });
    });
  }

  /**
   * Get pending outbound items
   */
  async getPendingOutboundItems() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM outbound_queue 
        WHERE status = 'pending' AND next_retry_at <= ?
        ORDER BY next_retry_at ASC
        LIMIT 100
      `;
      
      this.db.all(sql, [Date.now()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Update outbound item status
   */
  async updateOutboundItem(id, status, retryCount = null, nextRetryAt = null) {
    return new Promise((resolve, reject) => {
      let sql, params;
      
      if (retryCount !== null && nextRetryAt !== null) {
        sql = `
          UPDATE outbound_queue 
          SET status = ?, retry_count = ?, next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        params = [status, retryCount, nextRetryAt, id];
      } else {
        sql = `
          UPDATE outbound_queue 
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `;
        params = [status, id];
      }
      
      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes });
        }
      });
    });
  }

  /**
   * Get time until next batch processing
   */
  getTimeUntilNextBatch() {
    if (!this.metrics.lastBatchTime) {
      return this.batchProcessInterval;
    }
    
    const timeSinceLastBatch = Date.now() - this.metrics.lastBatchTime;
    const timeUntilNext = Math.max(0, this.batchProcessInterval - timeSinceLastBatch);
    return timeUntilNext;
  }

  /**
   * Force process current queue
   */
  async forceProcessQueue() {
    if (this.pendingQueue.length === 0) {
      return { processed: 0 };
    }

    console.log(`🔄 Force processing ${this.pendingQueue.length} queued items`);
    
    const batchData = [...this.pendingQueue];
    this.pendingQueue = [];
    
    try {
      const insertedCount = await this.processBatchUpsert(batchData);
      return { processed: insertedCount };
    } catch (error) {
      console.error('Force process error:', error);
      throw error;
    }
  }

  /**
   * Get recent container data with pagination
   */
  async getRecentContainerData(limit = 100, offset = 0) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT id, container_id, timestamp, compressed_data, decompressed_data, created_at
        FROM container_data
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;

      this.db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Convert Unix timestamp back to ISO string for compatibility
          const processedRows = rows.map(row => ({
            ...row,
            timestamp: new Date(row.timestamp).toISOString()
          }));
          resolve(processedRows);
        }
      });
    });
  }

  /**
   * Get data for specific container
   */
  async getContainerData(containerId, limit = 50) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT id, container_id, timestamp, compressed_data, decompressed_data, created_at
        FROM container_data
        WHERE container_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      this.db.all(sql, [containerId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Convert Unix timestamp back to ISO string for compatibility
          const processedRows = rows.map(row => ({
            ...row,
            timestamp: new Date(row.timestamp).toISOString()
          }));
          resolve(processedRows);
        }
      });
    });
  }

  /**
   * Get container statistics
   */
  async getStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT container_id) as unique_containers,
          AVG(LENGTH(compressed_data)) as avg_compressed_size,
          SUM(LENGTH(compressed_data)) as total_compressed_size,
          MIN(timestamp) as earliest_record,
          MAX(timestamp) as latest_record
        FROM container_data
      `;

      this.db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else {
          // Convert timestamps back to ISO strings
          const stats = {
            ...row,
            earliest_record: row.earliest_record ? new Date(row.earliest_record).toISOString() : null,
            latest_record: row.latest_record ? new Date(row.latest_record).toISOString() : null,
            total_compressed_size_mb: (row.total_compressed_size / (1024 * 1024)).toFixed(2)
          };
          resolve(stats);
        }
      });
    });
  }

  /**
   * Get outbound queue statistics
   */
  async getOutboundStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as total_items,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_items,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent_items,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_items,
          AVG(retry_count) as avg_retry_count,
          MAX(retry_count) as max_retry_count
        FROM outbound_queue
      `;

      this.db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Get queue status and performance metrics
   */
  getQueueStatus() {
    return {
      queue: {
        currentLength: this.pendingQueue.length,
        maxSize: this.maxQueueSize,
        utilizationPercent: ((this.pendingQueue.length / this.maxQueueSize) * 100).toFixed(1)
      },
      processing: {
        isProcessingBatch: this.isProcessingBatch,
        batchIntervalMs: this.batchProcessInterval,
        nextBatchIn: this.getTimeUntilNextBatch()
      },
      metrics: {
        ...this.metrics,
        queueThroughputPerSec: this.metrics.totalRequests > 0 ? 
          (this.metrics.totalRequests / ((Date.now() - (this.metrics.lastBatchTime || Date.now())) / 1000)).toFixed(1) : 0
      }
    };
  }

  /**
   * Close database connection and cleanup
   */
  async close() {
    return new Promise((resolve) => {
      console.log('🔄 Shutting down database service...');
      
      // Clear the batch timer
      if (this.batchTimer) {
        clearInterval(this.batchTimer);
        this.batchTimer = null;
      }

      // Process any remaining queue items
      this.forceProcessQueue()
        .then(() => {
          console.log('Final queue processing completed');
        })
        .catch((err) => {
          console.error('❌ Error in final queue processing:', err);
        })
        .finally(() => {
          // Close database connection
          if (this.db) {
            this.db.close((err) => {
              if (err) {
                console.error('Error closing database:', err);
              } else {
                console.log('Database connection closed');
              }
              resolve();
            });
          } else {
            resolve();
          }
        });
    });
  }
}

module.exports = DatabaseService;
