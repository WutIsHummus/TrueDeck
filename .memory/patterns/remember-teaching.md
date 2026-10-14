# Remember how the user wants work done

MemPalace wing: `truedeck-09d5b6c7`  
Palace: `C:\Users\alper\.mempalace\palace`  
Write identity: `windows:cursor:truedeck` (other CLIs use their own harness name, same project)

## Rooms

| Room | File this when |
|------|----------------|
| `jobs` | The user walks you through how a job should be done |
| `corrections` | The user fixes the method |
| `preferences` | A standing preference from the user, including ones gathered from older Codex, Grok, and Cursor chats |

The knowledge graph is the mind map. A fact is `subject → predicate → object`.

- Taught method: predicate `done_by`
- Corrected method: predicate `corrected_to`

The newest correction is the current method. Supersede the old fact when the method changes.

## Before a similar job

1. Search the wing, especially rooms `jobs` and `corrections`.
2. Query the knowledge graph for the job or system name.
3. Follow the filed method.

CLI when MCP tools are unavailable:

```
mempalace --palace C:\Users\alper\.mempalace\palace search "the job" --wing truedeck-09d5b6c7 --room corrections
mempalace --palace C:\Users\alper\.mempalace\palace wake-up --wing truedeck-09d5b6c7
```

## When the user teaches or corrects

Do this in the same turn, before continuing the work.

1. `mempalace_add_drawer` with the user's instruction, the method to use next time, and the date.
2. `mempalace_kg_add` with a short current method (object under 128 characters).
3. On a change of method, `mempalace_kg_supersede` the old fact.
4. Write the same fact as a short note under `.memory/context/` or `.memory/patterns/`.

Never store secrets, tokens, or cookies.
