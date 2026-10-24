// Runs the Python test suite (apps/server/tests) inside the project venv.
process.argv.push('--test');
await import('./start-server.mjs');
