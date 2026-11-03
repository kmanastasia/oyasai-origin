// git commit の前に npm run verify を走らせ、失敗したらコミットを止める（終了コード 2）。
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const command = JSON.parse(input || '{}').tool_input?.command ?? '';
if (!/\bgit\b[^;&|]*\bcommit\b/.test(command)) process.exit(0);

const result = spawnSync('npm', ['run', '--silent', 'verify'], { cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), encoding: 'utf8' });
if (result.status === 0) {
  console.log(result.stdout);
  process.exit(0);
}
process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}\nverify が通らなかったのでコミットを止めました。上の項目を直してから、もう一度コミットしてください。\n`);
process.exit(2);
