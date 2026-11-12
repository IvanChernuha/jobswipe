// P6 (early): see and edit your profile (web Profile.tsx). Workers: name,
// location, experience, bio and skills; employers: the company. Photo and CV
// upload come later.
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import * as api from '@jobswipe/shared/api'
import * as Sharing from 'expo-sharing'
import * as ImagePicker from 'expo-image-picker'
import { fakeSupabase, sessionFor } from './helpers/fakeSupabase'

jest.mock('../src/lib/supabase', () => ({ supabase: require('./helpers/fakeSupabase').fakeSupabase }))
jest.mock('@jobswipe/shared/api', () => ({
  ...jest.requireActual('@jobswipe/shared/api'),
  getWorkerProfile: jest.fn(),
  updateWorkerProfile: jest.fn(),
  getEmployerProfile: jest.fn(),
  updateEmployerProfile: jest.fn(),
  getTags: jest.fn(),
  exportMyData: jest.fn(),
  deleteMyAccount: jest.fn(),
  uploadAvatar: jest.fn(),
}))
const mockWrite = jest.fn(async () => {})
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((_dir: string, name: string) => ({
    uri: `file:///cache/${name}`, create: jest.fn(), write: mockWrite,
  })),
}))
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }))
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }))

const mocked = api as jest.Mocked<typeof api>
const APP = './src/app'

const react = { id: 't1', name: 'React', category: 'framework' }
const python = { id: 't3', name: 'Python', category: 'language' }

const worker: api.WorkerProfile = {
  id: 'w1', user_id: 'id-worker', name: 'Alice Chen', bio: 'Frontend dev who loves clean UI',
  location: 'Tel Aviv', skills: [], experience_years: 2, avatar_url: null, resume_url: null, tags: [react],
}

const company: api.EmployerProfile = {
  id: 'e1', user_id: 'id-employer', company_name: 'Wix', description: 'Website builder',
  industry: 'Software', location: 'Tel Aviv', avatar_url: null,
}

async function open(role: 'worker' | 'employer', url = '/profile') {
  fakeSupabase.__reset(sessionFor(role))
  return renderRouter(APP, { initialUrl: url })
}

const press = async (label: string) => act(async () => fireEvent.press(screen.getByRole('button', { name: label })))
const type = async (label: string, text: string) => act(async () => fireEvent.changeText(screen.getByLabelText(label), text))

beforeEach(() => {
  jest.clearAllMocks()
  mocked.getWorkerProfile.mockResolvedValue(worker)
  mocked.updateWorkerProfile.mockImplementation(async (_t, data) => ({ ...worker, ...data }) as api.WorkerProfile)
  mocked.getEmployerProfile.mockResolvedValue(company)
  mocked.updateEmployerProfile.mockImplementation(async (_t, data) => ({ ...company, ...data }))
  mocked.getTags.mockResolvedValue([react, python])
})

describe('worker profile', () => {
  it('shows who you are and your skills', async () => {
    await open('worker')
    expect(await screen.findByText('Alice Chen')).toBeOnTheScreen()
    expect(screen.getByText('Frontend dev who loves clean UI')).toBeOnTheScreen()
    expect(screen.getByText('React')).toBeOnTheScreen()
    expect(screen.getByText('Tel Aviv · 2 yrs exp')).toBeOnTheScreen()
  })

  it('edits the details and skills', async () => {
    const router = await open('worker')
    await screen.findByText('Alice Chen')
    await press('Edit profile')
    expect(await screen.findByDisplayValue('Alice Chen')).toBeOnTheScreen()
    await type('Bio', 'React and Python developer')
    await type('Years of experience', '3')
    await type('Search skills (e.g. React, Python, AWS)...', 'py')
    await press('Python')
    await press('Save changes')
    expect(mocked.updateWorkerProfile).toHaveBeenCalledWith('token-worker', {
      name: 'Alice Chen', location: 'Tel Aviv', experience_years: 3, bio: 'React and Python developer',
      tag_ids: ['t1', 't3'],
    })
    await waitFor(() => expect(router.getPathname()).toBe('/profile'))
  })

  it('a refused save says why and stays on the form', async () => {
    mocked.updateWorkerProfile.mockRejectedValueOnce(new Error('Name is too long'))
    await open('worker', '/profile/edit')
    await screen.findByDisplayValue('Alice Chen')
    await press('Save changes')
    expect(await screen.findByText('Name is too long')).toBeOnTheScreen()
  })

  it('an empty profile invites you to fill it in', async () => {
    mocked.getWorkerProfile.mockResolvedValueOnce({ ...worker, name: '', bio: '', location: '', tags: [] })
    await open('worker')
    expect(await screen.findByText('Add your details so employers can find you.')).toBeOnTheScreen()
  })
})

