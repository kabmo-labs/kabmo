import type { LucideIcon } from 'lucide-preact';
import { BookOpen, Briefcase, Camera, Code2, Database, FlaskConical, Folder, Gamepad2, Globe, Heart, Home, Leaf, Lightbulb, Music, Palette, Plus, Rocket, Server, Shield, Smartphone, Terminal } from 'lucide-preact';
import type { ProjectConfigItem } from '@/shared/types';

interface ProjectSidebarListProps {
  projects: ProjectConfigItem[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
}

const ICON_MAP: Record<string, LucideIcon> = {
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

export function ProjectSidebarList({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
}: ProjectSidebarListProps) {
  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      {/* List Header */}
      <div className="px-3.5 py-3 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          Total {projects.length}
        </span>
        <button
          type="button"
          onClick={onAddProject}
          title="Add New Project"
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      {/* Projects List */}
      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-0.5">
        {projects.map((proj) => {
          const isSelected = proj.id === selectedProjectId;
          const IconComp = ICON_MAP[proj.icon] || Folder;

          return (
            <button
              key={proj.id}
              type="button"
              onClick={() => onSelectProject(proj.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer group ${
                isSelected
                  ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                  : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              {proj.customIconUrl ? (
                <img
                  src={proj.customIconUrl}
                  alt=""
                  className="w-3.5 h-3.5 rounded-xs object-contain flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <IconComp
                  size={14}
                  className="flex-shrink-0"
                  style={{
                    color: proj.accentColor || 'currentColor',
                  }}
                />
              )}
              <span className="text-[11.5px] truncate flex-1">
                {proj.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
