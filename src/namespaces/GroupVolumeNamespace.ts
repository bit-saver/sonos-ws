import { BaseNamespace } from './BaseNamespace.js';
import type { GroupVolumeStatus, VolumeResponse } from '../types/volume.js';

export class GroupVolumeNamespace extends BaseNamespace {
  readonly namespace = 'groupVolume:1';

  async getVolume(): Promise<GroupVolumeStatus> {
    const response = await this.send('getVolume');
    return this.body(response) as unknown as GroupVolumeStatus;
  }

  async setVolume(volume: number): Promise<void> {
    await this.send('setVolume', { volume });
  }

  async setRelativeVolume(volumeDelta: number): Promise<VolumeResponse> {
    const response = await this.send('setRelativeVolume', { volumeDelta });
    return this.body(response) as unknown as VolumeResponse;
  }

  async setMute(muted: boolean): Promise<void> {
    await this.send('setMute', { muted });
  }
}
