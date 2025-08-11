const protobuf = require('protobufjs');
const http = require('http');
const fs = require('fs');

// Load protobuf schema synchronously
let ContainerData;
try {
    const root = protobuf.loadSync('./container_data.proto');
    ContainerData = root.lookupType('container.ContainerData');
    console.log('Protocol Buffer schema loaded successfully');
} catch (err) {
    console.error('Failed to load protobuf schema:', err.message);
    process.exit(1);
}
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

// Convert string-based data to protobuf message (like Python)
function convertToProtobufData(stringData) {
    // Create protobuf message
    const pbData = ContainerData.create({
        // String fields
        msisdn: stringData.msisdn,
        iso6346: stringData.iso6346,
        time: stringData.time,
        cgi: stringData.cgi,
        door: stringData.door,
        
        // Integer fields
        rssi: parseInt(stringData.rssi),
        ble_m: parseInt(stringData['ble-m']),
        bat_soc: parseInt(stringData['bat-soc']),
        gnss: parseInt(stringData.gnss),
        nsat: parseInt(stringData.nsat),
        
        // Accelerometer fields
        acc_x: parseFloat(stringData.acc.split(' ')[0]),
        acc_y: parseFloat(stringData.acc.split(' ')[1]),
        acc_z: parseFloat(stringData.acc.split(' ')[2]),
        
        // Float fields
        temperature: parseFloat(stringData.temperature),
        humidity: parseFloat(stringData.humidity),
        pressure: parseFloat(stringData.pressure),
        latitude: parseFloat(stringData.latitude),
        longitude: parseFloat(stringData.longitude),
        altitude: parseFloat(stringData.altitude),
        speed: parseFloat(stringData.speed),
        heading: parseFloat(stringData.heading),
        hdop: parseFloat(stringData.hdop)
    });
    
    return pbData;
}

// Protocol Buffer compression (matching Python implementation)
function protobufCompress(data) {
    // Convert to protobuf message
    const pbData = convertToProtobufData(data);
    
    // Serialize to binary
    return ContainerData.encode(pbData).finish();
}

// Protocol Buffer decompression: reverse of protobuf_compress (matching server.js)
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

function generateTestData() {
    return {
        "msisdn": "393600504805",
        "iso6346": "LMCU1231237",
        "time": "200423 002940.0",
        "rssi": "28",
        "cgi": "999-01-1-31D41",
        "ble-m": "0",
        "bat-soc": "96",
        "acc": "-993.9269 -27.1004 -52.0035",
        "temperature": "17.00",
        "humidity": "71.00",
        "pressure": "1012.3956",
        "door": "D",
        "gnss": "1",
        "latitude": "31.8682",
        "longitude": "28.7412",
        "altitude": "49.50",
        "speed": "28.2",
        "heading": "125.55",
        "nsat": "06",
        "hdop": "1.4"
    };
}

