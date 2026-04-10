# SonosHousehold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `SonosHousehold` as the top-level API for multi-speaker control, smart grouping with audio transfer, and automatic topology tracking.

**Architecture:** `SonosHousehold` wraps `SonosClient` (one WebSocket connection). `PlayerHandle` objects provide per-player namespace access using the shared connection with scoped IDs. Grouping logic lives in `SonosHousehold` with a `transfer` option for automatic audio source resolution.

**Tech Stack:** TypeScript, tsup (build), vitest (tests), Node.js ws library

**Spec:** `docs/superpowers/specs/2026-04-10-sonos-household-design.md`

---

## File Structure

| File | Role |
|------|------|
| **Create:** `src/household/PlayerHandle.ts` | Per-player command target with namespace accessors |
| **Create:** `src/household/SonosHousehold.ts` | Top-level household API: connection, topology, grouping |
| **Modify:** `src/types/errors.ts` | Add `PLAYER_NOT_FOUND`, `GROUP_OPERATION_FAILED` error codes |
| **Modify:** `src/types/events.ts` | Add `SonosHouseholdEvents` with `topologyChanged` |
| **Modify:** `src/types/groups.ts` | Add `GroupOptions` interface |
| **Modify:** `src/index.ts` | Export new classes and types |
| **Modify:** `src/client/SonosClient.ts` | Expose `connection` as `readonly` for household use |
| **Create:** `tests/household/PlayerHandle.test.ts` | Unit tests for PlayerHandle |
| **Create:** `tests/household/SonosHousehold.test.ts` | Unit tests for SonosHousehold |
| **Modify (Neurotto):** `neurotto/src/classes/utility/Sonos.ts` | Migrate to SonosHousehold, fix type errors |

---

### Task 1: Add New Error Codes and Types

**Files:**
- Modify: `src/types/errors.ts`
- Modify: `src/types/events.ts`
- Modify: `src/types/groups.ts`

- [ ] **Step 1: Add error codes to ErrorCode enum**

In `src/types/errors.ts`, add after `ERROR_NO_CONTENT`:

```typescript
  /** The specified player name or ID was not found in the household topology. */
  PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
  /** A multi-step group operation failed partway through. */
  GROUP_OPERATION_FAILED = 'GROUP_OPERATION_FAILED',
```

- [ ] **Step 2: Add SonosHouseholdEvents and GroupOptions to events.ts**

In `src/types/events.ts`, add the import for `Player` and the new interfaces after the existing `SonosEvents`:

```typescript
import type { Group, Player } from './groups.js';

/**
 * Events emitted by {@link SonosHousehold}.
 * Extends all {@link SonosEvents} and adds household-level topology events.
 */
export interface SonosHouseholdEvents extends SonosEvents {
  /** Emitted when group topology changes (groups/players added/removed/reorganized). */
  topologyChanged: (groups: Group[], players: Player[]) => void;
}
```

- [ ] **Step 3: Add GroupOptions interface to groups.ts**

In `src/types/groups.ts`, add at the end:

```typescript
/**
 * Options for {@link SonosHousehold.group}.
 */
export interface GroupOptions {
  /**
   * Audio transfer behavior:
   * - `undefined` (default): just group; if a target player is playing, its audio continues.
   * - `true`: automatically find the active audio source and transfer it.
   *   Checks target players first (by array order), then the rest of the household.
   *   Prefers `PLAYING` over `PAUSED`. If nothing is playing anywhere, groups silently.
   * - A player handle reference: transfer audio from that specific player.
   *   Throws if that player is not actively playing or paused.
   */
  transfer?: boolean | { readonly id: string };
}
```

Note: `{ readonly id: string }` is used instead of importing `PlayerHandle` to avoid circular dependency. Any object with an `id` property works (including `PlayerHandle`).

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean (no errors)

- [ ] **Step 5: Commit**

```bash
git add src/types/errors.ts src/types/events.ts src/types/groups.ts
git commit -m "feat: add error codes, household events, and GroupOptions types"
```

---

### Task 2: Expose SonosClient Connection for Household Use

**Files:**
- Modify: `src/client/SonosClient.ts`

The `SonosHousehold` needs access to the underlying `SonosConnection` to construct `NamespaceContext` objects for `PlayerHandle`. Currently `connection` is `private`. We need to make it accessible.

- [ ] **Step 1: Add a public getter for the connection**

In `src/client/SonosClient.ts`, add after the `connectionState` getter (after line 169):

```typescript
  /**
   * The underlying WebSocket connection.
   * Exposed for advanced use cases like {@link SonosHousehold}.
   * @internal
   */
  get rawConnection(): SonosConnection {
    return this.connection;
  }
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/client/SonosClient.ts
git commit -m "feat: expose rawConnection getter on SonosClient"
```

---

### Task 3: Implement PlayerHandle

**Files:**
- Create: `src/household/PlayerHandle.ts`
- Create: `tests/household/PlayerHandle.test.ts`

- [ ] **Step 1: Write PlayerHandle tests**

