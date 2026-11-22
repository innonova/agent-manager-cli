import fs from 'node:fs'
import { parseArgs } from 'node:util'
import path from 'node:path'
import readline from 'node:readline'
import { Api, ApiError } from './api.js'
import { clearSession, loadSession, managerUrl, saveSession } from './config.js'
import { client, findAgent, findProject } from './client.js'
import { holdText, parseUntil } from './until.js'
import { Events } from './events.js'
import { agentFacts, bold, dim, renderItem, stateMark } from './render.js'
import { answerTexts } from './quiet.js'
import { statRows } from './stats.js'
import type {
  Agent,
  ArchiveStatus,
  ChatMessage,
  EventFrame,
  Item,
  Repository,
  StoredItem,
  TurnImage,
} from './types.js'

export interface Io {
  out: (line: string) => void
  err: (line: string) => void
  /** Reads a line from the user; `hidden` for passwords. */
  ask: (prompt: string, hidden?: boolean) => Promise<string>
  /** Everything on stdin, or null when stdin is a terminal (nothing was piped in). */
  stdin?: () => Promise<string | null>
}

export const USAGE = `am — terminal client for agent-manager

  am                          open the TUI
  am login [--name NAME] [--url URL]   (AGENT_MANAGER_PASSWORD in the environment skips the prompt)
  am logout
  am projects
  am project new <name> <repo-path>... [--profile P] [--delegation free|on-request] [--host H]   (paths as on the manager's machine)
  am project add-repo <project> <repo-path>...
  am project set <project> --delegation free|on-request   when agents may start other agents
  am project restart <project>   restart the idle agents so they see the new repos
  am stream new <name> [--purpose TEXT] [--profile P] [--delegation free|on-request]
                              start a stream: a unit of work that is not tied to a repository. It gets
                              a folder of its own for its instructions, features and docs, and a home
                              where its agents start and where it clones what it works on. The name is
                              lower-case letters, digits and hyphens, and stays. The purpose is read
                              from stdin when not given. A stream is listed, and its agents started,
                              like a project's: am projects, am new <stream> <name>
  am stream archive <name> [--plan] [--discard] [--no-compact]
                              put a stream away: its folder, its agents and everything kept of them
                              stay, its clones come off the disk. Refused, saying what, while work
                              exists only in a clone or an agent is in a turn; branches with commits
                              no remote has are pushed first. --plan only says what it would do;
                              --discard lets files that are not committed go with the clones;
                              --no-compact leaves the agents' contexts as they are (an agent that
                              was active within the hour is otherwise compacted first, while that is
                              cheap). A person's to do, not an agent's.
  am stream revive <name>     bring it back: its clones are made again and set up, and each agent is
                              told at its next start how long it was away and what landed meanwhile
  am projects --archived      the streams that are put away
  am repos                    the repositories a stream can clone: where from, their setup, who uses them
  am repo add <name> <source> [--setup CMD]
                              register one, or change what is said about it: <source> is what git clone
                              is given, --setup a command that makes a fresh clone a working one (npm ci)
  am repo seed <name> --from <checkout> <file>...
                              keep untracked files a clone needs (.env and the like), taken from a
                              checkout on the manager's machine, to be copied into every new clone
  am repo drop <name>         take one off the registry; clones of it stay where they are
  am use <repository> [--stream S] [--again]
                              clone a registered repository into the stream's home and set it up; waits
                              and says how it went. Inside an agent's session the stream is its own.
                              --again: the clone is there and its setup failed or was cut short; run
                              the setup once more (it is never run again by itself)
  am clones [<stream>]        the clones in the stream's home, each with its branch
  am agents <project> [--archived]
  am new <project> <name> [--profile P] [--ask] [--cwd REPO] [--model M] [--effort E]
                              [--host H]: run the agent's session on that machine (a spoke), with
                              --cwd an absolute path there; the project stays here
                              a Claude model name ending in [1m] asks for the 1M context window
                              (claude-fable-5-2[1m]); \`am agents\` shows the window each agent got
  am tail <agent> [--lines N] [--follow] [--full]
  am turn <agent> <text...>   send a turn and print it as it runs (--no-wait: just send;
                              --quiet: print the agent's answer (its texts, minus the
                              narration before a tool call) and the turn's cost;
                              --steer: while a turn runs, deliver it into the turn or queue it;
                              --image FILE: send an image along, repeatable; png/jpeg/gif/webp)
  am wait <agent>             wait for the turn under way to end, then print its final answer
                              and cost (the last turn's, if none is under way)
  am exec <host> [--cwd DIR] [--timeout SECONDS] -- <command...>
                              run one command on that machine through its daemon, in the session
                              the daemon runs in (the logged-in desktop on Windows); prints the
                              output and exits with the command's exit code. One word after --
                              goes as it is; several are joined, words with spaces quoted. With
                              no -- the command is read from stdin, quotes and lines untouched:
                              am exec <host> <<'EOF' ... EOF
  am hold [<agent>] <until>   tell the manager a background wait is expected until then, so it
                              does not ask about it before: a time (13:30), a duration (45m, 2h,
                              1d) or off; inside an agent's session the agent is itself
  am allow <agent> [--option ID]   answer the pending permission (first allow option by default)
  am deny <agent>             both print the rest of the turn unless --no-wait
  am undo <agent>             take back the last message sent: its turn is stopped and the text printed,
                              to edit and send again; a Claude agent forgets it and its reply (work on disk stays)
  am interrupt <agent>        stop the turn under way; the agent stays and takes the next message
  am stop <agent>             end the session (its process); the next message resumes it
  am set <agent> [--name N] [--model M] [--effort E] [--ask|--bypass] [--nudge|--no-nudge]
                              edit the agent; model, effort and permissions apply at its next restart.
                              --nudge: when it stops with work left, the manager asks it a few minutes
                              later whether it can go on, and pages the people if it needs them
  am restart <agent>          stop and resume with the current settings; refused while busy
  am fork <agent> <name> [--into <project or stream>]
                              a new agent that begins with that one's whole conversation as it
                              stands, in the same project or in another one or a stream. The
                              original carries on untouched; the copy is told it is one, and where
                              it now is. How work that grew out of a conversation gets a place of
                              its own without being explained from nothing. Claude agents on the
                              manager's machine, between turns
  am stats [<agent>]          how the agent has been run: runtime and turns, tokens and cost, who started
                              the turns, the work since a person last wrote, the runs between
                              messages, and how much went on unattended. Inside an agent's session
                              the agent is itself
  am compact <agent>          compact its context now: replaced by a summary of itself, with its dialog
                              handed back word for word (weighed first if it has grown, which takes
                              minutes; the agent's flow says how it goes); refused while it is in a turn
  am archive <agent>          end its session and take it off the list (transcript kept)
  am delete <agent>           forget it for good: process, daemon logs, cache; the vendor's store stays
  am method                   how work is run under this manager: features, the gate, helpers, reviews
  am framing                  its companion: how a feature and a brief are written
  am learn <text...> [--ref R]   record something learned about working here, at the moment of noticing
  am learnings [--since N]    the learnings log, oldest first (entries after N)
  am runs [project]           the run log: feature, agent and model, duration, commits, cost, outcome
  am runs review <run-id> --outcome accepted|sent-back [--cause model|brief|doc] [--note TEXT]
                              close the loop on a run: a cause is required when sending back
  am recall [<n> | <n>-<m>]... [--agent A]
                              the agent's dialog with its people, word for word, by exchange number:
                              what the person wrote and what the agent wrote back. With no number,
                              the list: every exchange in one line, with the weight it was given.
                              After a compaction the manager hands the recent and the weightiest
                              back by itself; this fetches any other. Inside an agent's session the
                              agent is itself
  am recall --handback [--full] [--agent A]
                              what would be handed back if the context were compacted now: which
                              exchanges whole, how many as lines, the tokens; --full prints the
                              text itself. Nothing is written or sent
  am recall --handback --now  inside an agent's session: hand the dialog back to yourself now, without
                              waiting for a compaction. Prints which files to read
  am recall --weigh [--model M] [--agent A]
                              weigh the dialog now (minutes, and the manager's tokens): what is
                              handed back after a compaction is chosen by these weights
  am chat [<agent>] [--last N]   an agent's chat with the people, beside its work. Inside an agent's
                              session with no agent named it is the agent reading: what is unread,
                              marked read by being printed; --last N reads the last N back and
                              marks nothing. With an agent named: its last messages (20, or N)
  am chat close [<agent>] <id>   close an open question: the agent's own, no longer needed, or one
                              a person dismisses
  am say [--to <agent>] <text...>   say something in the chat; the text is read from stdin when none
                              is given (am say <<'EOF' ... EOF). Inside an agent's session it is the
                              agent speaking to the people: --decision for a choice made on their
                              behalf, --question for one that stays pinned until answered and
                              reaches their phones, --important for what should reach their phones.
                              --to <agent> says it to that agent instead: beside its work while it
                              is in a turn, for it to read when it chooses (--steer: into the turn
                              now), and as a turn when it is idle. --re ID replies to a message;
                              a reply to an open question is its answer
  am notes [<project>] [--all]   the project's notes: small actionable items, open ones with their ids
  am note add [<project>] <text...>   add one (the first line is the title)
  am note done|undo|drop [<project>] <id>   tick, reopen or remove one
                              (inside an agent's session the project is implied)
  am features <project>
  am feature <project> <slug>
  am respond <project> <slug> <text...> [--status planned|review|blocked|done]

An agent is an id, project/name, or a name unique across projects.
The manager is ${'AGENT_MANAGER_URL'} or the one logged into (default http://127.0.0.1:4268).
Inside an agent's session the manager sets AGENT_MANAGER_URL and AGENT_MANAGER_TOKEN: no login needed,
and everything is scoped to that agent's project.`

