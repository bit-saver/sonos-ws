import { createSocket } from 'node:dgram';
import { get as httpGet } from 'node:http';

/** Configuration options for Sonos device discovery. */
export interface DiscoveryOptions {
  /** How long to listen for SSDP responses, in milliseconds. Defaults to 5000. */
  timeout?: number;
  /** Network interface IP address to bind the SSDP socket to. Useful on multi-homed systems. */
  interfaceAddress?: string;
}

/** A Sonos device discovered via SSDP/UPnP on the local network. */
export interface DiscoveredDevice {
  /** IP address of the discovered device. */
  host: string;
  /** WebSocket port for the Sonos Control API (always 1443). */
  port: number;
  /** Model name of the device (e.g. "Sonos Arc", "Sonos Era 300"). */
  model?: string;
  /** Hardware model number. */
  modelNumber?: string;
  /** Device serial number. */
  serialNumber?: string;
  /** Room name assigned to the device in the Sonos app. */
  roomName?: string;
  /** UPnP device description URL returned in the SSDP response. */
  location: string;
}

/** @internal SSDP multicast address. */
const SSDP_ADDRESS = '239.255.255.250';
/** @internal SSDP multicast port. */
const SSDP_PORT = 1900;
/** @internal UPnP search target for Sonos ZonePlayer devices. */
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';

/**
 * Discovers Sonos devices on the local network using SSDP (Simple Service Discovery Protocol).
 *
 * Sends an M-SEARCH multicast message and collects responses from Sonos ZonePlayers,
 * then fetches each device's UPnP description to obtain model and room information.
 */
export class SonosDiscovery {
  /**
   * Send an SSDP M-SEARCH and collect all responding Sonos devices.
   *
   * @param options - Discovery configuration (timeout, network interface).
   * @returns An array of discovered Sonos devices on the local network.
   */
  static async discover(options?: DiscoveryOptions): Promise<DiscoveredDevice[]> {
    const timeout = options?.timeout ?? 5000;
    const devices = new Map<string, DiscoveredDevice>();

    return new Promise((resolve) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });

      const message = Buffer.from(
        [
          'M-SEARCH * HTTP/1.1',
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          'MX: 2',
          `ST: ${SEARCH_TARGET}`,
          '',
          '',
        ].join('\r\n'),
      );

      const pendingFetches: Promise<void>[] = [];

      const timer = setTimeout(async () => {
        socket.close();
        await Promise.allSettled(pendingFetches);
        resolve([...devices.values()]);
      }, timeout);

      socket.on('message', (msg, rinfo) => {
        const response = msg.toString();
        const locationMatch = response.match(/LOCATION:\s*(.+)/i);
        if (!locationMatch?.[1]) return;

        const location = locationMatch[1].trim();
        const host = rinfo.address;

        if (!devices.has(host)) {
          const device: DiscoveredDevice = { host, port: 1443, location };
          devices.set(host, device);

          const fetchPromise = fetchDeviceDescription(location)
            .then((info) => {
              if (info) Object.assign(device, info);
            })
            .catch(() => {});
          pendingFetches.push(fetchPromise);
        }
      });

      socket.on('error', async () => {
        clearTimeout(timer);
        socket.close();
        await Promise.allSettled(pendingFetches);
        resolve([...devices.values()]);
      });

      if (options?.interfaceAddress) {
        socket.bind({ address: options.interfaceAddress }, () => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
        });
      } else {
        socket.bind(() => {
          socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS);
        });
      }
    });
  }

  /**
   * Convenience method that discovers Sonos devices and returns the first one found.
   *
   * @param options - Discovery configuration (timeout, network interface).
   * @returns The first discovered device, or `undefined` if none were found.
   */
  static async discoverOne(options?: DiscoveryOptions): Promise<DiscoveredDevice | undefined> {
    const devices = await SonosDiscovery.discover(options);
    return devices[0];
  }
}

/**
 * Fetch and parse a UPnP device description XML to extract model and room information.
 *
 * @internal
 * @param location - The UPnP device description URL from the SSDP response.
 * @returns Partial device info extracted from the XML, or `null` on failure.
 */
function fetchDeviceDescription(
  location: string,
): Promise<Partial<DiscoveredDevice> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);

    httpGet(location, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => {
        clearTimeout(timer);
        const model = body.match(/<modelName>(.+?)<\/modelName>/)?.[1];
        const modelNumber = body.match(/<modelNumber>(.+?)<\/modelNumber>/)?.[1];
        const serialNumber = body.match(/<serialNum>(.+?)<\/serialNum>/)?.[1];
        const roomName = body.match(/<roomName>(.+?)<\/roomName>/)?.[1];
        resolve({ model, modelNumber, serialNumber, roomName });
      });
      res.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    }).on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}
