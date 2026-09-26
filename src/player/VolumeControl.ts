import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { GroupVolumeNamespace } from '../namespaces/GroupVolumeNamespace.js';
import { PlayerVolumeNamespace } from '../namespaces/PlayerVolumeNamespace.js';
import type { GroupVolumeStatus, PlayerVolumeStatus, VolumeResponse } from '../types/volume.js';
import type { SonosResponse } from '../types/messages.js';
import { settleAll } from '../util/settleAll.js';

/** How long group.relative waits for the groupVolume event before reading the volume instead. */
const RELATIVE_EVENT_WAIT_MS = 2000;

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

  /**
   * Re-sends the player and group volume subscriptions that are wanted.
   * @internal
   */
  async resubscribe(): Promise<void> {
    await settleAll([this._player.resubscribe(), this._group.resubscribe()], 'Failed to restore volume subscriptions');
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
      // setRelativeVolume replies with an empty body and an immediate getVolume still reads the old value, so take the
      // new volume from the groupVolume event — the one naming this group, since the socket carries every group's.
      const conn = this.coordinatorContext.connection;
      const groupId = this.coordinatorContext.getGroupId();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let handler: (msg: SonosResponse) => void = () => {};
      const stopWaiting = () => {
        clearTimeout(timer);
        conn.off('message', handler);
      };

      const volumeEvent = new Promise<GroupVolumeStatus>((resolve, reject) => {
        handler = (msg: SonosResponse) => {
          const [headers, body] = msg;
          if (headers?.namespace === 'groupVolume:1' && headers.groupId === groupId && body?._objectType === 'groupVolume') {
            stopWaiting();
            resolve(body as unknown as GroupVolumeStatus);
          }
        };
        timer = setTimeout(() => {
          stopWaiting();
          // No event (likely nothing subscribed this group here), so read instead. A failed read rejects: an invented
          // volume would pass for a real one.
          this._group.getVolume().then(resolve, reject);
        }, RELATIVE_EVENT_WAIT_MS);
        conn.on('message', handler);
      });

      try {
        await this._group.setRelativeVolume(delta);
      } catch (err) {
        // Refused: leave nothing behind to fire later. volumeEvent never settles, so it cannot reject unhandled.
        stopWaiting();
        throw err;
      }
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
