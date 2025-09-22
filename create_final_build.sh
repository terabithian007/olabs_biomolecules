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

usage() {
    cat << EOF
Usage: $0 [options]

Options:
      --prefix <path>       Prefix root in bucket (default: biomolecules)
      --help                Show this help

Examples:
  $0
  $0 --prefix biomolecules
\nThis script builds final outputs for both languages: en and hi.
EOF
}


BUCKET_PREFIX="biomolecules"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix)
            BUCKET_PREFIX="$2"; shift 2 ;;
        --help|-h)
            usage; exit 0 ;;
        *)
            print_error "Unknown option: $1"; usage; exit 1 ;;
    esac
done

print_status "Starting build process for languages: en, hi..."

# Check prereqs
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

# Check project root
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root directory."
    exit 1
fi

# Install dependencies if needed
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

# Build for both languages: en and hi
LANGUAGES=("en" "hi")

for LANGUAGE in "${LANGUAGES[@]}"; do
    # Build to a temporary directory so we can relocate into dist/<prefix>/<LANGUAGE>
    BUILD_DIR="dist_tmp"
    TARGET_DIR="dist/${BUCKET_PREFIX}/${LANGUAGE}/simulation"

    print_status "Building the project to ${BUILD_DIR} with VITE_LANGUAGE=${LANGUAGE}..."
    VITE_LANGUAGE="${LANGUAGE}" npm run build -- --outDir "${BUILD_DIR}"
    if [ $? -ne 0 ]; then
        print_error "Build failed for language ${LANGUAGE}."
        exit 1
    fi
    print_status "Build completed successfully for ${LANGUAGE}."

    # Prepare target directory and move artifacts
    print_status "Preparing target directory: ${TARGET_DIR}"
    mkdir -p "${TARGET_DIR}"
    rm -rf "${TARGET_DIR}"/*

    # Copy build output into target (preserve dotfiles)
    if [ -d "${BUILD_DIR}" ]; then
        cp -R "${BUILD_DIR}"/. "${TARGET_DIR}"/
        if [ $? -ne 0 ]; then
            print_error "Failed to copy build output to ${TARGET_DIR}."
            exit 1
        fi
        rm -rf "${BUILD_DIR}"
    else
        print_error "Temporary build directory ${BUILD_DIR} not found."
        exit 1
    fi
    print_status "Build artifacts moved to ${TARGET_DIR}."
done

print_status "Done. Artifacts are in dist/${BUCKET_PREFIX}/{en,hi}/simulation."
exit 0
