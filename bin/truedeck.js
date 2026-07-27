#!/usr/bin/env node
/**
 * TrueDeck CLI entry — full terminal UI (TUI).
 * Usage: truedeck [projectPath]
 */
const { spawn } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const entry = path.join(root, 'tui', 'index.ts')
const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const args = [tsx, entry, ...process.argv.slice(2)]

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env
})

child.on('exit', (code) => process.exit(code ?? 0))
