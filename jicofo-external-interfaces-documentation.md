# Jicofo External Interfaces Documentation

This document provides comprehensive documentation for all external interfaces that Jicofo (Jitsi Conference Focus) exposes to external systems through HTTP and TCP/IP protocols.

## Overview

Jicofo serves as the server-side focus component that manages video conferences in Jitsi Meet. It exposes several external interfaces for:
- REST API for management and monitoring
- XMPP connections for real-time communication
- Health checks and metrics endpoints
- Administrative operations

## HTTP REST API Interfaces

### Base Configuration

- **Default Host**: `0.0.0.0` (configurable via `jicofo.rest.host`)
- **Default Port**: `8888` (configurable via `jicofo.rest.port`)
- **Protocol**: HTTP
- **Content-Type**: `application/json` for most endpoints
- **Base URL**: `http://<host>:8888`

### 1. Metrics Endpoint

**Endpoint**: `GET /metrics`

**Purpose**: Prometheus-style metrics for monitoring and observability

**Configuration**: `jicofo.rest.prometheus.enabled = true`

**Response Format**: Prometheus metrics format or JSON (based on Accept header)

**Example Request**:
```bash
curl -H "Accept: application/json" http://localhost:8888/metrics
```

**Metrics Include**:
- Conference statistics (active conferences, participants)
- Bridge connection metrics  
- Authentication metrics
- JVM metrics (threads, memory)
- Health status indicators

---

### 2. Health Check Endpoint

**Endpoint**: `GET /about/health`

**Purpose**: Health status monitoring for load balancers and monitoring systems

**Response Codes**:
- `200 OK`: Jicofo is healthy and operational
- `503 Service Unavailable`: Jicofo is initializing or in transitional state
- `500 Internal Server Error`: Jicofo detected unhealthy state
- No response: Deadlock or severe malfunction

**Health Check Process**:
1. Verifies operational bridges are available
2. Creates test conference to validate functionality
3. Tests XMPP connectivity with ping requests
4. Validates core services are responsive

**Example Request**:
```bash
curl http://localhost:8888/about/health
```

---

### 3. Version Information

**Endpoint**: `GET /about/version`

**Purpose**: Retrieve version and system information

**Response**:
```json
{
  "name": "Jicofo",
  "version": "1.0-SNAPSHOT",
  "os": "Linux"
}
```

---

### 4. Conference Request API

**Endpoint**: `POST /conference-request/v1`

**Purpose**: Programmatic conference creation and management

**Configuration**: `jicofo.rest.conference-request.enabled = true`

**Request Body**:
```json
{
  "room": "room@conference.example.com",
  "properties": {
    "key": "value"
  }
}
```

**Response**: Conference IQ response with session details

**CORS Support**: `OPTIONS /conference-request/v1` available

---

### 5. Move Endpoints API

**Configuration**: `jicofo.rest.move-endpoints.enabled = true`

#### 5.1 Move Single Endpoint
**Endpoint**: `GET /move-endpoints/move-endpoint`

**Parameters**:
- `conference`: Conference JID (e.g., `room@conference.example.com`)
- `endpoint`: Endpoint ID to move
- `bridge`: Optional bridge JID to move from

**Response**:
```json
{
  "movedEndpoints": 1,
  "conferences": 1
}
```

#### 5.2 Move Multiple Endpoints
**Endpoint**: `GET /move-endpoints/move-endpoints`

**Parameters**:
- `bridge`: Bridge JID to move endpoints from
- `conference`: Optional conference JID filter
- `numEndpoints`: Number of endpoints to move (default: 1)

#### 5.3 Move Fraction of Endpoints
**Endpoint**: `GET /move-endpoints/move-fraction`

**Parameters**:
- `bridge`: Bridge JID to move endpoints from
- `fraction`: Fraction of endpoints to move (default: 0.1)

---

### 6. Debug API

**Configuration**: `jicofo.rest.debug.enabled = true`

#### 6.1 Global Debug State
**Endpoint**: `GET /debug`

**Parameters**:
- `full`: Set to "true" for detailed debug information

#### 6.2 Conference List
**Endpoint**: `GET /debug/conferences`

**Response**: Array of active conference JIDs

#### 6.3 Full Conference Details
**Endpoint**: `GET /debug/conferences-full`

**Response**: Detailed state of all conferences

#### 6.4 Specific Conference Debug
**Endpoint**: `GET /debug/conference/{conferenceJid}`

**Response**: Detailed debug state for specific conference

#### 6.5 XMPP Capabilities
**Endpoint**: `GET /debug/xmpp-caps`

**Response**: XMPP capabilities statistics

---

### 7. Pin API

**Configuration**: `jicofo.rest.pin.enabled = true`

**Purpose**: Pin conferences to specific bridge versions

#### 7.1 List Pinned Conferences
**Endpoint**: `GET /pin`

#### 7.2 Pin Conference
**Endpoint**: `POST /pin`

**Request Body**:
```json
{
  "conferenceId": "room@conference.example.com",
  "jvbVersion": "2.1.123",
  "durationMinutes": 60
}
```

#### 7.3 Unpin Conference
**Endpoint**: `POST /pin/remove`