/**
 * The words after `--` as one command line for the host's shell. One word
 * is the command as the caller wrote it (the usual form: the whole
 * command in one quoted argument). Several words come from the caller's
 * shell, which has eaten their quotes: a word with whitespace, a quote
 * or a shell character in it could only have arrived quoted, so the
 * caller meant it literally, and it is quoted again, in single quotes,
 * which bash and PowerShell both read literally. `$` is left alone, so
 * a variable reaches the host's shell as one. A single quote inside
 * such a word is doubled, PowerShell's escape; bash has none inside
 * single quotes, so there the one-argument or stdin form is the way.
 * Shell syntax meant for the host (a pipe, a redirect, a second
 * command) belongs in the one-argument or stdin form too.
 */
export function joinCommand(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return words
    .map((w) => (/[\s"'|&;<>()*?[\]{}#~!\\`]/.test(w) ? `'${w.replace(/'/g, "''")}'` : w))
    .join(' ')
}

function stdIo(): Io {
  return {
    out: (l) => process.stdout.write(l + '\n'),
    err: (l) => process.stderr.write(l + '\n'),
    stdin: async () => {
      if (process.stdin.isTTY) return null
      const chunks: Buffer[] = []
      for await (const c of process.stdin) chunks.push(c as Buffer)
      return Buffer.concat(chunks).toString('utf8')
    },
    ask: (prompt, hidden = false) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: true,
        })
        if (hidden) {
          // echo nothing while the password is typed
          const mute = rl as unknown as { _writeToOutput: (s: string) => void }
          const orig = mute._writeToOutput.bind(rl)
          mute._writeToOutput = (s: string) => {
            if (s.startsWith(prompt)) orig(prompt)
            else if (s.includes('\n')) orig('\n')
          }
        }
        rl.question(prompt, (a) => {
          rl.close()
          resolve(a)
        })
      }),
  }
}

