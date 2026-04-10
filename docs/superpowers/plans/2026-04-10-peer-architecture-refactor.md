# Peer Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor SonosHousehold and SonosClient into independent peers that each use SonosConnection directly, with a unified volume API, merged playback/metadata, and clean event routing.

**Architecture:** SonosConnection is the shared transport layer. SonosHousehold and SonosClient are independent consumers — they don't reference each other. PlayerHandle provides per-player namespace access via wrapper classes (VolumeControl, PlaybackControl, etc.) that give a clean API over the raw Sonos namespace classes.

**Tech Stack:** TypeScript, tsup (build), vitest (tests), Node.js ws library

**Spec:** `docs/superpowers/specs/2026-04-10-peer-architecture-refactor.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/client/SonosConnection.ts` | WebSocket lifecycle | Modify (remove re-emit from send) |
| `src/player/VolumeControl.ts` | Unified group + player volume | Create |
| `src/player/PlaybackControl.ts` | Playback + metadata | Create |
| `src/player/FavoritesAccess.ts` | Shortened favorites API | Create |
| `src/player/PlaylistsAccess.ts` | Shortened playlists API | Create |
| `src/player/AudioClipControl.ts` | Shortened audio clip API | Create |
| `src/player/HomeTheaterControl.ts` | Shortened home theater API | Create |
| `src/player/SettingsControl.ts` | Shortened settings API | Create |
| `src/player/PlayerHandle.ts` | Per-player command target (rewritten) | Create (replaces `src/household/PlayerHandle.ts`) |
| `src/household/SonosHousehold.ts` | Household API (rewritten) | Rewrite |
| `src/client/SonosClient.ts` | Simple single-speaker API (rewritten) | Rewrite |
| `src/types/events.ts` | Updated event interfaces | Modify |
| `src/index.ts` | Updated exports | Rewrite |
| `tests/player/VolumeControl.test.ts` | VolumeControl tests | Create |
| `tests/player/PlayerHandle.test.ts` | PlayerHandle tests (rewritten) | Create (replaces `tests/household/`) |
| `tests/household/SonosHousehold.test.ts` | SonosHousehold tests (rewritten) | Rewrite |
| **Neurotto** `src/classes/utility/Sonos.ts` | Migrate to new API | Modify |

### Files to delete

| File | Reason |
|------|--------|
| `src/household/PlayerHandle.ts` | Moved to `src/player/PlayerHandle.ts` |
| `tests/household/PlayerHandle.test.ts` | Moved to `tests/player/PlayerHandle.test.ts` |

---

### Task 1: Fix SonosConnection — Remove Response Re-emit

**Files:**
- Modify: `src/client/SonosConnection.ts`

This is the foundational fix. The `send()` method re-emits correlated responses as `message` events (line 236), causing double event firing. Remove it.

- [ ] **Step 1: Remove the re-emit line**

In `src/client/SonosConnection.ts`, find the `send()` method. Remove these two lines (approximately lines 234-236):

```typescript
    // Emit the response so listeners can extract metadata (e.g., householdId)
    // even from error responses
    this.emit('message', response);
```

The code after removal should flow directly from `const response = await promise;` to the success check:

```typescript
    const response = await promise;
    const [resHeaders, resBody] = response;

    if (resHeaders.success === false) {
```

- [ ] **Step 2: Run typecheck and existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: Clean typecheck. Existing tests may need adjustment if they depended on the re-emit behavior — fix any that break.

- [ ] **Step 3: Commit**

