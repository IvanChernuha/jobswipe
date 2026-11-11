// P7: the Team tab (web Team.tsx). Members and their roles, pending invites,
// invite by email with a role (the link goes out through the share sheet),
// change a role, remove someone; without a team: create one or join one.
import { Alert, Share } from 'react-native'
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('../src/lib/config', () => ({
  config: { apiUrl: 'https://jobswipe.test/api', webUrl: 'https://jobswipe.test', supabaseUrl: '', supabaseAnonKey: '' },
}))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getMyMembership: jest.fn(),
  getMyOrg: jest.fn(),
  getOrgMembers: jest.fn(),
  getOrgInvites: jest.fn(),
  createInvite: jest.fn(),
  revokeInvite: jest.fn(),
  updateMemberRole: jest.fn(),
  removeMember: jest.fn(),
  createOrg: jest.fn(),
  joinOrg: jest.fn(),
  // The feed tab mounts too; keep it quiet.
  getEmployerFeed: jest.fn(async () => []),
  getJobPostings: jest.fn(async () => []),
}))

const mocked = api as jest.Mocked<typeof api>
const APP = './src/app'

const member = (id: string, email: string, role: string): api.OrgMember => ({
  id, user_id: `u-${id}`, email, role, created_at: '2026-11-01T10:00:00Z',
})
const invite = (id: string, email: string, role: string): api.OrgInvite => ({
  id, email, role, token: `tok-${id}`, used: false, expires_at: '2026-12-01T10:00:00Z',
})

async function openTeam() {
  fakeSupabase.__reset(sessionFor('employer', 'owner@wix.com'))
  return renderRouter(APP, { initialUrl: '/team' })
}

const press = async (label: string) => act(async () => fireEvent.press(screen.getByRole('button', { name: label })))
const inMember = (id: string) => within(screen.getByTestId(`member-${id}`))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getMyMembership.mockResolvedValue({ has_org: true, role: 'owner', org_id: 'o1' })
  mocked.getMyOrg.mockResolvedValue({ id: 'o1', name: 'Wix Hiring', owner_id: 'u-m1', created_at: '2026-11-01T10:00:00Z' })
  mocked.getOrgMembers.mockResolvedValue([
    member('m1', 'owner@wix.com', 'owner'), member('m2', 'dana@wix.com', 'manager'), member('m3', 'omer@wix.com', 'viewer'),
  ])
  mocked.getOrgInvites.mockResolvedValue([invite('i1', 'noa@wix.com', 'viewer')])
  mocked.createInvite.mockImplementation(async (_t, email, role) => invite('i2', email, role))
  mocked.revokeInvite.mockResolvedValue(undefined)
  mocked.updateMemberRole.mockImplementation(async (_t, id, role) => member(id, 'dana@wix.com', role))
  mocked.removeMember.mockResolvedValue(undefined)
})

describe('your team', () => {
  it('shows the team, your role, the members and pending invites', async () => {
    await openTeam()
    expect(await screen.findByText('Wix Hiring')).toBeOnTheScreen()
    expect(screen.getByText('Your role: Owner')).toBeOnTheScreen()
    expect(inMember('m2').getByText('dana@wix.com')).toBeOnTheScreen()
    expect(inMember('m3').getByRole('radio', { name: 'Viewer' })).toBeChecked()
    expect(screen.getByText('noa@wix.com')).toBeOnTheScreen()
  })

  it("the owner can't be changed or removed", async () => {
    await openTeam()
    await screen.findByText('Wix Hiring')
    expect(inMember('m1').queryByRole('radio')).toBeNull()
    expect(inMember('m1').queryByRole('button', { name: /Remove/ })).toBeNull()
  })

  it("changes a member's role", async () => {
    await openTeam()
    await screen.findByText('Wix Hiring')
    await act(async () => fireEvent.press(inMember('m2').getByRole('radio', { name: 'Admin' })))
    expect(mocked.updateMemberRole).toHaveBeenCalledWith('token-employer', 'm2', 'admin')
    expect(await inMember('m2').findByRole('radio', { name: 'Admin' })).toBeChecked()
  })

  it('removes a member after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    await openTeam()
    await screen.findByText('Wix Hiring')
    await act(async () => fireEvent.press(inMember('m3').getByRole('button', { name: 'Remove omer@wix.com' })))
    expect(alert).toHaveBeenCalled()
    expect(mocked.removeMember).toHaveBeenCalledWith('token-employer', 'm3')
    await waitFor(() => expect(screen.queryByText('omer@wix.com')).toBeNull())
    alert.mockRestore()
  })
})

