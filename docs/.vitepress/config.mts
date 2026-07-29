import { defineConfig } from 'vitepress'

/**
 * TrueDeck documentation (VitePress).
 *
 * Local: npm run docs:dev
 * Build: npm run docs:build
 * GH Pages project site uses base `/TrueDeck/` via DOCS_BASE env.
 */
const base = process.env.DOCS_BASE || '/'

export default defineConfig({
 title: 'TrueDeck',
 description:
 'Agentic programming without the ops. Multi-agent coding deck for Grok, Codex, Cursor, Claude - real CLIs, panes, memory abstracted.',
 lang: 'en-US',
 cleanUrls: true,
 lastUpdated: true,
 base,
 appearance: 'dark',
 ignoreDeadLinks: [
 // Repo root files are outside the docs source tree
 /LICENSE/,
 /^https?:\/\/localhost/
 ],

 head: [
 ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }],
 ['meta', { name: 'theme-color', content: '#f0a050' }],
 ['meta', { property: 'og:type', content: 'website' }],
 ['meta', { property: 'og:title', content: 'TrueDeck' }],
 [
 'meta',
 {
 property: 'og:description',
 content:
 'Agentic programming without the ops. Multi-agent deck, real CLIs, memory handled for you.'
 }
 ],
 ['meta', { property: 'og:image', content: `${base}screenshot.png` }],
 ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
 ],

 themeConfig: {
 logo: '/favicon.svg',
 siteTitle: 'TrueDeck',
 outline: { level: [2, 3], label: 'On this page' },
 search: {
 provider: 'local'
 },
 socialLinks: [
 { icon: 'github', link: 'https://github.com/WutIsHummus/TrueDeck' }
 ],
 editLink: {
 pattern: 'https://github.com/WutIsHummus/TrueDeck/edit/master/docs/:path',
 text: 'Edit this page on GitHub'
 },
 lastUpdated: {
 text: 'Updated',
 formatOptions: { dateStyle: 'medium' }
 },
 footer: {
 message: 'MIT Licensed · Terminal-first multi-agent deck',
 copyright: 'Copyright © TrueDeck Contributors'
 },

 nav: [
 { text: 'Guide', link: '/' },
 { text: 'Get started', link: '/getting-started' },
 { text: 'Shortcuts', link: '/keyboard-shortcuts' },
 { text: 'Architecture', link: '/architecture' },
 {
 text: 'Reference',
 items: [
 { text: 'Configuration', link: '/configuration' },
 { text: 'MCP', link: '/mcp' },
 { text: 'Agents', link: '/agents' },
 { text: 'Memory', link: '/memory-providers' },
 { text: 'Glossary', link: '/glossary' },
 { text: 'Troubleshooting', link: '/troubleshooting' }
 ]
 },
 {
 text: 'v0.3',
 items: [
 {
 text: 'Changelog (README)',
 link: 'https://github.com/WutIsHummus/TrueDeck#whats-new-current'
 },
 {
 text: 'GitHub Releases',
 link: 'https://github.com/WutIsHummus/TrueDeck/releases'
 }
 ]
 }
 ],

 sidebar: [
 {
 text: 'Start',
 collapsed: false,
 items: [
 { text: 'Guide', link: '/' },
 { text: 'Getting started', link: '/getting-started' },
 { text: 'Keyboard shortcuts', link: '/keyboard-shortcuts' }
 ]
 },
 {
 text: 'Features',
 collapsed: false,
 items: [
 { text: 'Agents', link: '/agents' },
 { text: 'Task board', link: '/task-board' },
 { text: 'Agent chrome & frame', link: '/agent-frame' },
 { text: 'Configuration', link: '/configuration' },
 { text: 'MCP hub', link: '/mcp' },
 { text: 'Memory providers', link: '/memory-providers' }
 ]
 },
 {
 text: 'Internals',
 collapsed: false,
 items: [
 { text: 'Architecture', link: '/architecture' },
 { text: 'Fast PTY', link: '/FAST-PTY' },
 { text: 'Rust backend', link: '/RUST-BACKEND' },
 { text: 'Development', link: '/development' },
 { text: 'Troubleshooting', link: '/troubleshooting' },
 { text: 'Glossary', link: '/glossary' },
 { text: 'BridgeSpace parity', link: '/bridgespace-parity' }
 ]
 }
 ]
 },

 markdown: {
 theme: {
 light: 'github-light',
 dark: 'github-dark'
 },
 lineNumbers: false
 },

 vite: {
 server: { port: 5174, strictPort: false }
 }
})
