---
title: am turn --quiet returns the answer, not the narration
status: review
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

## Report (2026-09-20)

**What changed.** The suggested rule, as a small pure function so it can
be tested against a scripted sequence rather than a live agent.

- `src/quiet.ts`: `answerTexts(items)` returns the texts of the answer in
  order — every completed text except one shorter than `NARRATION_MAX`
  (200) that is immediately followed by a tool call. A trailing text with
  nothing after it yet is held (undecided) until the next item arrives;
  the turn's end decides the last one. Thinking and tool results between a
  text and its tool call are skipped when looking for what follows.
- `follow()` in `src/commands.ts`: in quiet mode it now buffers the
  turn's completed items and prints `answerTexts` as each text settles,
  instead of printing every text on arrival; the turn-end, error and
  open-permission lines are printed as before, and tool calls and
  thinking stay out. Non-quiet output is unchanged.
- The `--quiet` help line says what it prints now.

**What was verified, and how.** `src/quiet.spec.ts` scripts the two known
cases and the edges: the #45 narration ("Let me read the file first"
then a tool call) is dropped and the real answer kept; the #42 debrief
(several answer paragraphs with `am learn` tool calls between them) comes
back whole; a long text before a tool call (a quoted helper report) is
kept, as the spec accepts; a trailing text is held until the turn ends;
a short text not followed by a tool call is kept. `npm run build` clean.
The existing `--quiet` e2e cases still hold: the fake agent's answer text
comes after its tool call, so nothing there is narration. Full suite and
lint run once at the end of the batch.

**What is left open.** Length-and-position does most of it but not all: a
short answer paragraph that happens to precede a tool call would be
dropped, and a long quoted helper report is kept — both accepted in the
spec as the cost of not asking every agent to mark its answer. Nothing
else.

**What I noticed and left alone.**
- The 37 KB plan (#45) shrinks mainly by dropping the short narrations;
  the long quoted maps it included would still print. That is the
  spec's accepted limit, not a regression.
- The narration cutoff (200) lives in `quiet.ts` next to the rule it
  serves, so a later adjustment has one home.

Gated with the batch (with `commits-attributed-to-turns` in
`agent-manager`): committed per feature with cheap checks, full suite
and lint once at the end.
