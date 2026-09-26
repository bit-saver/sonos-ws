# sonos-ws

TypeScript client for the Sonos local WebSocket Control API.

Connects directly to Sonos speakers over WebSocket (port 1443) using the same protocol as the Sonos S2 app. This provides faster response times and instant CEC notifications compared to the legacy UPnP/SOAP API (port 1400).

## Installation

```bash
npm install sonos-ws
```

## Quick Start

```typescript
import { SonosHousehold } from 'sonos-ws';

const household = new SonosHousehold({ host: '192.168.1.100' });
await household.connect();

const arc = household.player('Arc');
await arc.volume.group.relative(5);
await arc.playback.pause();

const office = household.player('Office');
await household.group([arc, office], { transfer: true });

household.on('volumeChanged', (data, source) => {
  console.log(`Group ${source.groupId}: ${data.volume}, muted: ${data.muted}`);
});

await household.disconnect();
```

`SonosHousehold` is the recommended API. It opens one WebSocket connection per speaker in the household, tracks group topology as it changes, and hands out a `PlayerHandle` per speaker (via `household.player(nameOrId)`) that routes every command through the right socket automatically.

## API

### `SonosClient`

A lighter alternative for controlling a single speaker directly, without discovering or connecting to the rest of the household. `host` must be that speaker's own IP address — Sonos reports it per player, and host names are not matched. Because it opens only one socket, group-level commands fail with `groupCoordinatorChanged` while this speaker is grouped under another speaker; use `SonosHousehold` once speakers are grouped.

```typescript
import { SonosClient } from 'sonos-ws';

const client = new SonosClient({ host: '192.168.1.100' });
await client.connect();

await client.volume.get();
await client.volume.group.set(30);
await client.playback.play();

await client.disconnect();
```

### Player controls

`SonosHousehold.player(nameOrId)` and `SonosClient` both expose the same `PlayerHandle` controls. Group-level commands — `volume.group.*`, everything under `playback`, and loading a favorite or a playlist — go through the group's current coordinator automatically, whichever speaker that is.

| Control | Methods |
|---|---|
| `volume` | `get`, `set`, `relative`, `mute`, `subscribe`, and `volume.group.{get,set,relative,mute,subscribe}` |
| `playback` | `play`, `pause`, `togglePlayPause`, `stop`, `skipToNextTrack`, `skipToPreviousTrack`, `seek`, `seekRelative`, `getStatus`, `setPlayModes`, `loadLineIn`, `getMetadata`, `subscribe`, `subscribeMetadata` |
| `favorites` | `get`, `load` |
| `playlists` | `get`, `getPlaylist`, `load` |
| `audioClip` | `load`, `cancel` |
| `homeTheater` | `get`, `set`, `subscribe` |
| `settings` | `get`, `set` |

### Events

```typescript
household.on('connected', () => {});
household.on('disconnected', (reason: string) => {});
household.on('reconnecting', (attempt: number, delay: number) => {});
household.on('error', (error: Error) => {});

// Subscription events (call the control's subscribe() first)
household.on('volumeChanged', (data: GroupVolumeStatus, source: SonosEventSource) => {});
household.on('playerVolumeChanged', (data: PlayerVolumeStatus, source: SonosEventSource) => {});
household.on('groupsChanged', (data: GroupsResponse, source: SonosEventSource) => {});
household.on('playbackChanged', (data: PlaybackStatus, source: SonosEventSource) => {});
household.on('metadataChanged', (data: MetadataStatus, source: SonosEventSource) => {});
household.on('favoritesChanged', (data: FavoritesResponse, source: SonosEventSource) => {});
household.on('playlistsChanged', (data: PlaylistsResponse, source: SonosEventSource) => {});
household.on('homeTheaterChanged', (data: HomeTheaterOptions, source: SonosEventSource) => {});
household.on('coordinatorChanged', (data: GroupCoordinatorChangedEvent, source: SonosEventSource) => {});

// Raw messages (for debugging)
household.on('rawMessage', (message: SonosResponse, source: SonosEventSource) => {});

// SonosHousehold only, no per-event source since it is already about the whole household
household.on('topologyChanged', (groups: Group[], players: Player[]) => {});
```

`source` (a `SonosEventSource`) holds the `playerId` or `groupId` the event is about — Sonos reports state, never who caused it, so an external Spotify or Sonos-app controller looks like any other change. Subscriptions are kept alive across reconnects and regroups automatically, once `subscribe()` has been called once.

### Discovery

```typescript
import { SonosDiscovery } from 'sonos-ws';

const devices = await SonosDiscovery.discover({ timeout: 5000 });
// [{ host, port, model, roomName, serialNumber, location }]

const device = await SonosDiscovery.discoverOne();
```

### Error Handling

```typescript
import { SonosError, ConnectionError, CommandError, TimeoutError } from 'sonos-ws';

try {
  await player.volume.group.set(50);
} catch (err) {
  if (err instanceof TimeoutError) {
    // Request timed out
  } else if (err instanceof CommandError) {
    // Sonos rejected the command
    console.log(err.code, err.message);
  } else if (err instanceof ConnectionError) {
    // WebSocket connection issue
  }
}
```

### Custom Logger

```typescript
import { SonosClient } from 'sonos-ws';

const client = new SonosClient({
  host: '192.168.1.100',
  logger: {
    error: (msg, ...args) => myLogger.error(msg, ...args),
    warn: (msg, ...args) => myLogger.warn(msg, ...args),
    info: (msg, ...args) => myLogger.info(msg, ...args),
    debug: (msg, ...args) => myLogger.debug(msg, ...args),
  },
});
```

## Protocol Details

This library communicates with Sonos speakers using the local WebSocket Control API:

- **URL:** `wss://{ip}:1443/websocket/api`
- **Sub-protocol:** `v1.api.smartspeaker.audio`
- **Auth:** `X-Sonos-Api-Key` header (public key, no OAuth required on local network)
- **Messages:** JSON arrays `[headers, body]`
- **TLS:** Self-signed certificates (accepted automatically)

This is the same API the Sonos S2 app uses for local control.

## Why Not UPnP?

The legacy UPnP/SOAP API (port 1400) batches CEC notifications, causing delayed volume OSD on connected TVs and skipping rapid button presses. The WebSocket API triggers immediate CEC notifications, matching the Sonos S2 app's behavior.

## License

MIT
