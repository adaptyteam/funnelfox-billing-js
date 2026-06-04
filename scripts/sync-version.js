const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
// npm pack names scoped packages by stripping @ and replacing / with -
// e.g. @funnelfox/billing → funnelfox-billing
const pkgShortName = pkg.name.replace(/^@/, '').replace('/', '-');

// Sync SDK_VERSION in constants.ts
const constantsPath = path.join(__dirname, '../src/constants.ts');
const constants = fs.readFileSync(constantsPath, 'utf8');
const updatedConstants = constants.replace(
  /export const SDK_VERSION = '[^']+';/,
  `export const SDK_VERSION = '${version}';`
);
fs.writeFileSync(constantsPath, updatedConstants);

// Sync hardcoded tgz filename in build:examples
pkg.scripts['build:examples'] =
  `npm run build && npm pack && npm i ./${pkgShortName}-${version}.tgz --prefix examples/basic && npm run build --prefix examples/basic`;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Synced version ${version}`);
