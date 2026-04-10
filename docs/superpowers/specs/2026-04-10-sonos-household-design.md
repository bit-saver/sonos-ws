# SonosHousehold Design Spec

## Problem

The sonos-ws library currently exposes `SonosClient`, which connects to a single speaker and targets a single group. This causes several issues:

1. **Stale groupId** — when speakers are grouped/ungrouped, the cached groupId becomes invalid and commands fail.
2. **No multi-speaker control** — controlling a different speaker requires a separate `SonosClient` instance and WebSocket connection.
3. **No grouping API** — the library exposes raw `modifyGroupMembers` but has no high-level grouping, ungrouping, or audio transfer logic.
4. **Neurotto integration gaps** — Sonos.ts has type errors, an empty `group()` stub, and no way to manage the household.

## Solution

Add `SonosHousehold` as the new top-level API. One WebSocket connection, full household visibility, player handles for targeting any speaker, and smart grouping with automatic audio transfer.

## Architecture

### Class Hierarchy

```
SonosHousehold          — top-level: connect, topology, grouping
  └─ SonosClient        — internal: WebSocket connection, message routing
       └─ SonosConnection  — WebSocket lifecycle, reconnection
            └─ MessageCorrelator — request/response matching
  └─ PlayerHandle[]     — lightweight per-player command targets
       └─ (shared namespaces with scoped context)
```

`SonosClient` remains the internal connection layer and is still exported for advanced single-speaker use. `SonosHousehold` is the recommended public API.

### New Files

| File | Purpose |
|------|---------|
| `src/household/SonosHousehold.ts` | Main class — connection, topology, grouping |
| `src/household/PlayerHandle.ts` | Per-player command target with namespace accessors |

### Modified Files

| File | Change |
|------|--------|
| `src/index.ts` | Export `SonosHousehold`, `PlayerHandle` |
| `src/namespaces/BaseNamespace.ts` | Allow `NamespaceContext` to be constructed externally (for PlayerHandle) |
| `src/types/events.ts` | Add household-level events |
| `src/types/groups.ts` | No changes — types already sufficient |

### Unchanged

`SonosClient`, `SonosConnection`, `MessageCorrelator`, all existing namespace classes, error classes, and utility files remain unchanged. `SonosHousehold` wraps `SonosClient`; it does not modify it.

## SonosHousehold API

### Connection

```typescript
import { SonosHousehold } from 'sonos-ws';

const household = new SonosHousehold({
  host: '192.168.68.96',  // connect to any speaker in the household
  logger: consoleLogger,   // optional
  requestTimeout: 5000,    // optional
  reconnect: true,         // optional
});

await household.connect();
```

### Options Interface

```typescript
interface SonosHouseholdOptions {
  /** IP or hostname of any Sonos speaker in the household. */
  host: string;
  /** WebSocket port. @defaultValue 1443 */
  port?: number;
  /** Reconnection config. @defaultValue true */
  reconnect?: Partial<ReconnectOptions> | boolean;
  /** Custom logger. */
  logger?: Logger;
  /** Command timeout in ms. @defaultValue 5000 */
  requestTimeout?: number;
}
```

### Player Access

```typescript
// By display name (case-insensitive)
const arc = household.player('Arc');
const office = household.player('Office');
const bedroom = household.player('Bedroom');

// By RINCON ID
const arc = household.player('RINCON_38420BEE8DA901400');

// All players
household.players;  // Map<string, PlayerHandle>

// All current groups
household.groups;   // Group[]
```

`household.player()` throws if the name/ID is not found in the topology.

### PlayerHandle

A `PlayerHandle` is a lightweight object that provides the same namespace accessors as `SonosClient` but targets a specific player's group. It does not own a connection — it routes commands through the household's shared `SonosClient`.

```typescript
interface PlayerHandle {
  /** RINCON player ID. */
  readonly id: string;
  /** Display name (e.g. "Arc", "Office"). */
  readonly name: string;
  /** Current group ID this player belongs to. Refreshed on topology changes. */
  readonly groupId: string;
  /** Whether this player is the coordinator of its group. */
  readonly isCoordinator: boolean;
  /** Player capabilities from Sonos API. */
  readonly capabilities: PlayerCapability[];

  /** Group volume control — targets this player's group. */
  readonly groupVolume: GroupVolumeNamespace;
  /** Individual player volume control. */
  readonly playerVolume: PlayerVolumeNamespace;
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
}
```

