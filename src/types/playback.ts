export enum PlaybackState {
  IDLE = 'PLAYBACK_STATE_IDLE',
  BUFFERING = 'PLAYBACK_STATE_BUFFERING',
  PLAYING = 'PLAYBACK_STATE_PLAYING',
  PAUSED = 'PLAYBACK_STATE_PAUSED',
}

export interface PlayModes {
  shuffle: boolean;
  repeat: boolean;
  repeatOne: boolean;
  crossfade: boolean;
}

export interface PlaybackActions {
  canSkip: boolean;
  canSkipBack: boolean;
  canSeek: boolean;
  canRepeat: boolean;
  canRepeatOne: boolean;
  canCrossfade: boolean;
  canShuffle: boolean;
  canPause: boolean;
  canStop: boolean;
}

export interface PlaybackStatus {
  playbackState: PlaybackState;
  queueVersion?: string;
  itemId?: string;
  positionMillis: number;
  previousPositionMillis?: number;
  playModes: PlayModes;
  availablePlaybackActions?: PlaybackActions;
}

export interface LoadLineInOptions {
  playerId?: string;
}
