// Jobs page: import jobs from Comeet (OpenProject #3297). The user wants it
// "brain-dead, just tap and go": one paste of the UID + Token, then the jobs
// come in by themselves and stay in sync.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as api from '../../lib/api'
import ComeetCard from '../ComeetCard'

vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  getComeetStatus: vi.fn(),
  connectComeet: vi.fn(),
  syncComeet: vi.fn(),
  disconnectComeet: vi.fn(),
}))
const m = vi.mocked(api)

const connected: api.ComeetStatus = {
  connected: true, company_name: 'Careers API Sandbox', status: 'connected',
  job_count: 3, live_count: 3, last_synced_at: '2026-11-26T10:00:00Z', last_error: null,
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

const card = (onJobsChanged = vi.fn()) => {
  render(<ComeetCard token="tok" onJobsChanged={onJobsChanged} pollMs={5} />)
  return onJobsChanged
}

describe('Import from Comeet', () => {
  it('one paste connects, imports, and refreshes the jobs', async () => {
    m.getComeetStatus.mockResolvedValueOnce({ connected: false })
      .mockResolvedValueOnce({ ...connected, status: 'importing' })
      .mockResolvedValue(connected)
    m.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    const onJobsChanged = card()

    fireEvent.click(await screen.findByRole('button', { name: 'Import from Comeet' }))
    expect(screen.getByText(/Company Settings → Careers Website/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Comeet settings' })).toHaveAttribute(
      'href', 'https://app.comeet.co/app/company/settings/careers')
    fireEvent.change(screen.getByLabelText('UID and Token'), { target: { value: 'UID: E5.007\nToken: ABC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    expect(await screen.findByText('Found 3 jobs at Careers API Sandbox. Importing them now…')).toBeInTheDocument()
    expect(m.connectComeet).toHaveBeenCalledWith('tok', 'UID: E5.007\nToken: ABC')
    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeInTheDocument()
    await waitFor(() => expect(onJobsChanged).toHaveBeenCalled())
  })

  it('Connect waits for a paste', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    fireEvent.click(await screen.findByRole('button', { name: 'Import from Comeet' }))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('says why Comeet refused, and keeps the paste', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    m.connectComeet.mockRejectedValue(new Error("Comeet didn't accept this UID or Token."))
    card()
    fireEvent.click(await screen.findByRole('button', { name: 'Import from Comeet' }))
    fireEvent.change(screen.getByLabelText('UID and Token'), { target: { value: 'E5.007 WRONG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText("Comeet didn't accept this UID or Token.")).toBeInTheDocument()
    expect(screen.getByLabelText('UID and Token')).toHaveValue('E5.007 WRONG')
  })

  it('when connected: shows the company, and Sync now updates', async () => {
    m.getComeetStatus.mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ ...connected, status: 'importing' })
      .mockResolvedValue({ ...connected, live_count: 4, job_count: 4 })
    m.syncComeet.mockResolvedValue({ status: 'importing' })
    const onJobsChanged = card()
    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeInTheDocument()
    expect(screen.getByText(/Last synced/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(m.syncComeet).toHaveBeenCalledWith('tok')
    expect(await screen.findByText('Careers API Sandbox: 4 live jobs from Comeet')).toBeInTheDocument()
    await waitFor(() => expect(onJobsChanged).toHaveBeenCalled())
  })

  it('disconnect asks first, then switches the imported jobs off', async () => {
    m.getComeetStatus.mockResolvedValue(connected)
    m.disconnectComeet.mockResolvedValue({ disconnected: true, jobs_switched_off: 3 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onJobsChanged = card()
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(confirm).toHaveBeenCalledWith('Disconnect Comeet? The jobs imported from it will be switched off.')
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeInTheDocument()
    expect(m.disconnectComeet).toHaveBeenCalledWith('tok')
    expect(onJobsChanged).toHaveBeenCalled()
  })

  it('shows why the last sync failed', async () => {
    m.getComeetStatus.mockResolvedValue({ ...connected, status: 'error', last_error: "Comeet isn't answering right now." })
    card()
    expect(await screen.findByText("The last sync didn't work: Comeet isn't answering right now.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
  })

  it("shows nothing if the status can't load (e.g. a worker)", async () => {
    m.getComeetStatus.mockRejectedValue(new Error('Employers only'))
    const { container } = render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    await waitFor(() => expect(m.getComeetStatus).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('says how many imported jobs need a check', async () => {
    m.getComeetStatus.mockResolvedValue(connected)
    render(<ComeetCard token="tok" onJobsChanged={vi.fn()} needCheck={2} />)
    expect(await screen.findByText('2 imported jobs need a check before they can go live.')).toBeInTheDocument()
  })
})
