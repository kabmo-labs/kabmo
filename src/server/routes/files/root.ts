import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { getDb } from '@/server/db.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const db = await getDb();
  const sessionId = params.fileId;
  
  const files = await db.all('SELECT * FROM files WHERE session_id = ? ORDER BY type DESC, name ASC', [sessionId]);
  
  // Convert flat list to tree
  const fileMap = new Map();
  files.forEach(f => fileMap.set(f.id, { ...f, children: [] }));
  
  const rootFiles: any[] = [];
  
  files.forEach(f => {
    if (f.parent_id === null) {
      rootFiles.push(fileMap.get(f.id));
    } else {
      const parent = fileMap.get(f.parent_id);
      if (parent) {
        parent.children.push(fileMap.get(f.id));
      }
    }
  });

  return json({ files: rootFiles });
}
