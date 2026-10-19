// The file format the level editor saves (src/levels-custom.js) and the dev server's checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const IO = require('../src/custom-io.js');

const level = { name: 'Mine', map: ['#####', '#S.G#', '#===#', '#####'], coins: [{ x: 2, y: 1 }], editor: true };

test('a rendered file loads back as the same data', () => {
  const data = { overrides: { Tutorial: { ...level, name: 'Tutorial' } }, levels: [level] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jpm-')), 'levels-custom.js');
  fs.writeFileSync(file, IO.renderCustomFile(data));
  assert.deepEqual(require(file), data);
});

test('the shipped custom levels file is valid', () => {
  assert.equal(IO.checkCustomData(require('../src/levels-custom.js')), null);
});

test('bad data is refused before it can reach the disk', () => {
  assert.equal(IO.checkCustomData({ overrides: {}, levels: [level] }), null);
  assert.match(IO.checkCustomData(null), /object/);
  assert.match(IO.checkCustomData({ overrides: {}, levels: [{ ...level, map: ['#X#'] }] }), /map/);
  assert.match(IO.checkCustomData({ overrides: {}, levels: [{ ...level, map: ['####', '#S#', '####'] }] }), /map/);
  assert.match(IO.checkCustomData({ overrides: {}, levels: [level, level] }), /two custom levels/);
  assert.match(IO.checkCustomData({ overrides: { A: level }, levels: [] }), /different name/);
  assert.match(IO.checkCustomData({ overrides: {}, levels: [{ ...level, name: '' }] }), /name/);
  assert.match(IO.checkCustomData({ overrides: {}, levels: [{ ...level, coins: [{}] }] }), /position/);
});
