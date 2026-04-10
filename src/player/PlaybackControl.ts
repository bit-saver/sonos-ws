import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { PlaybackNamespace } from '../namespaces/PlaybackNamespace.js';
import { PlaybackMetadataNamespace } from '../namespaces/PlaybackMetadataNamespace.js';
import type { PlaybackStatus, PlayModes, LoadLineInOptions } from '../types/playback.js';
import type { MetadataStatus } from '../types/metadata.js';

/**
 * Playback and metadata control for a Sonos player's group.
 *
 * Combines the `playback:1` and `playbackMetadata:1` namespaces into
 * a single interface — playback state and track metadata are always
 * about the same thing (what's currently playing).
 */
export class PlaybackControl {
  private readonly pb: PlaybackNamespace;
  private readonly meta: PlaybackMetadataNamespace;

  constructor(context: NamespaceContext) {
    this.pb = new PlaybackNamespace(context);
    this.meta = new PlaybackMetadataNamespace(context);
  }

  /** Starts or resumes playback. */
  async play(): Promise<void> { return this.pb.play(); }

  /** Pauses playback. */
  async pause(): Promise<void> { return this.pb.pause(); }

  /** Toggles between play and pause. */
  async togglePlayPause(): Promise<void> { return this.pb.togglePlayPause(); }

  /** Stops playback entirely. */
  async stop(): Promise<void> { return this.pb.stop(); }

  /** Skips to the next track in the queue. */
  async skipToNextTrack(): Promise<void> { return this.pb.skipToNextTrack(); }

  /** Skips to the previous track. */
  async skipToPreviousTrack(): Promise<void> { return this.pb.skipToPreviousTrack(); }

  /**
   * Seeks to an absolute position in the current track.
   * @param positionMillis - Position in milliseconds.
   */
  async seek(positionMillis: number): Promise<void> { return this.pb.seek(positionMillis); }

  /**
   * Seeks forward or backward by a relative amount.
   * @param deltaMillis - Amount in milliseconds (positive = forward, negative = backward).
   */
  async seekRelative(deltaMillis: number): Promise<void> { return this.pb.seekRelative(deltaMillis); }

  /** Gets the current playback state, position, and play modes. */
  async getStatus(): Promise<PlaybackStatus> { return this.pb.getPlaybackStatus(); }

  /**
   * Sets shuffle, repeat, crossfade modes.
   * @param modes - Partial play modes to update.
   */
  async setPlayModes(modes: Partial<PlayModes>): Promise<void> { return this.pb.setPlayModes(modes); }

  /**
   * Switches playback to a line-in source.
   * @param options - Optional line-in configuration.
   */
  async loadLineIn(options?: LoadLineInOptions): Promise<void> { return this.pb.loadLineIn(options); }

  /** Gets metadata for the current track, container, and next item. */
  async getMetadata(): Promise<MetadataStatus> { return this.meta.getMetadataStatus(); }

  /** Subscribes to playback state change events. */
  async subscribe(): Promise<void> { await this.pb.subscribe(); }

  /** Unsubscribes from playback state events. */
  async unsubscribe(): Promise<void> { await this.pb.unsubscribe(); }
}
