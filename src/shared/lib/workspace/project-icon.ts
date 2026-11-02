import { BookOpen, Briefcase, Camera, Code2, Database, FlaskConical, Folder, Gamepad2, Globe, Heart, Home, Leaf, Lightbulb, Music, Palette, Rocket, Server, Shield, Smartphone, Terminal } from 'lucide-preact';
import type { LucideIcon } from 'lucide-preact';

/**
 * The workspace icon set, in ONE table.
 *
 * Three surfaces draw a project's mark — the settings grid, the settings list
 * and every sidebar/mobile row — and each used to carry its own map. They had
 * already drifted (`default` was a folder in the sidebar and an ✕ in the
 * settings grid, which reads as "clear the icon"), so the ids, their labels and
 * the glyphs live here and the pickers iterate {@link PROJECT_ICON_OPTIONS}.
 */
const PROJECT_ICON_MAP: Record<string, LucideIcon> = {
  default: Folder,
  code: Code2,
  terminal: Terminal,
  rocket: Rocket,
  flask: FlaskConical,
  gamepad: Gamepad2,
  briefcase: Briefcase,
  home: Home,
  globe: Globe,
  leaf: Leaf,
  shield: Shield,
  palette: Palette,
  server: Server,
  smartphone: Smartphone,
  database: Database,
  lightbulb: Lightbulb,
  music: Music,
  camera: Camera,
  book: BookOpen,
  heart: Heart,
};

export interface ProjectIconOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

/** Every pickable icon, in the grid's display order. */
export const PROJECT_ICON_OPTIONS: ProjectIconOption[] = [
  { id: 'default', label: 'Default folder', icon: Folder },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'rocket', label: 'Rocket', icon: Rocket },
  { id: 'flask', label: 'Flask', icon: FlaskConical },
  { id: 'gamepad', label: 'Gamepad', icon: Gamepad2 },
  { id: 'briefcase', label: 'Briefcase', icon: Briefcase },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'leaf', label: 'Leaf', icon: Leaf },
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'palette', label: 'Palette', icon: Palette },
  { id: 'server', label: 'Server', icon: Server },
  { id: 'smartphone', label: 'Smartphone', icon: Smartphone },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'lightbulb', label: 'Lightbulb', icon: Lightbulb },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'book', label: 'Book', icon: BookOpen },
  { id: 'heart', label: 'Heart', icon: Heart },
];

/** The glyph for a stored icon id, falling back to the plain folder. */
export function getProjectIcon(icon: string | undefined): LucideIcon {
  return PROJECT_ICON_MAP[icon || 'default'] || Folder;
}