Create `tests/household/PlayerHandle.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PlayerHandle } from '../../src/household/PlayerHandle.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { Player, Group } from '../../src/types/groups.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function mockConnection(): SonosConnection {
  return {
    send: vi.fn().mockResolvedValue([{}, {}]),
    state: 'connected',
  } as unknown as SonosConnection;
}

const arcPlayer: Player = {
  id: 'RINCON_ARC',
  name: 'Arc',
  capabilities: ['PLAYBACK', 'HT_PLAYBACK'],
};

const officePlayer: Player = {
  id: 'RINCON_OFFICE',
  name: 'Office',
  capabilities: ['PLAYBACK'],
};

const arcGroup: Group = {
  id: 'RINCON_ARC:123',
  name: 'Arc',
  coordinatorId: 'RINCON_ARC',
  playerIds: ['RINCON_ARC'],
};

const officeGroup: Group = {
  id: 'RINCON_OFFICE:456',
  name: 'Office',
  coordinatorId: 'RINCON_OFFICE',
  playerIds: ['RINCON_OFFICE'],
};

describe('PlayerHandle', () => {
  it('exposes player id and name', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.id).toBe('RINCON_ARC');
    expect(handle.name).toBe('Arc');
  });

  it('returns correct groupId', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupId).toBe('RINCON_ARC:123');
  });

  it('isCoordinator returns true when player is coordinator', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.isCoordinator).toBe(true);
  });

  it('isCoordinator returns false when player is not coordinator', () => {
    const conn = mockConnection();
    const groupedGroup: Group = {
      id: 'RINCON_ARC:123',
      name: 'Arc + 1',
      coordinatorId: 'RINCON_ARC',
      playerIds: ['RINCON_ARC', 'RINCON_OFFICE'],
    };
    const handle = new PlayerHandle(officePlayer, groupedGroup, 'HH_1', conn);
    expect(handle.isCoordinator).toBe(false);
  });

  it('updates groupId when updateGroup is called', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupId).toBe('RINCON_ARC:123');

    const newGroup: Group = { id: 'RINCON_ARC:789', name: 'Arc + 1', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] };
    handle.updateGroup(newGroup);
    expect(handle.groupId).toBe('RINCON_ARC:789');
  });

  it('has namespace accessors that use player-scoped context', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.groupVolume).toBeDefined();
    expect(handle.playerVolume).toBeDefined();
    expect(handle.playback).toBeDefined();
    expect(handle.playbackMetadata).toBeDefined();
    expect(handle.favorites).toBeDefined();
    expect(handle.playlists).toBeDefined();
    expect(handle.audioClip).toBeDefined();
    expect(handle.homeTheater).toBeDefined();
    expect(handle.settings).toBeDefined();
  });

  it('capabilities reflects player capabilities', () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    expect(handle.capabilities).toEqual(['PLAYBACK', 'HT_PLAYBACK']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/household/PlayerHandle.test.ts`
Expected: FAIL — `PlayerHandle` module not found

- [ ] **Step 3: Implement PlayerHandle**

Create `src/household/PlayerHandle.ts`:

```typescript
import type { SonosConnection } from '../client/SonosConnection.js';
import type { Player, Group } from '../types/groups.js';
import type { PlayerCapability } from '../types/groups.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { PlaybackNamespace } from '../namespaces/PlaybackNamespace.js';
import { PlaybackMetadataNamespace } from '../namespaces/PlaybackMetadataNamespace.js';
import { FavoritesNamespace } from '../namespaces/FavoritesNamespace.js';
import { PlaylistsNamespace } from '../namespaces/PlaylistsNamespace.js';
import { AudioClipNamespace } from '../namespaces/AudioClipNamespace.js';
import { HomeTheaterNamespace } from '../namespaces/HomeTheaterNamespace.js';
import { SettingsNamespace } from '../namespaces/SettingsNamespace.js';

/**
 * A lightweight handle for controlling a single Sonos player within a household.
 *
 * `PlayerHandle` does not own a WebSocket connection — it routes all commands
 * through the shared {@link SonosHousehold} connection, using this player's
 * current `groupId` and `playerId` in the request headers.
 *
 * Obtain instances via {@link SonosHousehold.player}.
 */
export class PlayerHandle {
  /** RINCON player ID. */
  readonly id: string;
  /** Display name (e.g. "Arc", "Office"). */
  readonly name: string;
  /** Player capabilities from the Sonos API. */
  readonly capabilities: PlayerCapability[];

  private _group: Group;
  private readonly householdId: string;
  private readonly context: NamespaceContext;

  /** Group volume control — targets this player's group. */
  readonly groupVolume: GroupVolumeNamespace;
  /** Individual player volume control. */
  readonly playerVolume: PlayerVolumeNamespace;
  /** Group topology management. */
  readonly groups: GroupsNamespace;
  /** Playback control — targets this player's group. */
  readonly playback: PlaybackNamespace;
  /** Playback metadata — targets this player's group. */
  readonly playbackMetadata: PlaybackMetadataNamespace;
  /** Favorites access. */
  readonly favorites: FavoritesNamespace;
  /** Playlists access. */
  readonly playlists: PlaylistsNamespace;
  /** Audio clip playback. */
  readonly audioClip: AudioClipNamespace;
  /** Home theater settings (only meaningful for HT players like Arc). */
  readonly homeTheater: HomeTheaterNamespace;
  /** Player settings. */
  readonly settings: SettingsNamespace;

  constructor(player: Player, group: Group, householdId: string, connection: SonosConnection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;

    this.context = {
      connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.groupVolume = new GroupVolumeNamespace(this.context);
    this.playerVolume = new PlayerVolumeNamespace(this.context);
    this.groups = new GroupsNamespace(this.context);
    this.playback = new PlaybackNamespace(this.context);
    this.playbackMetadata = new PlaybackMetadataNamespace(this.context);
    this.favorites = new FavoritesNamespace(this.context);
    this.playlists = new PlaylistsNamespace(this.context);
    this.audioClip = new AudioClipNamespace(this.context);
    this.homeTheater = new HomeTheaterNamespace(this.context);
    this.settings = new SettingsNamespace(this.context);
  }

  /** Current group ID this player belongs to. Updated automatically on topology changes. */
  get groupId(): string {
    return this._group.id;
  }

  /** Whether this player is the coordinator of its current group. */
  get isCoordinator(): boolean {
    return this._group.coordinatorId === this.id;
  }

  /**
   * Updates the group this player belongs to.
   * Called internally by {@link SonosHousehold} when topology changes.
   * @internal
   */
  updateGroup(group: Group): void {
    this._group = group;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/household/PlayerHandle.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/household/PlayerHandle.ts tests/household/PlayerHandle.test.ts
git commit -m "feat: implement PlayerHandle with per-player namespace routing"
```

