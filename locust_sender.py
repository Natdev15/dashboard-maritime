import time
import random
import requests
import json
from datetime import datetime, timedelta
from locust import HttpUser, task, between, events
import logging
import os
import sys

# Add protobuf import
try:
    from google.protobuf import text_format
    import container_data_pb2
except ImportError:
    print("❌ Protocol Buffers not installed. Please install:")
    print("   pip install protobuf")
    sys.exit(1)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DELIMITER = "|"  # Unique delimiter that won't appear in container data
MAX_PAYLOAD_SIZE = 158  # Bytes limit (REMOVED - No size restrictions)
TARGET_ENDPOINT = "/container-data"

# Get data pool size from environment or use default
DEFAULT_POOL_SIZE = 10000
DATA_POOL_SIZE = int(os.environ.get('LOCUST_DATA_POOL_SIZE', DEFAULT_POOL_SIZE))

def convert_to_protobuf_data(string_data: dict) -> container_data_pb2.ContainerData:
    """Convert string-based data to protobuf message"""
    
    # Create protobuf message
    pb_data = container_data_pb2.ContainerData()
    
    # Set string fields
    pb_data.msisdn = string_data["msisdn"]
    pb_data.iso6346 = string_data["iso6346"]
    pb_data.time = string_data["time"]
    pb_data.cgi = string_data["cgi"]
    pb_data.door = string_data["door"]
    
    # Set integer fields
    pb_data.rssi = int(string_data["rssi"])
    pb_data.ble_m = int(string_data["ble-m"])
    pb_data.bat_soc = int(string_data["bat-soc"])
    pb_data.gnss = int(string_data["gnss"])
    pb_data.nsat = int(string_data["nsat"])
    
    # Set accelerometer fields
    acc_values = [float(x) for x in string_data["acc"].split()]
    pb_data.acc_x = acc_values[0]
    pb_data.acc_y = acc_values[1]
    pb_data.acc_z = acc_values[2]
    
    # Set float fields
    pb_data.temperature = float(string_data["temperature"])
    pb_data.humidity = float(string_data["humidity"])
    pb_data.pressure = float(string_data["pressure"])
    pb_data.latitude = float(string_data["latitude"])
    pb_data.longitude = float(string_data["longitude"])
    pb_data.altitude = float(string_data["altitude"])
    pb_data.speed = float(string_data["speed"])
    pb_data.heading = float(string_data["heading"])
    pb_data.hdop = float(string_data["hdop"])
    
    return pb_data

def protobuf_compress(data: dict) -> bytes:
    """Protocol Buffer compression approach"""
    
    # Convert to protobuf message
    pb_data = convert_to_protobuf_data(data)
    
    # Serialize to binary
    return pb_data.SerializeToString()