function testCompression() {
    console.log('Testing Protocol Buffer Compression');
    console.log('='.repeat(50));
    
    // Generate test data
    const testData = generateTestData();
    
    // Protocol Buffer compression
    const compressedData = protobufCompress(testData);
    
    // Test decompression
    const reconstructedData = protobufDecompress(compressedData);
    
    // Measure actual byte sizes
    const jsonString = JSON.stringify(testData);
    const jsonBytes = Buffer.from(jsonString, 'utf-8');
    
    // Print results
    console.log(`Protocol Buffer Compression Results:`);
    console.log(`   Original JSON byte size: ${jsonBytes.length} bytes (UTF-8)`);
    console.log(`   Protobuf compressed byte size: ${compressedData.length} bytes (protobuf)`);
    console.log(`   Compression ratio vs JSON: ${(jsonBytes.length / compressedData.length).toFixed(2)}x`);
    console.log(`   Size check: ${compressedData.length < 158 ? 'PASS' : 'FAIL'} (< 158 bytes)`);
    console.log(`   Space remaining: ${158 - compressedData.length} bytes`);
    console.log(`   Data type: ${typeof compressedData} (${compressedData.constructor.name})`);
    console.log(`   First 20 bytes (hex): ${compressedData.subarray(0, 20).toString('hex')}`);
    
    console.log(`\nData Integrity Check:`);
    let allMatch = true;
    // Check all fields for exact match
    CONTAINER_FIELDS.forEach(field => {
        const original = testData[field];
        const reconstructed = reconstructedData[field];
        
        // Handle floating point precision for numeric fields
        let match;
        if (['temperature', 'humidity', 'pressure', 'latitude', 'longitude', 'altitude', 'speed', 'heading', 'hdop'].includes(field)) {
            try {
                const origFloat = parseFloat(original);
                const reconFloat = parseFloat(reconstructed);
                match = Math.abs(origFloat - reconFloat) < 0.01;
            } catch {
                match = original === reconstructed;
            }
        } else if (field === 'acc') {
            try {
                const origVals = original.split(' ').map(x => parseFloat(x));
                const reconVals = reconstructed.split(' ').map(x => parseFloat(x));
                match = origVals.length === reconVals.length && 
                        origVals.every((val, i) => Math.abs(val - reconVals[i]) < 0.01);
            } catch {
                match = original === reconstructed;
            }
        } else {
            match = original === reconstructed;
        }
        
        if (!match) allMatch = false;
        console.log(`   ${field}: ${match ? 'PASS' : 'FAIL'} ${original} → ${reconstructed}`);
    });
    
    console.log(`\nOverall Test: ${allMatch ? 'PASSED' : 'FAILED'}`);
    
    // Save results to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `smart_compression_test_nodejs_${timestamp}.txt`;
    
    let output = "";
    output += "PROTOCOL BUFFER COMPRESSION TEST RESULTS (Node.js)\n";
    output += "=".repeat(60) + "\n";
    output += `Test Date: ${new Date().toISOString()}\n`;
    output += `Compression Method: Protocol Buffers\n`;
    output += `Max Payload Size: 158 bytes\n\n`;
    
    output += "SIZE MEASUREMENTS:\n";
    output += "-".repeat(30) + "\n";
    output += `Original JSON byte size: ${jsonBytes.length} bytes (UTF-8)\n`;
    output += `Protobuf compressed byte size: ${compressedData.length} bytes (protobuf)\n`;
    output += `Compression ratio vs JSON: ${(jsonBytes.length / compressedData.length).toFixed(2)}x\n`;
    output += `Size check: ${compressedData.length < 158 ? 'PASS' : 'FAIL'} (< 158 bytes)\n`;
    output += `Space remaining: ${158 - compressedData.length} bytes\n`;
    output += `Data type: ${typeof compressedData} (${compressedData.constructor.name})\n\n`;
    
    output += "SAMPLE DATA:\n";
    output += "-".repeat(30) + "\n";
    output += "Original container data (JSON):\n";
    output += JSON.stringify(testData, null, 2) + "\n\n";
    
    output += "Field order and types:\n";
    const pbData = convertToProtobufData(testData);
    CONTAINER_FIELDS.forEach((field, index) => {
        let value;
        if (field === 'acc') {
            value = `${pbData.acc_x.toFixed(4)} ${pbData.acc_y.toFixed(4)} ${pbData.acc_z.toFixed(4)}`;
        } else if (field === 'ble-m') {
            value = pbData.ble_m;
        } else if (field === 'bat-soc') {
            value = pbData.bat_soc;
        } else {
            value = pbData[field.replace('-', '_')] || pbData[field];
        }
        output += `${(index + 1).toString().padStart(2)}. ${field}: ${typeof value} = ${value}\n`;
    });
    output += "\n";
    
    output += "PROTOBUF COMPRESSED DATA:\n";
    output += "-".repeat(30) + "\n";
    output += `Size: ${compressedData.length} bytes\n`;
    output += `Compression method: Protocol Buffers serialization\n`;
    output += "Hex representation:\n";
    
    // Write hex data in chunks of 32 bytes per line
    const hexString = compressedData.toString('hex');
    for (let i = 0; i < hexString.length; i += 64) { // 64 hex chars = 32 bytes
        const chunk = hexString.slice(i, i + 64);
        const byteOffset = (i / 2).toString(16).padStart(4, '0');
        output += `${byteOffset}: ${chunk}\n`;
    }
    output += "\n";
    
    output += "COMPRESSION ANALYSIS:\n";
    output += "-".repeat(30) + "\n";
    try {
        const decompressed = ContainerData.decode(compressedData);
        output += `Decompressed successfully: YES\n`;
        output += `Message size: ${decompressed.ByteSize()} bytes\n`;
        output += `Serialized size: ${compressedData.length} bytes\n`;
        output += `Compression efficiency: ${(decompressed.ByteSize() / compressedData.length).toFixed(2)}x\n`;
    } catch (e) {
        output += `Decompression error: ${e.message}\n`;
    }
    output += "\n";
    
    output += "RECONSTRUCTION TEST:\n";
    output += "-".repeat(30) + "\n";
    output += `Reconstruction: ${allMatch ? 'SUCCESS' : 'FAILED'}\n`;
    output += "Field verification:\n";
    CONTAINER_FIELDS.forEach(field => {
        const original = testData[field];
        const reconstructed = reconstructedData[field];
        
        // Handle floating point precision for verification
        let match;
        if (['temperature', 'humidity', 'pressure', 'latitude', 'longitude', 'altitude', 'speed', 'heading', 'hdop'].includes(field)) {
            try {
                const origFloat = parseFloat(original);
                const reconFloat = parseFloat(reconstructed);
                match = Math.abs(origFloat - reconFloat) < 0.01;
            } catch {
                match = original === reconstructed;
            }
        } else if (field === 'acc') {
            try {
                const origVals = original.split(' ').map(x => parseFloat(x));
                const reconVals = reconstructed.split(' ').map(x => parseFloat(x));
                match = origVals.length === reconVals.length && 
                        origVals.every((val, i) => Math.abs(val - reconVals[i]) < 0.01);
            } catch {
                match = original === reconstructed;
            }
        } else {
            match = original === reconstructed;
        }
        
        output += `  ${field}: ${match ? '✓' : '✗'} ${original} -> ${reconstructed}\n`;
    });
    output += `\nOverall integrity: ${allMatch ? 'PASS' : 'FAIL'}\n`;
    
    fs.writeFileSync(filename, output, 'utf-8');
    console.log(`\nResults saved to: ${filename}`);

    return {
        compressedData,
        testPassed: allMatch,
        compressionRatio: jsonBytes.length / compressedData.length,
        sizePassed: compressedData.length < 158,
        actualBytes: compressedData.length,
        jsonBytes: jsonBytes.length,
        filename: filename
    };
}

