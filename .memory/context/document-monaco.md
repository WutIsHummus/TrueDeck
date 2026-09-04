# Document tabs use Monaco (IDE editor)

Document view edit mode is **Monaco** (same engine as VS Code):

- Syntax coloring by extension (TS/JS, JSON, CSS, HTML, Lua/Luau, Python, Rust, …)
- Built-in **lint/diagnostics** for TypeScript, JavaScript, JSON, CSS, HTML
- Line numbers, minimap, find (Ctrl+F), fold, bracket colors, sticky scroll
- Ctrl+S saves; markdown still has Read / Edit toggle

Code: `src/components/CodeEditor.tsx`, `src/lib/monaco-setup.ts`, `DocumentPane.tsx`.