```bash
git add src/client/SonosConnection.ts
git commit -m "fix: remove response re-emit from SonosConnection.send()

Correlated command responses now only resolve the promise — they are no
longer also emitted as 'message' events. This eliminates double event
firing when subscribe confirmations were being routed as volume events.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Create Player Wrapper Classes

**Files:**
- Create: `src/player/VolumeControl.ts`
- Create: `src/player/PlaybackControl.ts`
- Create: `src/player/FavoritesAccess.ts`
- Create: `src/player/PlaylistsAccess.ts`
- Create: `src/player/AudioClipControl.ts`
- Create: `src/player/HomeTheaterControl.ts`
- Create: `src/player/SettingsControl.ts`
- Create: `tests/player/VolumeControl.test.ts`

These wrapper classes provide a clean API surface over the raw Sonos namespace classes. Each one takes a `NamespaceContext` and creates the underlying namespace internally.

- [ ] **Step 1: Create VolumeControl**

Create `src/player/VolumeControl.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import type { GroupVolumeStatus, PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';

/**
 * Unified volume control for a Sonos player.
 *
 * Primary methods control the group volume (all speakers in this player's group).
 * The {@link player} sub-object controls this individual speaker within its group.
 */
export class VolumeControl {
  private readonly group: GroupVolumeNamespace;
  private readonly _player: PlayerVolumeNamespace;

  constructor(context: NamespaceContext) {
    this.group = new GroupVolumeNamespace(context);
    this._player = new PlayerVolumeNamespace(context);
  }

  /** Gets the current group volume level and mute status. */
  async get(): Promise<GroupVolumeStatus> {
    return this.group.getVolume();
  }

  /**
   * Sets the absolute group volume.
   * @param volume - Volume level (0–100).
   */
  async set(volume: number): Promise<void> {
    return this.group.setVolume(volume);
  }

  /**
   * Adjusts the group volume by a relative amount.
   * @param delta - Amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level.
   */
  async relative(delta: number): Promise<VolumeResponse> {
    return this.group.setRelativeVolume(delta);
  }

  /**
   * Mutes or unmutes the entire group.
   * @param muted - `true` to mute, `false` to unmute.
   */
  async mute(muted: boolean): Promise<void> {
    return this.group.setMute(muted);
  }

  /**
   * Subscribes to real-time group volume change events.
   * After subscribing, the household emits `volumeChanged` events.
   */
  async subscribe(): Promise<void> {
    return this.group.subscribe();
  }

  /** Unsubscribes from group volume events. */
  async unsubscribe(): Promise<void> {
    return this.group.unsubscribe();
  }

  /**
   * Per-speaker volume control.
   * Controls this individual speaker independently within its group.
   * Use this to adjust one speaker's volume without affecting others in the group.
   */
  readonly player = {
    /** Gets the current volume and mute status for this individual speaker. */
    get: (): Promise<PlayerVolumeStatus> => {
      return this._player.getVolume();
    },
    /**
     * Sets the absolute volume for this speaker.
     * @param volume - Volume level (0–100).
     * @param muted - Optionally set mute state simultaneously.
     */
    set: (volume: number, muted?: boolean): Promise<void> => {
      return this._player.setVolume(volume, muted);
    },
    /**
     * Adjusts this speaker's volume by a relative amount.
     * @param delta - Amount to adjust.
     * @returns The resulting volume level.
     */
    relative: (delta: number): Promise<VolumeResponse> => {
      return this._player.setRelativeVolume(delta);
    },
    /**
     * Mutes or unmutes this individual speaker.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute: (muted: boolean): Promise<void> => {
      return this._player.setMute(muted);
    },
    /** Subscribes to per-speaker volume events. */
    subscribe: (): Promise<void> => {
      return this._player.subscribe();
    },
    /** Unsubscribes from per-speaker volume events. */
    unsubscribe: (): Promise<void> => {
      return this._player.unsubscribe();
    },
  };
}
```

- [ ] **Step 2: Create PlaybackControl**

Create `src/player/PlaybackControl.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { PlaybackNamespace } from '../namespaces/PlaybackNamespace.js';
import { PlaybackMetadataNamespace } from '../namespaces/PlaybackMetadataNamespace.js';
import type { PlaybackStatus, PlayModes, LoadLineInOptions } from '../types/playback.js';
import type { MetadataStatus } from '../types/metadata.js';

/**
 * Playback and metadata control for a Sonos player's group.
 *
 * Combines the `playback:1` and `playbackMetadata:1` namespaces into
 * a single interface — playback state and track metadata are always
 * about the same thing (what's currently playing).
 */
export class PlaybackControl {
  private readonly pb: PlaybackNamespace;
  private readonly meta: PlaybackMetadataNamespace;

  constructor(context: NamespaceContext) {
    this.pb = new PlaybackNamespace(context);
    this.meta = new PlaybackMetadataNamespace(context);
  }

  /** Starts or resumes playback. */
  async play(): Promise<void> { return this.pb.play(); }

  /** Pauses playback. */
  async pause(): Promise<void> { return this.pb.pause(); }

  /** Toggles between play and pause. */
  async togglePlayPause(): Promise<void> { return this.pb.togglePlayPause(); }

  /** Stops playback entirely. */
  async stop(): Promise<void> { return this.pb.stop(); }

  /** Skips to the next track in the queue. */
  async skipToNextTrack(): Promise<void> { return this.pb.skipToNextTrack(); }

  /** Skips to the previous track. */
  async skipToPreviousTrack(): Promise<void> { return this.pb.skipToPreviousTrack(); }

  /**
   * Seeks to an absolute position in the current track.
   * @param positionMillis - Position in milliseconds.
   */
  async seek(positionMillis: number): Promise<void> { return this.pb.seek(positionMillis); }

  /**
   * Seeks forward or backward by a relative amount.
   * @param deltaMillis - Amount in milliseconds (positive = forward, negative = backward).
   */
  async seekRelative(deltaMillis: number): Promise<void> { return this.pb.seekRelative(deltaMillis); }

  /** Gets the current playback state, position, and play modes. */
  async getStatus(): Promise<PlaybackStatus> { return this.pb.getPlaybackStatus(); }

  /**
   * Sets shuffle, repeat, crossfade modes.
   * @param modes - Partial play modes to update.
   */
  async setPlayModes(modes: Partial<PlayModes>): Promise<void> { return this.pb.setPlayModes(modes); }

  /**
   * Switches playback to a line-in source.
   * @param options - Optional line-in configuration.
   */
  async loadLineIn(options?: LoadLineInOptions): Promise<void> { return this.pb.loadLineIn(options); }

  /** Gets metadata for the current track, container, and next item. */
  async getMetadata(): Promise<MetadataStatus> { return this.meta.getMetadataStatus(); }

  /** Subscribes to playback state change events. */
  async subscribe(): Promise<void> { await this.pb.subscribe(); }

  /** Unsubscribes from playback state events. */
  async unsubscribe(): Promise<void> { await this.pb.unsubscribe(); }
}
```

- [ ] **Step 3: Create the five simple wrappers**

Create `src/player/FavoritesAccess.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { FavoritesNamespace } from '../namespaces/FavoritesNamespace.js';
import type { FavoritesResponse, LoadFavoriteOptions } from '../types/favorites.js';

/** Access and load Sonos favorites. */
export class FavoritesAccess {
  private readonly ns: FavoritesNamespace;
  constructor(context: NamespaceContext) { this.ns = new FavoritesNamespace(context); }

  /** Retrieves the list of Sonos favorites. */
  async get(): Promise<FavoritesResponse> { return this.ns.getFavorites(); }

  /**
   * Loads a favorite into the queue.
   * @param id - Favorite ID.
   * @param options - Queue action and playback options.
   */
  async load(id: string, options?: LoadFavoriteOptions): Promise<void> { return this.ns.loadFavorite(id, options); }
}
```

Create `src/player/PlaylistsAccess.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { PlaylistsNamespace } from '../namespaces/PlaylistsNamespace.js';
import type { PlaylistsResponse, PlaylistResponse, LoadPlaylistOptions } from '../types/playlists.js';

/** Access and load Sonos playlists. */
export class PlaylistsAccess {
  private readonly ns: PlaylistsNamespace;
  constructor(context: NamespaceContext) { this.ns = new PlaylistsNamespace(context); }

  /** Retrieves all Sonos playlists. */
  async get(): Promise<PlaylistsResponse> { return this.ns.getPlaylists(); }

  /**
   * Retrieves a specific playlist with its tracks.
   * @param id - Playlist ID.
   */
  async getPlaylist(id: string): Promise<PlaylistResponse> { return this.ns.getPlaylist(id); }

  /**
   * Loads a playlist into the queue.
   * @param id - Playlist ID.
   * @param options - Playback options.
   */
  async load(id: string, options?: LoadPlaylistOptions): Promise<void> { return this.ns.loadPlaylist(id, options); }
}
```

Create `src/player/AudioClipControl.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { AudioClipNamespace } from '../namespaces/AudioClipNamespace.js';
import type { LoadAudioClipOptions, AudioClipResponse } from '../types/audioClip.js';

/** Plays audio clips (notifications, chimes) that overlay current audio. */
export class AudioClipControl {
  private readonly ns: AudioClipNamespace;
  constructor(context: NamespaceContext) { this.ns = new AudioClipNamespace(context); }

  /**
   * Plays an audio clip.
   * @param options - Clip configuration (name, appId, streamUrl, priority, volume).
   */
  async load(options: LoadAudioClipOptions): Promise<AudioClipResponse> { return this.ns.loadAudioClip(options); }

  /**
   * Cancels a currently playing audio clip.
   * @param clipId - ID of the clip to cancel.
   */
  async cancel(clipId: string): Promise<void> { return this.ns.cancelAudioClip(clipId); }
}
```

Create `src/player/HomeTheaterControl.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { HomeTheaterNamespace } from '../namespaces/HomeTheaterNamespace.js';
import type { HomeTheaterOptions } from '../types/homeTheater.js';

/** Manages home theater settings (night mode, dialog enhancement). */
export class HomeTheaterControl {
  private readonly ns: HomeTheaterNamespace;
  constructor(context: NamespaceContext) { this.ns = new HomeTheaterNamespace(context); }

  /** Gets the current home theater settings. */
  async get(): Promise<HomeTheaterOptions> { return this.ns.getOptions(); }

  /**
   * Updates home theater settings.
   * @param options - Settings to update (nightMode, enhanceDialog).
   */
  async set(options: Partial<HomeTheaterOptions>): Promise<void> { return this.ns.setOptions(options); }
}
```

Create `src/player/SettingsControl.ts`:

```typescript
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { SettingsNamespace } from '../namespaces/SettingsNamespace.js';
import type { PlayerSettings } from '../types/settings.js';

/** Manages player-level settings. */
export class SettingsControl {
  private readonly ns: SettingsNamespace;
  constructor(context: NamespaceContext) { this.ns = new SettingsNamespace(context); }

  /** Gets the current player settings. */
  async get(): Promise<PlayerSettings> { return this.ns.getPlayerSettings(); }

  /**
   * Updates player settings.
   * @param settings - Settings to update.
   */
  async set(settings: Partial<PlayerSettings>): Promise<void> { return this.ns.setPlayerSettings(settings); }
}
```

- [ ] **Step 4: Write VolumeControl tests**

Create `tests/player/VolumeControl.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { VolumeControl } from '../../src/player/VolumeControl.js';
import type { NamespaceContext } from '../../src/namespaces/BaseNamespace.js';
import type { SonosConnection } from '../../src/client/SonosConnection.js';

function mockContext(): NamespaceContext {
  return {
    connection: {
      send: vi.fn().mockResolvedValue([{}, { volume: 42, muted: false, fixed: false }]),
    } as unknown as SonosConnection,
    getHouseholdId: () => 'HH_1',
    getGroupId: () => 'GROUP_1',
    getPlayerId: () => 'PLAYER_1',
  };
}

describe('VolumeControl', () => {
  it('get() delegates to GroupVolumeNamespace.getVolume()', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    const result = await vol.get();
    expect(result).toEqual({ volume: 42, muted: false, fixed: false });
  });

  it('set() sends setVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.set(50);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setVolume');
    expect(body.volume).toBe(50);
  });

  it('relative() sends setRelativeVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.relative(5);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setRelativeVolume');
    expect(body.volumeDelta).toBe(5);
  });

  it('mute() sends setMute command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.mute(true);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.command).toBe('setMute');
    expect(body.muted).toBe(true);
  });

  it('player.get() delegates to PlayerVolumeNamespace', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    const result = await vol.player.get();
    expect(result).toBeDefined();
  });

  it('player.set() sends playerVolume setVolume command', async () => {
    const ctx = mockContext();
    const vol = new VolumeControl(ctx);
    await vol.player.set(30);
    const send = ctx.connection.send as ReturnType<typeof vi.fn>;
    const lastCall = send.mock.calls[send.mock.calls.length - 1][0];
    expect(lastCall[0].namespace).toBe('playerVolume:1');
    expect(lastCall[0].command).toBe('setVolume');
    expect(lastCall[1].volume).toBe(30);
  });
});
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/player/VolumeControl.test.ts`
Expected: Clean typecheck, all 6 tests pass

- [ ] **Step 6: Commit**

```bash
git add src/player/ tests/player/VolumeControl.test.ts
git commit -m "feat: add player wrapper classes (VolumeControl, PlaybackControl, etc.)

