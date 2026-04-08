export enum ClipType {
  CHIME = 'CHIME',
  CUSTOM = 'CUSTOM',
}

export enum ClipPriority {
  LOW = 'LOW',
  HIGH = 'HIGH',
}

export interface LoadAudioClipOptions {
  name: string;
  appId: string;
  priority?: ClipPriority;
  clipType?: ClipType;
  streamUrl?: string;
  httpAuthorization?: string;
  volume?: number;
}

export interface AudioClipResponse {
  id: string;
  name: string;
  appId: string;
  status?: string;
}
