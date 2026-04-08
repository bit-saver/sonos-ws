/**
 * Smoke test — run against a real Sonos speaker on the local network.
 *
 * Usage:
 *   npx tsx examples/smoke.ts [speaker-ip]
 *
 * If no IP is provided, SSDP discovery will be used.
 */

import { SonosClient, SonosDiscovery, consoleLogger } from '../src/index.js';

const host = process.argv[2];

async function main() {
  let speakerHost: string;

  if (host) {
    speakerHost = host;
    console.log(`Using provided host: ${speakerHost}`);
  } else {
    console.log('Discovering Sonos speakers...');
    const devices = await SonosDiscovery.discover({ timeout: 3000 });

    if (devices.length === 0) {
      console.error('No Sonos speakers found on the network.');
      process.exit(1);
    }

    console.log(`Found ${devices.length} device(s):`);
    for (const d of devices) {
      console.log(`  - ${d.roomName ?? d.model ?? 'Unknown'} @ ${d.host}`);
    }

    speakerHost = devices[0]!.host;
  }

  console.log(`\nConnecting to ${speakerHost}:1443...`);

  const client = new SonosClient({
    host: speakerHost,
    logger: consoleLogger,
  });

  client.on('connected', () => console.log('\n--- CONNECTED ---'));
  client.on('disconnected', (r) => console.log(`\n--- DISCONNECTED: ${r} ---`));
  client.on('error', (e) => console.error('\n--- ERROR ---', e.message));
  client.on('groupVolumeChanged', (v) => console.log('Volume event:', v));

  try {
    await client.connect();

    console.log(`Household: ${client.householdId ?? 'unknown'}`);
    console.log(`Group:     ${client.groupId ?? 'unknown'}`);
    console.log(`Player:    ${client.playerId ?? 'unknown'}`);

    const vol = await client.groupVolume.getVolume();
    console.log(`\nCurrent volume: ${vol.volume}, muted: ${vol.muted}`);

    await client.groupVolume.subscribe();
    console.log('Subscribed to groupVolume events. Listening for 10 seconds...');

    await new Promise((resolve) => setTimeout(resolve, 10000));

    await client.disconnect();
    console.log('\nDone.');
  } catch (err) {
    console.error('Failed:', err);
    process.exit(1);
  }
}

main();
