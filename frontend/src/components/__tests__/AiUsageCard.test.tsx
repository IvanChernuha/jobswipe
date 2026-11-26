// Admin page, AI tab: how much the AI (Claude) has spent this month against
// the monthly budget, so the founder can see it before it runs out
// (user 2026-11-24: "use claude api ... with a limit").
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as api from '../../lib/api'
import AiUsageCard from '../AiUsageCard'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  getAiUsage: vi.fn(),
}))
const getAiUsage = vi.mocked(api.getAiUsage)

const usage: api.AiUsage = {
  month: '2026-11', spent_usd: 2.5, budget_usd: 10, calls: 80, model: 'claude-opus-5-5',
  by_feature: { cv: { calls: 70, spent_usd: 2.1 }, job: { calls: 10, spent_usd: 0.4 } },
}

beforeEach(() => { getAiUsage.mockReset() })

describe('AI spend', () => {
  it('shows the spend against the budget, per feature', async () => {
    getAiUsage.mockResolvedValue(usage)
    render(<AiUsageCard token="tok" />)
    expect(await screen.findByText('$2.50 of $10.00')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('80 calls · claude-opus-5-5')).toBeInTheDocument()
    expect(screen.getByText('CVs')).toBeInTheDocument()
    expect(screen.getByText('70 · $2.10')).toBeInTheDocument()
    expect(getAiUsage).toHaveBeenCalledWith('tok')
  })

  it('says when the AI is paused for the month', async () => {
    getAiUsage.mockResolvedValue({ ...usage, spent_usd: 10.02 })
    render(<AiUsageCard token="tok" />)
    expect(await screen.findByText(/paused until the 1st/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('says when the AI is switched off', async () => {
    getAiUsage.mockResolvedValue({ ...usage, spent_usd: 0, budget_usd: 0, calls: 0, by_feature: {} })
    render(<AiUsageCard token="tok" />)
    expect(await screen.findByText(/AI is off/)).toBeInTheDocument()
  })

  it('says if it could not load', async () => {
    getAiUsage.mockRejectedValue(new Error('Admin only'))
    render(<AiUsageCard token="tok" />)
    expect(await screen.findByText('Admin only')).toBeInTheDocument()
  })
})