Thin wrappers over raw Sonos namespace classes that provide a cleaner API
surface: unified volume (group + player), merged playback + metadata,
and shortened method names.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rewrite PlayerHandle with New Wrappers

**Files:**
- Create: `src/player/PlayerHandle.ts` (new location)
- Create: `tests/player/PlayerHandle.test.ts` (new location)
- Delete: `src/household/PlayerHandle.ts` (old location)
- Delete: `tests/household/PlayerHandle.test.ts` (old location)

- [ ] **Step 1: Create new PlayerHandle**

Create `src/player/PlayerHandle.ts`:

```typescript
import type { SonosConnection } from '../client/SonosConnection.js';
import type { Player, Group } from '../types/groups.js';
import type { PlayerCapability } from '../types/groups.js';
import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { VolumeControl } from './VolumeControl.js';
import { PlaybackControl } from './PlaybackControl.js';
import { FavoritesAccess } from './FavoritesAccess.js';
import { PlaylistsAccess } from './PlaylistsAccess.js';
import { AudioClipControl } from './AudioClipControl.js';
import { HomeTheaterControl } from './HomeTheaterControl.js';
import { SettingsControl } from './SettingsControl.js';

/**
 * A lightweight handle for controlling a single Sonos player.
 *
 * Routes all commands through a shared WebSocket connection using this
 * player's `groupId` and `playerId` in the request headers.
 *
 * Obtain instances via {@link SonosHousehold.player} or internally
 * from {@link SonosClient}.
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

  /** Unified volume control (group volume + per-speaker volume). */
  readonly volume: VolumeControl;
  /** Playback and metadata control. */
  readonly playback: PlaybackControl;
  /** Sonos favorites. */
  readonly favorites: FavoritesAccess;
  /** Sonos playlists. */
  readonly playlists: PlaylistsAccess;
  /** Audio clip playback. */
  readonly audioClip: AudioClipControl;
  /** Home theater settings. */
  readonly homeTheater: HomeTheaterControl;
  /** Player settings. */
  readonly settings: SettingsControl;
  /** Raw group operations (used internally by SonosHousehold for grouping). */
  readonly groups: GroupsNamespace;

  constructor(player: Player, group: Group, householdId: string, connection: SonosConnection) {
    this.id = player.id;
    this.name = player.name;
    this.capabilities = player.capabilities;
    this._group = group;
    this.householdId = householdId;

    const context: NamespaceContext = {
      connection,
      getHouseholdId: () => this.householdId,
      getGroupId: () => this._group.id,
      getPlayerId: () => this.id,
    };

    this.volume = new VolumeControl(context);
    this.playback = new PlaybackControl(context);
    this.favorites = new FavoritesAccess(context);
    this.playlists = new PlaylistsAccess(context);
    this.audioClip = new AudioClipControl(context);
    this.homeTheater = new HomeTheaterControl(context);
    this.settings = new SettingsControl(context);
    this.groups = new GroupsNamespace(context);
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
   * Called internally by SonosHousehold when topology changes.
   * @internal
   */
  updateGroup(group: Group): void {
    this._group = group;
  }
}
```

