/** Current volume state for a Sonos group. */
export interface GroupVolumeStatus {
  /** Current volume level (0--100). */
  volume: number;
  /** Whether the group is currently muted. */
  muted: boolean;
  /** Whether the group is in fixed volume mode (volume controlled externally, e.g. by a TV via HDMI ARC). */
  fixed: boolean;
}

/** Current volume state for an individual Sonos player. */
export interface PlayerVolumeStatus {
  /** Current volume level (0--100). */
  volume: number;
  /** Whether the player is currently muted. */
  muted: boolean;
  /** Whether the player is in fixed volume mode (volume controlled externally). */
  fixed: boolean;
}

/** Response returned from a relative volume adjustment. */
export interface VolumeResponse {
  /** The new volume level after the adjustment (0--100). */
  volume: number;
}
