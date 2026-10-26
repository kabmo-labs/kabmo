import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse } from '@/server/lib/route-adapter';
import fs from 'fs';
import path from 'path';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, isWithinRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { runShell } from '@/server/lib/fs/shell';
import { revealInFileManager } from '@/server/lib/fs/reveal';
import { duplicateEntry, nextDuplicateName, pasteEntry, toRelPath } from '@/server/lib/fs/transfer';
import { normalizeRelativePath } from '@/server/lib/fs/relative-path';
import { checkWriteConflict, parseBaseMtime, stableMtime } from '@/server/lib/fs/write-conflict';
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
      // The buffer names the mtime it was read from. A file that moved since then
      // is a CONFLICT, not a failure: the verdict carries the current value so the
      // panel can offer Reload/Keep. A save with no base — a handle-backed file, an
      // older client — writes unconditionally, which is the pre-existing contract.
      const verdict = await checkWriteConflict(
        fullPath,
        parseBaseMtime(formData.get('baseMtime')),
        async (target) => {
          const stat = await Bun.file(target).stat().catch(() => null);
          return stat && !stat.isDirectory() ? { mtimeMs: stat.mtimeMs } : null;
        },
      );
      if (!verdict.write) {
        return json(
          {
            error: 'This file changed on disk since it was opened.',
            conflict: true,
            mtimeMs: verdict.diskMtimeMs,
          },
          { status: 409 },
        );
      }
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await Bun.write(fullPath, content);
      const written = await Bun.file(fullPath).stat().catch(() => null);
      return json({ success: true, mtimeMs: written ? stableMtime(written.mtimeMs) : null });
    } else if (actionType === 'create') {
      // The Files panel's "New file"/"New folder": an empty entry beside the
      // folder that was right-clicked. The NAME may carry segments
      // (`lib/parse.ts`), so one dialog creates a nested path and every
      // intermediate directory with it — the grammar that keeps it inside the
      // named folder lives in `normalizeRelativePath`, not in a slash test here.
      const kind = formData.get('kind') === 'folder' ? 'folder' : 'file';
      const name = normalizeRelativePath((formData.get('name') as string) ?? '');
      if (!name) {
        return json({ error: 'Enter a name without .. or a leading slash' }, { status: 400 });
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
      if (kind === 'folder') await fs.promises.mkdir(target, { recursive: true });
      else {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await Bun.write(target, '');
      }
      // Relative to the LISTED root, which is the identity the tree renders by.
      return json({ success: true, kind, path: toRelPath(scopedRoot, target) });
    } else if (actionType === 'delete') {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
      return json({ success: true });
    } else if (actionType === 'rename') {
      // `newPath` is relative to the LISTED root, exactly like `path` is. It
      // used to be resolved against `rootDir`, so renaming inside a nested repo
      // resolved to a path under the workspace root instead of the repo — a
      // move out of the tree the row belongs to.
      const newPath = normalizeRelativePath((formData.get('newPath') as string) ?? '');
      if (!newPath) {
        return json({ error: 'Enter a name without .. or a leading slash' }, { status: 400 });
      }
      const fullNewPath = resolveWithinRoot(scopedRoot, newPath);
      if (!fullNewPath) {
        return json({ error: 'Invalid new path' }, { status: 403 });
      }
      if (fullNewPath === fullPath) return json({ success: true, path: newPath, previousPath: filePath });
      const source = await Bun.file(fullPath).stat().catch(() => null);
      if (!source) return json({ error: 'That entry no longer exists' }, { status: 404 });
      // A folder cannot be moved into itself: `rename(a, a/b)` fails with
      // EINVAL on every platform, but with an errno the panel cannot explain —
      // and the destination directory may not exist yet, so the check has to be
      // on the PATHS rather than on the filesystem.
      if (source.isDirectory() && isWithinRoot(fullPath, fullNewPath)) {
        return json({ error: 'A folder cannot be moved inside itself' }, { status: 400 });
      }
      // `rename` clobbers silently, so an existing destination is refused: the
      // entry the user meant to keep would otherwise disappear without a word.
      if ((await Bun.file(fullNewPath).stat().catch(() => null)) !== null) {
        return json({ error: `${newPath} already exists` }, { status: 409 });
      }
      // The destination's parents are created, which is what makes a rename
      // INTO a new folder work — the same nested grammar the create accepts.
      await fs.promises.mkdir(path.dirname(fullNewPath), { recursive: true });
      await fs.promises.rename(fullPath, fullNewPath);
      return json({ success: true, path: newPath, previousPath: filePath });
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
