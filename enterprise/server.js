/**
 * Simple Mock Enterprise API Gateway
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-enterprise-jwt-key';

// Middleware
app.use(cors({
  origin: ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Mock users
const mockUsers = [
  {
    id: '1',
    email: 'admin@quantlink.io',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['admin', 'user'],
    permissions: ['read', 'write', 'admin'],
    organizationId: 'quantlink',
    isActive: true,
    mfaEnabled: false,
    createdAt: new Date('2024-01-01'),
  },
];

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    service: 'enterprise-api-gateway',
    version: '1.0.0'
  });
});

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  const user = mockUsers.find(u => u.email === email);
  
  if (!user || password !== 'password') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const accessToken = jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      roles: user.roles,
      permissions: user.permissions 
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  const refreshToken = jwt.sign(
    { id: user.id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  res.json({
    user,
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      tokenType: 'Bearer',
    },
    sessionId: `session_${Date.now()}`,
  });
});

app.post('/api/v1/auth/wallet-login', (req, res) => {
  const { address, signature, message } = req.body;
  
  const user = {
    id: `wallet_${address.slice(-8)}`,
    walletAddress: address,
    firstName: 'Wallet',
    lastName: 'User',
    roles: ['user'],
    permissions: ['read'],
    organizationId: 'quantlink',
    isActive: true,
    mfaEnabled: false,
    createdAt: new Date(),
  };
  
  const accessToken = jwt.sign(
    { 
      id: user.id, 
      walletAddress: address,
      roles: user.roles,
      permissions: user.permissions 
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  res.json({
    user,
    tokens: {
      accessToken,
      refreshToken: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' }),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      tokenType: 'Bearer',
    },
    sessionId: `wallet_session_${Date.now()}`,
  });
});

app.get('/api/v1/metrics/system', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: {
      usage: Math.random() * 50 + 10,
      cores: 4,
    },
    requests: {
      total: Math.floor(Math.random() * 10000) + 1000,
      perSecond: Math.floor(Math.random() * 100) + 10,
    },
    errors: {
      total: Math.floor(Math.random() * 100),
      rate: Math.random() * 0.05,
    },
    timestamp: Date.now(),
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Enterprise API Gateway running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`\n📝 Test credentials:`);
  console.log(`   Email: admin@quantlink.io`);
  console.log(`   Password: password`);
});
