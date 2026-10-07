import { describe, expect, it } from 'vitest'
import { extractReport } from '../src/cre/sim-runner'

// Shape of `cre workflow simulate` output on 2026-10-07: keys sorted, one signature per line.
const output = `2026-10-07T06:50:11Z [USER LOG] Report delivered to the ProX backend
✓ Workflow Simulation Result:
{
  "context": "0001020304",
  "report": "015ccbe1bf",
  "signatures": [
    "4966d61921",
    "7bf112dba9"
  ]
}
2026-10-07T06:50:11Z [SIMULATION] Execution finished signal received`

describe('extractReport', () => {
  it('reads the signed report out of the CLI result regardless of key order', () => {
    expect(extractReport(output)).toEqual({ report: '015ccbe1bf', context: '0001020304', signatures: ['4966d61921', '7bf112dba9'] })
  })

  it('returns null when the run produced no report', () => {
    expect(extractReport('✓ Workflow Simulation Result:\n{\n  "skipped": "no live protection to observe"\n}')).toBeNull()
  })
})
