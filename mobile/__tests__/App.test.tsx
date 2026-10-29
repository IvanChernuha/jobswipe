import { render, screen } from '@testing-library/react-native'
import App from '../App'

const API = 'https://api.example.test/api'

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = API
  globalThis.fetch = jest.fn()
})

it('shows the JobSwipe name and tagline', async () => {
  ;(globalThis.fetch as jest.Mock).mockReturnValue(respond([]))
  await render(<App />)
  expect(screen.getByText('JobSwipe')).toBeOnTheScreen()
  expect(screen.getByText('Swipe your way into a startup')).toBeOnTheScreen()
})

it('reaches the real backend and shows how many skill categories it has', async () => {
  ;(globalThis.fetch as jest.Mock).mockReturnValue(
    respond([{ value: 'language', label: 'Languages' }, { value: 'cloud', label: 'Cloud & DevOps' }]),
  )
  await render(<App />)
  expect(await screen.findByText('Connected to the JobSwipe server ✓')).toBeOnTheScreen()
  expect(screen.getByText('2 skill categories loaded')).toBeOnTheScreen()
  expect(globalThis.fetch).toHaveBeenCalledWith(`${API}/tags/categories`)
})

it('says so when the server cannot be reached', async () => {
  ;(globalThis.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'))
  await render(<App />)
  expect(await screen.findByText("Can't reach the server")).toBeOnTheScreen()
})

it('says so when the server answers with an error', async () => {
  ;(globalThis.fetch as jest.Mock).mockReturnValue(respond({ detail: 'oops' }, 500))
  await render(<App />)
  expect(await screen.findByText("Can't reach the server")).toBeOnTheScreen()
})

it('says so when the app was built without a server address', async () => {
  delete process.env.EXPO_PUBLIC_API_URL
  await render(<App />)
  expect(await screen.findByText('No server address configured')).toBeOnTheScreen()
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