describe('company profile', () => {
  it('shows the company', async () => {
    await open('employer')
    expect(await screen.findByText('Wix')).toBeOnTheScreen()
    expect(screen.getByText('Website builder')).toBeOnTheScreen()
    expect(screen.getByText('Software · Tel Aviv')).toBeOnTheScreen()
  })

  it('edits the company', async () => {
    await open('employer')
    await screen.findByText('Wix')
    await press('Edit profile')
    await screen.findByDisplayValue('Wix')
    await type('Company name', 'Wix.com')
    await press('Save changes')
    expect(mocked.updateEmployerProfile).toHaveBeenCalledWith('token-employer', {
      company_name: 'Wix.com', industry: 'Software', location: 'Tel Aviv', description: 'Website builder',
    })
  })
})

describe('account', () => {
  it('still shows the account and sign out when the profile does not load', async () => {
    mocked.getWorkerProfile.mockRejectedValueOnce(new Error('Network request failed'))
    await open('worker')
    expect(await screen.findByText('Failed to load profile.')).toBeOnTheScreen()
    expect(screen.getByText('worker@test.com')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeOnTheScreen()
  })
})

describe('data & privacy', () => {
  it('downloads your data as a file you can save or send', async () => {
    mocked.exportMyData.mockResolvedValue({ profile: { name: 'Alice Chen' }, swipes: [] })
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Download my data' })))
    expect(mocked.exportMyData).toHaveBeenCalledWith('token-worker')
    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('"name": "Alice Chen"'))
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///cache/jobswipe-my-data.json', expect.objectContaining({ mimeType: 'application/json' }),
    )
  })

  it('deleting the account needs you to type "delete", then signs you out', async () => {
    mocked.deleteMyAccount.mockResolvedValue({ deleted: true })
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Delete account' })))
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
    await act(async () => fireEvent.changeText(screen.getByLabelText('Type "delete" to confirm'), 'Delete '))
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Delete my account' })))
    expect(mocked.deleteMyAccount).toHaveBeenCalledWith('token-worker')
    expect(fakeSupabase.auth.signOut).toHaveBeenCalled()
    expect(await screen.findByText('Welcome back')).toBeOnTheScreen()
  })

  it('cancel keeps the account', async () => {
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Delete account' })))
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Cancel' })))
    expect(screen.queryByLabelText('Type "delete" to confirm')).toBeNull()
    expect(mocked.deleteMyAccount).not.toHaveBeenCalled()
  })
})

describe('photo', () => {
  const picker = ImagePicker as jest.Mocked<typeof ImagePicker>

  it('change photo uploads the picture you pick', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false, assets: [{ uri: 'file:///pics/me.jpg', mimeType: 'image/jpeg', fileName: 'me.jpg', width: 1, height: 1 }],
    } as never)
    mocked.uploadAvatar.mockResolvedValue({ url: '/supabase/storage/v1/object/public/avatars/me.jpg' })
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Change photo' })))
    expect(mocked.uploadAvatar).toHaveBeenCalledWith('token-worker', { uri: 'file:///pics/me.jpg', name: 'me.jpg', type: 'image/jpeg' })
  })

  it('cancelling the picker uploads nothing', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never)
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Change photo' })))
    expect(mocked.uploadAvatar).not.toHaveBeenCalled()
  })

  it('says so when the upload fails', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false, assets: [{ uri: 'file:///pics/me.jpg', mimeType: 'image/jpeg', fileName: 'me.jpg', width: 1, height: 1 }],
    } as never)
    mocked.uploadAvatar.mockRejectedValueOnce(new Error('Image must be under 5 MB'))
    await open('worker')
    await act(async () => fireEvent.press(await screen.findByRole('button', { name: 'Change photo' })))
    expect(await screen.findByText('Image must be under 5 MB')).toBeOnTheScreen()
  })
})
