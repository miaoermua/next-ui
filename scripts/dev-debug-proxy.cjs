const { spawn } = require('node:child_process')

const child = spawn('pnpm', ['run', 'dev'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
  env: {
    ...process.env,
    DEBUG: process.env.DEBUG || 'vite:proxy'
  }
})

child.stdout.on('data', (chunk) => process.stdout.write(chunk))
child.stderr.on('data', (chunk) => process.stderr.write(chunk))
child.on('exit', (code) => process.exit(code ?? 0))
