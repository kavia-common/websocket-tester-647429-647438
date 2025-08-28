#!/bin/bash
cd /tmp/kavia/workspace/code-generation/websocket-tester-647429-647438/websocket_tester_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

