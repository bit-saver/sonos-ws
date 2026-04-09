import { BaseNamespace } from './BaseNamespace.js';
import type { PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';

/**
 * Controls volume for an individual Sonos player (single speaker).
 *
 * Maps to the Sonos WebSocket Control API `playerVolume:1` namespace.
 */
export class PlayerVolumeNamespace extends BaseNamespace {
  readonly namespace = 'playerVolume:1';

  /**
   * Gets the current player volume level and mute status.
   *
   * @returns The current volume and mute state for this player.
   */
  async getVolume(): Promise<PlayerVolumeStatus> {
    const response = await this.send('getVolume');
    return this.body(response) as unknown as PlayerVolumeStatus;
  }

  /**
   * Sets the absolute player volume, optionally setting the mute state at the same time.
   *
   * @param volume - The desired volume level (0--100).
   * @param muted - If provided, simultaneously sets the mute state (`true` to mute, `false` to unmute).
   */
  async setVolume(volume: number, muted?: boolean): Promise<void> {
    const body: Record<string, unknown> = { volume };
    if (muted !== undefined) body.muted = muted;
    await this.send('setVolume', body);
  }

  /**
   * Adjusts the player volume by a relative amount.
   *
   * @param volumeDelta - The amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level after the adjustment.
   */
  async setRelativeVolume(volumeDelta: number): Promise<VolumeResponse> {
    const response = await this.send('setRelativeVolume', { volumeDelta });
    return this.body(response) as unknown as VolumeResponse;
  }

  /**
   * Mutes or unmutes the player.
   *
   * @param muted - `true` to mute, `false` to unmute.
   */
  async setMute(muted: boolean): Promise<void> {
    await this.send('setMute', { muted });
  }
}
