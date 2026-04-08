export interface ServiceInfo {
  name?: string;
  id?: string;
  imageUrl?: string;
}

export interface Track {
  name: string;
  artist?: string;
  album?: string;
  imageUrl?: string;
  durationMillis?: number;
  type?: string;
  service?: ServiceInfo;
  tags?: string[];
}

export interface TrackInfo {
  track: Track;
  deleted?: boolean;
}

export interface Container {
  name?: string;
  type?: string;
  id?: string;
  imageUrl?: string;
  service?: ServiceInfo;
  tags?: string[];
}

export interface MetadataStatus {
  container?: Container;
  currentItem?: TrackInfo;
  nextItem?: TrackInfo;
  streamInfo?: string;
}
