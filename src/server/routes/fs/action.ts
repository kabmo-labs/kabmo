import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse } from '@/server/lib/route-adapter';
import fs from 'fs';
import path from 'path';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { runShell } from '@/server/lib/fs/shell';
import { revealInFileManager } from '@/server/lib/fs/reveal';
import { duplicateEntry, nextDuplicateName, pasteEntry } from '@/server/lib/fs/transfer';
import { transferRefusal } from '@/shared/lib/fs/clipboard';
import { toDiskText } from '@/shared/lib/code/line-endings';

/** The two shapes a transfer action answers with, ready for `json`. */
function transferResponse(outcome: { path?: string; error?: string; status?: number }) {
  if (outcome.error) return json({ error: outcome.error }, { status: outcome.status ?? 400 });
  return json({ success: true, path: outcome.path });
}

/**
 * The `duplicate` action: copy an entry beside itself under the `a copy.txt`
 * naming ladder.
 *
 * The name is chosen from the source's real directory listing (not a probe that
 * races the write), so the answer the panel renders and the file that landed
 * are the same name.
 */
async function runDuplicateAction(options: { filePath: string; scopedRoot: string }) {
  const { filePath, scopedRoot } = options;
  const source = resolveWithinRoot(scopedRoot, filePath);
  if (!source) return json({ error: 'Invalid path' }, { status: 403 });
  const kind = (await Bun.file(source).stat().catch(() => null))?.isDirectory() ? 'folder' : 'file';
  const destinationName = await nextDuplicateName(source, kind);
  return transferResponse(await duplicateEntry({ scopedRoot, sourcePath: source, destinationName }));
}

/**
 * `Paste` carries the clipboard ENTRY, not just its destination: the entry is
 * what the rule checks (a folder may not land in its own subtree) and what the
 * source path is resolved from, so the client cannot ask the server to move an
 * arbitrary pair of paths.
 *
 * The SCOPE half of `pasteRefusal` is deliberately not re-checked here: the
 * client's scope is built from the un-resolved `rootPath` (which may be
 * `~`-relative) while this side holds the resolved directory, so the two are
 * not comparable. `transferRefusal` is the half both ends can enforce.
 */
