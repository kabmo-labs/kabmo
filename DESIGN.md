# DESIGN.md — Light 'E-Ink Paper' Developer Dashboard Spec

## 1. Palette & Surface Tokens

| Token | CSS Variable (Light) | Purpose |
|---|---|---|
| **App Canvas** | `var(--theme-canvas)` | Warm paper base ground |
| **Raised Paper** | `var(--theme-paper)` | Cards, sidebars, elevated surfaces |
| **Primary Ink** | `var(--theme-ink)` | High-contrast text, primary buttons, filled glyphs |
| **Secondary Ink** | `color-mix(in srgb, var(--theme-ink) 62%, transparent)` | Secondary labels, descriptions, durations |
| **Muted Meta** | `color-mix(in srgb, var(--theme-ink) 42%, transparent)` | Micro-headers, timestamps, subtle breadcrumbs |
| **Hairline Dividers** | `color-mix(in srgb, var(--theme-ink) 14%, transparent)` | 1px border lines and grid dividers |
| **Signal Red (Only Chroma)** | `var(--theme-error)` | Reserved strictly for failed build row & error log tail |

The system uses `data-theme` on the `html` tag to swap palettes (e.g., `one-dark-pro-soft`). Always use tailwind theme classes (e.g. `bg-canvas`, `text-ink`, `border-ink/20`) instead of raw hex values to ensure themes apply universally.

---

## 2. Typography & Hierarchy

- **UI Headings & Body**: `IBM Plex Sans` (Weights: 400 Regular, 500 Medium, 600 SemiBold)
- **Data & Telemetry**: `IBM Plex Mono` with `font-variant-numeric: tabular-nums` (commit hashes, durations, deploy IDs, log lines, stats)
- **Micro-Headers**: Uppercase `10.5px - 11px`, `weight: 600`, `letter-spacing: 0.08em`, muted ink.

---

## 3. Ink Status Glyph Vocabulary

Never use green, blue, or yellow. Semantic states are expressed purely in ink:
- **Ready**: Solid filled `#141310` circle (`r=6`)
- **Building**: Half-filled `#141310` ring with spinning animation
- **Queued**: Empty `1.5px` stroked ring
- **Canceled**: Dashed-stroke ring (`stroke-dasharray="3 3"`)
- **Failed**: Filled `#c8321e` circle with white `x` (only colored element on page)

---

## 4. Texture & Borders

- **Dot Grain Texture**: Faint radial dot-grain applied to the hero card:
  `radial-gradient(rgba(20, 19, 16, 0.06) 0.65px, transparent 0.65px)` with `4px` grid size.
- **Zero Drop Shadows**: Hierarchy is built exclusively through 1px hairline borders, font weights, and paper-ground tonal contrasts.
- **Zero Gradients**: Flat surfaces with clean ink borders.

---

## 5. Structural Layout

- **Left Sidebar**: Fixed ~240px with workspace switcher ('SD'), Cmd+K search, main nav with active 3px ink rule, environments group, build quota meter (412/600), and user row.
- **Navbar**: 52px height with breadcrumb, segmented All/Production/Preview pill control, ghost filter, right sidebar Kabmo toggle, and solid-ink Deploy button.
- **Hero Card**: Current production with 4-stage pipeline rail (Build, Test, Bundle, Deploy summing exactly to 2m 41s).
- **Deployments Table**: Dense table with ~44px rows, branch chips, commit messages, and redeploy action.
- **Bottom Split**: Last failed build log excerpt with signal red error lines + Deploys last 14 days stepped ink bar chart.
- **Right Sidebar**: Double panel containing the **AI Oh-My-Pi Chamber** (interactive prompt/diagnostic assistant) and **Deployment Inspector** (runtime properties & stage breakdown).
- **Provider Settings Controls**: Connected-provider sidebar, filtered New Provider preset picker, and Available Models actions (fetch, hide all, show all) with disabled/loading feedback.

---

## 6. Route Architecture & Domain Grouping

- **Hierarchical Modular Routes**: All routes in `app/routes/` are strictly organized into logical domain subdirectories (`api/settings/`, `api/chat/`, `api/fs/`, `api/terminal/`, `api/telemetry/`, `api/sessions/`, `api/files/`, `api/folders/`) rather than residing in a flat, unorganized directory.
- **Predictable REST Resource URI Mapping**: Nested endpoints reflect clean REST hierarchy (e.g., `/api/settings/agents`, `/api/settings/providers`, `/api/chat/:sessionId`, `/api/fs/git`).

---

## 7. Data Layer Architecture (Mock vs Real Mode)

- **Environment-Controlled Toggle (`MOCK=true` / `MOCK=false`)** — unset defaults to real data:
  - **`MOCK=true`**: Provides sample simulation states (token graphs, chat monologue traces, preset agent configs, demo workspace sessions) for standalone previews and diagnostic demonstrations.
  - **`MOCK=false` (default)**: Connects directly to real SQLite tables and workspace files with zero synthetic demo sessions or fake commit data.
