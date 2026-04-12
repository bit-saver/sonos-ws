import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import type { GroupVolumeStatus, PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';

/**
 * Unified volume control for a Sonos player.
 *
 * Primary methods control the group volume (all speakers in this player's group).
 * The {@link player} sub-object controls this individual speaker within its group.
 */
export class VolumeControl {
  private readonly group: GroupVolumeNamespace;
  private readonly _player: PlayerVolumeNamespace;

  constructor(context: NamespaceContext) {
    this.group = new GroupVolumeNamespace(context);
    this._player = new PlayerVolumeNamespace(context);
  }

  /** Gets the current group volume level and mute status. */
  async get(): Promise<GroupVolumeStatus> {
    return this.group.getVolume();
  }

  /**
   * Sets the absolute group volume.
   * @param volume - Volume level (0–100).
   */
  async set(volume: number): Promise<void> {
    return this.group.setVolume(volume);
  }

  /**
   * Adjusts the group volume by a relative amount.
   * @param delta - Amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume status after the adjustment.
   */
  async relative(delta: number): Promise<GroupVolumeStatus> {
    await this.group.setRelativeVolume(delta);
    // Small delay for the device to process the change before reading back
    await new Promise((r) => setTimeout(r, 50));
    return this.group.getVolume();
  }

  /**
   * Mutes or unmutes the entire group.
   * @param muted - `true` to mute, `false` to unmute.
   */
  async mute(muted: boolean): Promise<void> {
    return this.group.setMute(muted);
  }

  /**
   * Subscribes to real-time group volume change events.
   * After subscribing, the household emits `volumeChanged` events.
   */
  async subscribe(): Promise<void> {
    return this.group.subscribe();
  }

  /** Unsubscribes from group volume events. */
  async unsubscribe(): Promise<void> {
    return this.group.unsubscribe();
  }

  /**
   * Per-speaker volume control.
   * Controls this individual speaker independently within its group.
   * Use this to adjust one speaker's volume without affecting others in the group.
   */
  readonly player = {
    /** Gets the current volume and mute status for this individual speaker. */
    get: (): Promise<PlayerVolumeStatus> => {
      return this._player.getVolume();
    },
    /**
     * Sets the absolute volume for this speaker.
     * @param volume - Volume level (0–100).
     * @param muted - Optionally set mute state simultaneously.
     */
    set: (volume: number, muted?: boolean): Promise<void> => {
      return this._player.setVolume(volume, muted);
    },
    /**
     * Adjusts this speaker's volume by a relative amount.
     * @param delta - Amount to adjust.
     * @returns The resulting volume level.
     */
    relative: (delta: number): Promise<VolumeResponse> => {
      return this._player.setRelativeVolume(delta);
    },
    /**
     * Mutes or unmutes this individual speaker.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute: (muted: boolean): Promise<void> => {
      return this._player.setMute(muted);
    },
    /** Subscribes to per-speaker volume events. */
    subscribe: (): Promise<void> => {
      return this._player.subscribe();
    },
    /** Unsubscribes from per-speaker volume events. */
    unsubscribe: (): Promise<void> => {
      return this._player.unsubscribe();
    },
  };
}
