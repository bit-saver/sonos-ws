# Multi-Connection Speaker Sockets

## Problem

`SonosHousehold` opens one WebSocket to one speaker (the Arc). The Sonos API requires volume and playback commands to go through the target speaker's own WebSocket. Commands targeting remote speakers fail with `ERROR_INVALID_OBJECT_ID`. This prevents per-speaker volume control and playback management for any speaker other than the one connected to.

## Solution

Maintain a `SonosConnection` per speaker, created lazily on first use. The primary connection (to the configured host) handles topology discovery, group management, and event subscriptions. Each speaker gets its own connection for volume and playback commands.

## Architecture

```
SonosHousehold
  └─ primaryConnection (Arc) — topology, group mgmt, events
  └─ speakerConnections: Map<playerId, SonosConnection>
       ├─ Arc → reuses primaryConnection
       ├─ Bedroom → lazy, created on first command
       └─ Office → lazy, created on first command
  └─ PlayerHandle[]
       └─ volume/playback namespaces use speaker's own connection
       └─ groups namespace uses primaryConnection
```

## Key Decisions

### Connect all speakers at startup
After the primary connection discovers topology, `SonosHousehold.connect()` opens connections to all discovered speakers in parallel. Every speaker is ready for commands immediately — no lazy setup, no first-command delays.

### Arc reuses primary
The speaker matching the configured host reuses the primary connection. No duplicate WebSocket to the same speaker.

### WebSocket URLs from topology
`getGroups()` returns each player's `websocketUrl` (e.g. `wss://192.168.68.90:1443/websocket/api`). No hardcoded IPs needed beyond the initial host. The connection manager resolves the URL from the player's topology data.

### Group management stays on primary
`createGroup`, `modifyGroupMembers`, `getGroups` work from any connection. The `GroupingEngine` and `householdGroups` namespace continue to use the primary connection. Only volume/playback need per-speaker connections.

### Events stay on primary
Topology events (`coordinatorChanged`, subscription pushes) are only subscribed on the primary connection. No need to listen on every connection.

### Connection lifecycle
Speaker connections stay open once created. They use the same `SonosConnection` class with reconnection logic. On `household.disconnect()`, all connections close.

## Implementation

### New: ConnectionManager (private to SonosHousehold)

Manages the pool of speaker connections. Simple enough to be inline in `SonosHousehold` rather than a separate class.

```typescript
// In SonosHousehold
private readonly speakerConnections = new Map<string, SonosConnection>();

async getConnectionForPlayer(playerId: string): Promise<SonosConnection> {
  // If this is the primary speaker, return the primary connection
  if (this.isPrimaryPlayer(playerId)) return this.connection;

  // Return existing connection or create new one
  const existing = this.speakerConnections.get(playerId);
  if (existing && existing.state === 'connected') return existing;

  // Get the speaker's WebSocket URL from topology
  const player = this._rawPlayers.find(p => p.id === playerId);
  if (!player?.websocketUrl) {
    throw new SonosError(PLAYER_NOT_FOUND, `No WebSocket URL for player ${playerId}`);
  }

  // Parse host from URL and create connection
  const url = new URL(player.websocketUrl);
  const conn = new SonosConnection({
    host: url.hostname,
    port: parseInt(url.port) || 1443,
    reconnect: this.reconnectOptions,
    requestTimeout: this.requestTimeout,
    logger: this.log,
  });

  await conn.connect();
  this.speakerConnections.set(playerId, conn);
  return conn;
}

private isPrimaryPlayer(playerId: string): boolean {
  // Match by checking if this player's websocketUrl points to our primary host
  const player = this._rawPlayers.find(p => p.id === playerId);
  if (!player?.websocketUrl) return false;
  const url = new URL(player.websocketUrl);
  return url.hostname === this.primaryHost;
}
```

### Modified: PlayerHandle construction

Currently all handles receive the same connection:

```typescript
// Before
new PlayerHandle(player, group, householdId, this.connection);
```

Change to provide a connection resolver instead of a static connection:

```typescript
// After — two connections: one for speaker commands, one for group commands
new PlayerHandle(player, group, householdId, {
  speaker: () => this.getConnectionForPlayer(player.id),
  groups: this.connection,  // primary, for group management
});
```

### Modified: PlayerHandle

