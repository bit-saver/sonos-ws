import { createSocket } from 'node:dgram';
import { get as httpGet } from 'node:http';

export interface DiscoveryOptions {
  timeout?: number;
  interfaceAddress?: string;
}

export interface DiscoveredDevice {
  host: string;
  port: number;
  model?: string;
  modelNumber?: string;
  serialNumber?: string;
  roomName?: string;
  location: string;
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';

export class SonosDiscovery {
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

  static async discoverOne(options?: DiscoveryOptions): Promise<DiscoveredDevice | undefined> {
    const devices = await SonosDiscovery.discover(options);
    return devices[0];
  }
}

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
