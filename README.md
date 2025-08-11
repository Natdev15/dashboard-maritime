# Container Data Compression & Stress Testing System

A complete solution for compressing container sensor data using Protocol Buffers (protobuf) and stress testing the system with Locust.

## System Overview

This system simulates ESP32 container data transmission with maximum compression using Google's Protocol Buffers:
- Python Sender: Locust-based stress tester that serializes data with Protocol Buffers
- Node.js Receiver: HTTP server with Protocol Buffer deserialization and pseudo queue processing
- ESP32 IoT Ready: Compatible with nanopb library for embedded deployments
- Comprehensive Testing: Load testing with detailed performance metrics

## Data Flow

```
Container Data → Protocol Buffer Schema → Binary Serialization → HTTP POST
                                                                        ↓
Reconstruct Data ← Protocol Buffer Deserialization ← Queue Processing ← Receive
```

## Quick Start

### Prerequisites
```bash
# Python dependencies
pip install -r requirements.txt

# Node.js dependencies (for receiver)
cd nodejs_receiver
npm install
```

### 1. Generate Protocol Buffer Files
```bash
# Generate Python protobuf module
python generate_protobuf.py
```

### 2. Start the Receiver
```bash
# Option A: Run directly
cd nodejs_receiver
npm start

# Option B: Run in development mode
cd nodejs_receiver
npm run dev
```

### 3. Test Compression
```bash
# Test Protocol Buffer compression effectiveness
python locust_sender.py test-compression
```

### 4. Run Stress Tests
```bash
# Single test with Locust UI
locust -f locust_sender.py --host http://localhost:3001

# Single headless test
locust -f locust_sender.py --host http://localhost:3001 --users 1000 --spawn-rate 100 --run-time 120s --headless
```

## Project Structure

```
project/
├── locust_sender.py              # Python stress tester with Protocol Buffer serialization
├── container_data.proto          # Protocol Buffer schema definition
├── container_data_pb2.py         # Generated Python protobuf module
├── generate_protobuf.py          # Protobuf generation script
├── requirements.txt              # Python dependencies
├── nodejs_receiver/              # Node.js receiver service
│   ├── server.js                 # Main server with protobuf deserialization
│   ├── package.json              # Node.js dependencies
│   └── container_data.proto      # Protobuf schema (copied)
├── Protocol_Buffer_Implementation_Report.md  # Performance analysis
├── Protocol_Buffer_Implementation_Report.pdf # PDF report
└── README.md                     # This file
```

## Configuration

### Python Sender (locust_sender.py)
```python
DELIMITER = "|"                   # Legacy delimiter (not used in protobuf)
TARGET_ENDPOINT = "/container-data"
# MAX_PAYLOAD_SIZE removed - no size restrictions with protobuf
```

### Node.js Receiver (nodejs_receiver/server.js)
```javascript
const PORT = 3001;                // Receiver port
const DASHBOARD_PORT = 3002;      // Dashboard port
const QUEUE_PROCESS_INTERVAL = 2000; // Process queue every 2 seconds
```

### Protocol Buffer Schema (container_data.proto)
```protobuf
syntax = "proto3";

package container;

message ContainerData {
  // String fields
  string msisdn = 1;      // SIM ID
  string iso6346 = 2;     // Container ID
  string time = 3;        // UTC time DDMMYY hhmmss.s
  string cgi = 4;         // Cell ID Location
  string door = 5;        // Door status
  
  // Integer fields
  uint32 rssi = 6;        // RSSI
  uint32 ble_m = 7;       // BLE source node
  uint32 bat_soc = 8;     // Battery %
  uint32 gnss = 9;        // GPS status
  uint32 nsat = 10;       // Number of satellites
  
  // Accelerometer data
  float acc_x = 11;       // Accelerometer X
  float acc_y = 12;       // Accelerometer Y
  float acc_z = 13;       // Accelerometer Z
  
  // Float fields
  float temperature = 14; // °C
  float humidity = 15;    // %RH
  float pressure = 16;    // hPa
  float latitude = 17;    // DD
  float longitude = 18;   // DD
  float altitude = 19;    // meters
  float speed = 20;       // m/s
  float heading = 21;     // degrees
  float hdop = 22;        // HDOP
}
```

## Container Data Fields

Data is serialized using Protocol Buffers with these fields:
1. msisdn - Mobile number (string)
2. iso6346 - Container ID (string)
3. time - Timestamp (string)
4. cgi - Cell global identity (string)
5. door - Door status (string)
6. rssi - Signal strength (uint32)
7. ble_m - Bluetooth mode (uint32)
8. bat_soc - Battery state (uint32)
9. gnss - GPS status (uint32)
10. nsat - Number of satellites (uint32)
11. acc_x, acc_y, acc_z - Accelerometer data (float)
12. temperature - Temperature sensor (float)
13. humidity - Humidity sensor (float)
14. pressure - Pressure sensor (float)
15. latitude - GPS latitude (float)
16. longitude - GPS longitude (float)
17. altitude - GPS altitude (float)
18. speed - Movement speed (float)
19. heading - Movement direction (float)
20. hdop - GPS accuracy (float)

## Stress Testing Features