**Request Body**:
```json
{
  "conferenceId": "room@conference.example.com"
}
```

---

### 8. Statistics Endpoint

**Endpoint**: `GET /stats`

**Purpose**: Retrieve comprehensive statistics

**Response**: JSON object with:
- Active participants and conferences
- Bridge statistics
- Jibri recording/streaming statistics
- Performance metrics

---

### 9. RTC Stats Endpoint

**Endpoint**: `GET /rtcstats`

**Purpose**: Real-time communication statistics for analytics

**Response**: Per-conference RTC statistics by meeting ID

---

## XMPP Interfaces

### 1. Client Connection

**Purpose**: Communication with conference participants and clients

**Default Configuration**:
- **Host**: `localhost`
- **Port**: `5222` (XMPP client-to-server)
- **Domain**: Configurable (`jicofo.xmpp.client.domain`)
- **Username**: `focus`
- **Resource**: `focus`
- **TLS**: Enabled by default (`jicofo.xmpp.client.use-tls = true`)

**Connection String**: `focus@domain/focus`

**Services**:
- Conference IQ handling
- Jingle session management
- MUC (Multi-User Chat) participation
- Presence management

### 2. Service Connection

**Purpose**: Communication with internal services (bridges, Jibri, etc.)

**Default Configuration**:
- **Host**: `localhost`
- **Port**: `6222` (XMPP service connection)
- **Domain**: Configurable (`jicofo.xmpp.service.domain`)
- **Username**: `focus`
- **TLS**: Enabled by default (`jicofo.xmpp.service.use-tls = true`)

**Services**:
- Bridge discovery and communication
- Jibri/Jigasi brewery rooms
- Service health monitoring

### 3. Visitor Connections

**Purpose**: Separate XMPP environments for visitor nodes

**Configuration**: Multiple visitor nodes under `jicofo.xmpp.visitors`

**Example Configuration**:
```hocon
visitors {
  v1 {
    enabled = true
    conference-service = "conference.v1.example.com"
    hostname = "127.0.0.1"
    domain = "auth.v1.example.com"
    port = 7222
    password = "changeme"
    xmpp-domain = "v1.example.com"
  }
}
```

### Key XMPP Configuration Parameters

- **Reply Timeout**: 15 seconds (configurable)
- **Certificate Verification**: Enabled by default
- **Trusted Domains**: Configurable list for service authentication
- **Conference MUC JID**: Domain for conference rooms
- **Client Proxy Support**: Optional client proxy JID configuration

---

## TCP/IP Port Summary

| Port | Protocol | Purpose | Default Config |
|------|----------|---------|----------------|
| 8888 | HTTP | REST API, Health checks, Metrics | `jicofo.rest.port` |
| 5222 | XMPP | Client connections | `jicofo.xmpp.client.port` |
| 6222 | XMPP | Service connections | `jicofo.xmpp.service.port` |
| Custom | XMPP | Visitor node connections | `jicofo.xmpp.visitors.*.port` |

---

## Security Considerations

### Authentication
- XMPP connections support various authentication methods:
  - XMPP domain authentication
  - External JWT authentication
  - Component authentication for services

### TLS/Encryption
- XMPP connections use TLS by default
- Certificate verification enabled by default
- Can be disabled for local/testing environments

### Access Control
- REST API endpoints can be individually enabled/disabled
- Trusted domains list for service authentication
- Optional client proxy support for user authentication

---

## Monitoring and Observability

### Health Monitoring
- Health check endpoint performs comprehensive system validation
- Includes bridge connectivity, XMPP ping tests, and conference creation
- Suitable for load balancer health checks

### Metrics Collection
- Prometheus-compatible metrics endpoint
- Real-time statistics via `/stats` endpoint
- Debug information via `/debug` endpoints
- XMPP capabilities tracking

### Logging
- XMPP packet logging (optional)
- Syslog support (configurable)
- Structured logging with contextual information

---

## Configuration Management

### Primary Configuration
- Main configuration in HOCON format (`reference.conf`)
- System properties override (`-Dconfig.file=path`)
- Environment-specific configurations

### Runtime Configuration
- Most settings require restart to take effect
- Some debug settings can be modified at runtime
- Pin operations are runtime-configurable

---

## Integration Examples

### Load Balancer Health Check
```bash
# Simple health check
curl -f http://jicofo:8888/about/health

# Health check with timeout
curl -f --max-time 10 http://jicofo:8888/about/health
```

### Prometheus Monitoring
```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'jicofo'
    static_configs:
      - targets: ['jicofo:8888']
    metrics_path: '/metrics'
    scrape_interval: 30s
```

### Conference Management
```bash
# Create conference via API
curl -X POST http://jicofo:8888/conference-request/v1 \
  -H "Content-Type: application/json" \
  -d '{"room": "test@conference.example.com"}'

# Move endpoint between bridges
curl "http://jicofo:8888/move-endpoints/move-endpoint?conference=test@conference.example.com&endpoint=abc123&bridge=jvb1"
```

This documentation covers all the primary external interfaces that jicofo exposes. The interfaces are designed for monitoring, management, and integration with other Jitsi Meet components and external systems.