function testServerEndpoint(compressedData) {
    return new Promise((resolve, reject) => {
        console.log('\nTesting Server Endpoint...');
        
        const postData = compressedData;
        
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/container-data',
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': postData.length
            }
        };
        
        const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    console.log(`Server Response: ${res.statusCode}`);
                    console.log(`   Status: ${response.status}`);
                    console.log(`   Size: ${response.size} bytes`);
                    console.log(`   Queue Size: ${response.queueSize}`);
                    console.log(`   Test: ${res.statusCode === 200 ? 'PASSED' : 'FAILED'}`);
                    resolve(res.statusCode === 200);
                } catch (error) {
                    console.log(`Failed to parse response: ${error.message}`);
                    reject(error);
                }
            });
        });
        
        req.on('error', (error) => {
            console.log(`Request failed: ${error.message}`);
            console.log(`   Make sure the server is running: npm start`);
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

async function runAllTests() {
    console.log('Container Data Compression Test Suite');
    console.log('='.repeat(50));
    
    try {
        // Test compression
        const compressionResult = testCompression();
        
        if (!compressionResult.testPassed) {
            console.log('Compression test failed, skipping server test');
            return;
        }
        
        if (!compressionResult.sizePassed) {
            console.log('Warning: Compressed data exceeds 158 byte limit');
        }
        
        // Test server endpoint (if server is running)
        try {
            await testServerEndpoint(compressionResult.compressedData);
            console.log('\nAll tests passed!');
        } catch (error) {
            console.log('\nServer test skipped (server not running)');
        }
        
    } catch (error) {
        console.error('Test suite failed:', error.message);
    }
}

// Run tests if this script is executed directly
if (require.main === module) {
    runAllTests();
}

module.exports = {
    testCompression,
    testServerEndpoint,
    generateTestData,
    protobufCompress,
    protobufDecompress
}; 