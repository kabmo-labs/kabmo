import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import path from 'path';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { getDefaultFsRoot, resolveRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const q = formData.get('q') as string;
  const replaceWith = formData.get('replaceWith') as string;
  const matchCase = formData.get('matchCase') === 'true';
  const wholeWord = formData.get('wholeWord') === 'true';
  const useRegex = formData.get('useRegex') === 'true';
  const fileToReplace = formData.get('file') as string; // Optional: specific file to replace in
  const filesString = formData.get('files') as string; // Comma separated list of files to replace in

  if (!q) {
    return json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    const baseDir = await resolveRoot(formData.get('root') as string, await getDefaultFsRoot(isMockMode()));
    const targetDir = await scopeToRepo(baseDir, formData.get('repo') as string);
    let filesToProcess: string[] = [];

    if (fileToReplace) {
      filesToProcess = [fileToReplace];
    } else if (filesString) {
      filesToProcess = JSON.parse(filesString);
    } else {
       return json({ error: 'No files provided for replacement' }, { status: 400 });
    }

    // Build the regex for replacement
    let regexStr = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex if not using regex
    if (wholeWord) {
      regexStr = `\\b${regexStr}\\b`;
    }
    
    const flags = matchCase ? 'g' : 'gi';
    const regex = new RegExp(regexStr, flags);

    const results = [];

    for (const relFile of filesToProcess) {
      // Prevent directory traversal
      if (relFile.includes('..') || relFile.startsWith('/')) continue;
      
      const fullPath = path.join(targetDir, relFile);
      
      try {
        const content = await Bun.file(fullPath).text();
        if (regex.test(content)) {
          const newContent = content.replace(regex, replaceWith || '');
          await Bun.write(fullPath, newContent);
          results.push({ file: relFile, status: 'success' });
        }
      } catch (err) {
        console.error(`Failed to replace in ${relFile}:`, err);
        results.push({ file: relFile, status: 'error' });
      }
    }

    return json({ success: true, results });
  } catch (error: any) {
    console.error(error);
    return json({ error: String(error) }, { status: 500 });
  }
}
