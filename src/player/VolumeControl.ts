import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import type { GroupVolumeStatus, PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';
import type { SonosResponse } from '../types/messages.js';

/**
 * Volume control for a Sonos player.
 *
 * Primary methods control this individual speaker's volume.
 * The {@link group} sub-object controls the entire group's volume
 * (all speakers in the group adjust proportionally).
 */
export class VolumeControl {
  private readonly _group: GroupVolumeNamespace;
  private readonly _player: PlayerVolumeNamespace;
  private readonly coordinatorContext: NamespaceContext;

  /**
   * @param speakerContext — for per-speaker volume (playerVolume:1)
   * @param coordinatorContext — for group volume (groupVolume:1), routed through the coordinator's connection
   */
  constructor(speakerContext: NamespaceContext, coordinatorContext?: NamespaceContext) {
    this.coordinatorContext = coordinatorContext ?? speakerContext;
    this._group = new GroupVolumeNamespace(this.coordinatorContext);
    this._player = new PlayerVolumeNamespace(speakerContext);
  }

  // ── Individual speaker volume (default) ─────────────────────────────

  /** Gets the current volume and mute status for this speaker. */
  async get(): Promise<PlayerVolumeStatus> {
    return this._player.getVolume();
  }

  /**
   * Sets the absolute volume for this speaker.
   * @param volume - Volume level (0–100).
   * @param muted - Optionally set mute state simultaneously.
   */
  async set(volume: number, muted?: boolean): Promise<void> {
    return this._player.setVolume(volume, muted);
  }

  /**
   * Adjusts this speaker's volume by a relative amount.
   * @param delta - Amount to adjust (positive to increase, negative to decrease).
   * @returns The resulting volume level.
   */
  async relative(delta: number): Promise<VolumeResponse> {
    return this._player.setRelativeVolume(delta);
  }

  /**
   * Mutes or unmutes this individual speaker.
   * @param muted - `true` to mute, `false` to unmute.
   */
  async mute(muted: boolean): Promise<void> {
    return this._player.setMute(muted);
  }

  /** Subscribes to per-speaker volume events. */
  async subscribe(): Promise<void> {
    return this._player.subscribe();
  }

  /** Unsubscribes from per-speaker volume events. */
  async unsubscribe(): Promise<void> {
    return this._player.unsubscribe();
  }

  // ── Group volume ────────────────────────────────────────────────────

  /**
   * Group volume control.
   * Controls all speakers in this player's group proportionally.
   * Automatically routes through the group coordinator's connection.
   */
  readonly group = {
    /** Gets the current group volume level and mute status. */
    get: (): Promise<GroupVolumeStatus> => {
      return this._group.getVolume();
    },

    /**
     * Sets the absolute group volume.
     * @param volume - Volume level (0–100).
     */
    set: (volume: number): Promise<void> => {
      return this._group.setVolume(volume);
    },

    /**
     * Adjusts the group volume by a relative amount.
     * @param delta - Amount to adjust (positive to increase, negative to decrease).
     * @returns The resulting group volume status after the adjustment.
     */
    relative: async (delta: number): Promise<GroupVolumeStatus> => {
      // Wait for the subscription event that confirms the volume change.
      const volumeEvent = new Promise<GroupVolumeStatus>((resolve) => {
        const conn = this.coordinatorContext.connection;
        const timeout = setTimeout(() => {
          conn.off('message', handler);
          this._group.getVolume().then(resolve, () => resolve({ volume: 0, muted: false, fixed: false }));
        }, 2000);

        const handler = (msg: SonosResponse) => {
          const [headers, body] = msg;
          if (headers?.namespace === 'groupVolume:1' && body?._objectType === 'groupVolume') {
            clearTimeout(timeout);
            conn.off('message', handler);
            resolve(body as unknown as GroupVolumeStatus);
          }
        };

        conn.on('message', handler);
      });

      await this._group.setRelativeVolume(delta);
      return volumeEvent;
    },

    /**
     * Mutes or unmutes the entire group.
     * @param muted - `true` to mute, `false` to unmute.
     */
    mute: (muted: boolean): Promise<void> => {
      return this._group.setMute(muted);
    },

    /** Subscribes to group volume change events. */
    subscribe: (): Promise<void> => {
      return this._group.subscribe();
    },

    /** Unsubscribes from group volume events. */
    unsubscribe: (): Promise<void> => {
      return this._group.unsubscribe();
    },
  };
}
