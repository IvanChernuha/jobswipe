// Jobs page: import jobs from Comeet (OpenProject #3297). The user wants it
// "brain-dead, just tap and go": a popup with a UID box and a Token box, each
// with a Paste button (2026-11-27), then the jobs come in by themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks() })

const card = (onJobsChanged = vi.fn()) => {
  render(<ComeetCard token="tok" onJobsChanged={onJobsChanged} pollMs={5} />)
  return onJobsChanged
}

const TOKEN = '5E7236A0BCE5E7295111B55E70BCE'
const startConnect = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Import from Comeet' }))
  return screen.getByRole('dialog', { name: 'Connect Comeet' })
}
const clipboard = (readText: () => Promise<string>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })

describe('Import from Comeet', () => {
  it('a popup with a UID box and a Token box connects, imports, and refreshes the jobs', async () => {
    m.getComeetStatus.mockResolvedValueOnce({ connected: false })
      .mockResolvedValueOnce({ ...connected, status: 'importing' })
      .mockResolvedValue(connected)
    m.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    const onJobsChanged = card()

    const dialog = await startConnect()
    expect(within(dialog).getByText(/Company Settings → Careers Website/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open Comeet settings' })).toHaveAttribute(
      'href', 'https://app.comeet.co/app/company/settings/careers')
    expect(within(dialog).getByText(/can't see your candidates/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))

    expect(await screen.findByText('Found 3 jobs at Careers API Sandbox. Importing them now…')).toBeInTheDocument()
    expect(m.connectComeet).toHaveBeenCalledWith('tok', `E5.007 ${TOKEN}`)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Careers API Sandbox: 3 live jobs from Comeet')).toBeInTheDocument()
    await waitFor(() => expect(onJobsChanged).toHaveBeenCalled())
  })

  it('Connect waits for both boxes', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    const dialog = await startConnect()
    const connect = within(dialog).getByRole('button', { name: 'Connect' })
    expect(connect).toBeDisabled()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    expect(connect).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })
    expect(connect).toBeEnabled()
  })

  it('a Paste button fills the box; a copy of both fills both', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    await startConnect()
    clipboard(() => Promise.resolve('E5.007'))
    fireEvent.click(screen.getByRole('button', { name: 'Paste the UID' }))
    await waitFor(() => expect(screen.getByLabelText('UID')).toHaveValue('E5.007'))
    expect(screen.getByLabelText('Token')).toHaveValue('')

    clipboard(() => Promise.resolve(`UID: E5.007\nToken: ${TOKEN}`))
    fireEvent.click(screen.getByRole('button', { name: 'Paste the Token' }))
    await waitFor(() => expect(screen.getByLabelText('Token')).toHaveValue(TOKEN))
    expect(screen.getByLabelText('UID')).toHaveValue('E5.007')
  })

  it('a value pasted into the wrong box goes to the right one', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    await startConnect()
    clipboard(() => Promise.resolve(TOKEN))
    fireEvent.click(screen.getByRole('button', { name: 'Paste the UID' }))
    await waitFor(() => expect(screen.getByLabelText('Token')).toHaveValue(TOKEN))
    expect(screen.getByLabelText('UID')).toHaveValue('')
  })

  it('pasting both into one box (Ctrl+V) splits them', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    await startConnect()
    fireEvent.paste(screen.getByLabelText('UID'), { clipboardData: { getData: () => `E5.007 ${TOKEN}` } })
    expect(screen.getByLabelText('UID')).toHaveValue('E5.007')
    expect(screen.getByLabelText('Token')).toHaveValue(TOKEN)
  })

  it('if the browser blocks the Paste button, says how to paste by hand', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    await startConnect()
    clipboard(() => Promise.reject(new Error('NotAllowedError')))
    fireEvent.click(screen.getByRole('button', { name: 'Paste the UID' }))
    expect(await screen.findByText(/Paste didn't work here/)).toBeInTheDocument()
  })

  it('says why Comeet refused, and keeps what was typed', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    m.connectComeet.mockRejectedValue(new Error("Comeet didn't accept this UID or Token."))
    card()
    const dialog = await startConnect()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'WRONGWRONGWRONGWRONG' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }))
    expect(await within(dialog).findByText("Comeet didn't accept this UID or Token.")).toBeInTheDocument()
    expect(screen.getByLabelText('Token')).toHaveValue('WRONGWRONGWRONGWRONG')
  })

  it('Cancel or Escape closes the popup', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    card()
    await startConnect()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const dialog = await startConnect()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  // On a phone, opening Comeet puts this tab in the background, and phones
  // often reload background tabs. The popup must come back as it was.
  it('keeps the popup and what was typed when the page reloads', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    const first = render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    await startConnect()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })
    first.unmount()

    render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    expect(await screen.findByRole('dialog', { name: 'Connect Comeet' })).toBeInTheDocument()
    expect(screen.getByLabelText('UID')).toHaveValue('E5.007')
    expect(screen.getByLabelText('Token')).toHaveValue(TOKEN)
  })

  it('Cancel and Connect forget it', async () => {
    m.getComeetStatus.mockResolvedValue({ connected: false })
    m.connectComeet.mockResolvedValue({ company_name: 'Careers API Sandbox', found: 3, status: 'importing' })
    const first = render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    await startConnect()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    first.unmount()
    const second = render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await startConnect()
    fireEvent.change(screen.getByLabelText('UID'), { target: { value: 'E5.007' } })
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: TOKEN } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText(/Found 3 jobs/)
    second.unmount()
    render(<ComeetCard token="tok" onJobsChanged={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Import from Comeet' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