async function runPasteAction(options: { formData: FormData; scopedRoot: string }) {
  const { formData, scopedRoot } = options;
  const mode = formData.get('mode') === 'cut' ? 'cut' : 'copy';
  const sourceRel = ((formData.get('sourcePath') as string) ?? '').trim();
  const sourcePath = resolveWithinRoot(scopedRoot, sourceRel);
  if (!sourcePath) return json({ error: 'Invalid path' }, { status: 403 });
  const sourceStat = await Bun.file(sourcePath).stat().catch(() => null);
  if (!sourceStat) return json({ error: 'The entry on the clipboard no longer exists' }, { status: 404 });
  const rawTarget = ((formData.get('targetPath') as string) ?? '').trim() || '.';
  const rawTargetKind = formData.get('targetKind') === 'folder' ? 'folder' : 'file';
  const targetDir = rawTargetKind === 'folder' ? rawTarget : path.dirname(rawTarget);
  const refusal = transferRefusal(
    { path: sourceRel, kind: sourceStat.isDirectory() ? 'folder' : 'file' },
    targetDir,
  );
  if (refusal) return json({ error: refusal }, { status: 409 });
  const fullDir = resolveWithinRoot(scopedRoot, targetDir);
  if (!fullDir) return json({ error: 'Invalid path' }, { status: 403 });
  return transferResponse(await pasteEntry({ scopedRoot, sourcePath, destinationDir: fullDir, mode }));
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const actionType = formData.get('actionType') as string;
  const filePath = formData.get('path') as string;

  const rootDir = await resolveRoot(formData.get('root') as string, await getDefaultFsRoot(isMockMode()));
  const repo = (formData.get('repo') as string) || '.';
  const scopedRoot = repo === '.' ? rootDir : resolveWithinRoot(rootDir, repo);
  if (!scopedRoot) {
    return json({ error: 'Invalid repo path' }, { status: 403 });
  }

  try {
    if (actionType === 'duplicate') {
      return await runDuplicateAction({ filePath, scopedRoot });
    }
    if (actionType === 'paste') {
      return await runPasteAction({ formData, scopedRoot });
    }

    const fullPath = resolveWithinRoot(scopedRoot, filePath);

    if (!fullPath) {
      return json({ error: 'Invalid path' }, { status: 403 });
    }
    if (actionType === 'save') {
      const raw = (formData.get('content') as string) ?? '';
      const eol = formData.get('eol');
      // The bytes are built here rather than written verbatim: `multipart/
      // form-data` normalizes every bare LF in a field value to CRLF in transit
      // (the HTML serializer does it on the way out, Bun's parser agrees on the
      // way in — same result either way), so an LF file would land on disk as
      // CRLF and show up as a full-file diff. `eol` is the ending the client
      // read the file with; without it the payload is written untouched.
      const content = eol === 'crlf' || eol === 'lf' ? toDiskText(raw, eol) : raw;
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, content);
      return json({ success: true });
    } else if (actionType === 'create') {
      // The Files panel's "New file": an empty file beside the folder that was
      // right-clicked. Only a NAME is accepted, never a path — a separator
      // would let the panel write anywhere under the root, and the folder is
      // already named by `path`.
      const name = ((formData.get('name') as string) ?? '').trim();
      if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
        return json({ error: 'Enter a file name without slashes' }, { status: 400 });
      }
      const target = resolveWithinRoot(scopedRoot, path.join(filePath || '.', name));
      if (!target) {
        return json({ error: 'Invalid path' }, { status: 403 });
      }
      // Creating must never overwrite: a name that already exists is reported,
      // not truncated — the panel offers Rename for that, and an empty write
      // here would destroy the file the user meant to keep.
      if ((await Bun.file(target).stat().catch(() => null)) !== null) {
        return json({ error: `${name} already exists` }, { status: 409 });
      }
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await Bun.write(target, '');
      // Relative to the LISTED root, which is the identity the tree renders by.
      return json({ success: true, path: path.relative(scopedRoot, target).split(path.sep).join('/') });
    } else if (actionType === 'delete') {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      return json({ success: true });
    } else if (actionType === 'rename') {
      const newPath = formData.get('newPath') as string;
      const fullNewPath = path.resolve(rootDir, newPath);
      if (fullNewPath !== rootDir && !fullNewPath.startsWith(rootDir + path.sep)) {
        return json({ error: 'Invalid new path' }, { status: 403 });
      }
      await fs.promises.rename(fullPath, fullNewPath);
      return json({ success: true });
    } else if (actionType === 'open_explorer') {
      const isDir = (await Bun.file(fullPath).stat().catch(() => null))?.isDirectory() ?? false;
      // A file reveals its containing directory — there is no portable "select
      // this file" — so the opener is always handed a directory.
      const result = await revealInFileManager(isDir ? fullPath : path.dirname(fullPath));
      return result.ok ? json({ success: true }) : json({ error: result.error }, { status: 500 });
    } else if (actionType === 'git_history') {
      const targetDir = scopedRoot;
      const history = await runShell(
        `git log -n 50 --date-order --pretty=format:"|~|%h|~|%an|~|%ar|~|%s" -- "${filePath}"`,
        { cwd: targetDir, maxBuffer: 1024 * 1024 }
      );
      if (history.exitCode !== 0 && history.stderr.includes('not a git repository')) {
        return json({ error: 'Not a git repository' }, { status: 200 });
      }
      const parsedData = history.stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|~|');
        if (parts.length === 1) {
          return { graph: '', message: parts[0] };
        }
        return {
          graph: parts[0],
          hash: parts[1],
          author: parts[2],
          time: parts[3],
          message: parts[4]
        };
      });
      return json({ success: true, type: 'history', data: parsedData });
    }
    
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
