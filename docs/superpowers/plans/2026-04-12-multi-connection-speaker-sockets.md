# Multi-Connection Speaker Sockets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a WebSocket connection to each Sonos speaker so volume and playback commands work on every speaker, not just the one SonosHousehold connected to.

**Architecture:** PlayerHandle gets split contexts — a per-speaker `SonosConnection` for volume/playback/metadata commands, and the primary connection for group management. SonosHousehold manages the connection pool, connecting to all speakers after topology discovery.

**Tech Stack:** TypeScript, tsup (build), vitest (tests), Node.js ws library

**Spec:** `docs/superpowers/specs/2026-04-12-multi-connection-speaker-sockets.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/player/PlayerHandle.ts` | Split into speaker + groups contexts | Modify |
| `src/household/SonosHousehold.ts` | Manage connection pool, connect all speakers | Modify |
| `src/index.ts` | No changes needed | — |
| `tests/player/PlayerHandle.test.ts` | Update for dual-connection constructor | Modify |
| `tests/household/SonosHousehold.test.ts` | Update for connection pool | Modify |

---

### Task 1: Modify PlayerHandle to Accept Dual Connections

**Files:**
- Modify: `src/player/PlayerHandle.ts`
- Modify: `tests/player/PlayerHandle.test.ts`

PlayerHandle currently takes a single `SonosConnection`. Change it to accept two: one for speaker-specific commands (volume, playback, etc.) and one for group management.

- [ ] **Step 1: Update PlayerHandle constructor**

In `src/player/PlayerHandle.ts`, change the constructor signature and create two contexts:

```typescript
export class PlayerHandle {
  // ... existing fields ...

  constructor(
    player: Player,
    group: Group,
    householdId: string,
    speakerConnection: SonosConnection,
    groupsConnection: SonosConnection,
  ) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;

    // Speaker context — for volume, playback, metadata, favorites, etc.
    // Uses the connection to this specific speaker's WebSocket.
    const speakerContext: NamespaceContext = {
      connection: speakerConnection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    // Groups context — for group management operations.
    // Uses the primary connection (group commands work from any speaker).
    const groupsContext: NamespaceContext = {
      connection: groupsConnection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.volume = new VolumeControl(speakerContext);
    this.playback = new PlaybackControl(speakerContext);
    this.favorites = new FavoritesAccess(speakerContext);
    this.playlists = new PlaylistsAccess(speakerContext);
    this.audioClip = new AudioClipControl(speakerContext);
    this.homeTheater = new HomeTheaterControl(speakerContext);
    this.settings = new SettingsControl(speakerContext);
    this.groups = new GroupsNamespace(groupsContext);
  }

  // ... rest unchanged ...
}
```

- [ ] **Step 2: Update PlayerHandle tests**

In `tests/player/PlayerHandle.test.ts`, update `mockConnection()` calls to pass two connections. For tests that don't care about the distinction, pass the same mock twice:

Every `new PlayerHandle(player, group, 'HH_1', mockConnection())` becomes `new PlayerHandle(player, group, 'HH_1', mockConnection(), mockConnection())`.

Update the test that checks `volume.set sends command with correct groupId` to verify it uses the first connection (speaker), not the second (groups).

Add a new test:

```typescript
it('groups namespace uses the groups connection, not the speaker connection', () => {
  const speakerConn = mockConnection();
  const groupsConn = mockConnection();
  const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', speakerConn, groupsConn);

  // volume should use speaker connection
  handle.volume.set(50);
  expect((speakerConn.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  expect((groupsConn.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
});
```

- [ ] **Step 3: Run tests — expect failures in SonosHousehold tests**

Run: `npx vitest run tests/player/`
Expected: Player tests pass. SonosHousehold tests will fail (they create PlayerHandle with old 4-arg constructor) — that's fixed in Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/player/PlayerHandle.ts tests/player/PlayerHandle.test.ts
git commit -m "feat: PlayerHandle accepts dual connections (speaker + groups)"
```

---

### Task 2: Add Connection Pool to SonosHousehold

**Files:**
- Modify: `src/household/SonosHousehold.ts`
- Modify: `tests/household/SonosHousehold.test.ts`

SonosHousehold manages a pool of per-speaker connections. After topology discovery, it connects to all speakers in parallel.

- [ ] **Step 1: Add connection pool and helper methods**

In `src/household/SonosHousehold.ts`, add after the existing fields:

```typescript
  /** Per-speaker WebSocket connections. Key is player ID. */
  private readonly speakerConnections = new Map<string, SonosConnection>();
  private readonly primaryHost: string;
  private readonly reconnectOptions: ReconnectOptions;
  private readonly requestTimeoutMs: number;
