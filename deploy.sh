#!/usr/bin/env bash
# Deploy Spesenhelfer to production (https://platform.alphatransition.com/spesen/)
set -e
cd "$(dirname "$0")/frontend"

VITE_BASE_PATH="/spesen/" \
VITE_API_BASE_URL="https://platform.alphatransition.com/spesen" \
VITE_AZURE_CLIENT_ID="d3480cbe-dba4-43cc-af89-c3cbce50c9f6" \
VITE_AZURE_TENANT_ID="42c35b5f-5f35-4903-9227-3b085998bd1f" \
npm run build

scp -i ~/.ssh/wsai_deploy_key -r dist/* root@188.245.191.188:/var/www/spesen/
echo "Deployed."
