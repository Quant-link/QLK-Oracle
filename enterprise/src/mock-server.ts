/**
 * @fileoverview Mock Enterprise API Gateway for Development
 * @author QuantLink Team
 * @version 1.0.0
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-enterprise-jwt-key';

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Mock user data
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
  {
    id: '2',
    email: 'user@quantlink.io',
    firstName: 'Regular',
    lastName: 'User',
    roles: ['user'],
    permissions: ['read'],
    organizationId: 'quantlink',
    isActive: true,
    mfaEnabled: false,
    createdAt: new Date('2024-01-01'),
  },
];

// Authentication middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    service: 'enterprise-api-gateway',
    version: '1.0.0'
  });
});

// Authentication routes
app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  // Mock authentication
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
  
  // Mock wallet authentication
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
    sessionId: `wallet_session_${Date.now()}`,
  });
});

app.post('/api/v1/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;
    const user = mockUsers.find(u => u.id === decoded.id);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    const newAccessToken = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        roles: user.roles,
        permissions: user.permissions 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    const newRefreshToken = jwt.sign(
      { id: user.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      tokens: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        tokenType: 'Bearer',
      },
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

app.post('/api/v1/auth/logout', authenticateToken, (req, res) => {
  // In a real implementation, you would invalidate the token
  res.json({ message: 'Logged out successfully' });
});

// Protected routes
app.get('/api/v1/user/profile', authenticateToken, (req: any, res) => {
  const user = mockUsers.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

app.put('/api/v1/user/profile', authenticateToken, (req: any, res) => {
  const user = mockUsers.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Update user data (mock)
  Object.assign(user, req.body);
  res.json(user);
});

// API Key management
app.get('/api/v1/api-keys', authenticateToken, (req, res) => {
  res.json([
    {
      id: 'key_1',
      name: 'Production API Key',
      keyPreview: 'ql_prod_****',
      permissions: ['read', 'write'],
      rateLimit: 1000,
      createdAt: new Date('2024-01-01'),
      lastUsed: new Date(),
      isActive: true,
    },
    {
      id: 'key_2',
      name: 'Development API Key',
      keyPreview: 'ql_dev_****',
      permissions: ['read'],
      rateLimit: 100,
      createdAt: new Date('2024-01-15'),
      lastUsed: new Date(),
      isActive: true,
    },
  ]);
});

// System metrics
app.get('/api/v1/metrics/system', authenticateToken, (req, res) => {
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

// Data export
app.get('/api/v1/export/:format', authenticateToken, (req, res) => {
  const { format } = req.params;
  const { startDate, endDate, symbols } = req.query;
  
  // Mock export data
  const exportData = {
    metadata: {
      format,
      startDate,
      endDate,
      symbols: symbols?.toString().split(',') || ['BTC/USDT'],
      generatedAt: new Date().toISOString(),
      recordCount: Math.floor(Math.random() * 1000) + 100,
    },
    downloadUrl: `http://localhost:${PORT}/api/v1/download/export_${Date.now()}.${format}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  
  res.json(exportData);
});

// Webhook management
app.get('/api/v1/webhooks', authenticateToken, (req, res) => {
  res.json([
    {
      id: 'webhook_1',
      url: 'https://your-app.com/webhook',
      events: ['price_update', 'fee_update'],
      isActive: true,
      createdAt: new Date('2024-01-01'),
      lastTriggered: new Date(),
    },
  ]);
});

app.post('/api/v1/webhooks', authenticateToken, (req, res) => {
  const webhook = {
    id: `webhook_${Date.now()}`,
    ...req.body,
    createdAt: new Date(),
    isActive: true,
  };
  
  res.status(201).json(webhook);
});

// Error handling
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enterprise API Gateway running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 API Documentation: http://localhost:${PORT}/api/v1/docs`);
  console.log(`\n📝 Test credentials:`);
  console.log(`   Email: admin@quantlink.io`);
  console.log(`   Password: password`);
});

export default app;
