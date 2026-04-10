# Peer Architecture Refactor

## Problem

`SonosHousehold` wraps `SonosClient`, then fights with it. It reaches into `client.groupId`, `client.rawConnection`, `client.groups`, and `client.householdId`. The two classes have overlapping responsibilities:

- **Duplicate topology tracking** — SonosClient tracks its own groupId; SonosHousehold tracks all groups.
- **groupId swap hack** — SonosHousehold mutates `client.groupId` with try/finally to target different groups, causing silent failures when the wrong playerId is sent.
- **Double event firing** — `SonosConnection.send()` re-emits correlated responses as `message` events, causing subscribe confirmations to fire as volume-change events.
- **Confusing volume API** — `groupVolume` and `playerVolume` are separate namespaces that map 1:1 to Sonos API names but don't match how users think about volume.

## Solution

Make `SonosHousehold` and `SonosClient` peers that each use `SonosConnection` directly. Clean up event routing. Unify the volume API.

## Architecture

```
SonosConnection           — WebSocket lifecycle, send/receive, reconnection
  |
  |── SonosHousehold      — topology, player handles, grouping, events
  |     └─ PlayerHandle[] — per-player namespace access
  |          └─ VolumeControl — unified group + player volume
  |
  └── SonosClient         — simple single-speaker API (independent)
        └─ PlayerHandle   — one internal handle
```

`SonosHousehold` and `SonosClient` are independent consumers of `SonosConnection`. They share no state and do not reference each other.

## Layer Responsibilities

### SonosConnection (minimal changes)

WebSocket lifecycle, message correlation, reconnection. No Sonos domain knowledge.

**One change:** Remove `this.emit('message', response)` from `send()` (line 176). Correlated command responses resolve the promise and stop there. Only unsolicited messages (subscription events, coordinator changes) are emitted as `message` events. This eliminates double event firing.

### SonosHousehold

Owns a `SonosConnection`. Responsible for:

- **Discovery:** on connect, discovers `householdId` by sending a raw `getGroups` command (same technique as current `SonosClient.discoverHouseholdId()`).
- **Topology:** fetches and caches all groups and players. Creates `PlayerHandle` instances. Updates handles on topology changes.
- **Event routing:** listens to `connection.on('message', ...)` and maps namespace strings to typed events. Filters out subscribe confirmations (empty bodies). Distinguishes `groupCoordinatorChanged` from normal namespace events.
- **Grouping:** `group()`, `ungroup()`, `ungroupAll()` — all operations go through `PlayerHandle` namespaces (never through raw client.groupId swapping).
- **Household-scoped commands:** maintains its own `GroupsNamespace` instance for operations that don't target a specific player (e.g., `createGroup`). This namespace has `groupId: undefined` / `playerId: undefined` — `createGroup` doesn't need them.

```typescript
const household = new SonosHousehold({ host: '192.168.68.96' });
await household.connect();

const arc = household.player('Arc');
const office = household.player('Office');

await arc.volume.relative(5);
await household.group([arc, office], { transfer: true });
```

**Options:**

```typescript
interface SonosHouseholdOptions {
  host: string;
  port?: number;              // default 1443
  reconnect?: Partial<ReconnectOptions> | boolean;  // default true
  logger?: Logger;
  requestTimeout?: number;    // default 5000
}
```

### PlayerHandle

Lightweight command target. Does not own a connection — receives a `SonosConnection` reference from the household.

Each handle creates its own namespace instances with a `NamespaceContext` that returns this player's `groupId` and `playerId`. When topology changes, the household calls `handle.updateGroup(newGroup)` and the namespace context automatically returns the new `groupId`.

```typescript
interface PlayerHandle {
  readonly id: string;                    // RINCON ID
  readonly name: string;                  // display name
  readonly groupId: string;               // current group (auto-updated)
  readonly isCoordinator: boolean;
  readonly capabilities: PlayerCapability[];

  readonly volume: VolumeControl;         // unified volume (group + player)
  readonly playback: PlaybackControl;     // play, pause, skip, seek, metadata
  readonly favorites: FavoritesAccess;    // get, load
  readonly playlists: PlaylistsAccess;    // get, getPlaylist, load
  readonly audioClip: AudioClipControl;   // load, cancel
  readonly homeTheater: HomeTheaterControl; // get, set
  readonly settings: SettingsControl;     // get, set
  readonly groups: GroupsNamespace;       // raw group operations (internal + advanced)
}
```

