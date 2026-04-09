import { BaseNamespace } from './BaseNamespace.js';
import type { PlaybackStatus, PlayModes, LoadLineInOptions } from '../types/playback.js';

/**
 * Controls playback for a Sonos group.
 *
 * Maps to the Sonos WebSocket Control API `playback:1` namespace.
 */
export class PlaybackNamespace extends BaseNamespace {
  readonly namespace = 'playback:1';

  /** Starts or resumes playback for the group. */
  async play(): Promise<void> {
    await this.send('play');
  }

  /** Pauses playback for the group. */
  async pause(): Promise<void> {
    await this.send('pause');
  }

  /** Toggles between play and pause for the group. */
  async togglePlayPause(): Promise<void> {
    await this.send('togglePlayPause');
  }

  /** Stops playback entirely for the group. */
  async stop(): Promise<void> {
    await this.send('stop');
  }

  /** Skips to the next track in the queue. */
  async skipToNextTrack(): Promise<void> {
    await this.send('skipToNextTrack');
  }

  /** Skips to the previous track in the queue. */
  async skipToPreviousTrack(): Promise<void> {
    await this.send('skipToPreviousTrack');
  }

  /**
   * Seeks to an absolute position in the current track.
   *
   * @param positionMillis - The target position in milliseconds from the start of the track.
   */
  async seek(positionMillis: number): Promise<void> {
    await this.send('seek', { positionMillis });
  }

  /**
   * Seeks forward or backward by a relative amount in the current track.
   *
   * @param deltaMillis - The offset in milliseconds (positive to seek forward, negative to seek backward).
   */
  async seekRelative(deltaMillis: number): Promise<void> {
    await this.send('seekRelative', { deltaMillis });
  }

  /**
   * Gets the current playback state, track position, and play modes.
   *
   * @returns The current playback status for the group.
   */
  async getPlaybackStatus(): Promise<PlaybackStatus> {
    const response = await this.send('getPlaybackStatus');
    return this.body(response) as unknown as PlaybackStatus;
  }

  /**
   * Sets the play modes for the group (shuffle, repeat, crossfade).
   *
   * @param playModes - An object containing the play mode properties to update.
   */
  async setPlayModes(playModes: Partial<PlayModes>): Promise<void> {
    await this.send('setPlayModes', { playModes });
  }

  /**
   * Switches playback to a line-in source.
   *
   * @param options - Optional configuration for the line-in source.
   */
  async loadLineIn(options?: LoadLineInOptions): Promise<void> {
    await this.send('loadLineIn', { ...options });
  }
}
