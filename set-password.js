const path = require('node:path');
const { setAdminPassword } = require('./server');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'data', 'class-hub.sqlite');
let password = '';

process.stdout.write('New admin password: ');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  for (const character of chunk.toString('utf8')) {
    if (character === '\r' || character === '\n') {
      process.stdout.write('\n');
      try {
        setAdminPassword(databasePath, password);
        process.stdout.write('Admin password saved.\n');
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      }
      password = '';
      process.stdin.pause();
      return;
    }
    if (character === '\u0003') process.exit(130);
    if (character === '\b' || character === '\u007f') password = password.slice(0, -1);
    else password += character;
  }
});