- [ ] **Step 2: Create new PlayerHandle tests**

Create `tests/player/PlayerHandle.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PlayerHandle } from '../../src/player/PlayerHandle.js';
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

const arcGroup: Group = {
  id: 'RINCON_ARC:123',
  name: 'Arc',
  coordinatorId: 'RINCON_ARC',
  playerIds: ['RINCON_ARC'],
};

describe('PlayerHandle', () => {
  it('exposes player id, name, and capabilities', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.id).toBe('RINCON_ARC');
    expect(handle.name).toBe('Arc');
    expect(handle.capabilities).toEqual(['PLAYBACK', 'HT_PLAYBACK']);
  });

  it('returns correct groupId', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.groupId).toBe('RINCON_ARC:123');
  });

  it('isCoordinator returns true when player is coordinator', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.isCoordinator).toBe(true);
  });

  it('updates groupId when updateGroup is called', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    const newGroup: Group = { id: 'RINCON_ARC:789', name: 'Arc + 1', coordinatorId: 'RINCON_ARC', playerIds: ['RINCON_ARC', 'RINCON_OFFICE'] };
    handle.updateGroup(newGroup);
    expect(handle.groupId).toBe('RINCON_ARC:789');
  });

  it('has wrapper namespace accessors', () => {
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', mockConnection());
    expect(handle.volume).toBeDefined();
    expect(handle.playback).toBeDefined();
    expect(handle.favorites).toBeDefined();
    expect(handle.playlists).toBeDefined();
    expect(handle.audioClip).toBeDefined();
    expect(handle.homeTheater).toBeDefined();
    expect(handle.settings).toBeDefined();
    expect(handle.groups).toBeDefined();
  });

  it('volume.set sends command with correct groupId', async () => {
    const conn = mockConnection();
    const handle = new PlayerHandle(arcPlayer, arcGroup, 'HH_1', conn);
    await handle.volume.set(50);
    const send = conn.send as ReturnType<typeof vi.fn>;
    const [headers, body] = send.mock.calls[0][0];
    expect(headers.groupId).toBe('RINCON_ARC:123');
    expect(headers.playerId).toBe('RINCON_ARC');
    expect(headers.command).toBe('setVolume');
    expect(body.volume).toBe(50);
  });
});
```

