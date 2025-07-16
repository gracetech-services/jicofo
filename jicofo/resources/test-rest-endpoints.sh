#!/usr/bin/env bash
# Test Jicofo REST API endpoints using cURL
# Base URL
BASE_URL="http://localhost:8888"

set -e

# Test /about/version
echo "\n==> GET /about/version"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/about/version"

# Test /about/health
echo "\n==> GET /about/health"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/about/health"

# Test /conference-request/v1 (POST)
echo "\n==> POST /conference-request/v1"
curl -s -w "\nHTTP %{http_code}\n" -H "Content-Type: application/json" -X POST \
    -d '{"room": "testroom@example.com", "properties": {"rtcstatsEnabled": true}}' \
    "$BASE_URL/conference-request/v1"

# Test /metrics (Prometheus)
echo "\n==> GET /metrics"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/metrics"

# Test /stats
echo "\n==> GET /stats"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/stats"

# Test /pin (GET)
echo "\n==> GET /pin"
curl -s -w "\nHTTP %{http_code}\n" "$BASE_URL/pin"

# Test /pin (POST)
echo "\n==> POST /pin"
curl -s -w "\nHTTP %{http_code}\n" -H "Content-Type: application/json" -X POST \
    -d '{"conferenceId": "testroom@example.com", "jvbVersion": "1.0.0", "durationMinutes": 10}' \
    "$BASE_URL/pin"

# Test /pin/remove (POST)
echo "\n==> POST /pin/remove"
curl -s -w "\nHTTP %{http_code}\n" -H "Content-Type: application/json" -X POST \
    -d '{"conferenceId": "testroom@example.com"}' \
    "$BASE_URL/pin/remove"

echo "\nAll endpoint tests completed." 