/** Runs one plain command; returns the exit code. Throws nothing: errors go to `io.err`. */
export async function run(argv: string[], io: Io = stdIo()): Promise<number> {
  const [cmd, ...rest] = argv
  try {
    switch (cmd) {
      case undefined:
      case 'tui':
        return await (await import('./tui/index.tsx')).tui(io)
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE)
        return 0
      case 'login':
        return await login(rest, io)
      case 'logout': {
        const api = client()
        await api.logout().catch(() => undefined)
        clearSession()
        io.out('logged out')
        return 0
      }
      case 'projects': {
        const api = client()
        if (rest.includes('--archived')) {
          const away = await api.projects(true)
          if (away.length === 0) io.out(dim('no stream is put away'))
          for (const { project } of away)
            io.out(
              `${bold(project.name)}  ${dim(project.id)}  ${dim(`put away ${project.archive ? new Date(project.archive.at).toISOString().slice(0, 10) : ''} · am stream revive ${project.name}`)}`,
            )
          return 0
        }
        for (const { project, agentCounts } of await api.projects()) {
          const counts = Object.entries(agentCounts)
            .filter(([, n]) => n > 0)
            .map(([s, n]) => `${n} ${s}`)
            .join(', ')
          io.out(
            `${bold(project.name)}  ${dim(project.id)}  ${project.kind === 'stream' ? dim(`stream · ${project.path}`) : ''}${counts ? dim(`  ${counts}`) : ''}`,
          )
          for (const r of project.repos) io.out(`  ${r.name}  ${dim(r.path)}`)
          if (project.workspace)
            io.out(
              `  ${dim('workspace')}  ${dim(project.workspace)}${project.sshHost ? dim(`  (code --remote ssh-remote+${project.sshHost} ${project.workspace})`) : ''}`,
            )
        }
        return 0
      }
      case 'project':
        return await project(rest, io)
      case 'stream':
        return await stream(rest, io)
      case 'repos': {
        const api = client()
        const { repositories } = await api.repositories()
        if (repositories.length === 0)
          io.out(dim('no repositories registered (am repo add <name> <source>)'))
        for (const r of repositories) printRepository(r, io)
        return 0
      }
      case 'repo':
        return await repo(rest, io)
      case 'use': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { stream: { type: 'string' }, again: { type: 'boolean' } },
        })
        const api = client()
        const name = need(positionals[0], 'repository')
        const project = await findProject(api, projectRef(values.stream))
        await api.useRepository(project.id, name, values.again ?? false)
        io.out(
          dim(
            values.again
              ? `running the setup of ${name} again …`
              : `cloning ${name} into ${project.path} …`,
          ),
        )
        let said = ''
        for (;;) {
          const clone = (await api.clones(project.id)).clones.find((c) => c.name === name)
          if (clone && clone.state !== said && clone.state === 'setting up')
            io.out(dim('cloned; running its setup …'))
          said = clone?.state ?? said
          if (clone?.state === 'ready') {
            io.out(`${bold(clone.name)}  ${clone.path}  ${dim(`on ${clone.branch ?? '?'}`)}`)
            return 0
          }
          if (clone?.state === 'failed') {
            io.err(clone.message ?? 'the clone failed')
            return 1
          }
          await new Promise((r) => setTimeout(r, 500))
        }
      }
      case 'clones': {
        const api = client()
        const project = await findProject(api, projectRef(rest[0]))
        const { clones } = await api.clones(project.id)
        if (clones.length === 0) io.out(dim(`no clones in ${project.path} (am use <repository>)`))
        for (const c of clones) {
          const l = c.landing
          const landing = l
            ? [
                l.unlanded ? `${l.unlanded} not on main` : '',
                l.uncommitted ? `${l.uncommitted} not committed` : '',
                l.behind ? `${l.behind} behind` : '',
              ]
                .filter(Boolean)
                .join(', ') || 'everything landed'
            : ''
          io.out(
            `${bold(c.name)}  ${c.path}  ${dim(c.state === 'ready' ? `on ${c.branch ?? '?'}` : c.state)}${landing ? dim(`  ${landing}`) : ''}`,
          )
          if (c.message) for (const l of c.message.split('\n')) io.out(`  ${dim(l)}`)
        }
        return 0
      }
      case 'agents': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { archived: { type: 'boolean' } },
        })
        const api = client()
        const project = await findProject(api, need(positionals[0], 'project'))
        for (const { agent, status } of await api.agents(project.id, values.archived ?? false)) {
          const extra = [
            agentFacts(agent, status),
            status.background ? `${status.background} bg` : '',
            status.usage
              ? status.usage.windows.map((w) => `${w.name} ${w.usedPercent}%`).join(' ')
              : '',
            status.error,
          ]
            .filter(Boolean)
            .join(', ')
          io.out(
            `${stateMark(status.state)} ${bold(agent.name)}  ${status.state}  ${dim(agent.id)}  ${dim(extra)}`,
          )
        }
        return 0
      }
      case 'new': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            profile: { type: 'string' },
            ask: { type: 'boolean' },
            cwd: { type: 'string' },
            model: { type: 'string' },
            effort: { type: 'string' },
            host: { type: 'string' },
          },
        })
        const api = client()
        const project = await findProject(api, need(positionals[0], 'project'))
        const name = need(positionals[1], 'name')
        if (values.host && !values.cwd)
          throw new Error('--host needs --cwd: an absolute path on that machine')
        const { agent, status } = await api.createAgent(project.id, {
          name,
          ...(values.host ? { host: values.host } : {}),
          ...(values.profile ? { profile: values.profile } : {}),
          ...(values.ask ? { permissions: 'ask' as const } : {}),
          ...(values.cwd ? { cwd: values.cwd } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values.effort ? { effort: values.effort } : {}),
        })
        io.out(
          `${stateMark(status.state)} ${bold(agent.name)}  ${dim(agent.id)}  ${agent.profile}${agent.host ? dim(`  on ${agent.host}`) : ''}`,
        )
        return 0
      }
      case 'tail':
        return await tail(rest, io)
      case 'turn':
        return await turn(rest, io)
      case 'allow':
      case 'deny':
        return await decide(cmd, rest, io)
      case 'undo': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        const { text, forgotten, left } = await api.undo(agent.id)
        io.out(
          forgotten
            ? 'taken back: the agent has no memory of the message or of its reply'
            : `taken back: the agent still has the message (${agent.profile} keeps its conversation out of reach, or it was not found)`,
        )
        if (left.length) io.out(`what the reply did stays: ${left.join(', ')}`)
        // the message itself, last and plain: it is what gets edited and sent again
        io.out('')
        io.out(text)
        return 0
      }
      case 'interrupt': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.interrupt(agent.id)
        io.out('interrupt sent')
        return 0
      }
      case 'stop': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.stop(agent.id)
        io.out('stopped')
        return 0
      }
      case 'wait':
        return await wait(rest, io)
      case 'set': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            name: { type: 'string' },
            model: { type: 'string' },
            effort: { type: 'string' },
            ask: { type: 'boolean' },
            bypass: { type: 'boolean' },
            nudge: { type: 'boolean' },
            'no-nudge': { type: 'boolean' },
          },
        })
        const api = client()
        const { agent } = await findAgent(api, need(positionals[0], 'agent'))
        const patch: Parameters<typeof api.updateAgent>[1] = {}
        if (values.nudge) patch.nudge = true
        else if (values['no-nudge']) patch.nudge = false
        if (values.name !== undefined) patch.name = values.name
        if (values.model !== undefined) patch.model = values.model || null
        if (values.effort !== undefined) patch.effort = values.effort || null
        if (values.ask) patch.permissions = 'ask'
        else if (values.bypass) patch.permissions = 'bypass'
        if (Object.keys(patch).length === 0)
          throw new Error(
            'nothing to set (--name, --model, --effort, --ask, --bypass, --nudge, --no-nudge)',
          )
        const r = await api.updateAgent(agent.id, patch)
        io.out(agentFacts(r.agent, r.status))
        if (r.appliesAtRestart.length)
          io.out(
            dim(
              `${r.appliesAtRestart.join(', ')} take effect after \`am restart ${r.agent.name}\``,
            ),
          )
        return 0
      }
      case 'exec': {
        const dash = rest.indexOf('--')
        const own = dash >= 0 ? rest.slice(0, dash) : rest
        const { values, positionals } = parseArgs({
          args: own,
          allowPositionals: true,
          options: { cwd: { type: 'string' }, timeout: { type: 'string' } },
        })
        const host = need(positionals[0], 'host')
        const command = dash >= 0 ? joinCommand(rest.slice(dash + 1)) : ((await io.stdin?.()) ?? '')
        if (!command.trim())
          throw new Error(
            "am exec <host> [--cwd DIR] -- <command...>, or the command on stdin (am exec <host> <<'EOF')",
          )
        const api = client()
        const r = await api.exec(host, command, {
          ...(values.cwd ? { cwd: values.cwd } : {}),
          ...(values.timeout ? { timeoutMs: Number(values.timeout) * 1000 } : {}),
        })
        if (r.stdout) io.out(r.stdout.replace(/\n$/, ''))
        if (r.stderr) io.err(r.stderr.replace(/\n$/, ''))
        if (r.timedOut)
          io.err(dim(`killed after the timeout (${Math.round(r.durationMs / 1000)}s)`))
        return r.timedOut ? 124 : (r.exitCode ?? 1)
      }
      case 'hold': {
        const api = client()
        const [first, second] = rest
        const ref = second !== undefined ? first : process.env.AGENT_MANAGER_AGENT
        const untilText = second ?? first
        if (!ref || !untilText)
          throw new Error(
            "am hold [<agent>] <until>: the agent is implied only inside an agent's session",
          )
        const { agent } = await findAgent(api, ref)
        const { holdUntil } = await api.hold(agent.id, parseUntil(untilText))
        io.out(holdText(holdUntil))
        return 0
      }
      case 'restart': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.restart(agent.id)
        io.out('restarted')
        return 0
      }
      case 'fork': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { into: { type: 'string' } },
        })
        const api = client()
        const { agent } = await findAgent(api, need(positionals[0], 'agent'))
        const into = values.into ? await findProject(api, values.into) : null
        const made = await api.fork(agent.id, {
          name: need(positionals[1], 'name'),
          ...(into ? { projectId: into.id } : {}),
        })
        io.out(
          `${bold(made.agent.name)}  ${dim(made.agent.id)}  ${dim(`a fork of ${agent.name}, in ${made.agent.cwd}; ${made.inherited} exchange${made.inherited === 1 ? '' : 's'} of its dialog carried over`)}`,
        )
        return 0
      }
      case 'stats': {
        const api = client()
        const agentId = rest[0] ? (await findAgent(api, rest[0])).agent.id : await self(api)
        if (!agentId)
          throw new Error("am stats <agent>: outside an agent's session, name the agent")
        const rows = statRows(await api.stats(agentId))
        const width = Math.max(...rows.map((r) => r.label.length))
        for (const r of rows) {
          io.out(`${bold(r.label.padEnd(width))}  ${r.text}`)
          if (r.note) io.out(`${' '.repeat(width)}  ${dim(r.note)}`)
        }
        return 0
      }
      case 'compact': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.compact(agent.id)
        io.out('compaction asked for; the flow says how it goes')
        return 0
      }
      case 'archive': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.archive(agent.id)
        io.out('archived')
        return 0
      }
      case 'delete': {
        const api = client()
        const { agent } = await findAgent(api, need(rest[0], 'agent'))
        await api.remove(agent.id)
        io.out('deleted')
        return 0
      }
      case 'method':
      case 'framing': {
        // the two documents of the practice, printed as they stand on this
        // machine: the method is the steps, the framing is what is said at
        // each of them
        const api = client()
        const { hosts } = cmd === 'method' ? await api.method() : await api.framing()
        const local = hosts[0]
        if (!local) throw new Error(`the manager has no ${cmd} text`)
        io.out(local.template)
        return 0
      }
      case 'learn': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { ref: { type: 'string' } },
        })
        const text = positionals.join(' ')
        if (!text) throw new UsageError('a text is required')
        const api = client()
        const { entry } = await api.learn(text, values.ref)
        io.out(`recorded as #${entry.n}`)
        return 0
      }
      case 'learnings': {
        const { values } = parseArgs({ args: rest, options: { since: { type: 'string' } } })
        const api = client()
        const { entries } = await api.learnings(Number(values.since ?? 0))
        if (entries.length === 0) {
          io.out(dim('nothing recorded yet'))
          return 0
        }
        for (const e of entries) {
          io.out(
            `${bold(`#${e.n}`)}  ${dim(new Date(e.at).toISOString().slice(0, 16).replace('T', ' '))}  ${e.by}${e.ref ? dim(`  ${e.ref}`) : ''}`,
          )
          io.out(e.text)
          io.out('')
        }
        return 0
      }
      case 'runs': {
        const api = client()
        if (rest[0] === 'review') {
          const { values, positionals } = parseArgs({
            args: rest.slice(1),
            allowPositionals: true,
            options: {
              outcome: { type: 'string' },
              cause: { type: 'string' },
              note: { type: 'string' },
            },
          })
          const { run } = await api.reviewRun(need(positionals[0], 'run id'), {
            outcome: need(values.outcome, '--outcome'),
            ...(values.cause ? { cause: values.cause } : {}),
            ...(values.note ? { note: values.note } : {}),
          })
          io.out(
            `${run.slug}: ${run.review?.outcome ?? '?'}${run.review?.cause ? ` (${run.review.cause})` : ''}`,
          )
          return 0
        }
        const project = rest[0] ? await findProject(api, rest[0]) : null
        const { runs } = await api.runs(project?.id)
        if (runs.length === 0) {
          io.out(dim('no runs yet'))
          return 0
        }
        for (const r of runs) {
          const mins = r.endedAt ? `${Math.round((r.endedAt - r.startedAt) / 60000)} min` : 'open'
          const commits =
            r.baseCommit && r.endCommit
              ? r.baseCommit === r.endCommit
                ? `${r.baseCommit.slice(0, 7)} (no commit)`
                : `${r.baseCommit.slice(0, 7)}..${r.endCommit.slice(0, 7)}`
              : ''
          const cost = r.costUsd != null ? `$${r.costUsd.toFixed(2)}` : ''
          const review = r.review
            ? `  ${r.review.outcome}${r.review.cause ? ` (${r.review.cause})` : ''}`
            : ''
          io.out(
            `${bold(r.slug)}  ${dim(project ? '' : r.projectName + '  ')}${r.agentName} · ${r.model ?? r.profile}  ${mins}  ${commits}  ${cost}  ${r.outcome ?? ''}${r.featureStatus ? ` → ${r.featureStatus}` : ''}${review}  ${dim(r.id)}`,
          )
        }
        return 0
      }
      case 'recall':
        return await recall(rest, io)
      case 'chat':
        return await chat(rest, io)
      case 'say':
        return await say(rest, io)
      case 'notes': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { all: { type: 'boolean' } },
        })
        const api = client()
        const project = await findProject(api, projectRef(positionals[0]))
        const { items } = await api.notes(project.id)
        const shown = values.all ? items : items.filter((n) => !n.done)
        if (shown.length === 0) io.out(dim(values.all ? 'no notes' : 'no open notes'))
        for (const n of shown) {
          io.out(`${n.done ? dim('[x]') : '[ ]'} ${bold(n.id)}  ${n.title}  ${dim(n.date)}`)
          if (n.body) for (const l of n.body.split('\n')) io.out(`           ${dim(l)}`)
        }
        return 0
      }
      case 'note': {
        const api = client()
        const [verb, ...args] = rest
        if (verb === 'add') {
          // with a project name first when given, else the session's project and all of it is the text
          let projectName: string | undefined
          let textParts = args
          if (args.length > 1 && !process.env.AGENT_MANAGER_PROJECT) {
            projectName = args[0]
            textParts = args.slice(1)
          } else if (args.length > 1) {
            try {
              await findProject(api, args[0]!)
              projectName = args[0]
              textParts = args.slice(1)
            } catch {
              /* the first word is part of the note */
            }
          }
          const project = await findProject(api, projectRef(projectName))
          const text = textParts.join(' ').trim()
          if (!text) throw new Error('am note add [<project>] <text>')
          const { items } = await api.addNote(project.id, text)
          const added = items.find((n) => n.title === text.split('\n')[0]!.trim() && !n.done)
          io.out(`added ${bold(added?.id ?? '?')}  ${text.split('\n')[0]}`)
          return 0
        }
        if (verb === 'done' || verb === 'undo' || verb === 'drop') {
          const [a, b] = args
          const id = b ?? a
          const project = await findProject(api, projectRef(b ? a : undefined))
          if (!id) throw new Error(`am note ${verb} [<project>] <id>`)
          if (verb === 'drop') await api.removeNote(project.id, id)
          else await api.updateNote(project.id, id, { done: verb === 'done' })
          io.out(
            `${verb === 'done' ? 'ticked' : verb === 'undo' ? 'reopened' : 'removed'} ${bold(id)}`,
          )
          return 0
        }
        throw new Error('am note add|done|undo|drop …')
      }
      case 'features': {
        const api = client()
        const project = await findProject(api, need(rest[0], 'project'))
        for (const f of (await api.features(project.id)).features)
          io.out(
            `${f.status.padEnd(11)} ${bold(f.slug)}  ${f.title}  ${dim(`${f.repo}, p${f.priority}`)}`,
          )
        return 0
      }
      case 'feature': {
        const api = client()
        const project = await findProject(api, need(rest[0], 'project'))
        const { feature } = await api.feature(project.id, need(rest[1], 'slug'))
        io.out(`${bold(feature.title)}  ${dim(`${feature.status}, ${feature.path}`)}`)
        io.out('')
        io.out((await import('./render.js')).markdown(feature.body))
        return 0
      }
      case 'respond': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { status: { type: 'string' } },
        })
        const api = client()
        const project = await findProject(api, need(positionals[0], 'project'))
        const slug = need(positionals[1], 'slug')
        const text = positionals.slice(2).join(' ')
        if (!text) throw new Error('a response text is required')
        const { feature } = await api.respond(project.id, slug, text, values.status)
        io.out(`${feature.slug}: ${feature.status}`)
        return 0
      }
      default:
        io.err(`unknown command "${cmd}"\n\n${USAGE}`)
        return 2
    }
  } catch (e) {
    if (e instanceof UsageError || (e instanceof TypeError && /option|argument/i.test(e.message))) {
      io.err(`${e.message}\n\n${USAGE}`)
      return 2
    }
    io.err(
      e instanceof ApiError
        ? e.status === 401
          ? 'not logged in (or the login expired): run `am login`'
          : `${e.message} (${e.status})`
        : e instanceof Error
          ? e.message
          : String(e),
    )
    return 1
  }
}