- [ ] **Step 3: Delete old files**

```bash
rm src/household/PlayerHandle.ts tests/household/PlayerHandle.test.ts
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run tests/player/`
Expected: Clean typecheck (SonosHousehold.ts will have import errors — that's expected, it gets rewritten in Task 4). All player tests pass.

Note: if `tsc` fails on SonosHousehold.ts due to the deleted import, that's fine — Task 4 rewrites it. Run tests only: `npx vitest run tests/player/`

- [ ] **Step 5: Commit**

```bash
git add src/player/PlayerHandle.ts tests/player/PlayerHandle.test.ts
git rm src/household/PlayerHandle.ts tests/household/PlayerHandle.test.ts
git commit -m "feat: rewrite PlayerHandle with wrapper classes at src/player/

PlayerHandle now uses VolumeControl, PlaybackControl, and other wrappers
instead of exposing raw namespace classes. Moved from src/household/ to
src/player/ since it's used by both SonosHousehold and SonosClient.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Update Event Types

**Files:**
- Modify: `src/types/events.ts`

- [ ] **Step 1: Update event interfaces**

In `src/types/events.ts`, update the `SonosHouseholdEvents` interface to use the new event names. Also update `SonosEvents` to rename the events for consistency (SonosClient will use these too):

Replace the existing `SonosEvents` interface with:

```typescript
export interface SonosEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, delay: number) => void;
  error: (error: SonosError | Error) => void;

  volumeChanged: (data: GroupVolumeStatus) => void;
  playerVolumeChanged: (data: PlayerVolumeStatus) => void;
  groupsChanged: (data: GroupsResponse) => void;
  playbackChanged: (data: PlaybackStatus) => void;
  metadataChanged: (data: MetadataStatus) => void;
  favoritesChanged: (data: FavoritesResponse) => void;
  playlistsChanged: (data: PlaylistsResponse) => void;
  homeTheaterChanged: (data: HomeTheaterOptions) => void;

  coordinatorChanged: (data: GroupCoordinatorChangedEvent) => void;

  rawMessage: (message: SonosResponse) => void;
}
```

And update `SonosHouseholdEvents`:

```typescript
export interface SonosHouseholdEvents extends SonosEvents {
  topologyChanged: (groups: Group[], players: Player[]) => void;
}
```

Also update `NAMESPACE_EVENT_MAP` to use the new event names:

```typescript
export const NAMESPACE_EVENT_MAP: Record<string, keyof SonosEvents> = {
  'groupVolume:1': 'volumeChanged',
  'playerVolume:1': 'playerVolumeChanged',
  'groups:1': 'groupsChanged',
  'playback:1': 'playbackChanged',
  'playbackMetadata:1': 'metadataChanged',
  'favorites:1': 'favoritesChanged',
  'playlists:1': 'playlistsChanged',
  'homeTheater:1': 'homeTheaterChanged',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/types/events.ts
git commit -m "feat: rename events for consistency (volumeChanged, playbackChanged, etc.)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rewrite SonosHousehold — Direct SonosConnection

**Files:**
- Rewrite: `src/household/SonosHousehold.ts`
- Rewrite: `tests/household/SonosHousehold.test.ts`

This is the core architectural change. SonosHousehold uses SonosConnection directly instead of wrapping SonosClient.

- [ ] **Step 1: Rewrite SonosHousehold**

Rewrite `src/household/SonosHousehold.ts`. The key differences from the current version:

1. Constructor creates `SonosConnection` (not `SonosClient`)
2. `connect()` does its own householdId discovery and topology fetch
3. Event routing happens in `handleMessage()` with `_objectType` filtering
4. A household-scoped `GroupsNamespace` is used for `createGroup` calls
5. Grouping methods use `PlayerHandle.groups` (already fixed)
6. No `rawConnection` getter, no `client.groupId` swapping

Read the full spec at `docs/superpowers/specs/2026-04-10-peer-architecture-refactor.md` for the exact architecture. The implementation should follow the existing SonosHousehold structure but with `SonosConnection` replacing `SonosClient`.

Key constructor change — create connection directly:

```typescript
this.connection = new SonosConnection({
  host: options.host,
  port: options.port ?? 1443,
  reconnect: resolveReconnectOptions(options.reconnect),
  requestTimeout: options.requestTimeout ?? 5000,
  logger: this.log,
});
```

Key connect() change — do householdId discovery inline:

```typescript
async connect(): Promise<void> {
  this._initialConnectDone = false;
  this.connection.on('connected', () => this.handleConnected());
  this.connection.on('disconnected', (r) => this.emit('disconnected', r));
  this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
  this.connection.on('error', (e) => this.emit('error', e));
  this.connection.on('message', (msg) => this.handleMessage(msg));

  await this.connection.connect();
  await this.discoverHouseholdId();
  await this.refreshTopology();
  this._initialConnectDone = true;
}
```

Key event routing — filter by `_objectType`:

```typescript
private handleMessage(message: SonosResponse): void {
  this.emit('rawMessage', message);
  const [headers, body] = message;
  const namespace = headers?.namespace;
  if (!namespace) return;

  // Capture householdId from any message
  if (!this._householdId && headers.householdId) {
    this._householdId = headers.householdId;
  }

  const objectType = body?._objectType as string | undefined;

  // Coordinator changes — refresh topology, don't route as volume event
  if (objectType === 'groupCoordinatorChanged') {
    this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent);
    this.refreshTopology().catch((err) => this.log.warn('Failed to refresh topology', err));
    return;
  }

  // Skip events with empty body (subscribe confirmations)
  if (!objectType) return;

  // Route to typed event
  const eventName = NAMESPACE_EVENT_MAP[namespace];
  if (eventName) {
    (this.emit as any)(eventName, body);
  }
}
```

The `resolveReconnectOptions` helper, `refreshTopology()`, `player()`, `group()`, `ungroup()`, `ungroupAll()`, `resolveAudioSource()`, `simpleGroup()`, and `transferAudio()` stay the same as the current working implementation — just using `this.connection` instead of `this.client.rawConnection`, and a household-scoped `GroupsNamespace` for `createGroup` instead of `this.client.groups.createGroup`.

- [ ] **Step 2: Rewrite SonosHousehold tests**

Rewrite `tests/household/SonosHousehold.test.ts` to mock `SonosConnection` instead of `SonosClient`. The tests should cover: connect, player lookup, topology refresh, disconnect, group empty array error, ungroup no-op, group single player no-op.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/household/`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/household/SonosHousehold.ts tests/household/SonosHousehold.test.ts
git commit -m "feat: rewrite SonosHousehold to use SonosConnection directly

SonosHousehold no longer wraps SonosClient. It owns a SonosConnection
directly, does its own householdId discovery, event routing with
_objectType filtering (fixing double events and Volume: undefined),
and uses a household-scoped GroupsNamespace for createGroup calls.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rewrite SonosClient as Thin Wrapper

**Files:**
- Rewrite: `src/client/SonosClient.ts`

- [ ] **Step 1: Rewrite SonosClient**

SonosClient becomes a convenience wrapper: `SonosConnection` + one `PlayerHandle`. It delegates namespace access to the internal handle.

```typescript
import { SonosConnection } from './SonosConnection.js';
import type { ReconnectOptions, ConnectionOptions } from './SonosConnection.js';
import { TypedEventEmitter } from '../util/TypedEventEmitter.js';
import type { SonosEvents } from '../types/events.js';
import { NAMESPACE_EVENT_MAP } from '../types/events.js';
import type { GroupCoordinatorChangedEvent } from '../types/events.js';
import type { SonosRequest, SonosResponse } from '../types/messages.js';
import type { GroupsResponse } from '../types/groups.js';
import type { Logger } from '../util/logger.js';
import { noopLogger } from '../util/logger.js';
import { GroupsNamespace } from '../namespaces/GroupsNamespace.js';
import { PlayerHandle } from '../player/PlayerHandle.js';
import type { VolumeControl } from '../player/VolumeControl.js';
import type { PlaybackControl } from '../player/PlaybackControl.js';
import type { FavoritesAccess } from '../player/FavoritesAccess.js';
import type { PlaylistsAccess } from '../player/PlaylistsAccess.js';
import type { AudioClipControl } from '../player/AudioClipControl.js';
import type { HomeTheaterControl } from '../player/HomeTheaterControl.js';
import type { SettingsControl } from '../player/SettingsControl.js';

export interface SonosClientOptions {
  host: string;
  port?: number;
  reconnect?: Partial<ReconnectOptions> | boolean;
  logger?: Logger;
  requestTimeout?: number;
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true, initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: Infinity,
};

/**
 * Simple single-speaker API for controlling one Sonos player.
 *
 * For multi-speaker control and grouping, use {@link SonosHousehold} instead.
 *
 * @example
 * ```typescript
 * const client = new SonosClient({ host: '192.168.68.96' });
 * await client.connect();
 * await client.volume.set(50);
 * await client.disconnect();
 * ```
 */
export class SonosClient extends TypedEventEmitter<SonosEvents> {
  private readonly connection: SonosConnection;
  private readonly log: Logger;
  private _handle: PlayerHandle | undefined;
  private _householdId: string | undefined;

  constructor(options: SonosClientOptions) {
    super();
    this.log = options.logger ?? noopLogger;
    this.connection = new SonosConnection({
      host: options.host,
      port: options.port ?? 1443,
      reconnect: resolveReconnectOptions(options.reconnect),
      requestTimeout: options.requestTimeout ?? 5000,
      logger: this.log,
    });
  }

  get connected(): boolean { return this.connection.state === 'connected'; }
  get connectionState() { return this.connection.state; }
  get householdId(): string | undefined { return this._householdId; }

  get volume(): VolumeControl { return this.handle.volume; }
  get playback(): PlaybackControl { return this.handle.playback; }
  get favorites(): FavoritesAccess { return this.handle.favorites; }
  get playlists(): PlaylistsAccess { return this.handle.playlists; }
  get audioClip(): AudioClipControl { return this.handle.audioClip; }
  get homeTheater(): HomeTheaterControl { return this.handle.homeTheater; }
  get settings(): SettingsControl { return this.handle.settings; }

  private get handle(): PlayerHandle {
    if (!this._handle) throw new Error('Not connected — call connect() first');
    return this._handle;
  }

  async connect(): Promise<void> {
    this.connection.on('connected', () => this.handleConnected());
    this.connection.on('disconnected', (r) => this.emit('disconnected', r));
    this.connection.on('reconnecting', (a, d) => this.emit('reconnecting', a, d));
    this.connection.on('error', (e) => this.emit('error', e));
    this.connection.on('message', (msg) => this.handleMessage(msg));

    await this.connection.connect();
    await this.discoverAndCreateHandle();
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  private async discoverAndCreateHandle(): Promise<void> {
    // Discover householdId
    const request: SonosRequest = [
      { namespace: 'groups:1', command: 'getGroups', cmdId: crypto.randomUUID() },
      {},
    ];

    try {
      const [headers, body] = await this.connection.send(request);
      if (headers.householdId) this._householdId = headers.householdId;

      const result = body as unknown as GroupsResponse;
      const group = result.groups?.[0];
      const player = result.players?.find((p) => p.id === group?.coordinatorId) ?? result.players?.[0];

      if (group && player) {
        this._handle = new PlayerHandle(player, group, this._householdId ?? '', this.connection);
      }
    } catch {
      this.log.warn('Could not discover player — provide host of a specific speaker');
    }
  }

  private async handleConnected(): Promise<void> {
    // On reconnect, re-discover group topology
    if (this._handle) {
      try {
        await this.discoverAndCreateHandle();
      } catch (err) {
        this.log.warn('Failed to re-discover on reconnect', err);
      }
    }
    this.emit('connected');
  }

  private handleMessage(message: SonosResponse): void {
    this.emit('rawMessage', message);
    const [headers, body] = message;
    const namespace = headers?.namespace;
    if (!namespace) return;

    if (!this._householdId && headers.householdId) {
      this._householdId = headers.householdId;
    }

    const objectType = body?._objectType as string | undefined;

    if (objectType === 'groupCoordinatorChanged') {
      this.emit('coordinatorChanged', body as unknown as GroupCoordinatorChangedEvent);
      this.discoverAndCreateHandle().catch((err) =>
        this.log.warn('Failed to refresh after coordinator change', err));
      return;
    }

    if (!objectType) return;

    const eventName = NAMESPACE_EVENT_MAP[namespace];
    if (eventName) {
      (this.emit as any)(eventName, body);
    }
  }
}

function resolveReconnectOptions(
  input: Partial<ReconnectOptions> | boolean | undefined,
): ReconnectOptions {
  if (input === false) return { ...DEFAULT_RECONNECT, enabled: false };
  if (input === true || input === undefined) return { ...DEFAULT_RECONNECT };
  return { ...DEFAULT_RECONNECT, ...input };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/client/SonosClient.ts
git commit -m "feat: rewrite SonosClient as thin SonosConnection + PlayerHandle wrapper

SonosClient no longer has mutable groupId/playerId properties, namespace
instances, or topology tracking. It creates one SonosConnection, discovers
its player on connect, creates one PlayerHandle, and delegates all
namespace access to it.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update Exports and Build

**Files:**
- Rewrite: `src/index.ts`

- [ ] **Step 1: Update barrel exports**

Rewrite `src/index.ts`:

```typescript
// Household API (recommended)
export { SonosHousehold } from './household/SonosHousehold.js';
export type { SonosHouseholdOptions } from './household/SonosHousehold.js';

// Player
export { PlayerHandle } from './player/PlayerHandle.js';
export { VolumeControl } from './player/VolumeControl.js';
export { PlaybackControl } from './player/PlaybackControl.js';
export { FavoritesAccess } from './player/FavoritesAccess.js';
export { PlaylistsAccess } from './player/PlaylistsAccess.js';
export { AudioClipControl } from './player/AudioClipControl.js';
export { HomeTheaterControl } from './player/HomeTheaterControl.js';
export { SettingsControl } from './player/SettingsControl.js';

// Simple single-speaker API
export { SonosClient } from './client/SonosClient.js';
export type { SonosClientOptions } from './client/SonosClient.js';
export type { ReconnectOptions, ConnectionState } from './client/SonosConnection.js';

// Discovery
export { SonosDiscovery } from './discovery/SsdpDiscovery.js';
export type { DiscoveryOptions, DiscoveredDevice } from './discovery/SsdpDiscovery.js';

// Errors
export { SonosError } from './errors/SonosError.js';
export { ConnectionError } from './errors/ConnectionError.js';
export { CommandError } from './errors/CommandError.js';
export { TimeoutError } from './errors/TimeoutError.js';

// Utilities
export type { Logger, LogLevel } from './util/logger.js';
export { consoleLogger, noopLogger } from './util/logger.js';

// Types
export * from './types/index.js';
```

- [ ] **Step 2: Run full typecheck, tests, and build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: Clean typecheck, all tests pass, build succeeds

- [ ] **Step 3: Commit and push**

```bash
git add src/index.ts dist/
git commit -m "feat: update exports for peer architecture

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 8: Migrate Neurotto and Live Test

**Files:**
- Modify: `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts`

- [ ] **Step 1: Update sonos-ws in Neurotto**

```bash
cd /home/bitsaver/workspace/neurotto && bun update sonos-ws
```

- [ ] **Step 2: Update Sonos.ts to new API**

Replace `/home/bitsaver/workspace/neurotto/src/classes/utility/Sonos.ts`:

```typescript
import { SonosHousehold, PlayerHandle, type GroupOptions } from 'sonos-ws';
import Log from '@utility/Log';
import { ILog } from '@types';

export type VolumeArgs =
  | { step: number; direction?: null }
  | { direction: 'up' | 'down'; step?: number }
  | { direction: 'set'; step: number }
  | { direction?: null; step?: null }
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

      await this.arc.volume.subscribe();
      this.household.on('volumeChanged', (data) => {
        this.log.info(`Volume: ${data.volume}`);
      });

      const vol = await this.arc.volume.get();
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
    const { volume } = await this.arc.volume.get();

    if (volume == null) {
      throw new Error('Volume is unavailable.');
    }
    if (!arg) {
      return volume;
    }

    const defaultStep = 2;

    const adjustVolume = async (adjustment: number): Promise<string> => {
      adjustment = Math.max(-volume, Math.min(100 - volume, adjustment));
      const result = await this.arc.volume.relative(adjustment);
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
        await this.arc.volume.set(value);
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

- [ ] **Step 4: Recreate dev container and check logs**

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d neurotto
```

Wait, then check logs. Expected:
- `Connecting to wss://192.168.68.96:1443/websocket/api`
- `Connected`
- `Volume: XX, Muted: false` (single line, not multiple)
- `Initialized`
- No `Volume: undefined`
- No duplicate volume log lines

- [ ] **Step 5: Live test volume**

Press Harmony volume up/down. Verify:
- OSD appears on Samsung TV
- Exactly ONE volume log line per event

- [ ] **Step 6: Live test grouping**

```
sonos group Arc Office
sonos ungroup Office
```

Verify speakers group and ungroup correctly.

- [ ] **Step 7: Commit Neurotto changes**

```bash
cd /home/bitsaver/workspace/neurotto
git add src/classes/utility/Sonos.ts
git commit -m "feat: migrate to sonos-ws peer architecture API

Use volume.get/set/relative instead of groupVolume.getVolume/setVolume.
Use playback.togglePlayPause instead of direct namespace access.
Single volumeChanged event handler — no more duplicate logging.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
