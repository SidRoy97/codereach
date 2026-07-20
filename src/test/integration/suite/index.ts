import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

// I discover every compiled test in this folder and run them under Mocha.
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  const testsRoot = __dirname;
  const files = await glob('**/*.test.js', { cwd: testsRoot });
  files.forEach(file => mocha.addFile(path.resolve(testsRoot, file)));

  await new Promise<void>((resolve, reject) => {
    mocha.run(failures => failures > 0 ? reject(new Error(`${failures} tests failed`)) : resolve());
  });
}
