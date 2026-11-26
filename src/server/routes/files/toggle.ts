import { json } from '@kabmo-labs/kabmo-http';
import type { ActionFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const db = await getDb();
  const fileId = params.fileId;
  const formData = await request.formData();
  
  const isExpanded = formData.get('isExpanded') === 'true' ? 1 : 0;
  
  await db.run('UPDATE files SET is_expanded = ? WHERE id = ?', [isExpanded, fileId]);
  
  return json({ success: true, isExpanded });
}
