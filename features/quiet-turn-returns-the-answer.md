---
title: am turn --quiet returns the answer, not the narration
status: planned
priority: 3
dependsOn: []
---

## Purpose

`am turn --quiet` is how one agent reads what another agent answered:
the return value of a turn. It has been wrong in both directions today.
First it printed only the turn's last text, so a debrief that wrote its
answer, ran `am learn` between paragraphs and closed with one summary
line came back as that one line (learnings #42). Fixed the same hour to
print every completed text of the turn (CLI commit 0150161), it then
returned 37 KB for a plan: the agent's narration before each tool call
("Let me read the feature file first"), the maps its own helpers had
reported and it quoted, and the plan at the end (learnings #45).

What a caller wants is what the agent said to the person, its answer,
which may be several texts with tool calls between them, and not the
sentence an agent says to itself before each tool call.

## Requirements

- `am turn --quiet` prints the agent's answer: every text that is part
  of what it says to the person, in order, and nothing it says to itself
  on the way to a tool call.
- The debrief case from #42 still comes back whole: several texts of an
  answer separated by tool calls.
- Tool calls, thinking, and results stay out, as now; the turn's end
  line (cost, duration) and an open permission stay in.
- The help text says what quiet prints.

## Facts

- The printing is in `follow()` in `src/commands.ts` (around line 555):
  `consider(s)` sees each stored item once complete; quiet prints every
  `text` item's text and the turn-end, error and open-permission lines.
- A text item's neighbours are visible there: what came after it (a
  `tool_use`, another text, the turn end) is known by the time the next
  item arrives, so a decision about a text can wait for the item that
  follows it.
- Narration before a tool call is short (a sentence, well under 200
  characters); an answer's paragraphs and a debrief's parts are longer.
  The 37 KB plan was long texts, not many short ones, so length alone
  does not separate an answer from a quoted helper report; position and
  length together do most of it.
- `am turn` without `--quiet` prints everything and is unchanged.

## Suggestions

The simplest rule that fits the two known cases: a text followed by a
tool call and shorter than some cutoff is narration and is dropped; any
other text is printed. A helper's quoted report that the agent then
acts on would still print under that rule; that is acceptable, since
the alternative (a marker the agent puts on its answer) asks every agent
to know the convention. Test both cases against a scripted item
sequence rather than a live agent (`test/` has a backend harness).
