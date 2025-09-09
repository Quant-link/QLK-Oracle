# QuantLink Oracle Dashboard

Production-ready, enterprise-grade dashboard for QuantLink Oracle with real-time WebSocket connections, TypeScript, and comprehensive monitoring capabilities.

## 🚀 Features

### Real-time Data Infrastructure
- **WebSocket Server**: Socket.io with Redis adapter for horizontal scaling
- **EventSource Fallback**: Server-sent events for reliable connectivity
- **Apache Kafka Integration**: Real-time data pipeline processing
- **Protocol Buffers**: Efficient binary data transfer
- **Connection Management**: Automatic reconnection with exponential backoff
- **Message Queuing**: Priority lanes with offline support
- **Health Monitoring**: Connection pooling with latency tracking

### State Management Architecture
- **Zustand Stores**: Persistence and encryption for sensitive data
- **Optimistic Updates**: Rollback capabilities for failed operations
- **Normalized Cache**: Automatic invalidation and time-travel debugging
- **Redux DevTools**: Integration for development debugging
- **Computed Properties**: Memoization for performance optimization
- **Cross-tab Sync**: State synchronization across browser tabs
- **Undo/Redo**: Functionality for user actions

### Authentication & Authorization
- **Web3 Wallet Support**: MetaMask, WalletConnect, Coinbase Wallet
- **JWT Management**: Token refresh rotation and session management
- **Role-based Access**: Granular permissions system
- **Multi-factor Auth**: WebAuthn biometric authentication support
- **Enterprise SSO**: OAuth2 integration for organizations
- **Audit Logging**: Comprehensive security event tracking

### Performance Optimization
- **Virtual Scrolling**: react-window for large datasets
- **Service Workers**: Offline functionality with Cache API
- **Code Splitting**: Route and component-level optimization
- **Bundle Analysis**: Tree shaking and vendor chunking
- **Image Pipeline**: Next.js optimization with WebP/AVIF
- **Request Batching**: Deduplication and intelligent caching

### Responsive Design System
- **Mobile-first**: CSS Grid and Flexbox layouts
- **Theme Support**: Dark/light mode with system preference
- **Accessibility**: WCAG 2.1 AA compliance throughout
- **Touch Optimization**: Mobile interactions and gestures
- **Print Stylesheets**: Optimized for document printing
- **Black & White**: Monochrome design system

## 🛠 Technology Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript with strict configuration
- **Styling**: Tailwind CSS with custom design system
- **State Management**: Zustand with persistence
- **Real-time**: Socket.io with Protocol Buffers
- **Authentication**: JWT with Web3 wallet support
- **Data Processing**: Apache Kafka integration
- **Caching**: Redis with intelligent invalidation
- **Testing**: Jest with React Testing Library
- **Monitoring**: Prometheus metrics integration

## 📦 Installation

```bash
# Clone the repository
git clone <repository-url>
cd dashboard

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env.local

# Start development server
npm run dev
```

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# WebSocket connection
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:3001

# API endpoints
NEXT_PUBLIC_API_URL=http://localhost:3001/api

# Authentication settings
NEXT_PUBLIC_ENABLE_WEB3_AUTH=true
NEXT_PUBLIC_ENABLE_MFA=true

# Performance settings
NEXT_PUBLIC_ENABLE_SERVICE_WORKER=true
NEXT_PUBLIC_ENABLE_CACHING=true
```

### WebSocket Configuration

The dashboard connects to the QuantLink Oracle WebSocket server for real-time data:

```typescript
// Connection configuration
{
  url: process.env.NEXT_PUBLIC_WEBSOCKET_URL,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  maxReconnectionAttempts: 10,
  timeout: 20000
}
```

## 🏗 Architecture

### Component Structure
```
src/
├── app/                    # Next.js App Router pages
├── components/             # Reusable UI components
│   ├── dashboard/         # Dashboard-specific components
│   ├── charts/            # Real-time chart components
│   ├── data-table/        # Data table with sorting/filtering
│   ├── metrics/           # Performance metrics displays
│   ├── providers/         # Context providers
│   └── ui/                # Base UI components
├── lib/                   # Core utilities and services
│   ├── store/             # Zustand state management
│   ├── websocket/         # WebSocket connection management
│   ├── protobuf/          # Protocol Buffers handling
│   └── utils.ts           # Utility functions
└── proto/                 # Protocol Buffer definitions
```

### Data Flow
1. **WebSocket Connection**: Establishes secure connection to Oracle server
2. **Protocol Buffers**: Decodes binary messages for efficiency
3. **State Management**: Updates Zustand stores with real-time data
4. **Component Updates**: React components re-render with new data
5. **User Interactions**: Actions trigger optimistic updates with rollback

## 📊 Real-time Features

### Data Types
- **Oracle Data**: Aggregated fee and price information
- **Price Updates**: Real-time CEX/DEX price feeds
- **Fee Updates**: Trading fee data from exchanges
- **Health Status**: System and source monitoring
- **Performance Metrics**: Connection and processing statistics

### Subscriptions
```typescript
// Subscribe to data channels
subscribe([
  'oracle:BTC/USDT',
  'oracle:ETH/USDT',
  'health:system',
  'metrics:performance'
]);
```

## 🔐 Security

### Authentication Flow
1. **Web3 Wallet**: Connect MetaMask/WalletConnect
2. **Signature Verification**: Cryptographic proof of ownership
3. **JWT Tokens**: Secure session management
4. **Permission Checks**: Role-based access control
5. **Session Validation**: Automatic token refresh

### Data Protection
- **Encryption**: Sensitive data encrypted in localStorage
- **HTTPS Only**: All communications over secure channels
- **CSP Headers**: Content Security Policy enforcement
- **XSS Protection**: Input sanitization and output encoding

## 📈 Performance

### Optimization Strategies
- **Code Splitting**: Dynamic imports for route-based chunks
- **Tree Shaking**: Eliminate unused code from bundles
- **Image Optimization**: WebP/AVIF with responsive sizing
- **Caching**: Aggressive caching with smart invalidation
- **Virtual Scrolling**: Handle large datasets efficiently
- **Service Workers**: Offline functionality and background sync

### Monitoring
- **Web Vitals**: LCP, FID, CLS tracking
- **Connection Metrics**: Latency and throughput monitoring
- **Error Tracking**: Comprehensive error boundary system
- **Performance Profiling**: Bundle analysis and optimization

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npm run test:e2e

# Run performance tests
npm run test:performance
```

## 🚀 Deployment

### Production Build
```bash
# Build for production
npm run build

# Start production server
npm start

# Analyze bundle size
npm run analyze
```

### Docker Deployment
```bash
# Build Docker image
docker build -t quantlink-dashboard .

# Run container
docker run -p 3000:3000 quantlink-dashboard
```

## 📝 Development

### Code Quality
- **TypeScript**: Strict type checking enabled
- **ESLint**: Comprehensive linting rules
- **Prettier**: Consistent code formatting
- **Husky**: Pre-commit hooks for quality gates

### Development Tools
- **Storybook**: Component development and testing
- **Redux DevTools**: State debugging and time-travel
- **React DevTools**: Component inspection and profiling
- **Bundle Analyzer**: Performance optimization insights

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Contact the QuantLink team
- Check the documentation wiki

---

**QuantLink Oracle Dashboard** - Production-ready enterprise dashboard with real-time data monitoring and analytics.
