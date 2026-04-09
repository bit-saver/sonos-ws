import { BaseNamespace } from './BaseNamespace.js';
import type { MetadataStatus } from '../types/metadata.js';

/**
 * Retrieves metadata about the currently playing content for a Sonos group.
 *
 * Maps to the Sonos WebSocket Control API `playbackMetadata:1` namespace.
 */
export class PlaybackMetadataNamespace extends BaseNamespace {
  readonly namespace = 'playbackMetadata:1';

  /**
   * Gets metadata for the current track, its container, and the next queued item.
   *
   * @returns The metadata status including current track info, container details, and next item.
   */
  async getMetadataStatus(): Promise<MetadataStatus> {
    const response = await this.send('getMetadataStatus');
    return this.body(response) as unknown as MetadataStatus;
  }
}
