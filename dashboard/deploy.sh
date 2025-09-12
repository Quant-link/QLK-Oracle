#!/bin/bash

# QuantLink Oracle Dashboard Production Deployment Script

set -e

echo "🚀 Starting QuantLink Oracle Dashboard Production Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DOCKER_IMAGE_NAME="quantlink-oracle-dashboard"
DOCKER_TAG="latest"
CONTAINER_NAME="quantlink-dashboard-prod"

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

print_status "Docker is running"

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    print_warning ".env.production file not found. Creating from template..."
    cp .env.production.template .env.production 2>/dev/null || true
    print_warning "Please update .env.production with your production values before deploying"
fi

# Build the Docker image
print_status "Building Docker image..."
docker build -t $DOCKER_IMAGE_NAME:$DOCKER_TAG .

if [ $? -eq 0 ]; then
    print_status "Docker image built successfully"
else
    print_error "Failed to build Docker image"
    exit 1
fi

# Stop existing container if running
if docker ps -q -f name=$CONTAINER_NAME | grep -q .; then
    print_status "Stopping existing container..."
    docker stop $CONTAINER_NAME
    docker rm $CONTAINER_NAME
fi

# Start the production environment
print_status "Starting production environment with Docker Compose..."
docker-compose -f docker-compose.prod.yml up -d

if [ $? -eq 0 ]; then
    print_status "Production environment started successfully"
else
    print_error "Failed to start production environment"
    exit 1
fi

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 10

# Health check
print_status "Performing health check..."
for i in {1..30}; do
    if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
        print_status "Health check passed"
        break
    fi
    
    if [ $i -eq 30 ]; then
        print_error "Health check failed after 30 attempts"
        docker-compose -f docker-compose.prod.yml logs
        exit 1
    fi
    
    echo "Waiting for health check... ($i/30)"
    sleep 2
done

# Display deployment information
echo ""
echo "🎉 QuantLink Oracle Dashboard deployed successfully!"
echo ""
echo "📊 Dashboard URL: http://localhost:3000"
echo "🔍 Health Check: http://localhost:3000/api/health"
echo ""
echo "📋 Useful commands:"
echo "  View logs: docker-compose -f docker-compose.prod.yml logs -f"
echo "  Stop services: docker-compose -f docker-compose.prod.yml down"
echo "  Restart services: docker-compose -f docker-compose.prod.yml restart"
echo ""
echo "🔧 Configuration:"
echo "  Environment: Production"
echo "  Container: $CONTAINER_NAME"
echo "  Image: $DOCKER_IMAGE_NAME:$DOCKER_TAG"
echo ""

# Show running containers
print_status "Running containers:"
docker-compose -f docker-compose.prod.yml ps

echo ""
print_status "Deployment completed successfully! 🚀"
