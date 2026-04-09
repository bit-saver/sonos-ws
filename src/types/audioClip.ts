/** The type of audio clip to play. */
export enum ClipType {
  /** A built-in chime sound provided by the Sonos player. */
  CHIME = 'CHIME',
  /** A custom audio clip loaded from an external URL. */
  CUSTOM = 'CUSTOM',
}

/** Priority level for audio clip playback. */
export enum ClipPriority {
  /** Low priority; the clip may be skipped if another clip is already playing. */
  LOW = 'LOW',
  /** High priority; the clip will interrupt other clips and duck current audio. */
  HIGH = 'HIGH',
}

/** Options for playing an audio clip overlay on a Sonos player. */
export interface LoadAudioClipOptions {
  /** Display name for the audio clip. */
  name: string;
  /** Identifier of the application requesting the clip (e.g. "com.myapp.alerts"). */
  appId: string;
  /** Priority level for the clip. Defaults to {@link ClipPriority.LOW}. */
  priority?: ClipPriority;
  /** Whether to play a built-in chime or a custom audio URL. Defaults to {@link ClipType.CUSTOM}. */
  clipType?: ClipType;
  /** URL of the audio file to stream for custom clips. Required when clipType is CUSTOM. */
  streamUrl?: string;
  /** HTTP Authorization header value for accessing a protected streamUrl. */
  httpAuthorization?: string;
  /** Volume level for the clip (0--100). If omitted, plays at the player's current volume. */
  volume?: number;
}

/** Response returned after loading an audio clip. */
export interface AudioClipResponse {
  /** Unique identifier for this audio clip instance. */
  id: string;
  /** Display name of the audio clip. */
  name: string;
  /** Application ID that requested the clip. */
  appId: string;
  /** Current status of the audio clip (e.g. "ACTIVE", "DONE"). */
  status?: string;
}
