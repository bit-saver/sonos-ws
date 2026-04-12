import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import type { GroupVolumeStatus, PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';
import type { SonosResponse } from '../types/messages.js';

/**
 * Unified volume control for a Sonos player.
 *
 * Primary methods control the group volume (all speakers in this player's group).
 * The {@link player} sub-object controls this individual speaker within its group.
 */
export class VolumeControl {
  private readonly group: GroupVolumeNamespace;
  private readonly _player: PlayerVolumeNamespace;
  private readonly context: NamespaceContext;

  constructor(context: NamespaceContext) {
    this.context = context;
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
    // Wait for the subscription event that confirms the volume change,
    // rather than polling getVolume (which can return stale data).
    const volumeEvent = new Promise<GroupVolumeStatus>((resolve) => {
      const timeout = setTimeout(() => {
        this.context.connection.off('message', handler);
        // Fallback to getVolume if no event arrives within 2s
        this.group.getVolume().then(resolve, () => resolve({ volume: 0, muted: false, fixed: false }));
      }, 2000);

      const handler = (msg: SonosResponse) => {
        const [headers, body] = msg;
        if (headers?.namespace === 'groupVolume:1' && body?._objectType === 'groupVolume') {
          clearTimeout(timeout);
          this.context.connection.off('message', handler);
          resolve(body as unknown as GroupVolumeStatus);
        }
      };

      this.context.connection.on('message', handler);
    });

    await this.group.setRelativeVolume(delta);
    return volumeEvent;
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
