#!/bin/bash
node_modules/.bin/playwright install chromium chromium-headless-shell --quiet 2>/dev/null
node ./dist/index.cjs
