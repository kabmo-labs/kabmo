export interface ProjectConfigItem {
  id: string;
  folderId?: number;
  name: string;
  path: string;
  model: string;
  accentColor: string;
  icon: string;
  customIconUrl?: string;
  isPinned?: boolean;
  isExpanded?: boolean;
}

export interface AccentColorOption {
  label: string;
  value: string;
  bgHex: string;
}
