import { expect, test } from 'bun:test';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { fileURLToPath } from 'node:url';
import { notesOptions } from '../release.config.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

/**
 * The notes plugin exactly as `release.config.mjs` hands it to semantic-release
 * — read from the named export, because the generator is a STEP KEY there now
 * (see `release/app-scope.js`).
 */
const notesConfig = notesOptions;

const MAINTAINER = '12345+kabmo-labs@users.noreply.github.com';

/** A commit shaped like the ones semantic-release collects from `git log`. */
const rawCommit = (hash, message, email) => ({
  hash,
  message,
  subject: message,
  author: { name: 'Author', email },
  committer: { name: 'Author', email },
});

const render = (commits) => generateNotes(notesConfig, {
  commits,
  lastRelease: { gitTag: 'v0.6.0', gitHead: 'a'.repeat(40) },
  nextRelease: { version: '0.7.0', gitTag: 'v0.7.0', gitHead: 'b'.repeat(40) },
  options: { repositoryUrl: 'https://github.com/kabmo-labs/kabmo.git' },
  cwd,
});

const bullets = (notes) => notes.split('\n').filter((line) => line.startsWith('* '));

test('credits a contributor, drops the maintainer, and keeps hidden types out', async () => {
  const notes = await render([
    rawCommit('c148bc5631cfcd2a034e05d650ee2a3ff0ea352a', 'feat(session): mark the live stream status at prompt dispatch, not agent_start', '12345+octocat@users.noreply.github.com'),
    rawCommit('9697514c3a32135308178e0025fb2a47d675bb43', 'fix(lifecycle): record the launch mode from argv, never from the environment', MAINTAINER),
    rawCommit('37f26fb7551cb78141a9961dbe6a54d9423bd93f', 'chore(pkg): declare author and license identity in the manifest', '12345+octocat@users.noreply.github.com'),
  ]);

  expect(bullets(notes)).toEqual([
    '* **session:** mark the live stream status at prompt dispatch, not agent_start ([c148bc5](https://github.com/kabmo-labs/kabmo/commit/c148bc5631cfcd2a034e05d650ee2a3ff0ea352a)) (thanks [@octocat](https://github.com/octocat))',
    '* **lifecycle:** record the launch mode from argv, never from the environment ([9697514](https://github.com/kabmo-labs/kabmo/commit/9697514c3a32135308178e0025fb2a47d675bb43))',
  ]);
});

test('resolves a contributor whose address is a real mailbox through the API', async () => {
  const fetchImpl = globalThis.fetch;
  const token = process.env.GITHUB_TOKEN;
  const calls = [];
  const hash = 'a25f8ca56727d59e8de606641e7cc5daee85dc9f';

  process.env.GITHUB_TOKEN = 'token';
  globalThis.fetch = async (url, init) => {
    calls.push([url, init.headers.authorization]);

    return { ok: true, status: 200, json: async () => ({ author: { login: 'mona', type: 'User' } }) };
  };

  try {
    const [bullet] = bullets(await render([
      rawCommit(hash, 'feat(update): restart the updated instance and leave servers started from source alone', 'mona@example.com'),
    ]));

    expect(calls).toEqual([[`https://api.github.com/repos/kabmo-labs/kabmo/commits/${hash}`, 'Bearer token']]);
    expect(bullet).toBe(`* **update:** restart the updated instance and leave servers started from source alone ([a25f8ca](https://github.com/kabmo-labs/kabmo/commit/${hash})) (thanks [@mona](https://github.com/mona))`);
  } finally {
    globalThis.fetch = fetchImpl;

    if (token === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = token;
    }
  }
});
