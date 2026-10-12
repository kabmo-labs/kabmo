import { bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import { browseDirectories, listDirectory, listFiles, readFile, readReferencedFile } from '@/server/routes/fs/read';
import { fileExists } from '@/server/routes/fs/exists';
import { serveRawFile } from '@/server/routes/fs/raw';
import * as fsAction from '@/server/routes/fs/action';
import * as fsGit from '@/server/routes/fs/git';
import * as fsReplace from '@/server/routes/fs/replace';
import * as fsSearch from '@/server/routes/fs/search';
import * as fsValidate from '@/server/routes/fs/validate';

export const fsBindings: HandlerBinding[] = [
  ...bindingsFor(fsAction, '/api/fs/action'),
  ...bindingsFor(fsGit, '/api/fs/git'),
  ...bindingsFor(fsReplace, '/api/fs/replace'),
  ...bindingsFor(fsSearch, '/api/fs/search'),
  ...bindingsFor(fsValidate, '/api/fs/validate'),
  { method: 'GET', path: '/api/fs/browse', handler: browseDirectories },
  { method: 'GET', path: '/api/fs/dir', handler: listDirectory },
  { method: 'GET', path: '/api/fs/exists', handler: fileExists },
  { method: 'GET', path: '/api/fs/list', handler: listFiles },
  { method: 'GET', path: '/api/fs/read', handler: readFile },
  { method: 'GET', path: '/api/fs/read-reference', handler: readReferencedFile },
  { method: 'GET', path: '/api/fs/raw', handler: serveRawFile },
];