```

Add `autoConnect` to the options interface (in the file, alongside the existing `SonosHouseholdOptions`):

```typescript
export interface SonosHouseholdOptions {
  host: string;
  port?: number;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
  /** Connect to all speakers at startup. @defaultValue true */
  autoConnect?: boolean;
}
```

Save options in the constructor:

```typescript
  constructor(options: SonosHouseholdOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.primaryHost = options.host;
    this.reconnectOptions = resolveReconnectOptions(options.reconnect);
    this.requestTimeoutMs = options.requestTimeout ?? 120000;
    this.autoConnectSpeakers = options.autoConnect ?? true;

    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });
    // ... rest unchanged ...
  }
```

Add helper method:

```typescript
  /**
   * Gets or creates a connection to a specific speaker.
   * Returns the primary connection if the speaker is the primary host.
   */
  private async connectToSpeaker(player: Player): Promise<SonosConnection> {
    // If this speaker is the primary host, reuse the primary connection
    if (player.websocketUrl) {
      try {
        const url = new URL(player.websocketUrl);
        if (url.hostname === this.primaryHost) {
          return this.connection;
        }
      } catch { /* fall through to create new connection */ }
    }

    // Return existing connection if already connected
    const existing = this.speakerConnections.get(player.id);
    if (existing && existing.state === 'connected') {
      return existing;
    }

    // Parse host from the player's WebSocket URL
    if (!player.websocketUrl) {
      this.log.warn(`No websocketUrl for player ${player.name} — using primary connection`);
      return this.connection;
    }

    const url = new URL(player.websocketUrl);
    const conn = new SonosConnection({
      host: url.hostname,
      port: parseInt(url.port) || 1443,
      reconnect: this.reconnectOptions,
      requestTimeout: this.requestTimeoutMs,
      logger: this.log,
    });

    await conn.connect();
    this.speakerConnections.set(player.id, conn);
    this.log.info(`Connected to ${player.name} at ${url.hostname}`);
    return conn;
  }
```

- [ ] **Step 2: Connect to all speakers after topology discovery**

In `connect()`, after `refreshTopology()`, connect to all discovered speakers:

```typescript
  async connect(): Promise<void> {
    this._initialConnectDone = false;

    this.connection.on('connected', () => this.handleReconnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));

    await this.connection.connect();
    await this.discoverHouseholdId();
    await this.refreshTopology();
    if (this.autoConnectSpeakers) {
      await this.connectAllSpeakers();
    }
    this._initialConnectDone = true;
  }

  /**
   * Opens connections to all discovered speakers in parallel.
   * The primary speaker reuses the existing connection.
   */
  private async connectAllSpeakers(): Promise<void> {
    const promises = this._rawPlayers.map(async (player) => {
      try {
        const conn = await this.connectToSpeaker(player);
        // Update the player handle to use its own speaker connection
        const handle = this._players.get(player.id);
        if (handle) {
          handle.setSpeakerConnection(conn);
        }
      } catch (err) {
        this.log.warn(`Failed to connect to ${player.name}:`, err);
      }
    });
    await Promise.all(promises);
  }
```

- [ ] **Step 3: Update refreshTopology to pass both connections when creating handles**

In `refreshTopology()`, change the PlayerHandle creation:

```typescript
    // Create or update player handles
    for (const player of result.players) {
      const group = result.groups.find((g) => g.playerIds.includes(player.id));
      if (!group) continue;

      const existing = this._players.get(player.id);
      if (existing) {
        existing.updateGroup(group);
      } else {
        // New handle — use primary connection for both initially.
        // Speaker connection gets upgraded in connectAllSpeakers().
        this._players.set(
          player.id,
          new PlayerHandle(player, group, householdId, this.connection, this.connection),
        );
      }
    }
```

- [ ] **Step 4: Add setSpeakerConnection to PlayerHandle**

In `src/player/PlayerHandle.ts`, add a method to upgrade the speaker connection after the handle is created. This requires storing the speaker context so it can be updated:

```typescript
  private _speakerConnection: SonosConnection;

  constructor(
    player: Player,
    group: Group,
    householdId: string,
    speakerConnection: SonosConnection,
    groupsConnection: SonosConnection,
  ) {
    // ... existing setup ...
    this._speakerConnection = speakerConnection;
    // ... rest ...
  }

  /**
   * Updates the speaker connection for this handle.
   * Called by SonosHousehold after establishing per-speaker connections.
   * @internal
   */
  setSpeakerConnection(connection: SonosConnection): void {
    this._speakerConnection = connection;
  }
```

But the `NamespaceContext` already captured the old connection in a closure. To make this work, the speaker context needs to read from a mutable reference. Change the speaker context to use a getter:

```typescript
    const speakerContext: NamespaceContext = {
      connection: speakerConnection,  // This won't update!
      // ...
    };
