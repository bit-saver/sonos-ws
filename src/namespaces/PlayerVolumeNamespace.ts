import { BaseNamespace } from './BaseNamespace.js';
import type { PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';

export class PlayerVolumeNamespace extends BaseNamespace {
  readonly namespace = 'playerVolume:1';

  async getVolume(): Promise<PlayerVolumeStatus> {
    const response = await this.send('getVolume');
    return this.body(response) as unknown as PlayerVolumeStatus;
  }

  async setVolume(volume: number, muted?: boolean): Promise<void> {
    const body: Record<string, unknown> = { volume };
    if (muted !== undefined) body.muted = muted;
    await this.send('setVolume', body);
  }

  async setRelativeVolume(volumeDelta: number): Promise<VolumeResponse> {
    const response = await this.send('setRelativeVolume', { volumeDelta });
    return this.body(response) as unknown as VolumeResponse;
  }

  async setMute(muted: boolean): Promise<void> {
    await this.send('setMute', { muted });
  }
}