---

### Task 4: Implement SonosHousehold — Connection and Topology

**Files:**
- Create: `src/household/SonosHousehold.ts`
- Create: `tests/household/SonosHousehold.test.ts`

This task implements the connection, player access, topology management, and event forwarding. Grouping is in the next task.

- [ ] **Step 1: Write SonosHousehold connection and topology tests**

Create `tests/household/SonosHousehold.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SonosHousehold } from '../../src/household/SonosHousehold.js';
import { SonosClient } from '../../src/client/SonosClient.js';
import type { GroupsResponse, Group, Player } from '../../src/types/groups.js';

// Mock SonosClient
vi.mock('../../src/client/SonosClient.js', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    removeAllListeners: vi.fn().mockReturnThis(),
    householdId: 'HH_1',
    groupId: 'RINCON_ARC:123',
    playerId: 'RINCON_ARC',
    rawConnection: {},
    groups: {
      getGroups: vi.fn(),
    },
  };
  return { SonosClient: vi.fn(() => mockClient) };
});

const mockTopology: GroupsResponse = {
  groups: [
    { id: 'RINCON_ARC:123', name: 'Arc', coordinatorId: 'RINCON_ARC', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_ARC'] },
    { id: 'RINCON_OFFICE:456', name: 'Office', coordinatorId: 'RINCON_OFFICE', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_OFFICE'] },
    { id: 'RINCON_BED:789', name: 'Bedroom', coordinatorId: 'RINCON_BED', playbackState: 'PLAYBACK_STATE_IDLE', playerIds: ['RINCON_BED'] },
  ] as Group[],
  players: [
    { id: 'RINCON_ARC', name: 'Arc', capabilities: ['PLAYBACK', 'HT_PLAYBACK'] },
    { id: 'RINCON_OFFICE', name: 'Office', capabilities: ['PLAYBACK'] },
    { id: 'RINCON_BED', name: 'Bedroom', capabilities: ['PLAYBACK'] },
  ] as Player[],
};

describe('SonosHousehold', () => {
  let household: SonosHousehold;

  beforeEach(() => {
    vi.clearAllMocks();
    household = new SonosHousehold({ host: '192.168.68.96' });
    const mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockClient.groups.getGroups.mockResolvedValue(mockTopology);
  });

  it('connects and discovers topology', async () => {
    await household.connect();
    expect(household.players.size).toBe(3);
    expect(household.groups.length).toBe(3);
  });

  it('player() returns handle by name (case-insensitive)', async () => {
    await household.connect();
    const arc = household.player('arc');
    expect(arc.id).toBe('RINCON_ARC');
    expect(arc.name).toBe('Arc');
  });

  it('player() returns handle by RINCON ID', async () => {
    await household.connect();
    const office = household.player('RINCON_OFFICE');
    expect(office.id).toBe('RINCON_OFFICE');
  });

  it('player() throws for unknown name', async () => {
    await household.connect();
    expect(() => household.player('Kitchen')).toThrow('PLAYER_NOT_FOUND');
  });

  it('player handles have correct groupIds', async () => {
    await household.connect();
    const arc = household.player('Arc');
    const office = household.player('Office');
    expect(arc.groupId).toBe('RINCON_ARC:123');
    expect(office.groupId).toBe('RINCON_OFFICE:456');
  });

  it('disconnect calls client disconnect', async () => {
    await household.connect();
    await household.disconnect();
    const mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(mockClient.disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — `SonosHousehold` module not found

- [ ] **Step 3: Implement SonosHousehold (connection + topology + player access)**

Create `src/household/SonosHousehold.ts`:

```typescript
import { SonosClient } from '../client/SonosClient.js';
import type { SonosClientOptions } from '../client/SonosClient.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosHouseholdEvents } from '../types/events.js';
import type { Group, Player, GroupsResponse, GroupOptions } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { SonosError } from '../errors/SonosError.js';
import { ErrorCode } from '../types/errors.js';
import { TimeoutError } from '../errors/TimeoutError.js';
import { PlayerHandle } from './PlayerHandle.js';

