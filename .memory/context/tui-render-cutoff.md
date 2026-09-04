# Terminal TUI rendering cut-off

**Symptom:** Agent / deck TUI text looks cut off or half-erased until new output arrives.

**Causes fixed (2026-07):**
1. xterm canvas: `opacity:0` hide skipped compositing → use `visibility:hidden`; force `term.refresh` on show/idle/resize.
2. PTY write bursts: coalesce per rAF so clear+redraw frames land together.
3. UTF-8 split across rust-pty/backend base64 chunks → carry incomplete multi-byte tails.
4. Blessed TUI: `smartCSR` artifacts; preview `tags` + raw ANSI ate content; attach `onData` not disposed on detach.

**Key files:** `src/components/TerminalPane.tsx`, `src/styles.css`, `electron/main/rust-pty-host.ts`, `tui/index.ts`
