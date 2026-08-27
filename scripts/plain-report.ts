/**
 * Runs every rule test and prints the result in plain English.
 * No stack traces, no test-framework noise.
 *
 *   npm run check
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), '.test-results.json');
if (existsSync(OUT)) rmSync(OUT);

console.log('Checking the rules of CONTRACT // HITMAN. This takes a few seconds.\n');

const vitestEntry = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const run = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--reporter=json', '--outputFile=.test-results.json'],
  { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
);

if (!existsSync(OUT)) {
  console.log('Could not run the checks. The exact message was:\n');
  console.log(run.stderr || '(no message)');
  process.exit(1);
}

interface AssertionResult {
  title: string;
  status: string;
  failureMessages?: string[];
}
interface TestFileResult {
  name: string;
  assertionResults: AssertionResult[];
}

const report = JSON.parse(readFileSync(OUT, 'utf8')) as {
  testResults: TestFileResult[];
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
};

const groupNames: Record<string, string> = {
  'deck.test.ts': 'The deck and the setup',
  'hitman-and-angel.test.ts': 'Hitman cards, Angels and winning',
  'attack.test.ts': 'Attack and Full Attack',
  'quick-cards.test.ts': 'Quick cards and the reflex window',
  'lock-and-steal.test.ts': 'Lock, Steal and Mimic',
  'turns-and-cards.test.ts': 'Turns, timers and the rest of the cards',
  'hidden-information.test.ts': 'Keeping hands and the deck secret',
  'soak.test.ts': 'Hundreds of whole matches played end to end',
  'room.test.ts': 'Private rooms, invite codes and dropped connections',
};

const failures: { title: string; message: string }[] = [];

for (const file of report.testResults) {
  const base = file.name.split(/[\\/]/).pop() ?? file.name;
  console.log(`\n${groupNames[base] ?? base}`);
  console.log('-'.repeat((groupNames[base] ?? base).length));
  for (const t of file.assertionResults) {
    if (t.status === 'passed') {
      console.log(`  OK    ${t.title}`);
    } else {
      console.log(`  FAIL  ${t.title}`);
      failures.push({
        title: t.title,
        message: (t.failureMessages ?? []).join('\n').split('\n')[0] ?? 'no detail',
      });
    }
  }
}

console.log('\n' + '='.repeat(60));
console.log(`${report.numPassedTests} of ${report.numTotalTests} rules behave correctly.`);

if (report.numFailedTests > 0) {
  console.log(`\n${report.numFailedTests} rule(s) are wrong:\n`);
  for (const f of failures) console.log(`  - ${f.title}\n    ${f.message}`);
  console.log('\nCopy the lines above and send them to me.');
  process.exit(1);
}

console.log('Every rule in the brief behaves the way it is supposed to.');
rmSync(OUT, { force: true });
