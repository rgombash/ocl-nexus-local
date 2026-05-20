#!/bin/bash
# OCL Nexus Standard Entrypoint

CODE_DIR="/app"
START_SCRIPT="$CODE_DIR/nexus-start.sh"

# Ensure we are in the code directory
cd "$CODE_DIR" || exit 1

if [ -f "$START_SCRIPT" ]; then
  echo "🚀 Nexus: Found $START_SCRIPT. Executing user start script..."
  # Ensure the user script is executable
  chmod +x "$START_SCRIPT"
  # Use exec to replace the shell with the user script (preserves PID 1)
  exec "$START_SCRIPT"
else
  echo "💤 Nexus: No start script found at $START_SCRIPT. Entering Idle Mode..."
  # Keep container alive for API-driven execution and file shipment
  exec tail -f /dev/null
fi