### VolumeControl

Wraps `GroupVolumeNamespace` and `PlayerVolumeNamespace` behind a unified interface:

```typescript
class VolumeControl {
  // Group volume (primary — controls all speakers in this player's group)
  get(): Promise<GroupVolumeStatus>
  set(volume: number): Promise<void>
  relative(delta: number): Promise<VolumeResponse>
  mute(muted: boolean): Promise<void>

  // Per-speaker volume (rare — control this physical speaker within its group)
  readonly player: {
    get(): Promise<PlayerVolumeStatus>
    set(volume: number, muted?: boolean): Promise<void>
    relative(delta: number): Promise<VolumeResponse>
    mute(muted: boolean): Promise<void>
  }
}
```

### PlaybackControl

Wraps `PlaybackNamespace` and `PlaybackMetadataNamespace` — playback and metadata are always about the same thing (what's currently playing):

```typescript
class PlaybackControl {
  play(): Promise<void>
  pause(): Promise<void>
  togglePlayPause(): Promise<void>
  stop(): Promise<void>
  skipToNextTrack(): Promise<void>
  skipToPreviousTrack(): Promise<void>
  seek(positionMillis: number): Promise<void>
  seekRelative(deltaMillis: number): Promise<void>
  getStatus(): Promise<PlaybackStatus>
  setPlayModes(modes: Partial<PlayModes>): Promise<void>
  loadLineIn(options?: LoadLineInOptions): Promise<void>
  getMetadata(): Promise<MetadataStatus>
}
```

### Simplified Namespace Wrappers

Favorites, playlists, audioClip, homeTheater, and settings get thin wrappers that shorten method names where the namespace already provides context:

```typescript
// FavoritesAccess wraps FavoritesNamespace
get(): Promise<FavoritesResponse>           // was getFavorites
load(id: string, options?): Promise<void>    // was loadFavorite

// PlaylistsAccess wraps PlaylistsNamespace
get(): Promise<PlaylistsResponse>            // was getPlaylists
getPlaylist(id: string): Promise<PlaylistResponse>
load(id: string, options?): Promise<void>    // was loadPlaylist

// AudioClipControl wraps AudioClipNamespace
load(options): Promise<AudioClipResponse>    // was loadAudioClip
cancel(clipId: string): Promise<void>        // was cancelAudioClip

// HomeTheaterControl wraps HomeTheaterNamespace
get(): Promise<HomeTheaterOptions>           // was getOptions
set(options): Promise<void>                  // was setOptions

// SettingsControl wraps SettingsNamespace
get(): Promise<PlayerSettings>               // was getPlayerSettings
set(settings): Promise<void>                 // was setPlayerSettings
```

### SonosClient (Simple API)

Convenience wrapper for single-speaker use. Creates its own `SonosConnection` and a single `PlayerHandle`. Delegates namespace access to the internal handle.

```typescript
const client = new SonosClient({ host: '192.168.68.96' });
await client.connect();

await client.volume.set(50);
await client.playback.play();

client.on('volumeChanged', (data) => ...);

await client.disconnect();
```

Internally:

```
SonosClient
  └─ SonosConnection (owns it)
  └─ PlayerHandle (one, created after auto-discovery)
```

- `connect()` — establishes WebSocket, discovers householdId, fetches topology, identifies the connected player's group, creates internal handle.
- All namespace properties (`volume`, `playback`, etc.) delegate to the internal handle.
- Event routing same as SonosHousehold but simpler — single player, no topology tracking.
- On coordinator-change events, re-discovers its group (same as current behavior).
- No `group()`, `player()`, `players`, or household management.

## Event Routing

### SonosConnection emits:

- `message(data: SonosResponse)` — unsolicited events only (subscription pushes, coordinator changes). NOT correlated command responses.
- `connected()` — WebSocket open.
- `disconnected(reason: string)` — WebSocket closed.
- `reconnecting(attempt: number, delay: number)` — before reconnect attempt.
- `error(error: Error)` — connection errors.

### SonosHousehold / SonosClient event mapping:

When a `message` arrives, check `body._objectType`:

- `groupCoordinatorChanged` → emit `coordinatorChanged`, refresh topology. Do NOT route to `volumeChanged`.
- Any body with `_objectType` matching a known event → emit the typed event.
- Empty body or unknown `_objectType` → ignore (subscribe confirmation).

**Household events:**

```typescript
interface SonosHouseholdEvents {
  // Connection lifecycle
  connected: () => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number, delay: number) => void;
  error: (error: Error) => void;

  // Subscription events
  volumeChanged: (data: GroupVolumeStatus) => void;
  playerVolumeChanged: (data: PlayerVolumeStatus) => void;
  playbackChanged: (data: PlaybackStatus) => void;
  metadataChanged: (data: MetadataStatus) => void;
  groupsChanged: (data: GroupsResponse) => void;
  favoritesChanged: (data: FavoritesResponse) => void;
  playlistsChanged: (data: PlaylistsResponse) => void;
  homeTheaterChanged: (data: HomeTheaterOptions) => void;

  // Topology
  coordinatorChanged: (data: GroupCoordinatorChangedEvent) => void;
  topologyChanged: (groups: Group[], players: Player[]) => void;

  // Debug
  rawMessage: (message: SonosResponse) => void;
}
```

## Grouping

Unchanged from the current spec. All operations go through `PlayerHandle.groups` which sends the correct `groupId` and `playerId` automatically.

```typescript
await household.group([arc, office]);                          // simple group
await household.group([arc, office], { transfer: true });      // auto-transfer audio
await household.group([arc, office], { transfer: bedroom });   // explicit source
await household.ungroup(office);
await household.ungroupAll();
```

The `transfer` resolution logic, coordinator shuffle procedure, and error handling are unchanged from the previous spec.

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/player/VolumeControl.ts` | Unified group + player volume |
| `src/player/PlaybackControl.ts` | Playback + metadata |
| `src/player/FavoritesAccess.ts` | Shortened favorites API |
| `src/player/PlaylistsAccess.ts` | Shortened playlists API |
| `src/player/AudioClipControl.ts` | Shortened audio clip API |
| `src/player/HomeTheaterControl.ts` | Shortened home theater API |
| `src/player/SettingsControl.ts` | Shortened settings API |

### Moved files

| From | To | Reason |
|------|----|--------|
| `src/household/PlayerHandle.ts` | `src/player/PlayerHandle.ts` | Player belongs in its own directory — it's used by both household and client |

### Rewritten files

| File | Change |
|------|--------|
| `src/household/SonosHousehold.ts` | Uses SonosConnection directly, owns event routing |
| `src/client/SonosClient.ts` | Thin wrapper: SonosConnection + one PlayerHandle |
| `src/index.ts` | Updated exports |

### Modified files

| File | Change |
|------|--------|
| `src/client/SonosConnection.ts` | Remove `this.emit('message', response)` from `send()` |
| `src/types/events.ts` | Updated event interface names |

### Unchanged files

All raw namespace classes (`GroupVolumeNamespace`, `PlayerVolumeNamespace`, `PlaybackNamespace`, etc.), `MessageCorrelator`, `TypedEventEmitter`, error classes, discovery, logger, all type definitions.

## Neurotto Updates

`Sonos.ts` updates to use the new API:

```typescript
// Before
await this.arc.groupVolume.getVolume();
await this.arc.groupVolume.setRelativeVolume(5);
await this.arc.playback.togglePlayPause();

// After
await this.arc.volume.get();
await this.arc.volume.relative(5);
await this.arc.playback.togglePlayPause();  // unchanged

// Event
household.on('volumeChanged', (data) => {
  this.log.info(`Volume: ${data.volume}`);
});
```

Only one volume log handler. No duplicate events.

## Verification

1. `npx tsc --noEmit` — clean
2. `npx vitest run` — all tests pass
3. Live test: connect to Arc, `volume.get()`, `volume.relative(5)` — OSD appears
4. Live test: `group([arc, office])`, verify speakers group, `ungroup(office)`, verify
5. Live test: `group([office, bedroom], { transfer: true })` with audio playing — audio transfers
6. Neurotto: restart container, verify single volume log line per event, no `Volume: undefined`

## Scope

**In scope:**
- Peer architecture (SonosHousehold and SonosClient as independent SonosConnection consumers)
- Unified volume API (VolumeControl)
- Merged playback + metadata (PlaybackControl)
- Shortened namespace wrappers
- Event routing cleanup (no double firing, no undefined volume)
- SonosConnection.send() fix
- Neurotto Sonos.ts migration

**Out of scope:**
- New features (auto-ungroup on TV, Spotify integration)
- New namespace support
- Test coverage expansion (separate effort)
