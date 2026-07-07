import { Sandbox } from 'e2b';

const E2B_API_KEY = 'e2b_ae6007c658dba002903fb926a53f910ec4cc0cc2';

async function test() {
  try {
    console.log('Testing E2B sandbox creation...');
    const sandbox = await Sandbox.create({ apiKey: E2B_API_KEY, timeoutMs: 60000 });
    console.log('✅ Sandbox created:', sandbox.sandboxId);

    console.log('Testing command execution...');
    const result = await sandbox.commands.run('echo hello && ls -la /home/user', { cwd: '/home/user' });
    console.log('stdout:', result.stdout);
    console.log('stderr:', result.stderr);
    console.log('exitCode:', result.exitCode);

    await sandbox.kill();
    console.log('✅ Sandbox killed');
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    if (err.stdout) console.error('stdout:', err.stdout);
    if (err.stderr) console.error('stderr:', err.stderr);
  }
}

test();