class ContainerDataSender(HttpUser):
    wait_time = between(1, 3)  # Wait 1-3 seconds between requests
    
    # Class-level shared data pool (generated once per worker)
    _data_pool = None
    _data_pool_size = DATA_POOL_SIZE
    _pool_initialized = False
    
    @classmethod
    def initialize_data_pool(cls):
        """Pre-generate data pool for all users (called once per worker process)"""
        if cls._pool_initialized:
            return
        
        # Check if running in distributed mode
        import sys
        is_worker = "--worker" in sys.argv
        is_master = "--master" in sys.argv
        worker_label = "WORKER" if is_worker else "MASTER" if is_master else "SINGLE"
        
        logger.info(f"[{worker_label}] Pre-generating {cls._data_pool_size:,} container data records...")
        logger.info(f"   [{worker_label}] This eliminates generation bottleneck during stress testing")
        
        cls._data_pool = []
        start_time = time.time()
        
        # Generate data in batches with progress logging
        batch_size = 50000
        generated_count = 0
        rejected_count = 0
        
        while generated_count < cls._data_pool_size:
            batch_target = min(batch_size, cls._data_pool_size - generated_count)
            batch_generated = 0
            
            while batch_generated < batch_target:
                data = generate_test_container_data()
                # Pre-compress the data to save CPU during test
                compressed = protobuf_compress(data)
                size = len(compressed)
                
                # Validate size during generation
                if size >= MAX_PAYLOAD_SIZE:
                    rejected_count += 1
                    if rejected_count % 100 == 0:  # Log occasionally
                        logger.warning(f"Rejected {rejected_count} oversized records ({size} bytes > {MAX_PAYLOAD_SIZE})")
                    continue  # Skip this record and try another
                
                cls._data_pool.append({
                    'original': data,
                    'compressed': compressed,
                    'size': size
                })
                
                batch_generated += 1
                generated_count += 1
            
            progress = (generated_count / cls._data_pool_size) * 100
            elapsed = time.time() - start_time
            eta = (elapsed / (generated_count / cls._data_pool_size)) - elapsed if generated_count < cls._data_pool_size else 0
            
            logger.info(f"   [{worker_label}] Progress: {generated_count:,}/{cls._data_pool_size:,} ({progress:.1f}%) - "
                       f"Elapsed: {elapsed:.1f}s, ETA: {eta:.1f}s"
                       f"{f', Rejected: {rejected_count}' if rejected_count > 0 else ''}")
        
        total_time = time.time() - start_time
        avg_size = sum(item['size'] for item in cls._data_pool) / len(cls._data_pool)
        min_size = min(item['size'] for item in cls._data_pool)
        max_size = max(item['size'] for item in cls._data_pool)
        
        # Final validation
        oversized = [item for item in cls._data_pool if item['size'] >= MAX_PAYLOAD_SIZE]
        
        logger.info(f"[{worker_label}] Data pool generation complete!")
        logger.info(f"   Generated: {len(cls._data_pool):,} records in {total_time:.1f}s")
        logger.info(f"   Rate: {len(cls._data_pool) / total_time:.0f} records/sec")
        logger.info(f"   Compressed size - Avg: {avg_size:.1f}B, Min: {min_size}B, Max: {max_size}B")
        logger.info(f"   Size validation: {len(oversized)} oversized records (all within {MAX_PAYLOAD_SIZE}B limit)")
        logger.info(f"   Total memory usage: ~{(len(cls._data_pool) * avg_size) / 1024 / 1024:.1f} MB")
        if rejected_count > 0:
            logger.info(f"   Rejected during generation: {rejected_count} records")
        
        cls._pool_initialized = True
    
    def on_start(self):
        """Called when a user starts"""
        self.message_id = 0
        self.data_index = 0  # Track position in data pool
        
        # Initialize shared data pool if not already done
        if not self.__class__._pool_initialized:
            self.__class__.initialize_data_pool()
        
        # logger.info(f"Container data sender started (using pre-generated pool of {len(self.__class__._data_pool):,} records)")
    
    @task
    def send_container_data(self):
        """Send pre-generated compressed container data (MAXIMUM THROUGHPUT!)"""
        try:
            # Get pre-generated and pre-compressed data from pool
            data_item = self.__class__._data_pool[self.data_index]
            compressed_data = data_item['compressed']
            actual_byte_size = data_item['size']
            
            # Cycle through the data pool
            self.data_index = (self.data_index + 1) % len(self.__class__._data_pool)
            
            # Validate size (should always pass since pre-validated, but double-check)
            if actual_byte_size >= MAX_PAYLOAD_SIZE:
                logger.error(f"Pre-generated payload too large: {actual_byte_size} bytes (max: {MAX_PAYLOAD_SIZE})")
                return
            
            self.message_id += 1
            
            # Send to Node.js receiver (pure network performance test)
            with self.client.post(
                TARGET_ENDPOINT,
                data=compressed_data,
                headers={'Content-Type': 'application/octet-stream'},
                catch_response=True
            ) as response:
                if response.status_code == 200:
                    logger.debug(f"Message {self.message_id} sent successfully ({actual_byte_size} bytes)")
                else:
                    logger.error(f"Failed to send message {self.message_id}: {response.status_code}")
                    response.failure(f"HTTP {response.status_code}")
                    
        except Exception as e:
            logger.error(f"Error sending container data: {e}")
    
    def generate_container_data(self):
        """Generate realistic container data (exact format as provided)"""
        return generate_test_container_data()  # Use the same function
    
    def create_delimited_string(self, data):
        """Create delimited string with values only in specific order"""
        return create_test_delimited_string(data)  # Use the same function

