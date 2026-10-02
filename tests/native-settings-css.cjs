const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const projectRequire = createRequire(path.join(root, 'package.json'));
const postcss = projectRequire('postcss');
const tailwind = projectRequire('@tailwindcss/postcss');
let compilation;

function compileSettingsCss() {
  compilation ??= postcss([tailwind({ base: root, optimize: false })])
    .process(
      fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8') + '\n' +
      fs.readFileSync(path.join(root, 'app/settings.css'), 'utf8'),
      { from: path.join(root, 'app/globals.css') },
    ).then(({ css }) => css);
  return compilation;
}
module.exports = { compileSettingsCss };