/**
 * Configuration options for creating a {@link SonosHousehold} instance.
 */
export interface SonosHouseholdOptions {
  /** IP or hostname of any Sonos speaker in the household. */
  host: string;
  /** WebSocket port. @defaultValue 1443 */
  port?: number;
  /** Reconnection config. @defaultValue true */
  reconnect?: SonosClientOptions['reconnect'];
  /** Custom logger. */
  logger?: Logger;
  /** Command timeout in ms. @defaultValue 5000 */
  requestTimeout?: number;
}

/**
 * Top-level API for controlling an entire Sonos household.
 *
 * Uses a single WebSocket connection (via {@link SonosClient}) and exposes
 * {@link PlayerHandle} objects for targeting individual speakers. Automatically
 * tracks group topology changes and provides high-level grouping operations.
 *
 * @example
 * ```typescript
 * const household = new SonosHousehold({ host: '192.168.68.96' });
 * await household.connect();
 *
 * const arc = household.player('Arc');
 * await arc.groupVolume.setRelativeVolume(5);
 *
 * const office = household.player('Office');
 * await household.group([arc, office], { transfer: true });
 * ```
 */
export class SonosHousehold extends TypedEventEmitter<SonosHouseholdEvents> {
  private readonly client: SonosClient;
  private readonly log: Logger;
  private readonly _players = new Map<string, PlayerHandle>();
  private _groups: Group[] = [];
  private _rawPlayers: Player[] = [];

  constructor(options: SonosHouseholdOptions) {
    super();
    this.log = options.logger ?? noopLogger;

    this.client = new SonosClient({
      host: options.host,
      port: options.port,
      reconnect: options.reconnect,
      logger: options.logger,
      requestTimeout: options.requestTimeout,
    });

    // Forward all client events
    this.client.on('connected', () => {
      this.refreshTopology().catch((err) => {
        this.log.warn('Failed to refresh topology on reconnect', err);
      });
      this.emit('connected');
    });
    this.client.on('disconnected', (reason) => this.emit('disconnected', reason));
    this.client.on('reconnecting', (attempt, delay) => this.emit('reconnecting', attempt, delay));
    this.client.on('error', (err) => this.emit('error', err));
    this.client.on('rawMessage', (msg) => this.emit('rawMessage', msg));
    this.client.on('groupVolumeChanged', (data) => this.emit('groupVolumeChanged', data));
    this.client.on('playerVolumeChanged', (data) => this.emit('playerVolumeChanged', data));
    this.client.on('groupsChanged', (data) => this.emit('groupsChanged', data));
    this.client.on('playbackStatusChanged', (data) => this.emit('playbackStatusChanged', data));
    this.client.on('metadataStatusChanged', (data) => this.emit('metadataStatusChanged', data));
    this.client.on('favoritesChanged', (data) => this.emit('favoritesChanged', data));
    this.client.on('playlistsChanged', (data) => this.emit('playlistsChanged', data));
    this.client.on('homeTheaterChanged', (data) => this.emit('homeTheaterChanged', data));
    this.client.on('groupCoordinatorChanged', (data) => {
      this.emit('groupCoordinatorChanged', data);
      this.refreshTopology().catch((err) => {
        this.log.warn('Failed to refresh topology after coordinator change', err);
      });
    });
  }

  /** All discovered players in the household, keyed by RINCON player ID. */
  get players(): ReadonlyMap<string, PlayerHandle> {
    return this._players;
  }

  /** All current groups in the household. */
  get groups(): readonly Group[] {
    return this._groups;
  }

  /** The Sonos household ID. */
  get householdId(): string | undefined {
    return this.client.householdId;
  }

  /** Whether the WebSocket connection is currently open. */
  get connected(): boolean {
    return this.client.connected;
  }

  /**
   * Connects to the Sonos speaker and discovers the household topology.
   * Populates {@link players} and {@link groups}.
   */
  async connect(): Promise<void> {
    await this.client.connect();
    await this.refreshTopology();
  }