### Load Testing
Comprehensive testing with high concurrency:
```bash
# Test with 1000 concurrent users
locust -f locust_sender.py --host http://localhost:3001 --users 1000 --spawn-rate 100 --run-time 120s --headless
```

### Metrics Collected
- RPS (Requests Per Second)
- Response Times (Average, Min, Max, Percentiles)
- Success Rate (% of successful requests)
- Error Rate (% of failed requests)
- Compression Ratio (Data size reduction vs JSON)
- Queue Performance (Processing delays)

### Performance Results
Based on recent testing:
- Success Rate: 100% (zero failures)
- Average Response Time: 48ms
- 99th Percentile: 110ms
- Throughput: 487 RPS sustained
- Payload Size: 138 bytes average (3.04x compression vs JSON)

## Testing

### Test Compression
```bash
# Test Protocol Buffer compression effectiveness
python locust_sender.py test-compression
```

### Validate System
```bash
# Test receiver endpoints
curl -X POST http://localhost:3001/container-data \
  -H "Content-Type: application/octet-stream" \
  --data-binary @test_data.bin

# Health check
curl http://localhost:3001/health
```

## Performance Expectations

### Compression Results
- Original JSON: ~413 bytes
- Protocol Buffer: ~138 bytes
- Compression Ratio: 3.04x reduction
- Type Safety: Strongly typed schema

### Load Testing Results
- Target RPS: 500+ requests/second
- Response Time: <50ms average
- Success Rate: 100%
- Queue Processing: 2-second intervals

## Monitoring

### Real-time Statistics
```bash
# View live stats
curl http://localhost:3001/stats

# Monitor queue size
watch -n 1 'curl -s http://localhost:3001/stats | jq .queueSize'
```

### Health Checks
```bash
# Check receiver health
curl http://localhost:3001/health

# View performance metrics
curl http://localhost:3001/stats
```

## Troubleshooting

### Common Issues

Protocol Buffer generation errors:
```bash
# Ensure protoc compiler is installed
protoc --version

# Regenerate protobuf files
python generate_protobuf.py
```

Connection refused:
```bash
# Ensure receiver is running
curl http://localhost:3001/health
```

### Debug Mode
```bash
# Enable debug logging
export DEBUG=true
npm run dev
```

## ESP32 IoT Implementation

### nanopb Library Integration
The system is fully compatible with ESP32 microcontrollers using the nanopb library:

```c
// ESP32 nanopb Implementation Example
#include "container_data.pb.h"

// Generate binary payload
ContainerData container_data = ContainerData_init_zero;
container_data.msisdn = "393600504805";
container_data.temperature = 17.24;
// ... set other fields

uint8_t buffer[256];
pb_ostream_t stream = pb_ostream_from_buffer(buffer, sizeof(buffer));
pb_encode(&stream, ContainerData_fields, &container_data);

// Send via HTTP
http_client_post("/container-data", buffer, stream.bytes_written);
```

### ESP32 Benefits
- Memory Efficient: nanopb uses minimal RAM (~2KB)
- Fast Serialization: Optimized for embedded systems
- Type Safety: Compile-time validation
- Backward Compatible: Schema evolution support
- Network Optimized: Reduced bandwidth usage

## Use Cases

1. IoT Data Transmission: Optimize satellite data costs with Protocol Buffers
2. Performance Testing: Validate system capacity under high load
3. Compression Analysis: Compare Protocol Buffer vs JSON efficiency
4. Queue Processing: Handle burst traffic with pseudo queue
5. Container Tracking: Real-time sensor monitoring with type safety

## Integration

### Add Custom Processing
```javascript
// In server.js, modify onDataProcessed()
onDataProcessed(data) {
    // Send to database
    // Forward to another API
    // Trigger alerts
    // Custom business logic
}
```

### Extend Stress Testing
```python
# In locust_sender.py, add custom scenarios
@task(weight=2)
def custom_scenario(self):
    # Your custom test logic
    pass
```

## API Endpoints

### Receiver Endpoints
- POST /container-data - Main data endpoint (accepts protobuf binary)
- GET /health - Health check
- GET /stats - Performance statistics  
- POST /test - Test endpoint

### Response Formats
```json
{
  "status": "received",
  "timestamp": "2024-12-01T12:00:00.000Z",
  "size": 138,
  "queueSize": 3
}
```

## Migration from CBOR

This system has been migrated from CBOR compression to Protocol Buffers for:
- Better Type Safety: Strongly typed schema definition
- Cross-platform Compatibility: Native support in multiple languages
- Performance: Optimized binary serialization
- Maintainability: Clear schema definition in .proto files
- ESP32 Support: Full IoT deployment compatibility with nanopb

## Performance Report

A comprehensive performance analysis is available:
- Markdown Report: Protocol_Buffer_Implementation_Report.md
- PDF Report: Protocol_Buffer_Implementation_Report.pdf

The report demonstrates:
- 100% Success Rate under high load
- 48ms Average Response Time
- 3.04x Compression Ratio vs JSON
- Production-ready Performance

This system provides a complete solution for high-performance container data processing using Protocol Buffers with comprehensive stress testing capabilities. 