import { describe, expect, test } from 'claude-code/testing'

import { keywordsOf, newGoal, noteCommit, noteEdit } from '../hooks/goal'
import { commitMessageOf } from '../hooks/ships'

describe('goal', () => {
  test('keywords are the meaningful words, lowercased, without filler', () => {
    expect(keywordsOf('Ship the pricing page for the launch')).toEqual([
      'ship',
      'pricing',
      'page',
      'launch',
    ])
  })

  test('plurals and camelCase are folded so a path can meet a goal', () => {
    expect(keywordsOf('fix payments retries')).toContain('payment')
    expect(keywordsOf('PricingTable')).toEqual(['pricing', 'table'])
  })

  test('a goal made of filler has no keywords', () => {
    expect(keywordsOf('do the thing')).toEqual([])
  })

  test('an edit whose path shares a word with the goal touches it', () => {
    const goal = newGoal('Ship the pricing page', 1000)

    noteEdit(goal, 'src/pages/Pricing.tsx', 2000)

    expect(goal.edits).toBe(1)
    expect(goal.commits).toBe(0)
    expect(goal.touchedAt).toBe(2000)
  })

  test('an edit that shares no word does not', () => {
    const goal = newGoal('Ship the pricing page', 1000)

    noteEdit(goal, 'src/auth/login.ts', 2000)
    noteEdit(goal, 'src/index.ts', 3000)

    expect(goal.edits).toBe(0)
    expect(goal.touchedAt).toBeUndefined()
  })

  test('a commit message that shares a word touches it', () => {
    const goal = newGoal('Ship the pricing page', 1000)

    noteCommit(goal, 'update pricing copy', 5000)
    noteCommit(goal, 'bump deps', 6000)

    expect(goal.commits).toBe(1)
    expect(goal.touchedAt).toBe(5000)
  })

  test('the commit message is what follows -m, not the command', () => {
    expect(commitMessageOf('git commit -m "add the payment retry"')).toBe(
      'add the payment retry',
    )
    expect(commitMessageOf('git commit -am first -m second')).toBe(
      'first second',
    )
    expect(commitMessageOf('git commit --message=tidy')).toBe('tidy')
    expect(commitMessageOf('git commit --amend --no-edit')).toBe('')
  })

  test('the word commit in the goal does not match every commit', () => {
    const goal = newGoal('commit more often', 1000)

    noteCommit(goal, commitMessageOf('git commit -m "tidy"'), 2000)

    expect(goal.commits).toBe(0)
  })
})
