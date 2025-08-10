#!/bin/bash

# Field Notes Data Synchronization Scripts
# Usage: ./data-sync.sh [export|import|import-merge]

case "$1" in
  export)
    echo "🚀 Exporting field notes data..."
    node scripts/export-data.js
    ;;
  import)
    echo "📥 Importing field notes data (replace mode)..."
    node scripts/import-data.js
    ;;
  import-merge)
    echo "🔄 Importing field notes data (merge mode)..."
    node scripts/import-data.js --merge
    ;;
  *)
    echo "Usage: $0 {export|import|import-merge}"
    echo ""
    echo "Commands:"
    echo "  export       - Export all data to data-export.json"
    echo "  import       - Import data (replaces existing data)"
    echo "  import-merge - Import data (merges with existing data)"
    exit 1
    ;;
esac