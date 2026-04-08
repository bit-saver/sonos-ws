# sonos-ws

TypeScript client for the Sonos local WebSocket Control API.

Connects directly to Sonos speakers over WebSocket (port 1443) using the same protocol as the Sonos S2 app. This provides faster response times and instant CEC notifications compared to the legacy UPnP/SOAP API (port 1400).

## Installation

```bash
npm install sonos-ws
```

## Quick Start

```typescript
import { SonosClient, SonosDiscovery } from 'sonos-ws';

// Discover speakers on the network
const devices = await SonosDiscovery.discover();
console.log(devices);

// Connect to a speaker
const client = new SonosClient({ host: '192.168.1.100' });
await client.connect();

// Volume control
const vol = await client.groupVolume.getVolume();
console.log(`Volume: ${vol.volume}, Muted: ${vol.muted}`);

await client.groupVolume.setRelativeVolume(5);
await client.groupVolume.setMute(false);

// Playback
await client.playback.play();
await client.playback.skipToNextTrack();

// Group management
const groups = await client.groups.getGroups();
await client.groups.modifyGroupMembers(['RINCON_xxx'], []);

// Subscribe to real-time events
await client.groupVolume.subscribe();
client.on('groupVolumeChanged', (data) => {
  console.log(`Volume: ${data.volume}`);
});

// Disconnect
await client.disconnect();
```

## API

### `SonosClient`

The main entry point. Connects to a Sonos speaker and exposes namespace objects for control.

```typescript
const client = new SonosClient({
  host: '192.168.1.100',     // Speaker IP address
  port: 1443,                // Default: 1443
  householdId: '...',        // Auto-discovered if omitted
  groupId: '...',            // Auto-discovered if omitted
  playerId: '...',           // Auto-discovered if omitted
  reconnect: {               // Or true/false
    enabled: true,
    initialDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    maxAttempts: Infinity,
  },
  logger: consoleLogger,     // Or any { error, warn, info, debug } object
  requestTimeout: 5000,      // Default: 5000ms
});
```

### Namespaces

| Namespace | Methods |
|-----------|---------|
| `client.groupVolume` | `getVolume`, `setVolume`, `setRelativeVolume`, `setMute`, `subscribe` |
| `client.playerVolume` | `getVolume`, `setVolume`, `setRelativeVolume`, `setMute`, `subscribe` |
| `client.groups` | `getGroups`, `createGroup`, `modifyGroupMembers`, `setGroupMembers`, `subscribe` |
| `client.playback` | `play`, `pause`, `togglePlayPause`, `stop`, `skipToNextTrack`, `skipToPreviousTrack`, `seek`, `seekRelative`, `getPlaybackStatus`, `setPlayModes`, `loadLineIn`, `subscribe` |
| `client.playbackMetadata` | `getMetadataStatus`, `subscribe` |
| `client.favorites` | `getFavorites`, `loadFavorite`, `subscribe` |
| `client.playlists` | `getPlaylists`, `getPlaylist`, `loadPlaylist`, `subscribe` |
| `client.audioClip` | `loadAudioClip`, `cancelAudioClip` |
| `client.homeTheater` | `getOptions`, `setOptions`, `subscribe` |
| `client.settings` | `getPlayerSettings`, `setPlayerSettings` |

### Events

```typescript
client.on('connected', () => {});
client.on('disconnected', (reason: string) => {});
client.on('reconnecting', (attempt: number, delay: number) => {});
client.on('error', (error: Error) => {});

// Subscription events (call namespace.subscribe() first)
client.on('groupVolumeChanged', (data: GroupVolumeStatus) => {});
client.on('playerVolumeChanged', (data: PlayerVolumeStatus) => {});
client.on('groupsChanged', (data: GroupsResponse) => {});
client.on('playbackStatusChanged', (data: PlaybackStatus) => {});
client.on('metadataStatusChanged', (data: MetadataStatus) => {});
client.on('favoritesChanged', (data: FavoritesResponse) => {});
client.on('playlistsChanged', (data: PlaylistsResponse) => {});
client.on('homeTheaterChanged', (data: HomeTheaterOptions) => {});

// Raw messages (for debugging)
client.on('rawMessage', (message: SonosResponse) => {});
```

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
  await client.groupVolume.setVolume(50);
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
