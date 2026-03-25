#!/usr/bin/env bash
set -e

echo "========================================="
echo "  RipV2 Server Setup"
echo "========================================="
echo ""

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  echo "Could not detect OS. Exiting."
  exit 1
fi

# Install system dependencies
echo "Installing system dependencies..."
case "$OS" in
  ubuntu|debian)
    sudo apt-get update
    sudo apt-get install -y curl python3 make g++ linux-headers-$(uname -r 2>/dev/null || echo "generic") ufw
    ;;
  alpine)
    sudo apk add --no-cache curl python3 make g++ linux-headers
    ;;
  fedora)
    sudo dnf install -y curl python3 make gcc-c++ kernel-headers
    ;;
  centos|rhel|rocky|alma)
    sudo yum install -y curl python3 make gcc-c++ kernel-headers
    ;;
  arch|manjaro)
    sudo pacman -Sy --noconfirm curl python3 make gcc linux-headers
    ;;
  *)
    echo "Unsupported OS: $OS"
    echo "Please manually install: Node.js 22, Python 3, make, g++, linux-headers"
    exit 1
    ;;
esac

# Install Node.js 22 if not present or wrong version
NEED_NODE=false
if ! command -v node &> /dev/null; then
  NEED_NODE=true
elif [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 22 ]; then
  echo "Node.js $(node -v) found, but version 22+ is required."
  NEED_NODE=true
fi

if [ "$NEED_NODE" = true ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  case "$OS" in
    ubuntu|debian)
      sudo apt-get install -y nodejs
      ;;
    fedora)
      sudo dnf install -y nodejs
      ;;
    centos|rhel|rocky|alma)
      sudo yum install -y nodejs
      ;;
    alpine)
      sudo apk add --no-cache nodejs npm
      ;;
    arch|manjaro)
      sudo pacman -Sy --noconfirm nodejs npm
      ;;
  esac
fi

echo "Node.js $(node -v) installed."

# Navigate to server directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Install npm dependencies
echo "Installing npm dependencies..."
npm install

# Generate .env file
if [ -f .env ]; then
  echo ""
  echo ".env file already exists. Overwrite? (y/N)"
  read -r OVERWRITE
  if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
    echo "Keeping existing .env file."
    SKIP_ENV=true
  fi
fi

if [ "$SKIP_ENV" != "true" ]; then
  echo ""
  echo "--- Server Configuration ---"
  echo ""

  # Port
  read -r -p "Server port [3000]: " PORT
  PORT=${PORT:-3000}

  # Encryption key
  ENCRYPTION_KEY=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)

  # Salt rounds
  read -r -p "Bcrypt salt rounds [12]: " SALT
  SALT=${SALT:-12}

  # Announced IP
  echo ""
  echo "Detecting public IP..."
  PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "")
  if [ -n "$PUBLIC_IP" ]; then
    echo "Detected public IP: $PUBLIC_IP"
    read -r -p "ANNOUNCED_IP [$PUBLIC_IP]: " ANNOUNCED_IP
    ANNOUNCED_IP=${ANNOUNCED_IP:-$PUBLIC_IP}
  else
    echo "Could not detect public IP."
    read -r -p "ANNOUNCED_IP (your server's public IP): " ANNOUNCED_IP
  fi

  cat > .env << EOF
PORT=$PORT
ENCRYPTION_KEY=$ENCRYPTION_KEY
SALT=$SALT
ANNOUNCED_IP=$ANNOUNCED_IP
EOF

  echo ".env file created."
fi

# Build TypeScript
echo "Building server..."
npm run build

# Configure firewall
echo ""
echo "--- Firewall Configuration ---"
echo ""

PORT_VAL=${PORT:-$(grep "^PORT=" .env | cut -d'=' -f2)}
PORT_VAL=${PORT_VAL:-3000}

if command -v ufw &> /dev/null; then
  echo "Configuring UFW firewall..."
  sudo ufw allow "$PORT_VAL"/tcp comment "RipV2 server"
  sudo ufw allow 10000:10100/udp comment "RipV2 mediasoup WebRTC"
  sudo ufw --force enable
  echo "Firewall rules added."
elif command -v firewall-cmd &> /dev/null; then
  echo "Configuring firewalld..."
  sudo firewall-cmd --permanent --add-port="$PORT_VAL"/tcp
  sudo firewall-cmd --permanent --add-port=10000-10100/udp
  sudo firewall-cmd --reload
  echo "Firewall rules added."
else
  echo "No supported firewall found. Please manually open these ports:"
  echo "  TCP: $PORT_VAL"
  echo "  UDP: 10000-10100"
fi

echo ""
echo "========================================="
echo "  Setup complete!"
echo "========================================="
echo ""
echo "Start the server with:"
echo "  cd $SCRIPT_DIR"
echo "  npm run serve"
echo ""
echo "Or for development:"
echo "  npm start"
echo ""