class UsageError extends Error {}
function need(v: string | undefined, what: string): string {
  if (!v) throw new UsageError(`${what} is required`)
  return v
}

/** Repo paths as the manager wants them: absolute on its machine. Relative ones are taken from here when the manager is local. */
function repoPaths(raw: string[], remote: boolean): { path: string }[] {
  if (!raw.length) throw new UsageError('at least one repo path is required')
  return raw.map((p) => {
    if (remote && !path.isAbsolute(p))
      throw new UsageError(`repo paths on another host must be absolute: ${p}`)
    return { path: path.resolve(p) }
  })
}

function parseDelegation(v: string): 'free' | 'on-request' {
  if (v === 'free' || v === 'on-request') return v
  throw new UsageError('--delegation must be "free" or "on-request"')
}

async function project(rest: string[], io: Io): Promise<number> {
  const [sub, ...args] = rest
  const api = client()
  switch (sub) {
    case 'new': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          profile: { type: 'string' },
          host: { type: 'string' },
          delegation: { type: 'string' },
        },
      })
      const [name, ...repos] = positionals
      const { project } = await api.createProject({
        name: need(name, 'name'),
        repos: repoPaths(repos, values.host !== undefined),
        ...(values.profile ? { defaultProfile: values.profile } : {}),
        ...(values.delegation ? { delegation: parseDelegation(values.delegation) } : {}),
        ...(values.host ? { host: values.host } : {}),
      })
      io.out(`${bold(project.name)}  ${dim(project.id)}`)
      for (const r of project.repos) io.out(`  ${r.name}  ${dim(r.path)}`)
      return 0
    }
    case 'set': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { delegation: { type: 'string' } },
      })
      const current = await findProject(api, need(positionals[0], 'project'))
      if (values.delegation === undefined) throw new UsageError('nothing to set (--delegation)')
      const { project } = await api.updateProject(current.id, {
        delegation: parseDelegation(values.delegation),
      })
      io.out(`${bold(project.name)}  delegation ${project.delegation}  ${dim(project.id)}`)
      io.out(dim('running agents see it after `am project restart`'))
      return 0
    }
    case 'add-repo': {
      const [ref, ...repos] = args
      const current = await findProject(api, need(ref, 'project'))
      // the whole list goes back: existing names stay, the new ones are named by the manager
      const { project } = await api.updateProject(current.id, {
        repos: [...current.repos, ...repoPaths(repos, current.host !== undefined)],
      })
      io.out(`${bold(project.name)}  ${dim(project.id)}`)
      for (const r of project.repos) io.out(`  ${r.name}  ${dim(r.path)}`)
      io.out(dim('running agents see the new repos after `am project restart`'))
      return 0
    }
    case 'restart': {
      const current = await findProject(api, need(args[0], 'project'))
      const { restarted, skipped } = await api.restartAgents(current.id)
      io.out(`restarted ${restarted.length} agent${restarted.length === 1 ? '' : 's'}`)
      for (const s of skipped) io.out(`  skipped ${s.id}: ${s.why}`)
      return 0
    }
    default:
      throw new UsageError(
        sub ? `unknown project command "${sub}"` : 'project needs new, add-repo, set or restart',
      )
  }
}

