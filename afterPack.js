const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // Just verify the unpacking worked
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName;
  
  console.log(`afterPack: Verifying better-sqlite3 packaging for ${platform}`);
  
  const asarUnpackDir = path.join(appOutDir, 'resources', 'app.asar.unpacked');
  const betterSqlitePath = path.join(asarUnpackDir, 'node_modules', 'better-sqlite3');
  const nativeModulePath = path.join(betterSqlitePath, 'build', 'Release', 'better_sqlite3.node');
  
  if (fs.existsSync(nativeModulePath)) {
    const stats = fs.statSync(nativeModulePath);
    console.log(`afterPack: better_sqlite3.node found (${stats.size} bytes, modified ${stats.mtime})`);
  } else {
    console.error('afterPack: better_sqlite3.node NOT FOUND!');
  }
};