Each namespace instance on a `PlayerHandle` is constructed with a `NamespaceContext` that returns the correct `groupId` and `playerId` for that player. The connection is shared. This means no overhead per player — just different IDs in the request headers.

### Grouping

#### `household.group(players, options?)`

Groups the specified players. The first player in the array becomes the coordinator.

```typescript
// Simple group — Arc becomes coordinator
await household.group([arc, office]);

// Group with automatic audio transfer
await household.group([arc, office], { transfer: true });

// Group with explicit audio source
await household.group([arc, office], { transfer: bedroom });

// Group all three
await household.group([arc, office, bedroom], { transfer: true });
```

**Options:**

```typescript
interface GroupOptions {
  /**
   * Audio transfer behavior:
   * - `undefined` (default): just group, don't transfer audio from outside the group.
   *   If a target player is playing, its audio continues on the group.
   * - `true`: automatically find the active audio source and transfer it.
   *   Checks target players first (by array order), then the rest of the household.
   *   For multiple sources outside the target group, prefers PLAYING over PAUSED,
   *   and uses the most recently active source when discernible.
   * - `PlayerHandle`: transfer audio from this specific player.
   */
  transfer?: boolean | PlayerHandle;
}
```

**Resolution logic for `transfer: true`:**

1. Scan target players (in array order) for `playbackState === PLAYING`. If found, make that player the coordinator (or keep it as coordinator if it already is). No shuffle needed if the playing player is first in the array.
2. If no target player is actively playing, check for `PAUSED` among target players (same array-order priority).
3. If no target player has audio, scan the rest of the household. Prefer `PLAYING` over `PAUSED`. For multiple candidates at the same state, pick the first one found (the Sonos API does not expose playback start time).
4. If nothing is playing or paused anywhere, group silently (no error).

**Resolution logic for `transfer: PlayerHandle`:**

1. If the specified player is in the target group, make it the coordinator (shuffle if needed).
2. If the specified player is NOT in the target group, add it temporarily, make the first target player the coordinator via shuffle, then the source drops out with its audio transferred.
3. If the specified player is not playing, throw an error.

**Coordinator shuffle procedure** (for transferring audio):

1. Add the target coordinator to the source's group via `modifyGroupMembers([targetId])`.
2. Remove the source coordinator via `modifyGroupMembers([], [sourceId])`. This causes an expected ~8 second timeout — handle it as normal, not an error.
3. The target inherits coordinator role and the audio source.
4. Add remaining target players to the new coordinator's group.
5. Refresh topology.

**Efficiency considerations:**

- If the desired coordinator is already the coordinator of a group that contains all the desired members, do nothing (no-op).
- If the desired coordinator is already playing and is the coordinator, just add/remove members without any shuffle.
- Only perform the shuffle when the audio source needs to change coordinators.
- Combine add/remove operations where possible — don't make sequential calls when one `modifyGroupMembers` call with both arrays can do it.

#### `household.ungroup(player)`

Removes a player from its current group. If the player is already solo, this is a no-op.

```typescript
await household.ungroup(office);  // Office goes solo
```

Internally calls `createGroup([playerId])` which pulls the player out into its own group.

#### `household.ungroupAll()`

Ungroups all players in the household. Each becomes its own group.

```typescript
await household.ungroupAll();
```

Calls `createGroup([playerId])` for each non-solo player.

### Topology Management

`SonosHousehold` maintains a live view of the household topology:

- **On connect:** calls `getGroups()` to populate `players` and `groups`.
- **On `groupCoordinatorChanged` event:** automatically calls `getGroups()` and updates all `PlayerHandle` groupIds. Emits `topologyChanged` event.
- **On reconnect:** refreshes topology and resubscribes.

```typescript
// React to topology changes
household.on('topologyChanged', (groups, players) => {
  console.log('Groups changed:', groups);
});
```

### Events

`SonosHousehold` emits all the same events as `SonosClient` (volume, playback, etc.) plus:

```typescript
interface SonosHouseholdEvents extends SonosEvents {
  /** Emitted when group topology changes (groups/players added/removed/reorganized). */
  topologyChanged: (groups: Group[], players: Player[]) => void;
}
```