`PlayerHandle` currently takes a single `SonosConnection` and creates one `NamespaceContext`. Change to take a connection resolver for volume/playback (which may need a lazy connection) and a static connection for groups.

```typescript
class PlayerHandle {
  constructor(
    player: Player,
    group: Group,
    householdId: string,
    connections: {
      speaker: () => Promise<SonosConnection>;  // lazy, per-speaker
      groups: SonosConnection;                    // primary, for group ops
    },
  ) {
    // Volume, playback, etc. use the speaker connection
    const speakerContext: NamespaceContext = {
      connection: null!,  // resolved lazily
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    // Groups namespace uses primary connection
    const groupsContext: NamespaceContext = {
      connection: connections.groups,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    // ...
  }
}
```

The challenge: `NamespaceContext.connection` is read synchronously in `BaseNamespace.send()`, but the speaker connection is created lazily (async). Two options:

**Option A: Resolve connection in PlayerHandle and cache it.** First volume/playback command triggers connection, subsequent ones use the cached connection. Requires making namespace `send()` async-aware of connection resolution.

**Option B: Change `NamespaceContext.connection` to a getter/resolver.** `BaseNamespace.send()` already awaits the result — just make the connection lookup async.

**Recommended: Option A** — resolve in PlayerHandle, cache the connection. The `NamespaceContext` stays simple (just a `SonosConnection` reference). The PlayerHandle resolves it before passing to the context.

Since connection is lazy, the handle starts with the primary connection (which works for group operations). On first volume/playback command, the handle detects it needs the speaker connection and resolves it.

Actually, the simplest approach: **resolve at handle creation time in `refreshTopology()`**. When `refreshTopology()` creates or updates handles, it can check if a speaker connection already exists and use it, otherwise default to the primary connection. The first volume command that fails with `ERROR_INVALID_OBJECT_ID` triggers a connection upgrade.

**Simplest approach: Two NamespaceContexts per handle.**

```typescript
// Groups context — always uses primary connection
this.groups = new GroupsNamespace(groupsContext);

// Speaker context — uses speaker connection (or primary if same speaker)
this.volume = new VolumeControl(speakerContext);
this.playback = new PlaybackControl(speakerContext);
// ... etc
```

The speaker context starts with the primary connection. `SonosHousehold` upgrades it when the speaker connection is established by calling a new `handle.setConnection(conn)` method that updates the context's connection reference.

### Modified: SonosHousehold.refreshTopology()

After updating handles, establish speaker connections for any handles that don't have one yet. Or do it lazily — only when a command fails.

### Modified: SonosHousehold.disconnect()

Close all speaker connections in addition to the primary:

```typescript
async disconnect(): Promise<void> {
  for (const conn of this.speakerConnections.values()) {
    await conn.disconnect();
  }
  this.speakerConnections.clear();
  await this.connection.disconnect();
}
```

## What Doesn't Change

- `SonosConnection` — unchanged
- `GroupingEngine` — unchanged (uses primary connection via `householdGroups`)
- `VolumeControl`, `PlaybackControl`, all wrappers — unchanged (they use `context.connection`)
- `BaseNamespace` — unchanged
- `SonosClient` — unchanged (single-connection convenience API)
- Consumer API — unchanged (`arc.volume.set(50)`, `bed.volume.relative(-3)`)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Speaker WebSocket URL not in topology | Throw `PLAYER_NOT_FOUND` |
| Speaker connection fails | Throw `ConnectionError` — same as primary |
| Speaker connection drops | Auto-reconnect (same SonosConnection logic) |
| `household.disconnect()` | Close all connections (primary + speakers) |

## Verification

1. `arc.volume.relative(5)` — works (uses primary connection, same as before)
2. `bed.volume.relative(-3)` — works (uses Bedroom's connection)
3. `bed.volume.player.set(10)` — works (per-speaker volume on Bedroom)
4. `bed.playback.play()` — works (playback on Bedroom)
5. `off.volume.get()` — works (Office's connection)
6. Group operations still work after speaker connections are established
7. `household.disconnect()` closes all connections

## Scope

**In scope:**
- Per-speaker connections in SonosHousehold
- PlayerHandle with split contexts (speaker vs groups)
- Lazy connection creation
- Connection cleanup on disconnect

**Out of scope:**
- Event subscriptions on per-speaker connections (primary handles all events)
- Connection pooling or limits
