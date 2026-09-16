// @vitest-environment jsdom
/** The sub-agent tree: nesting, per-node metrics, and the empty case. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AgentTree } from '../src/client/AgentTree.tsx'
import type { AgentTreeNode } from '../src/client/observability-model.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

function node(over: Partial<AgentTreeNode> = {}): AgentTreeNode {
  return {
    id: 'root' as AgentTreeNode['id'],
    label: 'Root',
    depth: 0,
    running: false,
    mode: 'root',
    children: [],
    ...over,
  }
}

describe('AgentTree', () => {
  it('renders the empty copy for a childless root', () => {
    render(<AgentTree root={node()} t={t} />)
    expect(screen.getByText(zh['tree.empty'])).toBeTruthy()
  })

  it('renders nested nodes with mode, provider/model, state, and metrics', () => {
    render(
      <AgentTree
        root={node({
          children: [node({
            id: 'child' as AgentTreeNode['id'],
            label: 'Child',
            depth: 1,
            running: true,
            mode: 'continuable',
            tokenTotal: 1500,
            durationMs: 2500,
            provider: 'deepseek',
            model: 'v4',
            children: [],
          })],
        })}
        t={t}
      />,
    )
    expect(screen.getByText('Child')).toBeTruthy()
    expect(screen.getAllByRole('treeitem')).toHaveLength(2)
    expect(screen.getByText('deepseek/v4')).toBeTruthy()
    expect(screen.getByText(zh['mode.continuable'])).toBeTruthy()
    expect(screen.getByText(zh['tree.running'])).toBeTruthy()
    expect(screen.getByText('1.5 千 · 2.5 秒')).toBeTruthy()
  })
})