```

This won't work because `connection` is captured by value. Instead, use a proxy pattern — store the connection in a field and have the context reference `this`:

```typescript
  private _speakerConnection: SonosConnection;

  constructor(
    player: Player,
    group: Group,
    householdId: string,
    speakerConnection: SonosConnection,
    groupsConnection: SonosConnection,
  ) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;
    this._speakerConnection = speakerConnection;

    // Speaker context — reads connection from mutable field
    const self = this;
    const speakerContext: NamespaceContext = {
      get connection() { return self._speakerConnection; },
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    const groupsContext: NamespaceContext = {
      connection: groupsConnection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.volume = new VolumeControl(speakerContext);
    this.playback = new PlaybackControl(speakerContext);
    this.favorites = new FavoritesAccess(speakerContext);
    this.playlists = new PlaylistsAccess(speakerContext);
    this.audioClip = new AudioClipControl(speakerContext);
    this.homeTheater = new HomeTheaterControl(speakerContext);
    this.settings = new SettingsControl(speakerContext);
    this.groups = new GroupsNamespace(groupsContext);
  }

  setSpeakerConnection(connection: SonosConnection): void {
    this._speakerConnection = connection;
  }
```

- [ ] **Step 5: Update disconnect to close all connections**

```typescript
  async disconnect(): Promise<void> {
    // Close all speaker connections
    for (const [id, conn] of this.speakerConnections) {
      try { await conn.disconnect(); } catch { /* best effort */ }
    }
    this.speakerConnections.clear();
    // Close primary connection
    await this.connection.disconnect();
  }
```

- [ ] **Step 6: Update SonosHousehold tests**

In `tests/household/SonosHousehold.test.ts`, update the mock to handle the dual-connection constructor. The mock `SonosConnection` should be usable by both contexts. Since `refreshTopology` creates handles with `new PlayerHandle(player, group, hid, this.connection, this.connection)`, the mock just needs to work as before.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 9: Commit**

```bash
git add src/player/PlayerHandle.ts src/household/SonosHousehold.ts tests/
git commit -m "feat: per-speaker WebSocket connections for volume/playback

SonosHousehold now opens a connection to each discovered speaker after
topology discovery. PlayerHandle uses the speaker's own connection for
volume/playback commands and the primary connection for group management.
All speakers are connected at startup in parallel."
```

---

### Task 3: Build, Push, Update Neurotto, and Live Test

**Files:**
- Build: `dist/` in sonos-ws
- Update: Neurotto dependency

- [ ] **Step 1: Build**

```bash
cd /home/bitsaver/workspace/sonos-ws && npm run build
```

- [ ] **Step 2: Commit dist and push**

```bash
git add dist/
git commit -m "chore: rebuild dist with multi-connection support"
git push
```

- [ ] **Step 3: Update Neurotto**

```bash
cd /home/bitsaver/workspace/neurotto && bun update sonos-ws && ./dev.sh restart
```

- [ ] **Step 4: Check logs**

```bash
cat /home/bitsaver/docker/neurotto/data/neurotto.log | grep -i "sonos\|connect\|speaker" | tail -15
```

Expected: `Connected to Arc`, `Connected to Bedroom`, `Connected to Office`, `Topology:`, `Initialized`.

- [ ] **Step 5: Live test — volume on remote speaker**

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
async function test() {
  const h = new SonosHousehold({ host: '192.168.68.96' });
  await h.connect();
  const bed = h.player('Bedroom');
  console.log('Bedroom volume:', (await bed.volume.get()).volume);
  console.log('Bedroom player volume:', (await bed.volume.player.get()).volume);
  await h.disconnect();
}
test().catch(console.error);
"
```

Expected: Both commands succeed (no `ERROR_INVALID_OBJECT_ID`).

- [ ] **Step 6: Live test — playback on remote speaker**

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
async function test() {
  const h = new SonosHousehold({ host: '192.168.68.96' });
  await h.connect();
  const bed = h.player('Bedroom');
  const status = await bed.playback.getStatus();
  console.log('Bedroom playback:', status.playbackState);
  await h.disconnect();
}
test().catch(console.error);
"
```

Expected: Returns playback status (no error).

- [ ] **Step 7: Live test — per-speaker volume adjustment**

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 node -e "
const { SonosHousehold } = require('./dist/index.cjs');
async function test() {
  const h = new SonosHousehold({ host: '192.168.68.96' });
  await h.connect();
  const bed = h.player('Bedroom');
  const before = await bed.volume.player.get();
  await bed.volume.player.set(before.volume + 1);
  const after = await bed.volume.player.get();
  console.log('Bedroom volume:', before.volume, '→', after.volume);
  await bed.volume.player.set(before.volume); // restore
  await h.disconnect();
}
test().catch(console.error);
"
```

Expected: Volume changes and reads back correctly.
