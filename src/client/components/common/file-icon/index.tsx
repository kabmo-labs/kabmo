import {
  Braces,
  File,
  FileArchive,
  FileCog,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
} from 'lucide-preact';
import type { ReactNode } from 'preact/compat';
import { BRAND_ICONS, BRAND_VIEWBOX, type BrandIconName } from '@/client/components/common/file-icon/brand-paths';
import { getImageMimeType } from '@/shared/lib/fs/file-kind';

interface FileIconProps {
  name: string;
  isFolder?: boolean;
  isOpen?: boolean;
  size?: number;
  className?: string;
}

/** A brand icon rendered from static path data. Painted with the official brand
 *  color by default; `monochrome` takes the surrounding ink instead, for
 *  surfaces that must stay free of chroma (the chat's tool cards). */
function BrandIconSvg({ name, size, className, monochrome = false }: { name: BrandIconName; size: number; className?: string; monochrome?: boolean }) {
  const brand = BRAND_ICONS[name];
  return (
    <svg
      viewBox={BRAND_VIEWBOX}
      width={size}
      height={size}
      fill={monochrome ? 'currentColor' : brand.color}
      className={className}
      aria-hidden="true"
    >
      <path d={brand.path} />
    </svg>
  );
}

/** Extension-keyed brand mapping: file types whose icon is an official language logo. */
const EXTENSION_BRANDS: ReadonlyArray<readonly [exts: readonly string[], brand: BrandIconName]> = [
  [['tsx', 'jsx'], 'React'],
  [['ts', 'mts', 'cts'], 'Typescript'],
  [['js', 'cjs', 'mjs'], 'Javascript'],
  [['go'], 'Go'],
  [['py', 'pyi'], 'Python'],
  [['rs'], 'Rust'],
  [['php'], 'Php'],
  [['kt', 'kts'], 'Kotlin'],
  [['swift'], 'Swift'],
  [['rb'], 'Ruby'],
  [['java'], 'Openjdk'],
  [['c', 'h'], 'C'],
  [['cpp', 'cc', 'cxx', 'hpp', 'hh'], 'Cplusplus'],
  [['cs'], 'Csharp'],
  [['zig'], 'Zig'],
  [['lua'], 'Lua'],
  [['dart'], 'Dart'],
  [['ex', 'exs'], 'Elixir'],
  [['hs'], 'Haskell'],
  [['scala'], 'Scala'],
  [['pl', 'pm'], 'Perl'],
  [['jl'], 'Julia'],
  [['r'], 'R'],
  [['vue'], 'Vuedotjs'],
  [['svelte'], 'Svelte'],
  [['astro'], 'Astro'],
];

/** Extension -> brand for the exact-match pass. */
const BRAND_BY_EXT: ReadonlyMap<string, BrandIconName> = (() => {
  const map = new Map<string, BrandIconName>();
  for (const [exts, brand] of EXTENSION_BRANDS) {
    for (const ext of exts) map.set(ext, brand);
  }
  return map;
})();

/** Spelled-out language names → the extension that names the same brand. */
const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  golang: 'go',
  rust: 'rs',
};

/** Brand logo for a tool's `language` id — the omp eval ids (`js`, `py`) and
 *  the spellings a file extension uses. Painted in the surrounding ink, never
 *  the brand's own color, so a tool card stays as monochrome as its neighbors.
 *  Returns null when the language has no brand mark, so the caller keeps its
 *  own generic glyph. */
export function languageBrandIcon(language: string, size = 14, className = ''): ReactNode {
  const id = language.trim().toLowerCase();
  const brand = BRAND_BY_EXT.get(LANGUAGE_ALIASES[id] ?? id);
  return brand ? <BrandIconSvg name={brand} size={size} className={className} monochrome /> : null;
}

export function FileIcon({ name, isFolder, isOpen, size = 14, className = '' }: FileIconProps) {
  const lowerName = name.toLowerCase();

  if (isFolder) {
    if (lowerName === 'node_modules') {
      return <BrandIconSvg name="Npm" size={size} className={className} />;
    }
    return isOpen
      ? <FolderOpen size={size} className={`text-meta ${className}`} />
      : <Folder size={size} className={`text-meta ${className}`} />;
  }

  if (lowerName === 'package.json') {
    return <BrandIconSvg name="Npm" size={size} className={className} />;
  }

  // Extension pass: brand logos first, keyed by extension.
  const dot = lowerName.lastIndexOf('.');
  if (dot >= 0) {
    const ext = lowerName.slice(dot + 1);
    const brand = BRAND_BY_EXT.get(ext);
    if (brand) return <BrandIconSvg name={brand} size={size} className={className} />;
  }

  if (lowerName.endsWith('.json')) {
    return <Braces size={size} color="#eab308" className={className} />;
  }
  if (lowerName.endsWith('.css') || lowerName.endsWith('.scss')) {
    return <BrandIconSvg name="Css" size={size} className={className} />;
  }
  if (lowerName.endsWith('.html')) {
    return <BrandIconSvg name="Html5" size={size} className={className} />;
  }
  // The documents the editor renders: a spreadsheet icon for the grid viewers, a
  // document icon for PDF/Word. Each has a viewer behind it, so the glyph is
  // what tells a user at a glance that the file opens as something other than
  // source text.
  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.xlsm')) {
    return <FileSpreadsheet size={size} color="#22c55e" className={className} />;
  }
  if (lowerName.endsWith('.pdf') || lowerName.endsWith('.docx')) {
    return <FileType size={size} color="#f97316" className={className} />;
  }
  if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
    return <FileText size={size} className={`text-ink/70 ${className}`} />;
  }
  // SVG is text the editor edits as code, but it is still a picture to the eye,
  // so the icon stays the image glyph for it.
  if (getImageMimeType(lowerName) || lowerName.endsWith('.svg')) {
    return <FileImage size={size} color="#c084fc" className={className} />;
  }
  if (lowerName.endsWith('.sh') || lowerName.endsWith('.bash')) {
    return <BrandIconSvg name="Gnubash" size={size} className={className} />;
  }
  if (lowerName.startsWith('.env') || lowerName.startsWith('.') || lowerName.includes('config')) {
    return <FileCog size={size} className={`text-ink/60 ${className}`} />;
  }
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar.gz')) {
    return <FileArchive size={size} className={`text-warning ${className}`} />;
  }

  return <File size={size} className={`text-ink/60 ${className}`} />;
}