### Disconnect

```typescript
await household.disconnect();
```

Disconnects the underlying `SonosClient`.

## Error Handling

### New Error Cases

| Scenario | Behavior |
|----------|----------|
| `player('Unknown')` — name not in topology | Throw `SonosError` with code `PLAYER_NOT_FOUND` |
| `group([])` — empty array | Throw `SonosError` with code `INVALID_PARAMETER` |
| `group([arc])` — single player | No-op if already solo; otherwise calls `createGroup` |
| `transfer: bedroom` but bedroom is idle | Throw `SonosError` with code `NO_CONTENT` |
| `transfer: true` but nothing playing anywhere | Group silently (no error) — this is "just group" fallback |
| `ungroup(arc)` — arc is already solo | No-op |
| Coordinator shuffle timeout (~8s) | Handle gracefully — this is expected, not an error |
| Network error during multi-step group operation | Refresh topology, throw with partial state info |

### New Error Codes

Add to `ErrorCode` enum:

```typescript
PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
NO_CONTENT = 'NO_CONTENT',
GROUP_OPERATION_FAILED = 'GROUP_OPERATION_FAILED',
```

## Neurotto Integration Updates

### Fix Sonos.ts Type Errors

Current type errors in `src/classes/utility/Sonos.ts`:

1. `getVolume()` returns `GroupVolumeStatus`, not a plain number — destructure correctly
2. `setVolume()` returns `Promise<void>`, not a volume object — adjust `.then()` chain
3. `togglePlayback()` should be `togglePlayPause()`
4. Hardcoded lines with `setRelativeVolume(5)` and `setMute(false)` at top of `volume()` — remove

### Update Sonos.ts to Use SonosHousehold

Replace `SonosClient` with `SonosHousehold`. Store player handles for named access:

```typescript
import { SonosHousehold, PlayerHandle } from 'sonos-ws';

class Sonos {
  household: SonosHousehold;
  arc: PlayerHandle;

  async init() {
    this.household = new SonosHousehold({ host: '192.168.68.96', logger: this.log });
    
    this.household.on('error', (e) => this.log.error('ERROR', e.message));
    this.household.on('topologyChanged', (groups) => this.log.info('Topology changed'));
    
    await this.household.connect();
    
    this.arc = this.household.player('Arc');
    
    await this.arc.groupVolume.subscribe();
    this.household.on('groupVolumeChanged', (v) => this.log.info('Volume:', v.volume));
  }

  async volume(arg) {
    // Use this.arc.groupVolume instead of this.client.groupVolume
  }

  async group(speakers: string[], options?) {
    const handles = speakers.map(name => this.household.player(name));
    await this.household.group(handles, options);
  }
}
```

### Update API.ts Sonos Command

The `sonos` command handler's `group` action should pass through to the new implementation:

```
sonos group Arc Office            → household.group([arc, office])
sonos group Arc Office transfer   → household.group([arc, office], { transfer: true })
sonos group Arc Office from:Bed   → household.group([arc, office], { transfer: bedroom })
```

## Verification

1. **Unit test: PlayerHandle routing** — create two PlayerHandles, verify they send different groupIds in requests.
2. **Integration test: group/ungroup** — group Office with Arc, verify topology, ungroup, verify.
3. **Integration test: transfer: true** — play audio on one speaker, group to another with transfer, verify audio continues.
4. **Integration test: topology auto-refresh** — group speakers via Sonos app, verify household.groups updates.
5. **Neurotto E2E: volume control** — press Harmony volume, verify OSD appears, verify volume changes.
6. **Neurotto E2E: grouping** — send `sonos group Arc Office` command, verify speakers group.

## Scope Boundaries

**In scope:**
- `SonosHousehold` class with player handles
- Grouping, ungrouping, audio transfer
- Topology auto-refresh
- Neurotto Sonos.ts type fixes and migration to SonosHousehold
- JSDoc on all new public API

**Out of scope (future work):**
- Sonos favorites/playlist management from Neurotto
- Auto-ungroup on TV input (requires Fire Cube CEC event detection — separate feature)
- Removing `node-sonos-ts` from Neurotto (wait until full migration is proven)
- Multi-household support
