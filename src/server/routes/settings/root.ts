import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { isMockMode } from '@/server/mock.server';
import { isPlainObject, mergeSettingsJson, readAllSettingsJson, writeSettingsJson, writeSettingsRaw } from '@/server/lib/db/settings-store';
import { packageDir } from '@/server/lib/fs/package-root';
import { refreshTrayIcon } from '@/server/lib/tray/runtime.server';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { TRAY_ICON_STYLE_SETTING_KEY } from '@/shared/lib/theme/tray-icon-style';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const settings = await readAllSettingsJson(db);
    return json({ settings, isMock: isMockMode() });
  } catch (error: any) {
    return json({ error: error.message, settings: {}, isMock: isMockMode() }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  try {
    const data = await request.json();
    const db = await getDb();

    // Data should be an object of key-value pairs. Object values merge into
    // whatever the key already holds, so a writer that sends one key's patch —
    // the settings modal now sends only what changed — cannot discard the keys
    // another writer stored in between. Arrays and scalars still replace.
    for (const [key, value] of Object.entries(data)) {
      if (isPlainObject(value)) {
        await mergeSettingsJson(db, key, value);
      } else if (typeof value === 'object') {
        await writeSettingsJson(db, key, value);
      } else {
        await writeSettingsRaw(db, key, String(value));
      }
    }

    // The tray host is a separate process that reads its config once, so a
    // change to the icon style (or the theme that picks the monochrome glyph's
    // ink) has to be pushed to it. A tray that is not running is a no-op, and a
    // failed refresh must not fail the settings write.
    const blob = data[SETTINGS_BLOB_KEY];
    if (isPlainObject(blob) && (TRAY_ICON_STYLE_SETTING_KEY in blob || 'theme' in blob)) {
      await refreshTrayIcon({ pkgRoot: packageDir() }).catch(() => {});
    }

    return json({ success: true });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
