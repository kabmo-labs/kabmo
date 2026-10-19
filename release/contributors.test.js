import { expect, test } from 'bun:test';
import { attachThanks, withThanksClause } from './contributors.js';

const HASH = 'c148bc5631cfcd2a034e05d650ee2a3ff0ea352a';

/** A commit as the notes generator hands it to the writer. */
const commit = (email, over = {}) => ({
  hash: HASH,
  subject: 'feat: something',
  author: { name: 'Author', email },
  ...over,
});

/** The changelog context the writer builds, plus a fetch that must not be reached. */
const request = (over = {}) => ({
  owner: 'kabmo-labs',
  host: 'https://github.com',
  repository: 'kabmo',
  token: 'token',
  fetchImpl: () => {
    throw new Error('unexpected request');
  },
  ...over,
});

const apiAnswer = (body) => {
  const calls = [];

  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);

      return { ok: true, status: 200, json: async () => body };
    },
  };
};

test('credits a contributor whose privacy address carries the login', async () => {
  const author = commit('12345+octocat@users.noreply.github.com');

  expect(await attachThanks([author], request())).toBe(1);
  expect(author.thanks).toBe('[@octocat](https://github.com/octocat)');
});

test('never credits the repository owner', async () => {
  const mine = commit('12345+kabmo-labs@users.noreply.github.com');

  expect(await attachThanks([mine], request())).toBe(0);
  expect(mine.thanks).toBeUndefined();
});

test('asks the API about a real mailbox and credits the login it reports', async () => {
  const { calls, fetchImpl } = apiAnswer({ author: { login: 'mona', type: 'User' } });
  const author = commit('mona@example.com');

  expect(await attachThanks([author], request({ fetchImpl }))).toBe(1);
  expect(calls).toEqual([`https://api.github.com/repos/kabmo-labs/kabmo/commits/${HASH}`]);
  expect(author.thanks).toBe('[@mona](https://github.com/mona)');
});

test('leaves bots and unattributed commits alone', async () => {
  const dependabot = commit('49699333+dependabot[bot]@users.noreply.github.com');
  const unverified = commit('nobody@example.com');
  const { calls, fetchImpl } = apiAnswer({ author: null });

  expect(await attachThanks([dependabot, unverified], request({ fetchImpl }))).toBe(0);
  expect(dependabot.thanks).toBeUndefined();
  expect(unverified.thanks).toBeUndefined();
  expect(calls).toHaveLength(1);
});

test('leaves an API-attributed bot alone', async () => {
  const app = commit('app@example.com');
  const { fetchImpl } = apiAnswer({ author: { login: 'dependabot[bot]', type: 'Bot' } });

  expect(await attachThanks([app], request({ fetchImpl }))).toBe(0);
  expect(app.thanks).toBeUndefined();
});

test('resolves each author once, however many commits they land', async () => {
  const { calls, fetchImpl } = apiAnswer({ author: { login: 'mona', type: 'User' } });

  expect(await attachThanks([commit('mona@example.com'), commit('mona@example.com')], request({ fetchImpl }))).toBe(2);
  expect(calls).toHaveLength(1);
});

test('keeps a release alive when the lookup fails', async () => {
  const failed = commit('mona@example.com', { hash: HASH });
  const refused = commit('octo@example.com', { hash: 'a'.repeat(40) });
  const { fetchImpl } = apiAnswer({ author: { login: 'mona', type: 'User' } });

  expect(
    await attachThanks([failed, refused], request({
      fetchImpl: async (url) => (url.endsWith(failed.hash) ? fetchImpl(url) : { ok: false, status: 403, json: async () => ({}) }),
    })),
  ).toBe(1);
  expect(
    await attachThanks([commit('unreachable@example.com')], request({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    })),
  ).toBe(0);
});

test('credits privacy addresses only when there is no token', async () => {
  const privacy = commit('12345+octocat@users.noreply.github.com');
  const real = commit('mona@example.com');

  expect(await attachThanks([privacy, real], request({ token: undefined }))).toBe(1);
  expect(privacy.thanks).toBe('[@octocat](https://github.com/octocat)');
  expect(real.thanks).toBeUndefined();
});

test('withThanksClause credits between the commit link and the closes list', () => {
  const partial = `* {{subject}} ([{{hash}}](url))\n\n{{~!-- commit references --}}\n{{~#if references~}}, closes{{~/if}}\n\n`;
  const updated = withThanksClause(partial);

  expect(updated.indexOf('{{#if thanks}}')).toBeGreaterThan(updated.indexOf('([{{hash}}](url))'));
  expect(updated.indexOf('{{#if thanks}}')).toBeLessThan(updated.indexOf('{{~#if references~}}'));
});

test('withThanksClause refuses a partial that lost the seam', () => {
  expect(() => withThanksClause('* {{subject}} ([{{hash}}](url))')).toThrow(/commit references/);
});