# Locust event listeners for detailed statistics
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    logger.info("Starting container data stress test (with pre-generated data)")
    logger.info(f"Target: {environment.host}{TARGET_ENDPOINT}")
    logger.info(f"Max payload size: {MAX_PAYLOAD_SIZE} bytes")
    logger.info(f"Pre-generated pool: {ContainerDataSender._data_pool_size:,} records")
    logger.info("This test focuses on pure network/server performance")
    logger.info("Using Protocol Buffers for compression")

@events.test_stop.add_listener  
def on_test_stop(environment, **kwargs):
    logger.info("Container data stress test completed")
    
    # Print final statistics
    stats = environment.stats.total
    data_pool_size = len(ContainerDataSender._data_pool) if ContainerDataSender._data_pool else 0
    
    logger.info(f"Final Results:")
    logger.info(f"   Total requests: {stats.num_requests}")
    logger.info(f"   Failures: {stats.num_failures}")
    logger.info(f"   Success rate: {((stats.num_requests - stats.num_failures) / stats.num_requests * 100):.1f}%")
    logger.info(f"   Average response time: {stats.avg_response_time:.2f}ms")
    logger.info(f"   Max response time: {stats.max_response_time:.2f}ms")
    logger.info(f"   RPS: {stats.current_rps:.2f}")
    logger.info(f"Data pool utilization: {data_pool_size:,} pre-generated records")
    if stats.num_requests > data_pool_size > 0:
        cycles = stats.num_requests / data_pool_size
        logger.info(f"   Pool cycled {cycles:.1f} times during test")

@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, context, **kwargs):
    """Log detailed request information"""
    if exception:
        logger.error(f"Request failed: {exception}")
    else:
        logger.debug(f"Request successful: {response_time}ms, {response_length} bytes")

# Distributed mode helpers
class DistributedLocustManager:
    """Helper for managing distributed Locust testing"""
    
    @staticmethod
    def start_master(host="http://localhost:3000", web_port=8089):
        """Start Locust master process"""
        import subprocess
        import os
        
        cmd = [
            "locust",
            "-f", __file__,
            "--master",
            "--host", host,
            "--web-port", str(web_port)
        ]
        
        logger.info(f"Starting Locust MASTER process...")
        logger.info(f"   Host: {host}")
        logger.info(f"   Web UI: http://localhost:{web_port}")
        logger.info(f"   Command: {' '.join(cmd)}")
        
        return subprocess.Popen(cmd)
    
    @staticmethod
    def start_worker(master_host="127.0.0.1", master_port=5557):
        """Start a single Locust worker process"""
        import subprocess
        
        cmd = [
            "locust",
            "-f", __file__,
            "--worker",
            "--master-host", master_host,
            "--master-port", str(master_port)
        ]
        
        return subprocess.Popen(cmd)
    
    @staticmethod
    def start_distributed_test(num_workers=8, host="http://localhost:3000", web_port=8089):
        """Start complete distributed test with master + workers"""
        import subprocess
        import time
        import os
        
        logger.info(f"Starting DISTRIBUTED Locust test")
        logger.info(f"   Target: {host}")
        logger.info(f"   Workers: {num_workers}")
        logger.info(f"   Data pool per worker: {ContainerDataSender._data_pool_size:,} records")
        logger.info(f"   Total capacity: {ContainerDataSender._data_pool_size * num_workers:,} records")
        
        processes = []
        
        try:
            # Start master
            logger.info("Starting master process...")
            master_cmd = [
                "locust", "-f", __file__, "--master", 
                "--host", host, "--web-port", str(web_port)
            ]
            master_process = subprocess.Popen(master_cmd)
            processes.append(("master", master_process))
            time.sleep(3)  # Let master start
            
            # Start workers
            for i in range(num_workers):
                logger.info(f"Starting worker {i+1}/{num_workers}...")
                worker_cmd = [
                    "locust", "-f", __file__, "--worker",
                    "--master-host", "127.0.0.1"
                ]
                worker_process = subprocess.Popen(worker_cmd)
                processes.append((f"worker-{i+1}", worker_process))
                time.sleep(1)  # Stagger worker starts
            
            logger.info(f"Distributed setup complete!")
            logger.info(f"Web UI: http://localhost:{web_port}")
            logger.info(f"Configure your test in the web UI and start!")
            logger.info(f"Recommended settings:")
            logger.info(f"   - Users: {num_workers * 250} (250 per worker)")
            logger.info(f"   - Spawn rate: {num_workers * 25} (25 per worker)")
            logger.info(f"   - Run time: 300s for thorough test")
            
            # Wait for user input to stop
            input("\n⏸️  Press Enter to stop all processes...\n")
            
        except KeyboardInterrupt:
            logger.info("Stopping distributed test...")
        finally:
            # Clean up processes
            for name, process in processes:
                logger.info(f"Stopping {name}...")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            
            logger.info("All processes stopped")

