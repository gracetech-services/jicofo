# Jicofo Interfaces Documentation

This document provides comprehensive documentation for all interfaces implemented in the Jicofo (Jitsi Conference Focus) project.

## Overview

Jicofo is the server-side component that manages video conferences in Jitsi Meet. It implements several key interfaces that define contracts for authentication, conference management, session handling, and event listening.

## Core Interfaces

### 1. AuthenticationAuthority

**Location**: `jicofo/src/main/java/org/jitsi/jicofo/auth/AuthenticationAuthority.java`

**Purpose**: Encapsulates authorization methods like XMPP domain authentication.

**Key Methods**:
- `String createLoginUrl(String machineUID, EntityFullJid peerFullJid, EntityBareJid roomName, boolean popup)` - Creates the URL for user login
- `IQ processAuthentication(ConferenceIq query, ConferenceIq response)` - Processes authentication queries and verifies user sessions
- `IQ processLogoutIq(LogoutIq iq)` - Handles logout requests and destroys authentication sessions
- `void addAuthenticationListener(AuthenticationListener l)` - Registers authentication listeners
- `void removeAuthenticationListener(AuthenticationListener l)` - Unregisters authentication listeners
- `String getSessionForJid(Jid jabberId)` - Returns authentication session ID for a given JID
- `String getUserIdentity(Jid jabberId)` - Returns user login associated with a JID
- `boolean isExternal()` - Indicates if this is an external authentication method
- `void start()` - Starts the authentication authority
- `void shutdown()` - Shuts down the authentication authority

**Implementations**:
- `AbstractAuthAuthority` - Base implementation that also implements `ConferenceStore.Listener`

### 2. AuthenticationListener

**Location**: `jicofo/src/main/java/org/jitsi/jicofo/auth/AuthenticationListener.java`

**Purpose**: Listens to authentication notifications fired by AuthenticationAuthority.

**Key Methods**:
- `void jidAuthenticated(Jid userJid, String authenticatedIdentity, String sessionId)` - Called when a user gets confirmed identity by external authentication

**Usage**: Used by components that need to be notified when authentication events occur.

### 3. JitsiMeetConference

**Location**: `jicofo/src/main/java/org/jitsi/jicofo/conference/JitsiMeetConference.java`

**Purpose**: Main conference interface extracted from JitsiMeetConferenceImpl. Defines the contract for conference management operations.

**Extends**: `XmppProvider.Listener`

**Key Methods**:

#### Conference Information
- `int getParticipantCount()` - Returns the number of participants including visitors
- `EntityBareJid getMainRoomJid()` - Returns JID of the main room for breakout rooms
- `List<EntityBareJid> getVisitorRoomsJids()` - Returns JIDs of connected visitor rooms
- `long getVisitorCount()` - Returns the number of visitors in the conference
- `String getMeetingId()` - Returns the meeting ID associated with the conference
- `EntityBareJid getRoomName()` - Returns the conference room name
- `ChatRoom getChatRoom()` - Returns the ChatRoom instance for the MUC

#### Participant Management
- `Participant getParticipant(Jid mucJid)` - Finds participant by MUC JID
- `MemberRole getRoleForMucJid(Jid jid)` - Gets the role of a member in the conference
- `void muteAllParticipants(MediaType mediaType)` - Mutes all participants for a specific media type
- `MuteResult handleMuteRequest(Jid muterJid, Jid toBeMutedJid, boolean doMute, MediaType mediaType)` - Handles mute/unmute requests

#### Bridge and Session Management
- `Set<String> getBridgeRegions()` - Returns regions of bridges currently in the conference
- `Map<Bridge, ConferenceBridgeProperties> getBridges()` - Returns information about bridges used by the conference
- `boolean moveEndpoint(String endpointId, Bridge bridge)` - Moves an endpoint to a specific bridge
- `int moveEndpoints(Bridge bridge, int numEps)` - Moves multiple endpoints from a bridge

#### Recording and Integration
- `JibriRecorder getJibriRecorder()` - Returns the Jibri recorder instance
- `JibriSipGateway getJibriSipGateway()` - Returns the Jibri SIP gateway instance
- `IqProcessingResult handleJibriRequest(IqRequest<JibriIq> request)` - Processes Jibri-related IQ requests
- `boolean acceptJigasiRequest(Jid from)` - Determines if a user can invite Jigasi to the conference

