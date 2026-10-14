# Operator preferences (from Codex, Grok, and Cursor)

Gathered 2026-10-02 from the user's own messages. Search MemPalace room `preferences` and knowledge-graph entity `Operator`.

## How to work

- Pool and reuse instances, from UI through workspace objects. Do not recreate them every frame.
- Keep Heartbeat and simulation cheap. The server sends only the data that player needs. Animate on the client.
- Authored UI already exists. Change colors and text at runtime. Do not clone a fallback UI, and do not move GUI attachment positions at runtime.
- Use scale. Keep square art at 1:1. Pattern tiles are `{0, 96}, {0, 96}`. Pattern image color is black. Clip shines inside the rounded frame, and match the shine to that background.
- Match the game's real screens: image-label backgrounds, headers, pattern, and the existing font size.
- On mobile, leave the authored HUD where it is. Taps must hit the buttons. The move control must not open menus.
- Proximity prompts stay small. The hold fills the whole key badge from the bottom to the top in green. Do not zoom the camera for a prompt.
- Screen shake is only for the caster or the player who was hit, and it falls off with distance.
- Do not use globals. Do not modify parts named Handle. Do not invent a second fallback. If the instance is already in Studio, change it through MCP.

## TrueDeck

- Do not force the TrueDeck window to the center.
- Agents should be able to message each other across terminals and across PCs running TrueDeck.
- Do not use Tailscale to reach the other PC.
- Cursor should have MCP permission so a normal task does not stop to ask.