describe('inviting', () => {
  it('invites by email with the chosen role', async () => {
    await openTeam()
    await screen.findByText('Wix Hiring')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Email address'), ' yossi@wix.com '))
    await act(async () => fireEvent.press(within(screen.getByTestId('invite-role')).getByRole('radio', { name: 'Manager' })))
    await press('Invite')
    expect(mocked.createInvite).toHaveBeenCalledWith('token-employer', 'yossi@wix.com', 'manager')
    expect(await screen.findByText('yossi@wix.com')).toBeOnTheScreen()
    expect(screen.getByLabelText('Email address')).toHaveDisplayValue('')
  })

  it('says why an invite failed', async () => {
    mocked.createInvite.mockRejectedValueOnce(new Error('Already a member'))
    await openTeam()
    await screen.findByText('Wix Hiring')
    await act(async () => fireEvent.changeText(screen.getByLabelText('Email address'), 'dana@wix.com'))
    await press('Invite')
    expect(await screen.findByText('Already a member')).toBeOnTheScreen()
  })

  it('shares the invite link through the phone', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined })
    await openTeam()
    await screen.findByText('noa@wix.com')
    await press('Share invite for noa@wix.com')
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('https://jobswipe.test/join?token=tok-i1') })
    share.mockRestore()
  })

  it('revokes a pending invite', async () => {
    await openTeam()
    await screen.findByText('noa@wix.com')
    await press('Revoke invite for noa@wix.com')
    expect(mocked.revokeInvite).toHaveBeenCalledWith('token-employer', 'i1')
    await waitFor(() => expect(screen.queryByText('noa@wix.com')).toBeNull())
  })
})

describe('team roles', () => {
  it('viewers see the members but cannot manage anything', async () => {
    mocked.getMyMembership.mockResolvedValue({ has_org: true, role: 'viewer', org_id: 'o1' })
    await openTeam()
    expect(await screen.findByText('dana@wix.com')).toBeOnTheScreen()
    expect(screen.getByText('Your role: Viewer')).toBeOnTheScreen()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Admin' })).toBeNull()
    expect(mocked.getOrgInvites).not.toHaveBeenCalled()
  })
})

describe('no team yet', () => {
  beforeEach(() => {
    // Every call: the feed tab asks too (for team viewers' rights).
    mocked.getMyMembership.mockResolvedValue({ has_org: false, role: null, org_id: null })
  })

  it('creates a team', async () => {
    mocked.createOrg.mockImplementation(async () => {
      mocked.getMyMembership.mockResolvedValue({ has_org: true, role: 'owner', org_id: 'o1' })
      return { id: 'o1', name: 'Wix Hiring', owner_id: 'u-m1', created_at: '' }
    })
    await openTeam()
    await act(async () => fireEvent.changeText(await screen.findByLabelText('Organization name'), 'Wix Hiring'))
    await press('Create Organization')
    expect(mocked.createOrg).toHaveBeenCalledWith('token-employer', 'Wix Hiring')
    expect(await screen.findByText('Your role: Owner')).toBeOnTheScreen()
  })

  it('joins a team with the code from an invite link', async () => {
    mocked.joinOrg.mockResolvedValue(member('m9', 'owner@wix.com', 'viewer'))
    await openTeam()
    await act(async () => fireEvent.press(await screen.findByRole('radio', { name: 'Join Organization' })))
    await act(async () => fireEvent.changeText(screen.getByLabelText('Invite token'), 'https://jobswipe.test/join?token=abc123'))
    await press('Join Organization')
    expect(mocked.joinOrg).toHaveBeenCalledWith('token-employer', 'abc123')
  })
})
