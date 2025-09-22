#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

print_status "Starting build and server process..."

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root directory."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        print_error "Failed to install dependencies."
        exit 1
    fi
    print_status "Dependencies installed successfully."
else
    print_status "Dependencies already installed."
fi

# Build the project
print_status "Building the project..."
npm run build
if [ $? -ne 0 ]; then
    print_error "Build failed."
    exit 1
fi
print_status "Build completed successfully."

# Check if dist directory exists
if [ ! -d "dist" ]; then
    print_error "dist directory not found. Build may have failed."
    exit 1
fi

# Change to dist directory and start Python HTTP server
print_status "Changing to dist directory and starting Python HTTP server on port 8000..."
cd dist
python3 -m http.server 8000
if [ $? -ne 0 ]; then
    print_error "Failed to start the Python HTTP server."
    exit 1
fi