  /** Gracefully closes the WebSocket connection. */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  /**
   * Gets a player handle by display name (case-insensitive) or RINCON ID.
   *
   * @param nameOrId - Player display name (e.g. "Arc") or RINCON ID.
   * @returns The player handle.
   * @throws {SonosError} With code `PLAYER_NOT_FOUND` if not found.
   */
  player(nameOrId: string): PlayerHandle {
    // Try by ID first
    const byId = this._players.get(nameOrId);
    if (byId) return byId;

    // Try by name (case-insensitive)
    const lower = nameOrId.toLowerCase();
    for (const handle of this._players.values()) {
      if (handle.name.toLowerCase() === lower) return handle;
    }

    throw new SonosError(
      ErrorCode.PLAYER_NOT_FOUND,
      `Player not found: "${nameOrId}". Available: ${[...this._players.values()].map((p) => p.name).join(', ')}`,
    );
  }

  /**
   * Refreshes the household topology from the Sonos device.
   * Updates all player handles with their current group assignments.
   * @internal
   */
  async refreshTopology(): Promise<GroupsResponse> {
    const result = await this.client.groups.getGroups();
    this._groups = result.groups;
    this._rawPlayers = result.players;

    const connection = this.client.rawConnection;
    const householdId = this.client.householdId ?? '';

    // Create or update player handles
    for (const player of result.players) {
      const group = result.groups.find((g) => g.playerIds.includes(player.id));
      if (!group) continue;

      const existing = this._players.get(player.id);
      if (existing) {
        existing.updateGroup(group);
      } else {
        this._players.set(player.id, new PlayerHandle(player, group, householdId, connection));
      }
    }

    // Remove players that no longer exist
    for (const [id] of this._players) {
      if (!result.players.some((p) => p.id === id)) {
        this._players.delete(id);
      }
    }

    this.emit('topologyChanged', this._groups, this._rawPlayers);
    this.log.debug(`Topology refreshed: ${this._players.size} players, ${this._groups.length} groups`);

    return result;
  }

  /**
   * Groups the specified players. The first player in the array becomes the coordinator.
   *
   * @param players - Players to group. First player becomes coordinator.
   * @param options - Grouping options including audio transfer behavior.
   * @throws {SonosError} With code `INVALID_PARAMETER` if players array is empty.
   */
  async group(players: PlayerHandle[], options?: GroupOptions): Promise<void> {
    // Implemented in Task 5
    throw new Error('Not implemented');
  }

  /**
   * Removes a player from its current group. No-op if already solo.
   *
   * @param player - The player to ungroup.
   */
  async ungroup(player: PlayerHandle): Promise<void> {
    // Implemented in Task 5
    throw new Error('Not implemented');
  }

