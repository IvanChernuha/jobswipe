// The job check on the website (user 2026-11-26): the form, file results and
// the job list say what a job is missing before it can go live.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import JobChecklist from '../JobChecklist'

describe('JobChecklist', () => {
  it('lists what is missing, then the tips', () => {
    render(<JobChecklist issues={[
      { code: 'description', level: 'must' }, { code: 'skills', level: 'must' }, { code: 'salary', level: 'should' },
    ]} />)
    expect(screen.getByText('Before it can go live:')).toBeInTheDocument()
    expect(screen.getByText('Add a description (a few sentences about the job)')).toBeInTheDocument()
    expect(screen.getByText('Add at least one skill')).toBeInTheDocument()
    expect(screen.getByText('Tips:')).toBeInTheDocument()
    expect(screen.getByText('Add a salary range')).toBeInTheDocument()
  })

  it('says when the job is ready, with any tips', () => {
    render(<JobChecklist issues={[{ code: 'required_skills', level: 'should' }]} />)
    expect(screen.getByText('Ready to go live')).toBeInTheDocument()
    expect(screen.getByText('Mark the skills a candidate must have')).toBeInTheDocument()
    expect(screen.queryByText('Before it can go live:')).toBeNull()
  })

  it('compact: only what is missing', () => {
    render(<JobChecklist compact issues={[{ code: 'location', level: 'must' }, { code: 'salary', level: 'should' }]} />)
    expect(screen.getByText('Add a location, or mark the job as remote')).toBeInTheDocument()
    expect(screen.queryByText('Add a salary range')).toBeNull()
  })
})
