import { BaseNamespace } from './BaseNamespace.js';
import type { GroupVolumeStatus, VolumeResponse } from '../types/volume.js';

/**
 * Controls volume for an entire Sonos group (all speakers in the group).
 *
 * Maps to the Sonos WebSocket Control API `groupVolume:1` namespace.
 */
export class GroupVolumeNamespace extends BaseNamespace {
  readonly namespace = 'groupVolume:1';

  /**
   * Gets the current group volume level and mute status.
   *
   * @returns The current volume and mute state for the group.
   */
  async getVolume(): Promise<GroupVolumeStatus> {
    const response = await this.send('getVolume');
    return this.body(response) as unknown as GroupVolumeStatus;
  }

  /**
   * Sets the absolute group volume.
   *
   * @param volume - The desired volume level (0--100).
   */
  async setVolume(volume: number): Promise<void> {
    await this.send('setVolume', { volume });
  }

  /**
   * Adjusts the group volume by a relative amount.
   *
   * @param volumeDelta - The amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level after the adjustment.
   */
  async setRelativeVolume(volumeDelta: number): Promise<VolumeResponse> {
    const response = await this.send('setRelativeVolume', { volumeDelta });
    return this.body(response) as unknown as VolumeResponse;
  }

  /**
   * Mutes or unmutes the entire group.
   *
   * @param muted - `true` to mute, `false` to unmute.
   */
  async setMute(muted: boolean): Promise<void> {
    await this.send('setMute', { muted });
  }
}
