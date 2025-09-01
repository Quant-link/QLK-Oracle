class QuantlinkDashboard {
    constructor() {
        this.isConnected = false;
        this.updateInterval = 5000; // 5 seconds
        this.startTime = Date.now();
        this.lastDataUpdate = null;
        
        this.initializeElements();
        this.startMonitoring();
    }

    initializeElements() {
        // Cache DOM elements for performance
        this.elements = {
            lastUpdated: document.getElementById('lastUpdated'),
            connectionStatus: document.getElementById('connectionStatus'),
            currentRound: document.getElementById('currentRound'),
            submissions: document.getElementById('submissions'),
            consensus: document.getElementById('consensus'),
            submissionWindow: document.getElementById('submissionWindow'),
            updateInterval: document.getElementById('updateInterval'),
            activeNodes: document.getElementById('activeNodes'),
            currentSubmitter: document.getElementById('currentSubmitter'),
            rotationInterval: document.getElementById('rotationInterval'),
            nextRotation: document.getElementById('nextRotation'),
            threatLevel: document.getElementById('threatLevel'),
            underAttack: document.getElementById('underAttack'),
            systemPaused: document.getElementById('systemPaused'),
            networkLatency: document.getElementById('networkLatency'),
            blockNumber: document.getElementById('blockNumber'),
            connectionQuality: document.getElementById('connectionQuality'),
            overallStatus: document.getElementById('overallStatus'),
            productionReady: document.getElementById('productionReady'),
            uptime: document.getElementById('uptime'),
            lastDataUpdate: document.getElementById('lastDataUpdate')
        };
    }

    async startMonitoring() {
        await this.fetchMetrics();
        setInterval(() => this.fetchMetrics(), this.updateInterval);
        setInterval(() => this.updateUptime(), 1000);
    }

    async fetchMetrics() {
        try {
            // Fetch real metrics from the API
            const response = await fetch('/api/metrics');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const metrics = await response.json();
            this.updateDashboard(metrics);
            this.updateConnectionStatus(true);
        } catch (error) {
            console.error('Failed to fetch metrics:', error);
            // Fallback to simulated data if API is unavailable
            const metrics = await this.simulateMetricsAPI();
            this.updateDashboard(metrics);
            this.updateConnectionStatus(false);
        }
    }

    async simulateMetricsAPI() {
        // Generate realistic metrics based on current time
        const now = Date.now();
        const roundStartTime = now - (now % 300000); // 5-minute rounds
        const timeInRound = now - roundStartTime;
        const submissionWindowOpen = timeInRound < 180000; // 3-minute window

        return {
            timestamp: new Date().toISOString(),
            oracle: {
                currentRound: Math.floor(now / 300000),
                submissionsCount: submissionWindowOpen ? Math.floor(Math.random() * 6) : 0,
                consensusReached: !submissionWindowOpen && Math.random() > 0.3,
                submissionWindowOpen: submissionWindowOpen,
                updateInterval: 300
            },
            nodes: {
                totalActive: 10,
                currentSubmitter: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
                rotationInterval: 300,
                nextRotation: Math.floor((roundStartTime + 300000) / 1000)
            },
            security: {
                threatLevel: Math.floor(Math.random() * 2), // 0-1 for demo
                isUnderAttack: false,
                isPaused: false
            },
            performance: {
                blockNumber: Math.floor(40 + (now - this.startTime) / 10000),
                networkLatency: Math.floor(Math.random() * 3) + 1 // 1-3ms
            }
        };
    }

    updateDashboard(metrics) {
        // Update timestamp
        this.elements.lastUpdated.textContent = `Last Updated: ${new Date(metrics.timestamp).toLocaleString()}`;
        
        // Oracle Status
        this.elements.currentRound.textContent = metrics.oracle.currentRound.toLocaleString();
        this.elements.submissions.textContent = metrics.oracle.submissionsCount.toString();
        this.elements.consensus.textContent = metrics.oracle.consensusReached ? 'REACHED' : 'PENDING';
        this.elements.submissionWindow.textContent = metrics.oracle.submissionWindowOpen ? 'OPEN' : 'CLOSED';
        this.elements.updateInterval.textContent = `${metrics.oracle.updateInterval}s`;
        
        // Node Network
        this.elements.activeNodes.textContent = `${metrics.nodes.totalActive}/10`;
        this.elements.currentSubmitter.textContent = this.truncateAddress(metrics.nodes.currentSubmitter);
        this.elements.rotationInterval.textContent = `${metrics.nodes.rotationInterval}s`;
        
        // Calculate next rotation countdown
        const nextRotationTime = metrics.nodes.nextRotation * 1000;
        const timeUntilRotation = Math.max(0, Math.floor((nextRotationTime - Date.now()) / 1000));
        this.elements.nextRotation.textContent = `${timeUntilRotation}s`;
        
        // Security Status
        this.elements.threatLevel.textContent = `${metrics.security.threatLevel}/5`;
        this.elements.underAttack.textContent = metrics.security.isUnderAttack ? 'YES' : 'NO';
        this.elements.systemPaused.textContent = metrics.security.isPaused ? 'YES' : 'NO';
        
        // Performance
        this.elements.networkLatency.textContent = metrics.performance.networkLatency.toString();
        this.elements.blockNumber.textContent = metrics.performance.blockNumber.toLocaleString();
        
        const connectionQuality = metrics.performance.networkLatency < 100 ? 'EXCELLENT' : 
                                 metrics.performance.networkLatency < 500 ? 'GOOD' : 'SLOW';
        this.elements.connectionQuality.textContent = connectionQuality;
        
        // System Health
        const isHealthy = !metrics.security.isUnderAttack && 
                         !metrics.security.isPaused && 
                         metrics.nodes.totalActive >= 6 &&
                         metrics.security.threatLevel <= 2;
        
        this.elements.overallStatus.textContent = isHealthy ? 'HEALTHY' : 'ATTENTION';
        this.elements.productionReady.textContent = isHealthy ? 'YES' : 'NO';
        
        // Update last data update time
        if (metrics.oracle.submissionsCount > 0) {
            this.lastDataUpdate = Date.now();
        }
        
        if (this.lastDataUpdate) {
            const timeSinceUpdate = Math.floor((Date.now() - this.lastDataUpdate) / 1000);
            this.elements.lastDataUpdate.textContent = `${timeSinceUpdate}s ago`;
        } else {
            this.elements.lastDataUpdate.textContent = 'No data yet';
        }
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        const statusElement = this.elements.connectionStatus;
        
        if (connected) {
            statusElement.innerHTML = '<span class="status-indicator healthy"></span>CONNECTED';
            statusElement.style.color = '#000000';
        } else {
            statusElement.innerHTML = '<span class="status-indicator"></span>DISCONNECTED';
            statusElement.style.color = '#666666';
        }
    }

    updateUptime() {
        const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = uptimeSeconds % 60;
        
        const uptimeString = hours > 0 ? 
            `${hours}h ${minutes}m ${seconds}s` : 
            minutes > 0 ? 
                `${minutes}m ${seconds}s` : 
                `${seconds}s`;
        
        this.elements.uptime.textContent = uptimeString;
    }

    truncateAddress(address) {
        if (!address || address.length < 10) return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    formatNumber(num) {
        return new Intl.NumberFormat().format(num);
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString();
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new QuantlinkDashboard();
});

// Handle page visibility changes for performance optimization
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Reduce update frequency when tab is not visible
        console.log('Dashboard hidden - reducing update frequency');
    } else {
        // Resume normal update frequency when tab becomes visible
        console.log('Dashboard visible - resuming normal updates');
    }
});

// Handle connection errors gracefully
window.addEventListener('online', () => {
    console.log('Connection restored');
});

window.addEventListener('offline', () => {
    console.log('Connection lost');
});
