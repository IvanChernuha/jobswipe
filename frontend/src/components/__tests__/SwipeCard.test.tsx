import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import SwipeCard, { type CardData } from '../SwipeCard'
import type { MatchScore } from '../../lib/api'

function card(match_score: MatchScore | null): CardData {
  return {
    id: 'w1',
    name: 'Dana Levi',
    avatar_url: null,
    title: '2 yrs experience',
    bio: 'Junior developer',
    location: 'Tel Aviv',
    skills: [],
    tags: [],
    match_score,
  }
}

const best: MatchScore = { matched: 6, total: 7, percentage: 86, job_id: 'j1', job_title: 'AI Engineer' }

describe('SwipeCard match badge', () => {
  it('names the job the best score is for (employer feed)', () => {
    render(<SwipeCard card={card(best)} />)
    expect(screen.getByText('86%')).toBeInTheDocument()
    expect(screen.getByText('for AI Engineer')).toBeInTheDocument()
  })

  it('shows no job line when the score has no job (worker feed)', () => {
    render(<SwipeCard card={card({ matched: 3, total: 4, percentage: 75 })} />)
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.queryByText(/^for /)).not.toBeInTheDocument()
  })

  it('shows no badge when there is no score (no live jobs)', () => {
    render(<SwipeCard card={card(null)} />)
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('shows no badge when the job has no tags to match against', () => {
    render(<SwipeCard card={card({ ...best, matched: 0, total: 0, percentage: 0 })} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    expect(screen.queryByText('for AI Engineer')).not.toBeInTheDocument()
  })

  it('translates the job line in Hebrew', async () => {
    await act(() => i18n.changeLanguage('he'))
    render(<SwipeCard card={card(best)} />)
    expect(screen.getByText('למשרה: AI Engineer')).toBeInTheDocument()
  })
})