#### Configuration and State
- `void mucConfigurationChanged()` - Notifies that the main MUC configuration changed
- `boolean isRtcStatsEnabled()` - Indicates if stats should be exported to rtcstats
- `boolean includeInStatistics()` - Indicates if conference should be included in statistics
- `OrderedJsonObject getDebugState()` - Returns debug state information
- `OrderedJsonObject getRtcstatsState()` - Returns stats for rtcstats export

**Implementations**:
- `JitsiMeetConferenceImpl` - Main implementation

### 4. JibriSession.StateListener

**Location**: `jicofo/src/main/java/org/jitsi/jicofo/jibri/JibriSession.java` (nested interface)

**Purpose**: Listens to Jibri session state changes. Used by session owners to receive notifications about status updates.

**Key Methods**:
- `void onSessionStateChanged(JibriSession jibriSession, JibriIq.Status newStatus, JibriIq.FailureReason failureReason)` - Called when Jibri session status changes

**Usage**: Passed to JibriSession constructor to receive status change notifications for recording and streaming sessions.

### 5. JitsiMeetConferenceImpl.ConferenceListener

**Location**: `jicofo/src/main/java/org/jitsi/jicofo/conference/JitsiMeetConferenceImpl.java` (nested interface)

**Purpose**: Listens for conference lifecycle events.

**Key Methods**:
- `void conferenceEnded(JitsiMeetConferenceImpl conference)` - Called when a conference has ended

**Usage**: Used by conference managers to receive notifications when conferences terminate.

## Abstract Base Classes

### BaseBrewery<T extends ExtensionElement>

**Location**: `jicofo-common/src/main/java/org/jitsi/jicofo/xmpp/BaseBrewery.java`

**Purpose**: Manages pools of service instances that exist in the current session by joining "brewery" rooms where instances connect and publish their status.

**Implements**: `XmppProvider.Listener`

**Key Abstract Methods**:
- `void onInstanceStatusChanged(EntityFullJid jid, T status)` - Called when a brewing instance status changes
- `void notifyInstanceOffline(Jid jid)` - Called when a brewing instance goes offline

**Key Concrete Methods**:
- `boolean isAnyInstanceConnected()` - Checks if any service instances are connected
- `void init()` - Initializes the brewery
- `void shutdown()` - Stops and releases resources
- `int getInstanceCount()` - Returns the number of instances
- `void processMemberPresence(ChatRoomMember member)` - Processes member presence changes

## Interface Usage Patterns

### Event-Driven Architecture
Most interfaces in jicofo follow an event-driven pattern where:
- Listener interfaces define callbacks for specific events
- Components register as listeners to receive notifications
- Events are fired when state changes occur

### Service Discovery and Management
The brewery pattern is used extensively for service discovery:
- Services join MUC rooms to advertise their availability
- BaseBrewery manages the lifecycle of these service instances
- Status changes are propagated through presence updates

### Authentication Flow
The authentication system uses a multi-step process:
1. `AuthenticationAuthority.createLoginUrl()` generates login URLs
2. Users authenticate through external systems
3. `AuthenticationAuthority.processAuthentication()` validates sessions
4. `AuthenticationListener.jidAuthenticated()` notifies of successful authentication

### Conference Management
Conference management follows a hierarchical approach:
- `JitsiMeetConference` defines the high-level contract
- `JitsiMeetConferenceImpl` provides the implementation
- Various listener interfaces handle specific aspects (bridges, participants, etc.)

## Key Design Principles

1. **Separation of Concerns**: Each interface has a specific responsibility
2. **Loose Coupling**: Interfaces allow for flexible implementations
3. **Event-Driven**: Extensive use of listener patterns for reactivity
4. **Extensibility**: Abstract base classes enable easy extension
5. **XMPP Integration**: Most interfaces work with XMPP primitives (JIDs, IQs, etc.)

## Dependencies

Many interfaces reference external types from:
- `org.jitsi.utils` - Utility classes and logging
- `org.jitsi.xmpp.extensions` - XMPP extension elements
- `org.jivesoftware.smack` - XMPP client library
- `org.jxmpp.jid` - JID handling utilities

This documentation covers the primary interfaces implemented within the jicofo codebase itself. Additional interfaces may be inherited from external dependencies in the Jitsi ecosystem.