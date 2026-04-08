export type PlayerCapability =
  | 'PLAYBACK'
  | 'CLOUD'
  | 'HT_PLAYBACK'
  | 'HT_POWER_STATE'
  | 'AIRPLAY'
  | 'LINE_IN'
  | 'AUDIO_CLIP'
  | 'VOICE'
  | 'SPEAKER_DETECTION'
  | 'FIXED_VOLUME';

export interface Player {
  id: string;
  name: string;
  websocketUrl?: string;
  softwareVersion?: string;
  apiVersion?: string;
  minApiVersion?: string;
  capabilities: PlayerCapability[];
  deviceIds?: string[];
  icon?: string;
}

export interface Group {
  id: string;
  name: string;
  coordinatorId: string;
  playbackState?: string;
  playerIds: string[];
}

export interface GroupsResponse {
  groups: Group[];
  players: Player[];
}

export interface CreateGroupResponse {
  group: Group;
}

export interface ModifyGroupResponse {
  group: Group;
}
