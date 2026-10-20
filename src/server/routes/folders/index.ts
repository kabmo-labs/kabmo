import { actionBindings, bindingsFor, type HandlerBinding } from '@/server/lib/route-adapter';
import * as foldersCreate from '@/server/routes/folders/create';
import * as foldersClone from '@/server/routes/folders/clone';
import * as foldersMkdir from '@/server/routes/folders/mkdir';
import {
  deleteFolder,
  openFolder,
  pinFolder,
  toggleFolder,
  updateFolderSettings,
} from '@/server/routes/folders/folder';
import { batchDeleteFolders } from '@/server/routes/folders/batch-delete';

export const foldersBindings: HandlerBinding[] = [
  ...bindingsFor(foldersCreate, '/api/folders'),
  // Static segment, registered before `:folderId/*` for the same reason the
  // sessions batch route is: an id route must not swallow it.
  { method: 'POST', path: '/api/folders/batch-delete', handler: batchDeleteFolders },
  ...actionBindings(foldersClone.action, '/api/folders/clone'),
  ...actionBindings(foldersMkdir.action, '/api/folders/mkdir'),
  ...actionBindings(pinFolder, '/api/folders/:folderId/pin'),
  ...actionBindings(toggleFolder, '/api/folders/:folderId/toggle'),
  ...actionBindings(openFolder, '/api/folders/:folderId/open'),
  ...actionBindings(deleteFolder, '/api/folders/:folderId/delete'),
  ...actionBindings(updateFolderSettings, '/api/folders/:folderId/settings'),
];
