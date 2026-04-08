import { BaseNamespace } from './BaseNamespace.js';
import type { MetadataStatus } from '../types/metadata.js';

export class PlaybackMetadataNamespace extends BaseNamespace {
  readonly namespace = 'playbackMetadata:1';

  async getMetadataStatus(): Promise<MetadataStatus> {
    const response = await this.send('getMetadataStatus');
    return this.body(response) as unknown as MetadataStatus;
  }
}