function printRepository(r: Repository, io: Io): void {
  io.out(`${bold(r.name)}  ${r.source}`)
  if (r.setup) io.out(`  ${dim('setup')}  ${r.setup}`)
  if (r.seed.length) io.out(`  ${dim('seed')}   ${r.seed.join(', ')}`)
  if (r.usedBy.length) io.out(`  ${dim('used by')}  ${r.usedBy.join(', ')}`)
}

const megabytes = (kb: number) =>
  kb >= 1024 * 1024
    ? `${(kb / 1024 / 1024).toFixed(1)} GB`
    : kb < 512
      ? 'under 1 MB'
      : `${Math.round(kb / 1024)} MB`

/** Follows a stream on its way there or back, a line per step, until it has arrived or failed. */
async function followArchive(
  api: Api,
  projectId: string,
  arrived: (s: ArchiveStatus) => boolean,
  io: Io,
): Promise<number> {
  let said = ''
  for (;;) {
    const s = await api.archiveStatus(projectId)
    if (s.progress.error) {
      io.err(s.progress.error)
      return 1
    }
    if (s.progress.step && s.progress.step !== said && s.progress.step !== 'beginning')
      io.out(dim(`  ${s.progress.step}`))
    said = s.progress.step ?? said
    if (arrived(s) && !s.progress.step) {
      io.out(s.progress.done ?? 'done')
      return 0
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function stream(rest: string[], io: Io): Promise<number> {
  const [sub, ...args] = rest
  if (sub === 'archive') {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        plan: { type: 'boolean' },
        discard: { type: 'boolean' },
        'no-compact': { type: 'boolean' },
      },
    })
    const api = client()
    const project = await findProject(api, need(positionals[0], 'name'))
    if (values.plan) {
      const { plan } = await api.archivePlan(project.id)
      io.out(
        `${bold(project.name)}  ${dim(`${plan.clones.length} clone${plan.clones.length === 1 ? '' : 's'}, ${megabytes(plan.reclaimKb)} to reclaim`)}`,
      )
      for (const c of plan.clones)
        io.out(
          `  ${c.name}  ${dim(`on ${c.branch ?? 'a detached HEAD'} · ${megabytes(c.sizeKb)}`)}`,
        )
      for (const p of plan.pushes)
        io.out(
          `  ${dim('pushed first')}  ${p.clone}: ${p.branch} (${p.commits} commit${p.commits === 1 ? '' : 's'} no remote has)`,
        )
      for (const u of plan.uncommitted)
        io.out(
          `  ${dim('lost unless committed (--discard lets them go)')}  ${u.clone}: ${[
            u.count
              ? `${u.count} file${u.count === 1 ? '' : 's'} (${u.files.slice(0, 8).join(', ')}${u.count > 8 ? ', …' : ''})`
              : '',
            u.stashes ? `${u.stashes} stashed change${u.stashes === 1 ? '' : 's'}` : '',
          ]
            .filter(Boolean)
            .join(' and ')}`,
        )
      for (const n of plan.unreachable)
        io.out(
          `  ${dim('its remote could not be asked; judged by what the clone last knew')}  ${n}`,
        )
      for (const a of plan.agents)
        io.out(
          `  ${a.name}  ${dim(`${a.compact ? 'compacted first' : 'not compacted'}: ${a.why}`)}`,
        )
      if (plan.blocked.length) {
        io.out('in the way:')
        for (const b of plan.blocked) io.out(`  - ${b}`)
        return 1
      }
      return 0
    }
    await api.archiveStream(project.id, {
      ...(values.discard ? { discard: true } : {}),
      ...(values['no-compact'] ? { compact: false } : {}),
    })
    io.out(dim(`putting ${project.name} away …`))
    return await followArchive(api, project.id, (s) => s.archive?.state === 'archived', io)
  }
  if (sub === 'revive') {
    const api = client()
    const name = need(args[0], 'name')
    const away = (await api.projects(true)).map((r) => r.project)
    const project = away.find((p) => p.id === name) ?? away.find((p) => p.name === name)
    if (!project)
      throw new Error(`no stream "${name}" is put away (am projects --archived lists them)`)
    await api.reviveStream(project.id)
    io.out(dim(`bringing ${project.name} back …`))
    return await followArchive(api, project.id, (s) => !s.archive, io)
  }
  if (sub !== 'new')
    throw new UsageError(
      'am stream new <name> [--purpose TEXT] | am stream archive <name> [--plan] [--discard] [--no-compact] | am stream revive <name>',
    )
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      purpose: { type: 'string' },
      profile: { type: 'string' },
      delegation: { type: 'string' },
    },
  })
  const api = client()
  const purpose = values.purpose ?? (await io.stdin?.())?.trim() ?? ''
  const { project } = await api.createStream({
    name: need(positionals[0], 'name'),
    ...(purpose ? { purpose } : {}),
    ...(values.profile ? { defaultProfile: values.profile } : {}),
    ...(values.delegation ? { delegation: parseDelegation(values.delegation) } : {}),
  })
  io.out(`${bold(project.name)}  ${dim(project.id)}`)
  io.out(`  ${dim('home')}    ${project.path}`)
  for (const r of project.repos) if (r.folder) io.out(`  ${dim('folder')}  ${r.path}`)
  return 0
}

