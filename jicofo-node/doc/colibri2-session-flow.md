# Colibri2 Session Management: High-Level Flow

```mermaid
flowchart TD
    subgraph Conference
        A[Participant joins] --> B[Allocate Colibri2 session]
        B --> C{BridgeSelector selects bridge}
        C -->|Bridge exists| D[Get or create Colibri2Session]
        C -->|No bridge| E[Fail allocation]
        D --> F[Send allocation request to bridge]
        F --> G[Bridge responds with session info]
        G --> H[Session added to active sessions]
        H --> I[Participant mapped to session]
        I --> J[Conference state updated]
    end
    
    subgraph Session Management
        H --> K[Multiple sessions?]
        K -->|Yes| L[Octo/mesh logic: create relays between sessions]
        K -->|No| M[Single bridge, no relays]
        L --> N[Relay allocation requests]
        N --> O[Relay responses update session state]
    end
    
    subgraph Failure Handling
        F -->|Error| P[Bridge marked non-operational]
        P --> Q[Try another bridge or fail]
        G -->|Error| R[Session/endpoint failed]
        R --> S[Remove session, re-invite participant]
    end
    
    subgraph Expiry
        J --> T[Expire session on participant leave or conference end]
        T --> U[Send expire request to bridge]
        U --> V[Session removed from active sessions]
    end
```

---

## Explanatory Flow

### Conference Flow
- **Participant joins**
- **Allocate Colibri2 session**
- **BridgeSelector selects a bridge**
  - If a bridge is available: get or create a Colibri2Session
  - If no bridge: fail allocation
- **Send allocation request to bridge**
- **Bridge responds with session info**
- **Session is added to active sessions**
- **Participant is mapped to the session**
- **Conference state is updated**

### Session Management
- If multiple sessions exist (multi-bridge/Octo): create relays between sessions (mesh logic)
- Relay allocation requests are sent
- Relay responses update session state

### Failure Handling
- If allocation request errors: bridge is marked non-operational, try another bridge or fail
- If bridge/session/endpoint fails: remove session, re-invite participant

### Expiry
- On participant leave or conference end: expire session
- Send expire request to bridge
- Session is removed from active sessions 