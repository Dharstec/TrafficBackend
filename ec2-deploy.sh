#!/bin/bash
# Run this script on EC2 to pull latest code and rebuild backend
# Usage: bash ec2-deploy.sh

set -e

echo "=== Pulling latest code ==="
git pull origin Gokul

echo "=== Installing dependencies ==="
cd backend
npm install --production

echo "=== Building ==="
node node_modules/typescript/bin/tsc --project tsconfig.json

echo "=== Restarting service ==="
if command -v pm2 &> /dev/null; then
  pm2 restart traffic-backend || pm2 start dist/main.js --name traffic-backend
  pm2 save
else
  echo "PM2 not found. Run: npm i -g pm2 && pm2 start dist/main.js --name traffic-backend"
fi

echo "=== Done! Backend is running. ==="
