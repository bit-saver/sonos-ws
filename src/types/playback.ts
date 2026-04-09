/** Possible playback states for a Sonos player or group. */
export enum PlaybackState {
  /** No content loaded or playback has finished. */
  IDLE = 'PLAYBACK_STATE_IDLE',
  /** Loading content for playback. */
  BUFFERING = 'PLAYBACK_STATE_BUFFERING',
  /** Actively playing audio. */
  PLAYING = 'PLAYBACK_STATE_PLAYING',
  /** Playback is paused. */
  PAUSED = 'PLAYBACK_STATE_PAUSED',
}

/** Playback mode settings that control queue behavior. */
export interface PlayModes {
  /** Whether to randomize track order in the queue. */
  shuffle: boolean;
  /** Whether to repeat the entire queue when it finishes. */
  repeat: boolean;
  /** Whether to repeat the current track continuously. */
  repeatOne: boolean;
  /** Whether to crossfade between tracks. */
  crossfade: boolean;
}

/** Indicates which playback actions are currently available for the session. */
export interface PlaybackActions {
  /** Whether the player can skip to the next track. */
  canSkip: boolean;
  /** Whether the player can skip back to the previous track. */
  canSkipBack: boolean;
  /** Whether the player can seek within the current track. */
  canSeek: boolean;
  /** Whether repeat mode can be toggled. */
  canRepeat: boolean;
  /** Whether repeat-one mode can be toggled. */
  canRepeatOne: boolean;
  /** Whether crossfade mode can be toggled. */
  canCrossfade: boolean;
  /** Whether shuffle mode can be toggled. */
  canShuffle: boolean;
  /** Whether playback can be paused. */
  canPause: boolean;
  /** Whether playback can be stopped. */
  canStop: boolean;
}

/** Full playback state including position, modes, and available actions. */
export interface PlaybackStatus {
  /** The current playback state. */
  playbackState: PlaybackState;
  /** Version string for the current queue, used for cache invalidation. */
  queueVersion?: string;
  /** Identifier of the currently playing item in the queue. */
  itemId?: string;
  /** Current playback position in milliseconds. */
  positionMillis: number;
  /** Previous playback position in milliseconds (before a seek or track change). */
  previousPositionMillis?: number;
  /** Current playback mode settings (shuffle, repeat, crossfade). */
  playModes: PlayModes;
  /** Which playback actions are currently available. */
  availablePlaybackActions?: PlaybackActions;
}

/** Options for loading a line-in audio source. */
export interface LoadLineInOptions {
  /** The player ID whose line-in input to use. If omitted, defaults to the group coordinator. */
  playerId?: string;
}
