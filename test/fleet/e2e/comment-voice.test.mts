/**
 * @file E2E tier for scripts/fleet/comment-voice.mts — spawns the real CLI
 *   as a subprocess and asserts the full contract: argv parsing, stdin
 *   piping, file arguments, stdout shape, and exit codes. This is the only
 *   tier that exercises the `isMain` entry guard and the process boundary
 *   the way a human (or a hook) actually invokes the tool. The path resolves
 *   relative to this file so the same test works at the template source and
 *   in the cascaded mirror.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { whichSync } from '@socketsecurity/lib-stable/exe/path/which'
import { isSpawnExitError } from '@socketsecurity/lib-stable/process/spawn/errors'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { afterAll, describe, expect, it } from 'vitest'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const stateDirectory = mkdtempSync(path.join(os.tmpdir(), 'comment-voice-e2e-'))
afterAll(async () => {
  await safeDelete(stateDirectory)
})

const CLI = fileURLToPath(
  new URL('../../../scripts/fleet/comment-voice.mts', import.meta.url),
)

/**
 * The interpreter to spawn the CLI with. The CLI reaches `node:sqlite` via
 * `process.getBuiltinModule`, which Bun does not back the same way — under
 * `bun test`, `process.execPath` IS bun, so spawning the CLI with it runs the
 * Node-only tool under Bun and crashes. The CLI is Node-targeted regardless of
 * which runtime hosts this test, so the bun case resolves node off PATH.
 */
function resolveNodeBinSync(): string {
  if (!process.versions['bun']) {
    return process.execPath
  }
  const resolved = whichSync('node')
  if (typeof resolved !== 'string') {
    throw new Error('no node binary on PATH to host the Node-targeted CLI')
  }
  return resolved
}

const NODE_BIN = resolveNodeBinSync()

/**
 * Runs the CLI and answers its exit code plus stdout. A non-zero exit is a
 * result here rather than a failure, because the violation cases are exactly
 * what these tests assert, and lib spawn signals that by throwing.
 */
async function runProc(
  args: string[],
  stdin?: string | undefined,
): Promise<{ code: number; stdout: string }> {
  const running = spawn(NODE_BIN, [CLI, ...args], {
    // NO_HYPERLINK pins the copy affordance to its pbcopy-line branch so
    // the assertion does not depend on the invoking terminal.
    env: {
      ...process.env,
      NO_HYPERLINK: '1',
      SOCKET_STATE_DIR: stateDirectory,
      VOICE_PROFILE_JSON: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (stdin !== undefined) {
    running.process.stdin?.write(stdin)
  }
  running.process.stdin?.end()
  try {
    const { code, stdout } = await running
    return { code, stdout }
  } catch (e) {
    if (isSpawnExitError(e)) {
      return { code: e.code, stdout: String(e.stdout) }
    }
    throw e
  }
}

describe('comment-voice CLI end to end', () => {
  it('--rules prints the decision tree and exits 0', async () => {
    const { code, stdout } = await runProc(['--rules'])
    expect(code).toBe(0)
    expect(stdout).toContain('Reaction rule:')
    expect(stdout).toContain('Message rules (enforced):')
  })

  it('piped violation exits 1 and names the rules', async () => {
    const { code, stdout } = await runProc(
      ['--thread'],
      '👍 — keep it out of this RFC, honestly.',
    )
    expect(code).toBe(1)
    expect(stdout).toContain('thumbs-format')
    expect(stdout).toContain('gatekeeping')
    expect(stdout).toContain('violation(s)')
  })

  it('clean draft from a file exits 0 with a copy affordance', async () => {
    const file = path.join(stateDirectory, 'draft.md')
    writeFileSync(file, '👍 - resolved at head.')
    const { code, stdout } = await runProc(['--thread', file])
    expect(code).toBe(0)
    expect(stdout).toContain('copy: pbcopy < ')
    expect(stdout.trim().endsWith('clean')).toBe(true)
  })

  it('warnings-only draft exits 0 but says so', async () => {
    const { code, stdout } = await runProc(
      ['--thread'],
      '👍 - one. Two here. Three here. Four here.',
    )
    expect(code).toBe(0)
    expect(stdout).toContain('clean (warnings only)')
  })
})