  /**
   * Ungroups all players in the household. Each becomes its own group.
   */
  async ungroupAll(): Promise<void> {
    // Implemented in Task 5
    throw new Error('Not implemented');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: implement SonosHousehold with connection, topology, and player access"
```

---

### Task 5: Implement Grouping, Ungrouping, and Audio Transfer

**Files:**
- Modify: `src/household/SonosHousehold.ts`
- Modify: `tests/household/SonosHousehold.test.ts`

This is the most complex task. The `group()` method must handle: simple grouping, no-op detection, `transfer: true` with audio source resolution, `transfer: PlayerHandle` with explicit source, and the coordinator shuffle with its expected timeout.

- [ ] **Step 1: Write grouping tests**

Append to `tests/household/SonosHousehold.test.ts`:

```typescript
describe('SonosHousehold grouping', () => {
  let household: SonosHousehold;
  let mockClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    household = new SonosHousehold({ host: '192.168.68.96' });
    mockClient = (SonosClient as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockClient.groups.getGroups.mockResolvedValue(mockTopology);
    await household.connect();
  });

  it('group() throws on empty array', async () => {
    await expect(household.group([])).rejects.toThrow('INVALID_PARAMETER');
  });

  it('ungroup() is a no-op for solo player', async () => {
    const arc = household.player('Arc');
    await household.ungroup(arc);
    // createGroup should not be called since arc is already solo
    expect(mockClient.groups.getGroups).toHaveBeenCalledTimes(1); // only the initial connect call
  });

  it('group([single]) is a no-op for solo player', async () => {
    const arc = household.player('Arc');
    await household.group([arc]);
    // Should not make any group API calls beyond the initial topology fetch
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/household/SonosHousehold.test.ts`
Expected: FAIL — "Not implemented"

- [ ] **Step 3: Implement group(), ungroup(), ungroupAll()**

Replace the stub methods in `src/household/SonosHousehold.ts` with the full implementation. Replace the three stub methods (`group`, `ungroup`, `ungroupAll`) with:

```typescript
  async group(players: PlayerHandle[], options?: GroupOptions): Promise<void> {
    if (players.length === 0) {
      throw new SonosError(ErrorCode.INVALID_PARAMETER, 'group() requires at least one player');
    }

    // Single player — just ensure they're solo
    if (players.length === 1) {
      const player = players[0]!;
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group && group.playerIds.length === 1) return; // already solo
      await this.client.groups.createGroup([player.id]);
      await this.refreshTopology();
      return;
    }

    const desiredCoordinator = players[0]!;
    const desiredMemberIds = players.map((p) => p.id);

    // Check if already in the desired configuration
    const currentGroup = this._groups.find((g) => g.playerIds.includes(desiredCoordinator.id));
    if (currentGroup
      && currentGroup.coordinatorId === desiredCoordinator.id
      && currentGroup.playerIds.length === desiredMemberIds.length
      && desiredMemberIds.every((id) => currentGroup.playerIds.includes(id))) {
      // Already grouped as desired — handle transfer option even in this case
      if (!options?.transfer) return;
    }

    // Resolve audio source if transfer is requested
    let audioSource: PlayerHandle | undefined;
    if (options?.transfer) {
      audioSource = this.resolveAudioSource(players, options.transfer);
    }

    // If we have an audio source and it needs to become coordinator via shuffle
    if (audioSource && audioSource.id !== desiredCoordinator.id) {
      await this.transferAudio(audioSource, desiredCoordinator, desiredMemberIds);
    } else {
      // Simple grouping: make desiredCoordinator the coordinator, add others
      await this.simpleGroup(desiredCoordinator, desiredMemberIds);
    }

    await this.refreshTopology();
  }

  async ungroup(player: PlayerHandle): Promise<void> {
    const group = this._groups.find((g) => g.playerIds.includes(player.id));
    if (!group || group.playerIds.length === 1) return; // already solo

    await this.client.groups.createGroup([player.id]);
    await this.refreshTopology();
  }

  async ungroupAll(): Promise<void> {
    const multiPlayerGroups = this._groups.filter((g) => g.playerIds.length > 1);
    for (const group of multiPlayerGroups) {
      // Pull out all non-coordinator members
      for (const playerId of group.playerIds) {
        if (playerId !== group.coordinatorId) {
          await this.client.groups.createGroup([playerId]);
        }
      }
    }
    if (multiPlayerGroups.length > 0) {
      await this.refreshTopology();
    }
  }

  /**
   * Resolves the audio source player based on the `transfer` option.
   * @returns The player with audio, or undefined if nothing is playing.
   */
  private resolveAudioSource(
    targetPlayers: PlayerHandle[],
    transfer: boolean | { readonly id: string },
  ): PlayerHandle | undefined {
    // Explicit player specified
    if (typeof transfer === 'object') {
      const source = this._players.get(transfer.id);
      if (!source) {
        throw new SonosError(ErrorCode.PLAYER_NOT_FOUND, `Transfer source not found: ${transfer.id}`);
      }
      const sourceGroup = this._groups.find((g) => g.playerIds.includes(source.id));
      if (!sourceGroup || sourceGroup.playbackState === 'PLAYBACK_STATE_IDLE') {
        throw new SonosError(ErrorCode.ERROR_NO_CONTENT, `Transfer source "${source.name}" has no content`);
      }
      return source;
    }

    // Auto-resolve: check target players first (by array order)
    const targetIds = new Set(targetPlayers.map((p) => p.id));

    // Phase 1: PLAYING among target players
    for (const player of targetPlayers) {
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group?.playbackState === 'PLAYBACK_STATE_PLAYING') return player;
    }

    // Phase 2: PAUSED among target players
    for (const player of targetPlayers) {
      const group = this._groups.find((g) => g.playerIds.includes(player.id));
      if (group?.playbackState === 'PLAYBACK_STATE_PAUSED') return player;
    }

    // Phase 3: PLAYING elsewhere in household
    for (const group of this._groups) {
      if (group.playbackState === 'PLAYBACK_STATE_PLAYING') {
        const coordinatorHandle = this._players.get(group.coordinatorId);
        if (coordinatorHandle && !targetIds.has(coordinatorHandle.id)) return coordinatorHandle;
      }
    }

    // Phase 4: PAUSED elsewhere in household
    for (const group of this._groups) {
      if (group.playbackState === 'PLAYBACK_STATE_PAUSED') {
        const coordinatorHandle = this._players.get(group.coordinatorId);
        if (coordinatorHandle && !targetIds.has(coordinatorHandle.id)) return coordinatorHandle;
      }
    }

    // Nothing playing anywhere
    return undefined;
  }

  /**
   * Performs a simple group operation: ensures the coordinator owns a group
   * with exactly the desired members.
   */
  private async simpleGroup(coordinator: PlayerHandle, memberIds: string[]): Promise<void> {
    const currentGroup = this._groups.find((g) => g.playerIds.includes(coordinator.id));
    if (!currentGroup) return;

    // If coordinator is not the coordinator of its current group, pull it out first
    if (currentGroup.coordinatorId !== coordinator.id) {
      await this.client.groups.createGroup([coordinator.id]);
      await this.refreshTopology();
    }

    // Now add the other members to the coordinator's group
    const othersToAdd = memberIds.filter((id) => id !== coordinator.id);
    if (othersToAdd.length > 0) {
      // Target the coordinator's group for the modifyGroupMembers call
      const coordGroup = this._groups.find((g) => g.coordinatorId === coordinator.id);
      if (coordGroup) {
        // Use raw connection to target the correct group
        const currentGroupId = this.client.groupId;
        this.client.groupId = coordGroup.id;
        try {
          // Remove members that shouldn't be in the group
          const currentMembers = coordGroup.playerIds.filter((id) => id !== coordinator.id);
          const toRemove = currentMembers.filter((id) => !memberIds.includes(id));
          const toAdd = othersToAdd.filter((id) => !coordGroup.playerIds.includes(id));

          if (toAdd.length > 0 || toRemove.length > 0) {
            await this.client.groups.modifyGroupMembers(
              toAdd.length > 0 ? toAdd : undefined,
              toRemove.length > 0 ? toRemove : undefined,
            );
          }
        } finally {
          this.client.groupId = currentGroupId;
        }
      }
    }
  }

  /**
   * Transfers audio from a source player to a target coordinator using
   * the coordinator shuffle technique.
   *
   * 1. Add target to source's group
   * 2. Remove source from group (expected ~8s timeout)
   * 3. Target inherits audio
   * 4. Add remaining members
   */
  private async transferAudio(
    source: PlayerHandle,
    targetCoordinator: PlayerHandle,
    allMemberIds: string[],
  ): Promise<void> {
    const sourceGroup = this._groups.find((g) => g.coordinatorId === source.id)
      ?? this._groups.find((g) => g.playerIds.includes(source.id));

    if (!sourceGroup) {
      throw new SonosError(ErrorCode.GROUP_OPERATION_FAILED, `Could not find group for source player "${source.name}"`);
    }

    // Step 1: Add target coordinator to the source's group
    const savedGroupId = this.client.groupId;
    this.client.groupId = sourceGroup.id;
    try {
      if (!sourceGroup.playerIds.includes(targetCoordinator.id)) {
        await this.client.groups.modifyGroupMembers([targetCoordinator.id]);
      }

      // Step 2: Remove the source coordinator — this triggers the transfer
      // Expected to timeout (~8s) as the response comes as an event, not a command response
      try {
        await this.client.groups.modifyGroupMembers([], [source.id]);
      } catch (err) {
        if (!(err instanceof TimeoutError)) throw err;
        // Timeout is expected during coordinator shuffle — continue
        this.log.debug('Expected timeout during coordinator transfer');
      }
    } finally {
      this.client.groupId = savedGroupId;
    }

    // Step 3: Refresh topology to find the new group
    await this.refreshTopology();

    // Step 4: Add remaining members to the target's new group
    const remaining = allMemberIds.filter((id) => id !== targetCoordinator.id && id !== source.id);
    if (remaining.length > 0) {
      const targetGroup = this._groups.find((g) => g.coordinatorId === targetCoordinator.id);
      if (targetGroup) {
        const toAdd = remaining.filter((id) => !targetGroup.playerIds.includes(id));
        if (toAdd.length > 0) {
          this.client.groupId = targetGroup.id;
          try {
            await this.client.groups.modifyGroupMembers(toAdd);
          } finally {
            this.client.groupId = savedGroupId;
          }
        }
      }
    }
  }
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run tests/household/`
Expected: All tests PASS

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: implement group(), ungroup(), ungroupAll() with audio transfer"
```

---

### Task 6: Update Barrel Exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add exports for SonosHousehold and PlayerHandle**

In `src/index.ts`, add after the existing `SonosClient` exports:

```typescript
export { SonosHousehold } from './household/SonosHousehold.js';
export type { SonosHouseholdOptions } from './household/SonosHousehold.js';
export { PlayerHandle } from './household/PlayerHandle.js';
```

- [ ] **Step 2: Run typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: Clean typecheck, successful build with updated `dist/`

- [ ] **Step 3: Commit**

```bash
git add src/index.ts dist/
git commit -m "feat: export SonosHousehold and PlayerHandle from barrel"
```

---

### Task 7: Migrate Neurotto Sonos.ts to SonosHousehold

**Files:**
- Modify: `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts`

- [ ] **Step 1: Update sonos-ws in Neurotto**

```bash
cd /home/bitsaver/workspace/neurotto && bun update sonos-ws
```

- [ ] **Step 2: Rewrite Sonos.ts**

Replace the contents of `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts` with:

```typescript
import { SonosHousehold, PlayerHandle, type GroupOptions } from 'sonos-ws';
import Log from '@utility/Log';
import { ILog } from '@types';

export type VolumeArgs =
  | {
      step: number;
      direction?: null;
    }
  | {
      direction: 'up' | 'down';
      step?: number;
    }
  | {
      direction: 'set';
      step: number;
    }
  | {
      direction?: null;
      step?: null;
    }
  | null;

class Sonos {
  log: ILog;
  initialized: boolean;
  household: SonosHousehold;
  arc: PlayerHandle;

  constructor() {
    this.log = Log(['Sonos']);
    this.initialized = false;
  }

  async init() {
    try {
      this.household = new SonosHousehold({ host: '192.168.68.96', logger: this.log });

      this.household.on('connected', () => this.log.info('\n--- CONNECTED ---'));
      this.household.on('disconnected', (r) => this.log.info(`\n--- DISCONNECTED: ${r} ---`));
      this.household.on('error', (e) => this.log.error('\n--- ERROR ---', e.message));
      this.household.on('topologyChanged', (groups) => {
        this.log.info('Topology changed:', groups.map((g) => g.name).join(', '));
      });

      await this.household.connect();

      this.arc = this.household.player('Arc');

      await this.arc.groupVolume.subscribe();
      this.household.on('groupVolumeChanged', (data) => {
        this.log.info(`Volume: ${data.volume}`);
      });

      const vol = await this.arc.groupVolume.getVolume();
      this.log.verbose(`Volume: ${vol.volume}, Muted: ${vol.muted}`);

      this.log.info('Initialized');
      this.initialized = true;
    } catch (err) {
      this.log.error('init', 'Initialization error', err);
    }
  }

  checkInitialized() {
    if (!this.initialized) {
      throw new Error('Sonos not initialized');
    }
  }

  async volume(arg: VolumeArgs = null): Promise<number | string> | null {
    this.checkInitialized();

    const { step = null, direction = null } = arg ?? {};

    const { volume } = await this.arc.groupVolume.getVolume();

    if (volume == null) {
      throw new Error('Volume is unavailable.');
    }
    if (!arg) {
      return volume;
    }

    const defaultStep = 2;

    const adjustVolume = async (adjustment: number): Promise<string> => {
      adjustment = Math.max(-volume, Math.min(100 - volume, adjustment));
      const result = await this.arc.groupVolume.setRelativeVolume(adjustment);
      return `Volume set to: ${result.volume}`;
    };

    if (!direction && step) {
      if (isNaN(step) || step < -100 || step > 100) {
        throw new Error(`Invalid volume step: ${step}`);
      }
      return adjustVolume(+step);
    } else if (direction) {
      if (step !== null && direction === 'set') {
        const value = Math.max(0, Math.min(100, step));
        await this.arc.groupVolume.setVolume(value);
        return `Volume set to: ${value}`;
      }
      if (!['up', 'down'].includes(direction)) {
        throw new Error(`Invalid volume direction: ${direction}`);
      }
      const value = direction === 'up' ? defaultStep : defaultStep * -1;
      return adjustVolume(value);
    } else {
      throw new Error(`Command not found. ${direction}/${step}`);
    }
  }

  play() {
    this.checkInitialized();
    return this.arc.playback.play();
  }

  pause() {
    this.checkInitialized();
    return this.arc.playback.pause();
  }

  togglePlayback() {
    this.checkInitialized();
    return this.arc.playback.togglePlayPause();
  }

  async group(speakers: string[], options?: GroupOptions) {
    this.checkInitialized();
    const handles = speakers.map((name) => this.household.player(name));
    await this.household.group(handles, options);
  }

  async ungroup(speaker: string) {
    this.checkInitialized();
    const handle = this.household.player(speaker);
    await this.household.ungroup(handle);
  }

  async close() {
    await this.household.disconnect();
  }
}

export default Sonos;
```

- [ ] **Step 3: Verify Neurotto builds**

```bash
cd /home/bitsaver/workspace/neurotto && npx tsc --noEmit 2>&1 | grep -i sonos
```

Expected: No sonos-related errors

- [ ] **Step 4: Restart Neurotto dev container and check logs**

```bash
cd /home/bitsaver/workspace/neurotto && ./dev.sh restart
# wait a few seconds
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs --tail=30 neurotto
```

Expected: See "Connected", "Volume: XX", "Initialized", no crashes

- [ ] **Step 5: Commit**

```bash
cd /home/bitsaver/workspace/neurotto
git add src/classes/utility/Sonos.ts
git commit -m "feat: migrate Sonos.ts to SonosHousehold API with player handles"
```

---

### Task 8: Build, Push, and Integration Test

**Files:**
- sonos-ws: rebuild dist, push to GitHub
- Neurotto: reinstall, test

- [ ] **Step 1: Push sonos-ws changes**

```bash
cd /home/bitsaver/workspace/sonos-ws
git push
```

- [ ] **Step 2: Reinstall in Neurotto from GitHub**

```bash
cd /home/bitsaver/workspace/neurotto
bun update sonos-ws
```

- [ ] **Step 3: Recreate dev container and verify**

```bash
cd /home/bitsaver/workspace/neurotto
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d neurotto
```

Wait, then check logs for: "Connected", "Volume:", "Topology changed", "Initialized"

- [ ] **Step 4: Live test volume control**

Press Harmony volume up/down. Verify:
- OSD appears on Samsung TV
- Log shows volume change events
- No crashes or stale groupId errors

- [ ] **Step 5: Live test grouping**

Via Neurotto CLI or API:
```
sonos group Arc Office
```

Verify Office joins Arc's group. Then:
```
sonos ungroup Office
```

Verify Office goes solo.