# Custom test scenarios
class IncrementalLoadTest:
    """Run tests with incrementally increasing users"""
    
    def __init__(self, max_users=1000, step_size=100, step_duration=60):
        self.max_users = max_users
        self.step_size = step_size  
        self.step_duration = step_duration
    
    def run_test(self, host):
        """Run incremental load test"""
        import subprocess
        import os
        
        logger.info(f"Starting incremental load test")
        logger.info(f"   Max users: {self.max_users}")
        logger.info(f"   Step size: {self.step_size}")
        logger.info(f"   Step duration: {self.step_duration}s")
        
        results = []
        
        for users in range(self.step_size, self.max_users + 1, self.step_size):
            logger.info(f"Testing with {users} users...")
            
            # Run locust with current user count
            cmd = [
                "locust",
                "-f", __file__,
                "--host", host,
                "--users", str(users),
                "--spawn-rate", str(min(10, users)),
                "--run-time", f"{self.step_duration}s",
                "--headless",
                "--only-summary"
            ]
            
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=self.step_duration + 30)
                
                # Parse results from output
                output = result.stdout
                if "Total requests" in output:
                    logger.info(f"{users} users test completed")
                    results.append({
                        'users': users,
                        'output': output,
                        'success': True
                    })
                else:
                    logger.error(f"{users} users test failed")
                    results.append({
                        'users': users,
                        'output': result.stderr,
                        'success': False
                    })
                    
            except subprocess.TimeoutExpired:
                logger.error(f"{users} users test timed out")
                results.append({
                    'users': users,
                    'output': "Test timed out",
                    'success': False
                })
        
        return results

def generate_test_container_data():
    """Generate realistic container data for testing (exact format as provided)"""
    container_id = random.randint(1, 999999)
    base_time = datetime.now() - timedelta(minutes=random.randint(0, 60))
    
    # Generate realistic variations
    variations = {
        'latitude': 31.86 + (random.random() - 0.5) * 0.5,  # Around provided example
        'longitude': 28.74 + (random.random() - 0.5) * 0.5,
        'temperature': 17.0 + random.random() * 10,  # Around 17°C
        'humidity': 71.0 + random.random() * 20 - 10,  # Around 71%
        'pressure': 1012.4 + random.random() * 20 - 10,  # Around 1012.4 hPa
        'battery': max(10, 96 - random.random() * 20),  # Around 96%
        'rssi': random.randint(15, 35),  # Around 28 dBm
        'speed': random.random() * 40,  # 0-40 m/s
        'heading': random.random() * 360,  # 0-360 degrees
        'altitude': 49.5 + random.random() * 20 - 10  # Around 49.5m
    }

    return {
        "msisdn": f"39360050{random.randint(4800, 4999)}",  # SIM ID format
        "iso6346": f"LMCU{str(container_id).zfill(7)}",  # Container ID
        "time": base_time.strftime("%d%m%y %H%M%S.%f")[:-5],  # DDMMYY hhmmss.s format
        "rssi": str(int(variations['rssi'])),  # RSSI
        "cgi": "999-01-1-31D41",  # Cell ID Location
        "ble-m": str(random.randint(0, 1)),  # BLE source node
        "bat-soc": str(int(variations['battery'])),  # Battery %
        "acc": f"{(-993.9 + random.random() * 20):.4f} {(-27.1 + random.random() * 10):.4f} {(-52.0 + random.random() * 10):.4f}",  # Accelerometer mg
        "temperature": f"{variations['temperature']:.2f}",  # °C
        "humidity": f"{variations['humidity']:.2f}",  # %RH
        "pressure": f"{variations['pressure']:.4f}",  # hPa
        "door": random.choice(["D", "O", "C", "T"]),  # Door status
        "gnss": str(random.randint(0, 1)),  # GPS status
        "latitude": f"{variations['latitude']:.2f}",  # DD format
        "longitude": f"{variations['longitude']:.2f}",  # DD format
        "altitude": f"{variations['altitude']:.2f}",  # meters
        "speed": f"{variations['speed']:.1f}",  # m/s
        "heading": f"{variations['heading']:.2f}",  # degrees
        "nsat": f"{random.randint(4, 12):02d}",  # Number of satellites
        "hdop": f"{(0.5 + random.random() * 5):.1f}"  # HDOP 0.5-5.5
    }

