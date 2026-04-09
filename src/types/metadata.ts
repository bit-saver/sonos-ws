/** Information about a music service (e.g. Spotify, Apple Music, Amazon Music). */
export interface ServiceInfo {
  /** Display name of the music service. */
  name?: string;
  /** Unique identifier for the music service. */
  id?: string;
  /** URL to the music service's logo or icon. */
  imageUrl?: string;
}

/** Metadata for a single audio track. */
export interface Track {
  /** Track title. */
  name: string;
  /** Artist or performer name. */
  artist?: string;
  /** Album name. */
  album?: string;
  /** URL to the album art or track image. */
  imageUrl?: string;
  /** Track duration in milliseconds. */
  durationMillis?: number;
  /** Content type (e.g. "track", "show", "ad"). */
  type?: string;
  /** The music service this track originates from. */
  service?: ServiceInfo;
  /** Descriptive tags associated with the track. */
  tags?: string[];
}

/** Wrapper around {@link Track} that includes a deletion flag. */
export interface TrackInfo {
  /** The track metadata. */
  track: Track;
  /** Whether the track has been deleted from the music service. */
  deleted?: boolean;
}

/** Metadata for a container such as an album, playlist, or radio station. */
export interface Container {
  /** Container name (e.g. album title, playlist name). */
  name?: string;
  /** Container type (e.g. "album", "playlist", "station"). */
  type?: string;
  /** Unique identifier for the container. */
  id?: string;
  /** URL to the container's cover art or image. */
  imageUrl?: string;
  /** The music service this container originates from. */
  service?: ServiceInfo;
  /** Descriptive tags associated with the container. */
  tags?: string[];
}

/** Full metadata status for the current playback session. */
export interface MetadataStatus {
  /** The container (album, playlist, station) currently being played from. */
  container?: Container;
  /** Metadata for the currently playing track. */
  currentItem?: TrackInfo;
  /** Metadata for the next track in the queue. */
  nextItem?: TrackInfo;
  /** Stream information string for live or radio streams. */
  streamInfo?: string;
}
