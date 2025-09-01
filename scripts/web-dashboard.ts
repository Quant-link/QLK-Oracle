import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as url from "url";

interface DeploymentInfo {
  network: string;
  timestamp: string;
  contracts: {
    AccessControlManager: string;
    SecurityManager: string;
    NodeManager: string;
    ConsensusEngine: string;
    QuantlinkOracle: string;
    PriceFeedAdapter: string;
    ProtocolIntegration: string;
  };
}

interface SystemMetrics {
  timestamp: string;
  oracle: {
    currentRound: number;
    submissionsCount: number;
    consensusReached: boolean;
    submissionWindowOpen: boolean;
    updateInterval: number;
  };
  nodes: {
    totalActive: number;
    currentSubmitter: string;
    rotationInterval: number;
    nextRotation: number;
  };
  security: {
    threatLevel: number;
    isUnderAttack: boolean;
    isPaused: boolean;
  };
  performance: {
    gasUsed: string;
    blockNumber: number;
    networkLatency: number;
  };
}

class PremiumWebDashboard {
  private deployment: DeploymentInfo | null = null;
  private server: http.Server | null = null;
  private port: number = 3000;
  private dashboardPath: string;

  constructor() {
    this.dashboardPath = path.join(__dirname, "../dashboard");
  }

  async initialize(): Promise<void> {
    console.log("🚀 Initializing Premium Web Dashboard...");
    
    // Load deployment info
    this.deployment = await this.loadLatestDeployment();
    
    // Create HTTP server
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    
    // Start server
    this.server.listen(this.port, () => {
      console.log(`✅ Premium Dashboard Server running at:`);
      console.log(`   http://localhost:${this.port}`);
      console.log(`   Network: ${network.name.toUpperCase()}`);
      console.log(`   Status: LIVE AND OPERATIONAL`);
    });
  }

  private async loadLatestDeployment(): Promise<DeploymentInfo> {
    const deploymentsDir = path.join(__dirname, "../deployments");
    const files = fs.readdirSync(deploymentsDir)
      .filter(file => file.startsWith(network.name) && file.endsWith('.json'))
      .sort()
      .reverse();

    const latestFile = files[0];
    const filepath = path.join(deploymentsDir, latestFile);
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';

    // Set CORS headers for API requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      if (pathname === '/') {
        await this.serveFile(res, 'index.html', 'text/html');
      } else if (pathname === '/dashboard.js') {
        await this.serveFile(res, 'dashboard.js', 'application/javascript');
      } else if (pathname === '/api/metrics') {
        await this.serveMetrics(res);
      } else if (pathname === '/api/health') {
        await this.serveHealthCheck(res);
      } else {
        this.serve404(res);
      }
    } catch (error) {
      console.error('Request handling error:', error);
      this.serve500(res);
    }
  }

  private async serveFile(res: http.ServerResponse, filename: string, contentType: string): Promise<void> {
    const filepath = path.join(this.dashboardPath, filename);
    
    if (!fs.existsSync(filepath)) {
      this.serve404(res);
      return;
    }

    const content = fs.readFileSync(filepath, 'utf8');
    
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.end(content);
  }

  private async serveMetrics(res: http.ServerResponse): Promise<void> {
    if (!this.deployment) {
      this.serve500(res);
      return;
    }

    try {
      const metrics = await this.collectSystemMetrics();
      
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      
      res.end(JSON.stringify(metrics, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value, 2));
    } catch (error) {
      console.error('Metrics collection error:', error);
      this.serve500(res);
    }
  }

  private async serveHealthCheck(res: http.ServerResponse): Promise<void> {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      network: network.name,
      deployment: this.deployment ? 'loaded' : 'missing',
      uptime: process.uptime()
    };

    res.writeHead(200, {
      'Content-Type': 'application/json'
    });
    
    res.end(JSON.stringify(health, null, 2));
  }

  private serve404(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 - Not Found');
  }

  private serve500(res: http.ServerResponse): void {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 - Internal Server Error');
  }

  private async collectSystemMetrics(): Promise<SystemMetrics> {
    if (!this.deployment) {
      throw new Error('Deployment not loaded');
    }

    const oracle = await ethers.getContractAt("QuantlinkOracle", this.deployment.contracts.QuantlinkOracle);
    const nodeManager = await ethers.getContractAt("NodeManager", this.deployment.contracts.NodeManager);
    const securityManager = await ethers.getContractAt("SecurityManager", this.deployment.contracts.SecurityManager);

    // Oracle metrics
    const currentRound = await oracle.getCurrentRound();
    const updateInterval = await oracle.getUpdateInterval();
    const isSubmissionOpen = await oracle.isSubmissionWindowOpen();

    // Node metrics
    const totalActiveNodes = await nodeManager.getTotalActiveNodes();
    const currentSubmitter = await nodeManager.getCurrentSubmitter();
    const rotationSchedule = await nodeManager.getRotationSchedule();

    // Security metrics
    const threatLevel = await securityManager.getThreatLevel();
    const isUnderAttack = await securityManager.isUnderAttack();
    const isPaused = await securityManager.paused();

    // Performance metrics
    const blockNumber = await ethers.provider.getBlockNumber();
    const startTime = Date.now();
    await ethers.provider.getBlock(blockNumber);
    const networkLatency = Date.now() - startTime;

    return {
      timestamp: new Date().toISOString(),
      oracle: {
        currentRound: Number(currentRound.roundId),
        submissionsCount: Number(currentRound.submissionsCount),
        consensusReached: currentRound.consensusReached,
        submissionWindowOpen: isSubmissionOpen,
        updateInterval: Number(updateInterval),
      },
      nodes: {
        totalActive: Number(totalActiveNodes),
        currentSubmitter,
        rotationInterval: Number(rotationSchedule.rotationInterval),
        nextRotation: Number(rotationSchedule.rotationTime),
      },
      security: {
        threatLevel: Number(threatLevel),
        isUnderAttack,
        isPaused,
      },
      performance: {
        gasUsed: "0",
        blockNumber,
        networkLatency,
      },
    };
  }

  async shutdown(): Promise<void> {
    if (this.server) {
      console.log("🛑 Shutting down Premium Web Dashboard...");
      this.server.close();
    }
  }
}

async function main() {
  const dashboard = new PremiumWebDashboard();
  
  try {
    await dashboard.initialize();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await dashboard.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await dashboard.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    console.error("❌ Failed to start Premium Web Dashboard:", error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { PremiumWebDashboard };