async function repo(rest: string[], io: Io): Promise<number> {
  const [sub, ...args] = rest
  const api = client()
  switch (sub) {
    case 'add': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { setup: { type: 'string' } },
      })
      const { repository } = await api.putRepository(need(positionals[0], 'name'), {
        source: need(positionals[1], 'source'),
        ...(values.setup !== undefined ? { setup: values.setup || null } : {}),
      })
      printRepository(repository, io)
      return 0
    }
    case 'seed': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { from: { type: 'string' } },
      })
      const [name, ...files] = positionals
      if (!values.from || files.length === 0)
        throw new UsageError('am repo seed <name> --from <checkout> <file>...')
      const { repository } = await api.seedRepository(need(name, 'name'), {
        from: path.resolve(values.from),
        files,
      })
      printRepository(repository, io)
      return 0
    }
    case 'drop': {
      await api.removeRepository(need(args[0], 'name'))
      io.out('dropped')
      return 0
    }
    default:
      throw new UsageError('am repo add|seed|drop …  (am help)')
  }
}

async function login(rest: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args: rest,
    options: { name: { type: 'string' }, url: { type: 'string' } },
  })
  const url = (
    values.url ??
    process.env.AGENT_MANAGER_URL ??
    loadSession()?.url ??
    managerUrl()
  ).replace(/\/$/, '')
  const name = values.name ?? (await io.ask('user: '))
  // scripts pass the password in the environment, never on the command line (ps, history)
  const password = process.env.AGENT_MANAGER_PASSWORD ?? (await io.ask('password: ', true))
  const api = new Api(url)
  const { user } = await api.login(name.trim(), password)
  if (!api.cookie) throw new Error('the manager set no session cookie')
  saveSession({ url, cookie: api.cookie, user: user.name })
  io.out(`logged in to ${url} as ${user.name}`)
  return 0
}

async function tail(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      lines: { type: 'string', default: '40' },
      follow: { type: 'boolean', short: 'f' },
      full: { type: 'boolean' },
    },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const n = Number(values.lines)
  if (!Number.isInteger(n) || n < 0) throw new Error('--lines must be a non-negative integer')
  const { items, total } = await api.items(agent.id, { tail: n })
  const shown = new Map<number, string>()
  const print = (s: StoredItem) => {
    const line = renderItem(s, values.full)
    if (shown.get(s.index) === line) return
    shown.set(s.index, line)
    io.out(line)
  }
  for (const s of items) print(s)
  if (!values.follow) return 0
  const events = new Events(api.url, api.authHeaders())
  let lost = false
  await new Promise<void>((resolve) => {
    events.on('error', (e) => {
      io.err(e.message)
      if (/not logged in/.test(e.message)) {
        lost = true
        resolve()
      }
    })
    let from = Math.max(0, total - n) // refetched on each connection: updates to the last items too
    events.on('frame', (f: EventFrame) => {
      if (f.type === 'agent.item' && 'agentId' in f && f.agentId === agent.id) {
        const s = (f as { item: StoredItem }).item
        if (s.item.kind === 'text' && s.item.streaming) return // print text once it is complete
        print(s)
        from = Math.max(from, s.index - n)
      }
      if (f.type === 'agent.reset') {
        io.out(dim('· transcript rebuilt by the manager'))
        shown.clear()
        from = 0
      }
    })
    events.on('open', () => {
      void api
        .items(agent.id, { from })
        .then((r) => {
          for (const s of r.items) if (!(s.item.kind === 'text' && s.item.streaming)) print(s)
        })
        .catch((e: Error) => io.err(e.message))
    })
    events.connect()
    process.on('SIGINT', () => {
      events.close()
      resolve()
    })
  })
  events.close()
  return lost ? 1 : 0
}

/**
 * Prints the items of the turn under way as they arrive, until it ends,
 * errors or stops to ask a permission. `total` is the index the turn's
 * items start at.
 */
/**
 * Prints the items of the turn under way as they arrive, until it ends
 * (a turn end, an error, the session ending) or stops to ask a
 * permission. `total` is the index the turn's items start at. Each
 * (re)connection refetches from there, so nothing is missed in a gap;
 * an item updated in place prints again only if its line changed, and a
 * text identical to the one just printed (Claude finalises a text twice)
 * is not repeated.
 */
async function follow(
  api: Api,
  agent: Agent,
  total: number,
  io: Io,
  quiet = false,
): Promise<'ended' | 'error' | 'permission' | 'lost'> {
  const events = new Events(api.url, api.authHeaders())
  const printed = new Map<number, string>()
  let lastText = ''
  // quiet: the completed items of the turn in order, and how many of the
  // answer's texts have been printed. answerTexts() decides each text once
  // the item after it has arrived (a short text before a tool call is
  // narration and dropped), so a text is emitted the moment it is settled.
  const quietItems: Item[] = []
  let printedTexts = 0
  let outcome: 'ended' | 'error' | 'permission' | 'lost' | null = null
  const settle = (o: typeof outcome) => (outcome ??= o)
  const consider = (s: StoredItem): void => {
    if (s.index < total) return
    if (s.item.kind === 'text' && s.item.streaming) return // print text once it is complete
    const line = renderItem(s)
    if (printed.get(s.index) === line) return
    printed.set(s.index, line)
    if (s.item.kind === 'text') {
      if (s.item.text === lastText) return
      lastText = s.item.text
    }
    // quiet: the run's tool calls and thinking are not printed, only what
    // the agent said to the person (its answer, several texts with tool
    // calls between them, minus the narration before a tool call) and how
    // it ended
    if (!quiet) io.out(line)
    else {
      quietItems.push(s.item)
      const texts = answerTexts(quietItems)
      while (printedTexts < texts.length) io.out(texts[printedTexts++]!)
      if (
        s.item.kind === 'turn_end' ||
        s.item.kind === 'error' ||
        (s.item.kind === 'permission' && !s.item.decision)
      )
        io.out(line)
    }
    if (s.item.kind === 'turn_end') settle('ended')
    else if (s.item.kind === 'error') settle('error')
    else if (s.item.kind === 'system' && s.item.text.startsWith('session ended')) settle('ended')
    else if (s.item.kind === 'permission' && !s.item.decision) {
      io.out(dim(`(answer with: am allow ${agent.name} / am deny ${agent.name})`))
      settle('permission')
    }
  }
  const done = new Promise<void>((resolve) => {
    const check = () => outcome && resolve()
    events.on('frame', (f: EventFrame) => {
      if (f.type === 'agent.reset') {
        io.out(dim('· the transcript was rebuilt by the manager; follow it with am tail --follow'))
        settle('lost')
        return check()
      }
      if (f.type !== 'agent.item' || !('agentId' in f) || f.agentId !== agent.id) return
      consider((f as { item: StoredItem }).item)
      check()
    })
    // each (re)connection: whatever landed while we were not listening
    events.on('open', () => {
      void api
        .items(agent.id, { from: total })
        .then((r) => {
          for (const s of r.items) consider(s)
          check()
        })
        .catch((e: Error) => {
          io.err(e.message)
          settle('lost')
          check()
        })
    })
    events.on('error', (e) => {
      io.err(e.message)
      if (/not logged in/.test(e.message)) {
        settle('lost')
        check()
      }
    })
  })
  try {
    events.connect()
    const opened = await Promise.race([
      new Promise<true>((r) => events.once('open', () => r(true))),
      new Promise<false>((r) => setTimeout(() => r(false), 10_000).unref()),
    ])
    if (!opened && !outcome) {
      io.err('the event stream did not open; the turn was sent, follow it with am tail --follow')
      return 'lost'
    }
    await done
    return outcome ?? 'lost'
  } finally {
    events.close()
  }
}

