const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('desktop refuses to start without configured local credentials', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  for (const env of [{}, { AUTH_MANAGER_ACCOUNT: ' ' }]) {
    const context = {
      process: { env },
      require(name) {
        if (name === 'electron') return {
          app: { whenReady: () => ({ then() {} }), on() {} },
        };
        return require(name);
      },
    };
    assert.throws(
      () => vm.runInNewContext(source + '\nstartWorker();', context),
      /请先设置本机环境变量/,
    );
  }
});
