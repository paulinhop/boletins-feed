import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const generator = fileURLToPath(new URL('./gerar-boletins.mjs', import.meta.url));
// Any network request is a failure; never contact a model or source.
const noNetwork = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("UNEXPECTED_NETWORK")};';
for (const provider of ['claude', 'openai', 'kimi', 'todos', 'claude-cli', 'codex-cli']) {
  test(`blocks ${provider} before network and file changes`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'medbrain-gateway-policy-'));
    try {
      const result = spawnSync(process.execPath, ['--import', noNetwork, generator, directory], {
        env: { ...process.env, PROVIDER: provider }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /IA_GATEWAY_ONLY/);
      assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
      assert.deepEqual(readdirSync(directory), []);
    } finally { rmdirSync(directory); }
  });
}
test('default requires local gateway credentials without fallback', () => {
  const env = { ...process.env };
  delete env.PROVIDER; delete env.IA_GATEWAY_URL; delete env.IA_GATEWAY_TOKEN;
  const result = spawnSync(process.execPath, ['--import', noNetwork, generator], {
    env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /IA_GATEWAY_URL e IA_GATEWAY_TOKEN/);
  assert.doesNotMatch(result.stderr, /UNEXPECTED_NETWORK/);
});
test('Actions does not schedule or pass model credentials for generation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/gerar-rascunho.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^\s*(schedule:|- cron:)/m);
  assert.doesNotMatch(workflow, /secrets\.|gerar-rascunho-e-pr\.sh/);
});
