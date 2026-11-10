/**
 * Auth API tests — prevents regression on signup/login flows.
 * Run with: bun test src/__tests__/auth.test.ts
 * Requires dev server on localhost:3000.
 */
import { describe, it, expect } from 'bun:test'

const BASE = process.env.TEST_URL ?? 'http://localhost:3000'

describe('Auth API', () => {
  const uniqueEmail = `test-${Date.now()}@auth-test.com`
  const password = 'Sup3rSecret!Pass'
  let sessionCookie: string

  describe('Signup', () => {
    it('creates user + org + session', async () => {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail, password, name: 'Auth Test', orgName: 'Auth Test Org' }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.userId).toBeDefined()

      // Verify cookie was set
      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('fn_session=')
    })

    it('rejects duplicate email with 409', async () => {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail, password, name: 'Dup', orgName: 'Dup Org' }),
      })
      expect(res.status).toBe(409)
    })

    it('rejects invalid email with 422', async () => {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'notanemail', password, name: 'Test' }),
      })
      expect(res.status).toBe(422)
    })

    it('rejects weak password with 422', async () => {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `weak-${Date.now()}@test.com`, password: 'short', name: 'Test' }),
      })
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(data.reasons).toBeDefined()
    })

    it('rejects missing fields with 400', async () => {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('Login', () => {
    it('returns 200 and sets session cookie', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail, password }),
      })
      expect(res.status).toBe(200)
      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toContain('fn_session=')
      sessionCookie = setCookie?.split('fn_session=')[1]?.split(';')[0] ?? ''
    })

    it('returns 401 for wrong password', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail, password: 'WrongPassword123!' }),
      })
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe('Invalid credentials')
      expect(data.attemptsRemaining).toBeDefined()
    })

    it('returns 401 for nonexistent email', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nonexistent@test.com', password: 'SomePassword1!' }),
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 for missing fields', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: uniqueEmail }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('Me (authenticated)', () => {
    it('returns user data with valid session', async () => {
      const res = await fetch(`${BASE}/api/auth/me`, {
        headers: { Cookie: `fn_session=${sessionCookie}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.user.email).toBe(uniqueEmail)
      expect(data.user.name).toBe('Auth Test')
      expect(data.organizations).toBeDefined()
      expect(data.organizations.length).toBeGreaterThan(0)
      expect(data.permissions).toBeDefined()
    })

    it('returns 401 without session', async () => {
      const res = await fetch(`${BASE}/api/auth/me`)
      expect(res.status).toBe(401)
    })
  })

  describe('Logout', () => {
    it('invalidates the session', async () => {
      const res = await fetch(`${BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `fn_session=${sessionCookie}` },
      })
      expect(res.status).toBe(200)

      // Verify session is gone
      const meRes = await fetch(`${BASE}/api/auth/me`, {
        headers: { Cookie: `fn_session=${sessionCookie}` },
      })
      expect(meRes.status).toBe(401)
    })
  })
})