def create_test_delimited_string(data):
    """Create delimited string with values only in specific order (exact field order as provided)"""
    # Order from actual container data format
    ordered_values = [
        data["msisdn"],      # SIM ID
        data["iso6346"],     # Container ID
        data["time"],        # UTC time DDMMYY hhmmss.s
        data["rssi"],        # RSSI
        data["cgi"],         # Cell ID Location
        data["ble-m"],       # BLE source node
        data["bat-soc"],     # Battery %
        data["acc"],         # Accelerometer mg
        data["temperature"], # °C
        data["humidity"],    # %RH
        data["pressure"],    # hPa
        data["door"],        # Door status
        data["gnss"],        # GPS status
        data["latitude"],    # DD
        data["longitude"],   # DD
        data["altitude"],    # meters
        data["speed"],       # m/s
        data["heading"],     # degrees
        data["nsat"],        # Number of satellites
        data["hdop"]         # HDOP
    ]
    
    return DELIMITER.join(ordered_values)

def test_compression():
    """Test the Protocol Buffer compression effectiveness - MEASURING ACTUAL BYTES"""
    print("Testing Protocol Buffer compression...")
    print("IMPORTANT: Measuring actual byte sizes for transmission, not character counts!")
    
    # Generate sample data directly (without instantiating Locust class)
    sample_data = generate_test_container_data()
    delimited_string = create_test_delimited_string(sample_data)
    
    # Protocol Buffer compression
    compressed_data = protobuf_compress(sample_data)
    
    # Measure actual byte sizes
    json_bytes = json.dumps(sample_data).encode('utf-8')
    delimited_bytes = delimited_string.encode('utf-8')
    
    print(f"Protocol Buffer Compression Test Results:")
    print(f"   Original JSON byte size: {len(json_bytes)} bytes (UTF-8)")
    print(f"   Delimited string byte size: {len(delimited_bytes)} bytes (UTF-8)")
    print(f"   Protobuf compressed byte size: {len(compressed_data)} bytes (protobuf)")
    print(f"   Compression ratio vs JSON: {len(json_bytes) / len(compressed_data):.2f}x")
    print(f"   Compression ratio vs delimited: {len(delimited_bytes) / len(compressed_data):.2f}x")
    print(f"   Size check: {'PASS' if len(compressed_data) < MAX_PAYLOAD_SIZE else 'FAIL'} (<{MAX_PAYLOAD_SIZE} bytes)")
    print(f"   Space remaining: {MAX_PAYLOAD_SIZE - len(compressed_data)} bytes")
    print(f"   Data type: {type(compressed_data)}")
    print(f"   First 20 bytes (hex): {compressed_data[:20].hex()}")
    print(f"   Verification: Binary data? {'YES' if isinstance(compressed_data, bytes) else 'NO'}")
    print(f"   Sample delimited string: {delimited_string[:100]}...")
    
    # Save results to file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"smart_compression_test_{timestamp}.txt"
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write("PROTOCOL BUFFER COMPRESSION TEST RESULTS\n")
        f.write("=" * 50 + "\n")
        f.write(f"Test Date: {datetime.now().isoformat()}\n")
        f.write(f"Compression Method: Protocol Buffers\n")
        f.write(f"Max Payload Size: {MAX_PAYLOAD_SIZE} bytes\n")
        f.write("\n")
        
        f.write("SIZE MEASUREMENTS:\n")
        f.write("-" * 30 + "\n")
        f.write(f"Original JSON byte size: {len(json_bytes)} bytes (UTF-8)\n")
        f.write(f"Delimited string byte size: {len(delimited_bytes)} bytes (UTF-8)\n")
        f.write(f"Protobuf compressed byte size: {len(compressed_data)} bytes (protobuf)\n")
        f.write(f"Compression ratio vs JSON: {len(json_bytes) / len(compressed_data):.2f}x\n")
        f.write(f"Compression ratio vs delimited: {len(delimited_bytes) / len(compressed_data):.2f}x\n")
        f.write(f"Size check: {'PASS' if len(compressed_data) < MAX_PAYLOAD_SIZE else 'FAIL'} (<{MAX_PAYLOAD_SIZE} bytes)\n")
        f.write(f"Space remaining: {MAX_PAYLOAD_SIZE - len(compressed_data)} bytes\n")
        f.write(f"Data type: {type(compressed_data)}\n")
        f.write(f"Is binary: {'YES' if isinstance(compressed_data, bytes) else 'NO'}\n")
        f.write("\n")
        
        f.write("SAMPLE DATA:\n")
        f.write("-" * 30 + "\n")
        f.write("Original container data (JSON):\n")
        f.write(json.dumps(sample_data, indent=2) + "\n\n")
        
        f.write("Field order for delimited string:\n")
        field_order = ['msisdn', 'iso6346', 'time', 'rssi', 'cgi', 'ble-m', 'bat-soc', 
                      'acc', 'temperature', 'humidity', 'pressure', 'door', 'gnss', 
                      'latitude', 'longitude', 'altitude', 'speed', 'heading', 'nsat', 'hdop']
        for i, field in enumerate(field_order, 1):
            f.write(f"{i:2d}. {field}: {sample_data[field]}\n")
        f.write("\n")
        
        f.write("ORIGINAL DATA STRUCTURE:\n")
        f.write("-" * 30 + "\n")
        f.write("Field order and types:\n")
        pb_data = convert_to_protobuf_data(sample_data)
        for i, field in enumerate(pb_data.DESCRIPTOR.fields, 1):
            value = getattr(pb_data, field.name)
            f.write(f"{i:2d}. {field.name}: {type(value).__name__} = {value}\n")
        f.write("\n")
        
        f.write("PROTOBUF COMPRESSED DATA:\n")
        f.write("-" * 30 + "\n")
        f.write(f"Size: {len(compressed_data)} bytes\n")
        f.write(f"Compression method: Protocol Buffers serialization\n")
        f.write(f"Hex representation:\n")
        
        # Write hex data in chunks of 32 bytes per line for readability
        hex_string = compressed_data.hex()
        for i in range(0, len(hex_string), 64):  # 64 hex chars = 32 bytes
            chunk = hex_string[i:i+64]
            byte_offset = i // 2
            f.write(f"{byte_offset:04x}: {chunk}\n")
        f.write("\n")
        
        f.write("COMPRESSION ANALYSIS:\n")
        f.write("-" * 30 + "\n")
        try:
            # Test decompression to verify integrity
            decompressed = container_data_pb2.ContainerData()
            decompressed.ParseFromString(compressed_data)
            f.write(f"Decompressed successfully: YES\n")
            f.write(f"Message size: {decompressed.ByteSize()} bytes\n")
            f.write(f"Serialized size: {len(compressed_data)} bytes\n")
            f.write(f"Compression efficiency: {decompressed.ByteSize() / len(compressed_data):.2f}x\n")
        except Exception as e:
            f.write(f"Decompression error: {e}\n")
        f.write("\n")
        
        f.write("ESP32 TRANSMISSION SIMULATION:\n")
        f.write("-" * 30 + "\n")
        f.write(f"ESP32 data generation: ✓\n")
        f.write(f"Type conversion: ✓\n")
        f.write(f"Protobuf serialization: ✓\n")
        f.write(f"Size validation: {'✓' if len(compressed_data) < MAX_PAYLOAD_SIZE else '✗'}\n")
        f.write(f"Ready for Astronode S: {'YES' if len(compressed_data) < MAX_PAYLOAD_SIZE else 'NO'}\n")
        f.write(f"ESP32 compatible: ✓ (protobuf library available)\n")
        f.write(f"Space remaining: {MAX_PAYLOAD_SIZE - len(compressed_data)} bytes\n")
        f.write("\n")
        
        f.write("NODE.JS RECEIVER REQUIREMENTS:\n")
        f.write("-" * 30 + "\n")
        f.write("Required steps for reconstruction:\n")
        f.write("1. Receive binary data (application/octet-stream)\n")
        f.write("2. Parse protobuf message\n")
        f.write("3. Reconstruct original container data\n")
        f.write("\n")
        f.write("Node.js implementation notes:\n")
        f.write("- Use 'protobufjs' or 'google-protobuf' module\n")
        f.write("- Load the same .proto schema file\n")
        f.write("- Parse binary data to protobuf message\n")
        f.write("- Extract fields to reconstruct original data\n")
        f.write(f"- Expect {len(compressed_data)} byte payload\n")
    
    print(f"\nResults saved to: {filename}")
    
    return {
        'compressed_data': compressed_data,
        'actual_bytes': len(compressed_data),
        'delimited_bytes': len(delimited_bytes),
        'passes_size_check': len(compressed_data) < MAX_PAYLOAD_SIZE,
        'filename': filename
    }

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "test-compression":
        test_compression()
    elif len(sys.argv) > 1 and sys.argv[1] == "incremental":
        host = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"
        test = IncrementalLoadTest()
        test.run_test(host)
    elif len(sys.argv) > 1 and sys.argv[1] == "distributed":
        # Start distributed test with 4 workers by default
        workers = int(sys.argv[2]) if len(sys.argv) > 2 else 4
        host = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:3000"
        DistributedLocustManager.start_distributed_test(num_workers=workers, host=host)
    elif len(sys.argv) > 1 and sys.argv[1] == "master":
        # Start master only
        host = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"
        port = int(sys.argv[3]) if len(sys.argv) > 3 else 8089
        print(f"🎛️  Starting Locust MASTER...")
        print(f"   Target: {host}")
        print(f"   Web UI: http://localhost:{port}")
        print(f"   Run workers separately: python locust_sender.py worker")
        process = DistributedLocustManager.start_master(host=host, web_port=port)
        try:
            process.wait()
        except KeyboardInterrupt:
            process.terminate()
    elif len(sys.argv) > 1 and sys.argv[1] == "worker":
        # Start worker only
        master_host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
        print(f"⚡ Starting Locust WORKER...")
        print(f"   Master: {master_host}:5557")
        process = DistributedLocustManager.start_worker(master_host=master_host)
        try:
            process.wait()
        except KeyboardInterrupt:
            process.terminate()
    else:
        print("Container Data Sender - Locust Load Testing")
        print("=" * 50)
        print("")
        print("Usage Options:")
        print("  python locust_sender.py test-compression")
        print("    Test compression algorithms and save results")
        print("")
        print("  python locust_sender.py distributed [workers] [host]")
        print("    Start complete distributed test (master + workers)")
        print("    Default: 4 workers, http://localhost:3000")
        print("    Example: python locust_sender.py distributed 8 http://localhost:3000")
        print("")
        print("  python locust_sender.py master [host] [web_port]")
        print("    Start master process only")
        print("    Default: http://localhost:3000, port 8089")
        print("")
        print("  python locust_sender.py worker [master_host]")
        print("    Start worker process only")
        print("    Default: master at 127.0.0.1:5557")
        print("")
        print("  python locust_sender.py incremental [host]")
        print("    Run incremental load test")
        print("")
        print("  locust -f locust_sender.py --host http://localhost:3000")
        print("    Standard single-process Locust (with web UI)")
        print("")
        print("RECOMMENDED: Distributed Mode")
        print("  python locust_sender.py distributed 4")
        print("  → Starts 1 master + 4 workers")
        print("  → 2,000,000 total pre-generated records")
        print("  → Maximum throughput capacity")
        print("  → Web UI at http://localhost:8089")
        print("")
        print("Manual Distributed Setup:")
        print("  Terminal 1: python locust_sender.py master")
        print("  Terminal 2: python locust_sender.py worker")
        print("  Terminal 3: python locust_sender.py worker")
        print("  Terminal 4: python locust_sender.py worker")
        print("  Terminal 5: python locust_sender.py worker")
        print("")
        print("Environment Variables:")
        print(f"  LOCUST_DATA_POOL_SIZE={DATA_POOL_SIZE:,} (default: {DEFAULT_POOL_SIZE:,})")
        print("    Controls pre-generated data pool size per worker")
        print("    Total capacity = POOL_SIZE × NUMBER_OF_WORKERS")
        print("")
        print("Scaling Tips:")
        print("  • Each worker: ~500k records, ~60MB RAM")
        print("  • 4 workers: ~2M records, ~240MB total")
        print("  • More workers = higher sustained RPS")
        print("  • Monitor CPU/memory during tests") 