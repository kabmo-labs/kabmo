import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { discoverExtensions, setExtensionDisabled } from '@kabmo-labs/kabmo-omp-config-mcp/extensions';

export async function loader({ request }: LoaderFunctionArgs) {
  const mock = isMockMode();
  if (mock) {
    return json({ extensions: [], isMock: true });
  }
  const url = new URL(request.url);
  const cwd = url.searchParams.get('cwd') ?? undefined;
  return json({ extensions: await discoverExtensions(cwd), isMock: false });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json();
    if (typeof body.id !== 'string' || typeof body.disabled !== 'boolean') {
      return json({ error: 'id and disabled are required' }, { status: 400 });
    }
    if (isMockMode()) {
      return json({ error: 'Extension toggles are unavailable in mock mode' }, { status: 400 });
    }
    const changed = await setExtensionDisabled(body.id, body.disabled);
    return json({ success: true, changed });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