async function turn(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      'no-wait': { type: 'boolean' },
      quiet: { type: 'boolean' },
      steer: { type: 'boolean' },
      image: { type: 'string', multiple: true },
    },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const text = positionals.slice(1).join(' ')
  if (!text) throw new Error('a text is required')
  const images = (values.image ?? []).map(readImage)
  const { total } = await api.items(agent.id, { tail: 0 })
  const { mode } = await api.turn(agent.id, text, values.steer, images)
  if (mode === 'queued') {
    io.out(dim('queued: the agent cannot take a message mid-turn; it is sent when this turn ends'))
    return 0
  }
  if (values['no-wait']) {
    io.out(mode)
    return 0
  }
  return (await follow(api, agent, total, io, values.quiet ?? false)) === 'error' ? 1 : 0
}

/**
 * The turn under way, waited out: its final answer and how it ended, as
 * `turn --quiet` prints them. Pairs with `turn --no-wait` for a caller
 * that sends, does something else and collects later. With no turn under
 * way, the last turn's answer is printed straight from the transcript.
 */
/** The agent this session is, by its token; null for a person's login. */
async function self(api: Api): Promise<string | null> {
  if (!api.bearer) return null
  return (await api.me()).agent?.id ?? null
}

const clock = (at: number): string => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}

/** One chat message: a line that says who, what kind and when, then the text as it was written. */
function printChat(m: ChatMessage, io: Io, marks: boolean): void {
  const kind =
    m.kind === 'question'
      ? `question, ${m.closedAt === null ? 'open' : m.closedBy === 'answer' ? 'answered' : 'closed'}`
      : m.kind === 'decision'
        ? m.important
          ? 'important decision'
          : 'decision'
        : m.important
          ? 'important'
          : ''
  const re = m.re
    ? `${m.re.kind === 'question' && m.from === 'person' ? 'answer to' : 're'} #${m.re.id} "${m.re.excerpt}"`
    : ''
  const read = marks && m.from === 'person' ? (m.readAt ? `read ${clock(m.readAt)}` : 'unread') : ''
  io.out(
    [bold(`#${m.id}`), m.author, kind, dim(clock(m.at)), re, read && dim(read)]
      .filter(Boolean)
      .join('  '),
  )
  io.out(m.text)
  io.out('')
}

/** How often a weighing under way is asked about. */
const WEIGH_POLL_MS = Number(process.env.AM_WEIGH_POLL_MS) || 3000

/**
 * An agent's dialog with its people: the list, exchanges by number, or
 * a weighing. What it prints of an exchange is what was written, both
 * sides, nothing shortened: it is the record of what was settled.
 */
async function recall(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      agent: { type: 'string' },
      weigh: { type: 'boolean' },
      model: { type: 'string' },
      handback: { type: 'boolean' },
      full: { type: 'boolean' },
      now: { type: 'boolean' },
    },
  })
  const api = client()
  const agentId = values.agent ? (await findAgent(api, values.agent)).agent.id : await self(api)
  if (!agentId)
    throw new Error("am recall --agent <agent>: outside an agent's session, name the agent")
  if (values.weigh) {
    // started there and asked about from here: a weighing takes minutes, longer than a request is held
    const { weighing } = await api.weigh(agentId, values.model)
    io.err(dim(`weighing with ${weighing.model}; this takes minutes`))
    for (;;) {
      await new Promise((r) => setTimeout(r, WEIGH_POLL_MS))
      const d = await api.dialog(agentId)
      if (d.weighing) continue
      if (d.failed && d.failed.at >= weighing.since)
        throw new Error(`the weighing failed: ${d.failed.message}`)
      const live = d.exchanges.filter((e) => !e.withdrawn)
      const done = live.filter((e) => e.weight !== null).length
      io.out(
        `weighed ${done} of ${live.length} exchanges with ${d.weighed?.model ?? weighing.model} in ${Math.round((Date.now() - weighing.since) / 1000)} s`,
      )
      return 0
    }
  }
  if (values.handback && values.now) {
    if (values.agent || !(await self(api)))
      throw new Error(
        "am recall --handback --now is an agent's own: it hands the dialog to the session that asks",
      )
    const { text } = await api.handbackNow()
    io.out(text ?? 'no dialog yet')
    return 0
  }
  if (values.handback) {
    const h = await api.handbackPreview(agentId)
    if (values.full) for (const f of h.files) io.out(f)
    const list = (ns: number[]) => (ns.length ? ns.map((n) => `#${n}`).join(' ') : 'none')
    io.out(`recent, whole: ${list(h.recent)}`)
    io.out(`earlier, whole: ${list(h.kept)}`)
    io.out(
      `${h.indexed} more as one line each; about ${h.tokens.toLocaleString('en-US')} tokens of a budget of ${h.budget.toLocaleString('en-US')}, in ${h.files.length} file${h.files.length === 1 ? '' : 's'}`,
    )
    return 0
  }
  const wanted: number[] = []
  for (const p of positionals) {
    const m = /^#?(\d+)(?:-#?(\d+))?$/.exec(p)
    if (!m) throw new UsageError(`"${p}" is not an exchange number or a range (12, 12-15)`)
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    if (to < from || to - from > 200)
      throw new UsageError(`"${p}": a range runs upward, 200 at most`)
    for (let n = from; n <= to; n++) wanted.push(n)
  }
  const day = (at: number) => new Date(at).toISOString().slice(0, 10)
  if (wanted.length === 0) {
    const { exchanges, weighed, classifier } = await api.dialog(agentId)
    if (exchanges.length === 0) io.out(dim('no dialog yet'))
    for (const e of exchanges) {
      const state = e.withdrawn
        ? 'taken back'
        : e.supersededBy !== null
          ? `reversed by #${e.supersededBy}`
          : e.weight === null
            ? ''
            : e.inForce
              ? ''
              : e.kind === 'task'
                ? 'done'
                : e.kind === 'chatter'
                  ? ''
                  : 'no longer in force'
      io.out(
        [
          bold(`#${e.n}`),
          dim(day(e.at)),
          e.weight === null ? dim('-') : String(e.weight),
          e.kind ?? '',
          e.line,
          state && dim(`(${state})`),
        ]
          .filter(Boolean)
          .join('  '),
      )
    }
    io.out(
      dim(
        weighed
          ? `weighed up to #${weighed.upTo} by ${weighed.model}, ${day(weighed.at)}; 3: needed word for word, 0: nothing to keep`
          : classifier
            ? `not weighed yet (\`am recall --weigh\` does it now, with ${classifier})`
            : 'this manager weighs no dialog: only the recent exchanges are handed back',
      ),
    )
    return 0
  }
  for (const n of wanted) {
    const { exchange: e } = await api.exchange(agentId, n)
    io.out(
      `${bold(`#${e.n}`)}  ${dim(new Date(e.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC')}`,
    )
    io.out(`${e.by}:`)
    io.out(e.person)
    io.out('')
    io.out('agent:')
    io.out(e.agent || dim('(nothing written back before the next message)'))
    io.out('')
  }
  return 0
}

/**
 * An agent's chat. The agent itself, naming nobody, reads: the unread
 * messages are printed and that marks them read, which the people see.
 * `--last N` and anyone else's look read back and mark nothing.
 */
