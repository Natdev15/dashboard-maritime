class MaritimeDashboard {
    constructor() {
        this.autoRefresh = false;
        this.refreshInterval = null;
        this.chart = null;
        this.containers = [];
        this.filteredContainers = [];
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadInitialData();
        this.setupChart();
        
        // Hide loading overlay
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    setupEventListeners() {
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadData();
        });

        // Auto refresh toggle
        document.getElementById('autoRefreshBtn').addEventListener('click', () => {
            this.toggleAutoRefresh();
        });

        // Search functionality
        document.getElementById('searchContainer').addEventListener('input', (e) => {
            this.filterContainers(e.target.value);
        });

        // Modal close
        document.getElementById('closeModal').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal on background click
        document.getElementById('containerModal').addEventListener('click', (e) => {
            if (e.target.id === 'containerModal') {
                this.closeModal();
            }
        });

        // Event delegation for view details buttons
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('view-details-btn')) {
                const containerId = e.target.getAttribute('data-container-id');
                this.showContainerDetails(containerId);
            }
        });
    }

    async loadInitialData() {
        await this.loadData();
        await this.loadStats();
    }

    async loadData() {
        try {
            this.showLoading();
            
            const response = await fetch('/api/containers?limit=100');
            const data = await response.json();
            
            this.containers = data.containers || [];
            this.filteredContainers = [...this.containers];
            
            this.updateContainerTable();
            this.updateChart();
            
        } catch (error) {
            console.error('Error loading container data:', error);
            this.showError('Failed to load container data');
        } finally {
            this.hideLoading();
        }
    }

    async loadStats() {
        try {
            const response = await fetch('/api/stats');
            const stats = await response.json();
            
            this.updateSystemStats(stats);
            this.updateHeaderStats(stats);
            
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    updateSystemStats(stats) {
        document.getElementById('totalRecords').textContent = stats.database?.total_records || 0;
        document.getElementById('uniqueContainers').textContent = stats.database?.unique_containers || 0;
        
        const successRate = stats.totalRequests > 0 
            ? ((stats.successfulWrites / stats.totalRequests) * 100).toFixed(1)
            : 0;
        document.getElementById('successRate').textContent = `${successRate}%`;
        
        // Mock compression ratio for display
        document.getElementById('avgCompression').textContent = '2.99x';
    }

    updateHeaderStats(stats) {
        document.getElementById('totalContainers').textContent = stats.database?.unique_containers || 0;
        document.getElementById('queueLength').textContent = stats.writeQueue?.queueLength || 0;
        document.getElementById('uptime').textContent = this.formatUptime(stats.uptime || 0);
    }

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    updateContainerTable() {
        const tbody = document.getElementById('containerTableBody');
        tbody.innerHTML = '';

        this.filteredContainers.forEach(container => {
            const row = this.createContainerRow(container);
            tbody.appendChild(row);
        });
    }

    createContainerRow(container) {
        const row = document.createElement('tr');
        const data = container.data || {};
        
        // Determine status based on various factors
        const status = this.getContainerStatus(data);
        
        row.innerHTML = `
            <td><strong>${container.containerId}</strong></td>
            <td>${this.formatLocation(data)}</td>
            <td>${data.temperature || '-'}°C</td>
            <td>${data['bat-soc'] || data.battery || '-'}%</td>
            <td><span class="status-badge status-${status.class}">${status.text}</span></td>
            <td>${this.formatDateTime(container.timestamp)}</td>
            <td>
                <button class="btn-small view-details-btn" data-container-id="${container.containerId}">
                    View Details
                </button>
            </td>
        `;

        return row;
    }

    getContainerStatus(data) {
        const battery = parseInt(data['bat-soc'] || data.battery || 100);
        const temp = parseFloat(data.temperature || 20);
        
        if (battery < 20 || temp > 30 || temp < -10) {
            return { class: 'critical', text: 'Critical' };
        } else if (battery < 50 || temp > 25 || temp < 0) {
            return { class: 'warning', text: 'Warning' };
        } else {
            return { class: 'normal', text: 'Normal' };
        }
    }

    formatLocation(data) {
        if (data.latitude && data.longitude) {
            return `${parseFloat(data.latitude).toFixed(4)}, ${parseFloat(data.longitude).toFixed(4)}`;
        }
        return 'Unknown';
    }

    formatDateTime(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    filterContainers(searchTerm) {
        if (!searchTerm) {
            this.filteredContainers = [...this.containers];
        } else {
            this.filteredContainers = this.containers.filter(container => 
                container.containerId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (container.data?.iso6346 && container.data.iso6346.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }
        this.updateContainerTable();
    }

    async showContainerDetails(containerId) {
        try {
            this.showLoading();
            
            const response = await fetch(`/api/containers/${containerId}`);
            const data = await response.json();
            
            this.displayContainerModal(data, containerId);
            
        } catch (error) {
            console.error('Error loading container details:', error);
            this.showError('Failed to load container details');
        } finally {
            this.hideLoading();
        }
    }

    displayContainerModal(containerData, containerId) {
        const modal = document.getElementById('containerModal');
        const title = document.getElementById('modalTitle');
        const body = document.getElementById('containerDetails');
        
        title.textContent = `Container ${containerId} - Historical Data`;
        
        body.innerHTML = `
            <div class="analytics-dashboard">
                <div class="time-selector-section">
                    <h4>📅 Time Period Selection</h4>
                    <div class="time-selector">
                        <button class="time-btn active" data-period="1h">Last Hour</button>
                        <button class="time-btn" data-period="6h">Last 6 Hours</button>
                        <button class="time-btn" data-period="24h">Last 24 Hours</button>
                        <button class="time-btn" data-period="7d">Last 7 Days</button>
                        <button class="time-btn" data-period="30d">Last 30 Days</button>
                    </div>
                </div>
                
                <div class="metrics-tabs-section">
                    <h4>Metrics Dashboard</h4>
                    <div class="metrics-tabs">
                                                  <button class="metric-tab-btn active" data-metric="battery">Battery Levels</button>
                          <button class="metric-tab-btn" data-metric="temperature">Temperature</button>
                                                  <button class="metric-tab-btn" data-metric="humidity">Humidity</button>
                          <button class="metric-tab-btn" data-metric="pressure">Pressure</button>
                    </div>
                </div>
                
                <div class="chart-section">
                    <div class="chart-container-analytics">
                        <canvas id="analyticsChart"></canvas>
                    </div>
                </div>
                
                <div class="summary-section">
                    <h4>Summary Statistics for ${containerId}</h4>
                    <div class="summary-grid">
                        <div class="summary-card">
                            <span class="summary-label">Total Readings</span>
                            <span class="summary-value" id="totalReadingsCount">-</span>
                        </div>
                        <div class="summary-card">
                            <span class="summary-label">Average Value</span>
                            <span class="summary-value" id="averageValue">-</span>
                        </div>
                        <div class="summary-card">
                            <span class="summary-label">Min Value</span>
                            <span class="summary-value" id="minValue">-</span>
                        </div>
                        <div class="summary-card">
                            <span class="summary-label">Max Value</span>
                            <span class="summary-value" id="maxValue">-</span>
                        </div>
                    </div>
                </div>
                
                <div class="data-table-section">
                    <h4>📋 Historical Data for ${containerId}</h4>
                    <div class="table-container-analytics">
                        <table id="analyticsTable">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Battery (%)</th>
                                    <th>Temperature (°C)</th>
                                    <th>Humidity (%)</th>
                                    <th>Pressure (hPa)</th>
                                    <th>Location</th>
                                </tr>
                            </thead>
                            <tbody id="analyticsTableBody">
                                <!-- Dynamic content -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        // Store the container data and ID for analytics
        this.currentContainerData = containerData;
        this.currentContainerId = containerId;
        
        // Setup analytics functionality
        setTimeout(() => {
            this.setupAnalyticsDashboard();
            this.loadContainerAnalyticsData('1h', 'battery'); // Default: last hour, battery data
        }, 100);
        
        modal.style.display = 'block';
    }

    setupAnalyticsDashboard() {
        // Setup time period buttons
        const timeButtons = document.querySelectorAll('.time-btn');
        timeButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                timeButtons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                
                const period = e.target.getAttribute('data-period');
                const metric = document.querySelector('.metric-tab-btn.active').getAttribute('data-metric');
                this.loadContainerAnalyticsData(period, metric);
            });
        });

        // Setup metric tabs
        const metricButtons = document.querySelectorAll('.metric-tab-btn');
        metricButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                metricButtons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                
                const metric = e.target.getAttribute('data-metric');
                const period = document.querySelector('.time-btn.active').getAttribute('data-period');
                this.loadContainerAnalyticsData(period, metric);
            });
        });
    }

    async loadContainerAnalyticsData(period, metric) {
        try {
            this.showLoading();
            
            // Calculate time range
            const endTime = new Date();
            const startTime = new Date();
            
            switch(period) {
                case '1h':
                    startTime.setHours(endTime.getHours() - 1);
                    break;
                case '6h':
                    startTime.setHours(endTime.getHours() - 6);
                    break;
                case '24h':
                    startTime.setDate(endTime.getDate() - 1);
                    break;
                case '7d':
                    startTime.setDate(endTime.getDate() - 7);
                    break;
                case '30d':
                    startTime.setDate(endTime.getDate() - 30);
                    break;
            }
            
            // Process the container history data we already have
            const processedData = this.processContainerAnalyticsData(this.currentContainerData.history || [], startTime, endTime, metric);
            
            // Update chart and table
            this.updateContainerAnalyticsChart(processedData, metric, period);
            this.updateContainerAnalyticsTable(processedData, metric);
            this.updateContainerSummaryStats(processedData, metric);
            
        } catch (error) {
            console.error('Error loading container analytics data:', error);
            this.showError('Failed to load container analytics data');
        } finally {
            this.hideLoading();
        }
    }

    processContainerAnalyticsData(history, startTime, endTime, metric) {
        const filteredData = [];
        
        history.forEach(entry => {
            const entryTime = new Date(entry.timestamp);
            
            // Filter by time range
            if (entryTime >= startTime && entryTime <= endTime) {
                const data = entry.data || {};
                
                let value = null;
                switch(metric) {
                    case 'battery':
                        value = parseFloat(data['bat-soc'] || data.battery);
                        break;
                    case 'temperature':
                        value = parseFloat(data.temperature);
                        break;
                    case 'humidity':
                        value = parseFloat(data.humidity);
                        break;
                    case 'pressure':
                        value = parseFloat(data.pressure);
                        break;
                }
                
                if (value !== null && !isNaN(value)) {
                    filteredData.push({
                        timestamp: entryTime,
                        value: value,
                        data: data
                    });
                }
            }
        });
        
        // Sort by timestamp
        filteredData.sort((a, b) => a.timestamp - b.timestamp);
        
        return filteredData;
    }

    updateContainerAnalyticsChart(analyticsData, metric, period) {
        const ctx = document.getElementById('analyticsChart');
        if (!ctx) return;
        
        // Destroy existing chart
        if (this.analyticsChart) {
            this.analyticsChart.destroy();
        }
        
        // Prepare chart data - show time series
        const labels = analyticsData.map(entry => entry.timestamp.toLocaleTimeString());
        const values = analyticsData.map(entry => entry.value);
        
        const metricConfig = {
            battery: { label: 'Battery SOC (%)', color: '#27ae60', unit: '%', max: 100 },
            temperature: { label: 'Temperature (°C)', color: '#e74c3c', unit: '°C' },
            humidity: { label: 'Humidity (%)', color: '#1abc9c', unit: '%', max: 100 },
            pressure: { label: 'Pressure (hPa)', color: '#f39c12', unit: ' hPa' }
        };
        
        const config = metricConfig[metric];
        
        this.analyticsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `${config.label}`,
                    data: values,
                    backgroundColor: config.color + '20', // 12% opacity
                    borderColor: config.color,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${this.currentContainerId} - ${config.label} - ${period.toUpperCase()}`
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.parsed.y.toFixed(2)}${config.unit}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: config.max || undefined,
                        title: {
                            display: true,
                            text: config.label
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time'
                        }
                    }
                }
            }
        });
    }

    updateContainerAnalyticsTable(analyticsData, metric) {
        const tbody = document.getElementById('analyticsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        // Sort by timestamp (most recent first)
        analyticsData.sort((a, b) => b.timestamp - a.timestamp);
        
        analyticsData.forEach(entry => {
            const row = document.createElement('tr');
            const data = entry.data;
            
            row.innerHTML = `
                <td>${this.formatDateTime(entry.timestamp)}</td>
                <td>${data['bat-soc'] || data.battery || '-'}%</td>
                <td>${data.temperature || '-'}°C</td>
                <td>${data.humidity || '-'}%</td>
                <td>${data.pressure || '-'} hPa</td>
                <td>${this.formatLocation(data)}</td>
            `;
            
            tbody.appendChild(row);
        });
    }

    updateContainerSummaryStats(analyticsData, metric) {
        const metricConfig = {
            battery: { unit: '%' },
            temperature: { unit: '°C' },
            humidity: { unit: '%' },
            pressure: { unit: ' hPa' }
        };
        
        const config = metricConfig[metric];
        
        if (analyticsData.length === 0) {
            document.getElementById('totalReadingsCount').textContent = '0';
            document.getElementById('averageValue').textContent = 'N/A';
            document.getElementById('minValue').textContent = 'N/A';
            document.getElementById('maxValue').textContent = 'N/A';
            return;
        }
        
        const allValues = analyticsData.map(entry => entry.value);
        const overallAverage = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const overallMin = Math.min(...allValues);
        const overallMax = Math.max(...allValues);
        
        document.getElementById('totalReadingsCount').textContent = analyticsData.length;
        document.getElementById('averageValue').textContent = `${overallAverage.toFixed(2)}${config.unit}`;
        document.getElementById('minValue').textContent = `${overallMin.toFixed(2)}${config.unit}`;
        document.getElementById('maxValue').textContent = `${overallMax.toFixed(2)}${config.unit}`;
    }

    closeModal() {
        document.getElementById('containerModal').style.display = 'none';
        
        // Cleanup charts
        if (this.containerChart) {
            this.containerChart.destroy();
            this.containerChart = null;
            this.containerChartData = null;
        }
        
        if (this.analyticsChart) {
            this.analyticsChart.destroy();
            this.analyticsChart = null;
        }
    }

    setupChart() {
        const ctx = document.getElementById('activityChart').getContext('2d');
        
        // Add time period controls above the chart
        const chartContainer = document.querySelector('.chart-container');
        const chartHeader = document.createElement('div');
        chartHeader.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0;">Container Activity</h3>
                <div class="chart-time-controls" style="display: flex; gap: 5px;">
                    <button class="chart-time-btn active" data-hours="1">Last Hour</button>
                    <button class="chart-time-btn" data-hours="3">Last 3 Hours</button>
                    <button class="chart-time-btn" data-hours="6">Last 6 Hours</button>
                </div>
            </div>
        `;
        chartContainer.insertBefore(chartHeader, chartContainer.firstChild);
        
        // Add event listeners for time controls
        document.querySelectorAll('.chart-time-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.chart-time-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const hours = parseInt(e.target.getAttribute('data-hours'));
                this.updateChartData(hours);
            });
        });
        
        // Initialize with default data (1 hour)
        this.initializeChart(ctx);
        this.updateChartData(1);
    }

    initializeChart(ctx) {
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Container Updates',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0,0,0,0.1)'
                        },
                        title: {
                            display: true,
                            text: 'Container Updates'
                        }
                    },
                    x: {
                        grid: {
                            color: 'rgba(0,0,0,0.1)'
                        },
                        title: {
                            display: true,
                            text: 'Time'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: false
                    }
                }
            }
        });
    }

    updateChartData(hours) {
        if (!this.chart) return;
        
        const now = new Date();
        const startTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
        
        // Create time buckets based on the selected period
        const bucketCount = hours <= 1 ? 12 : (hours <= 3 ? 18 : 24); // 5min, 10min, 15min intervals
        const bucketSize = (hours * 60 * 60 * 1000) / bucketCount;
        
        const buckets = [];
        const labels = [];
        
        for (let i = 0; i < bucketCount; i++) {
            buckets.push(0);
            const bucketTime = new Date(startTime.getTime() + i * bucketSize);
            labels.push(bucketTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}));
        }
        
        // Count containers in each time bucket
        this.containers.forEach(container => {
            const containerTime = new Date(container.timestamp);
            if (containerTime >= startTime && containerTime <= now) {
                const bucketIndex = Math.floor((containerTime - startTime) / bucketSize);
                if (bucketIndex >= 0 && bucketIndex < bucketCount) {
                    buckets[bucketIndex]++;
                }
            }
        });
        
        this.chart.data.labels = labels;
        this.chart.data.datasets[0].data = buckets;
        this.chart.update();
    }

    updateChart() {
        // Get the current active time period and update accordingly
        const activeBtn = document.querySelector('.chart-time-btn.active');
        if (activeBtn) {
            const hours = parseInt(activeBtn.getAttribute('data-hours'));
            this.updateChartData(hours);
        } else {
            this.updateChartData(1); // Default to 1 hour
        }
    }

    toggleAutoRefresh() {
        const btn = document.getElementById('autoRefreshBtn');
        
        if (this.autoRefresh) {
            // Turn off auto refresh
            this.autoRefresh = false;
            clearInterval(this.refreshInterval);
            btn.textContent = '⏰ Auto Refresh: OFF';
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        } else {
            // Turn on auto refresh
            this.autoRefresh = true;
            this.refreshInterval = setInterval(() => {
                this.loadData();
                this.loadStats();
            }, 5000); // Refresh every 5 seconds
            btn.textContent = '⏰ Auto Refresh: ON';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
        }
    }

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    showError(message) {
        // Simple error notification - could be enhanced with a proper notification system
        alert(message);
    }
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new MaritimeDashboard();
});

// Add some CSS for history items
const additionalStyles = `
    .history-list {
        max-height: 200px;
        overflow-y: auto;
    }
    
    .history-item {
        padding: 8px;
        margin-bottom: 8px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 0.9rem;
    }
    
    .history-item:last-child {
        margin-bottom: 0;
    }
`;

// Inject additional styles
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet); 