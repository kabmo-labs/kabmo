import { PanelPluginsSection } from '@/client/components/settings/categories/panel-plugins/Section';

/**
 * The Panel Plugins settings category.
 *
 * Its own category rather than a segment of LIBRARY → Plugins, because the two
 * are different nouns that only share the word "plugin": LIBRARY holds **omp's**
 * plugins (installed through `omp plugin`, with features, settings and
 * enablement), while this holds **Kabmo's** panel plugins — marketplaces
 * of sandboxed views, which omp has no concept of. Filing them together meant a
 * user looking for one found the other's install grammar and a Panels segment
 * that had nothing to do with omp's registry.
 *
 * The pane scrolls itself: this category is one of the full-bleed ones (no
 * modal padding), so the padding lives here.
 */
export function PanelPluginSettings() {
  return (
    <div className="flex-1 min-h-0 overflow-auto p-6 md:p-8">
      <div className="max-w-3xl">
        <PanelPluginsSection />
      </div>
    </div>
  );
}
