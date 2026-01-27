const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // Ensure better-sqlite3 native module is properly copied
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName;
  
  console.log('afterPack: Ensuring better-sqlite3 is properly packaged for', platform);
  
  // The native module should already be handled by asarUnpack,
  // but we log to verify
  const asarUnpackDir = path.join(appOutDir, 'resources', 'app.asar.unpacked');
  if (fs.existsSync(asarUnpackDir)) {
    console.log('afterPack: app.asar.unpacked exists');
  } else {
    console.warn('afterPack: app.asar.unpacked does NOT exist');
  }
};