async function chat(rest: string[], io: Io): Promise<number> {
  const api = client()
  const me = await self(api)
  if (rest[0] === 'close') {
    const [a, b] = rest.slice(1)
    const idText = b ?? a
    const ref = b ? a : undefined
    if (!idText || !/^\d+$/.test(idText.replace(/^#/, '')))
      throw new Error('am chat close [<agent>] <id>: the id of an open question')
    const agentId = ref ? (await findAgent(api, ref)).agent.id : me
    if (!agentId)
      throw new Error("am chat close <agent> <id>: outside an agent's session, name the agent")
    const { message } = await api.chatClose(agentId, Number(idText.replace(/^#/, '')))
    io.out(`closed #${message.id}`)
    return 0
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { last: { type: 'string' } },
  })
  const last = values.last === undefined ? null : Number(values.last)
  if (last !== null && (!Number.isInteger(last) || last < 1))
    throw new UsageError('--last takes a number of messages')
  const agentId = positionals[0] ? (await findAgent(api, positionals[0])).agent.id : me
  if (!agentId) throw new Error("am chat <agent>: outside an agent's session, name the agent")
  if (agentId === me && last === null) {
    const { messages, summary } = await api.chatRead(agentId)
    if (messages.length === 0) io.out(dim('nothing unread'))
    for (const m of messages) printChat(m, io, false)
    if (summary.questions)
      io.out(
        dim(
          `${summary.questions} of your questions ${summary.questions === 1 ? 'is' : 'are'} still open`,
        ),
      )
    return 0
  }
  const { messages, summary } = await api.chat(agentId, last ?? 20)
  if (messages.length === 0) io.out(dim('nothing in this chat yet'))
  for (const m of messages) printChat(m, io, true)
  if (agentId === me && summary.unread)
    io.out(dim(`${summary.unread} unread: \`am chat\` prints and marks them read`))
  return 0
}

/**
 * Says something in a chat. Inside an agent's session, naming nobody,
 * it is the agent speaking to the people; with `--to` it is the caller
 * speaking to that agent, which reads it when it chooses.
 */
async function say(rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      to: { type: 'string' },
      decision: { type: 'boolean' },
      question: { type: 'boolean' },
      important: { type: 'boolean' },
      steer: { type: 'boolean' },
      re: { type: 'string' },
    },
  })
  const text = (positionals.length ? positionals.join(' ') : ((await io.stdin?.()) ?? '')).trim()
  if (!text) throw new Error("am say <text...>, or the text on stdin (am say <<'EOF')")
  let replyTo: number | undefined
  if (values.re !== undefined) {
    replyTo = Number(values.re.replace(/^#/, ''))
    if (!Number.isInteger(replyTo)) throw new UsageError('--re takes a message id')
  }
  const api = client()
  const me = await self(api)
  const to = values.to ? (await findAgent(api, values.to)).agent : null
  if (!to || to.id === me) {
    if (!me)
      throw new Error("am say --to <agent> <text...>: outside an agent's session, name the agent")
    if (values.steer) throw new UsageError('--steer is for a message to another agent (--to)')
    if (values.decision && values.question)
      throw new UsageError('--decision or --question, not both')
    const kind = values.question ? 'question' : values.decision ? 'decision' : 'message'
    const { message } = await api.chatSay(me, {
      text,
      kind,
      ...(values.important ? { important: true } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
    })
    io.out(
      kind === 'question'
        ? `asked (#${message.id}): sent to their phones and pinned until answered; the answer arrives in the chat`
        : `${kind === 'decision' ? 'decision said' : 'said'} (#${message.id})${message.important ? ', sent to their phones' : ''}`,
    )
    return 0
  }
  if (values.decision || values.question || values.important)
    throw new UsageError(
      '--decision, --question and --important are for an agent speaking in its own chat',
    )
  const { message, mode } = await api.chatSay(to.id, {
    text,
    ...(values.steer ? { steer: true } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
  })
  io.out(
    mode === 'turn'
      ? `sent to ${to.name} as a turn (#${message.id})`
      : mode === 'steer'
        ? `steered into ${to.name}'s turn (#${message.id})`
        : `left for ${to.name} beside its work (#${message.id}): unread until it reads its chat`,
  )
  return 0
}

/** A project named on the command line, else the one an agent's session carries (AGENT_MANAGER_PROJECT). */
function projectRef(given: string | undefined): string {
  const ref = given ?? process.env.AGENT_MANAGER_PROJECT
  if (!ref) throw new Error("name the project (or run inside an agent's session, which implies it)")
  return ref
}

async function wait(rest: string[], io: Io): Promise<number> {
  const api = client()
  const { agent, status } = await findAgent(api, need(rest[0], 'agent'))
  // the turn's items start after its user message: the last one in the tail
  const { items, total } = await api.items(agent.id, { tail: 200 })
  let from = Math.max(0, total - items.length)
  for (const s of items) if (s.item.kind === 'user') from = s.index + 1
  if (
    status.state === 'working' ||
    status.state === 'waiting-permission' ||
    status.state === 'starting'
  )
    return (await follow(api, agent, from, io, true)) === 'error' ? 1 : 0
  const texts: string[] = []
  let end: StoredItem | null = null
  for (const s of items) {
    if (s.index < from) continue
    if (s.item.kind === 'text' && !s.item.streaming) texts.push(s.item.text)
    if (s.item.kind === 'turn_end' || s.item.kind === 'error') end = s
  }
  for (const t of texts) io.out(t)
  if (end) io.out(renderItem(end))
  else if (texts.length === 0) io.out(dim('nothing to wait for and no answer yet'))
  return end?.item.kind === 'error' ? 1 : 0
}

async function decide(cmd: 'allow' | 'deny', rest: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { option: { type: 'string' }, 'no-wait': { type: 'boolean' } },
  })
  const api = client()
  const { agent } = await findAgent(api, need(positionals[0], 'agent'))
  const { items, total } = await api.items(agent.id, { tail: 200 })
  const pendingOf = (list: StoredItem[]) => {
    const open: StoredItem[] = []
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!
      if (s.item.kind === 'turn_end' || s.item.kind === 'error') break
      if (s.item.kind === 'permission' && !s.item.decision) open.unshift(s)
    }
    return open
  }
  const pending = pendingOf(items)[0]
  if (!pending || pending.item.kind !== 'permission') throw new Error('no permission is pending')
  const option =
    values.option ??
    pending.item.options.find((o) => (cmd === 'allow' ? o.kind === 'allow' : o.kind === 'deny'))?.id
  if (!option)
    throw new Error(
      `no ${cmd} option; offered: ${pending.item.options.map((o) => o.id).join(', ')}`,
    )
  await api.decide(agent.id, pending.item.requestId, option)
  io.out(`${pending.item.title || pending.item.tool}: ${option}`)
  if (values['no-wait']) return 0
  const still = pendingOf((await api.items(agent.id, { tail: 200 })).items).filter(
    (s) => s.index !== pending.index,
  )
  if (still.length) {
    io.out(
      dim(
        `${still.length} more permission(s) pending: am allow ${agent.name} / am deny ${agent.name}`,
      ),
    )
    return 0
  }
  return (await follow(api, agent, total, io)) === 'error' ? 1 : 0
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** An image file for a turn: base64 with the media type from its extension. */
function readImage(file: string): TurnImage {
  const ext = file.toLowerCase().split('.').pop() ?? ''
  const mediaType = IMAGE_TYPES[ext]
  if (!mediaType) throw new UsageError(`${file}: not a png, jpeg, gif or webp`)
  return { mediaType, data: fs.readFileSync(file).toString('base64') }
}
