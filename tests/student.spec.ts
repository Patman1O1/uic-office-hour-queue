import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { io, type Socket } from 'socket.io-client'
import { randomBytes } from 'node:crypto'
// The real application, queue store, authorization, and Socket.IO handlers.
// @ts-expect-error The existing server is JavaScript.
import { createApplication } from '../server/src/app.js'
let app: ReturnType<typeof createApplication>
let peers: Socket[]
let instructor: Socket
let queue: { queueId: string; managementToken: string }
let dropJoin = false
let rejectLeave = false
const origin = 'http://127.0.0.1:4318'
const storageKey = () => `myofficehours:student:v1:${queue.queueId}`
async function connect() {
  const socket = io(origin, { reconnection: false }); peers.push(socket)
  await new Promise<void>(resolve => socket.on('connect', resolve)); return socket
}
async function operation(socket: Socket, event: string, payload: object) {
  const ack = await socket.timeout(3000).emitWithAck(event, payload)
  expect(ack.ok).toBe(true); return ack.data
}
async function action(event: string, extra = {}) { return operation(instructor, event, { ...queue, ...extra }) }
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey()) }
async function join(page: Page) {
  await page.getByLabel('Your name').fill('Test Student')
  await page.getByLabel('What would you like help with?').fill('Understanding chapter four')
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByRole('heading', { name: 'You’re in the queue.' })).toBeVisible()
}
async function otherStudent() {
  const socket = await connect()
  return operation(socket, 'student:join', { queueId: queue.queueId, name: 'Private Other Student', category: 'Lab', reason: 'Private other reason', email: 'private@example.edu', idempotencyKey: randomBytes(32).toString('base64url') })
}
test.beforeEach(async () => {
  peers = []; dropJoin = false; rejectLeave = false
  app = createApplication({ config: { allowedOrigins: ['http://127.0.0.1:5178'] } })
  app.io.on('connection', (socket: { use: (fn: (packet: unknown[], next: () => void) => void) => void }) => {
    socket.use((packet, next) => {
      if (packet[0] === 'student:join' && dropJoin) { dropJoin = false; packet[2] = () => {} }
      if (packet[0] === 'student:leave' && rejectLeave) {
        rejectLeave = false
        ;(packet[2] as (ack: object) => void)({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to process.' } }); return
      }
      next()
    })
  })
  await new Promise<void>(resolve => app.httpServer.listen(4318, '127.0.0.1', resolve))
  instructor = await connect()
  const created = await operation(instructor, 'queue:create', { title: 'Software Design · Office Hours' })
  queue = { queueId: created.queueId, managementToken: created.managementToken }
})
test.afterEach(async () => { peers.forEach(socket => socket.disconnect()); await new Promise<void>(resolve => app.io.close(resolve)) })

test('validation, privacy, authoritative position, called, complete and fresh rejoin', async ({ page }) => {
  const other = await otherStudent()
  await page.goto(`/queue/${queue.queueId}`)
  await expect(page.getByText('student waiting', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByText('Enter your name', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Your name')).toBeFocused()
  await join(page)
  await expect(page.getByLabel('Position 2', { exact: true })).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('Private Other')
  const first = await saved(page)
  await action('queue:call-next')
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  await expect(page.getByText('You’re next!', { exact: true })).toHaveCount(0)
  await action('student:done', { studentId: other.studentId })
  await action('queue:call-next')
  await expect(page.getByRole('heading', { name: 'You’re next!' })).toBeVisible()
  await action('student:done', { studentId: first.studentId })
  await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible()
  await page.getByRole('button', { name: 'Rejoin Queue' }).click()
  await expect(page.getByLabel('Your name')).toHaveValue('Test Student')
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  expect((await saved(page)).studentId).not.toBe(first.studentId)
})

test('lost join acknowledgement recovers original membership after refresh without duplicate', async ({ page }) => {
  dropJoin = true
  await page.goto(`/queue/${queue.queueId}`)
  await page.getByLabel('Your name').fill('Test Student')
  await page.getByLabel('What would you like help with?').fill('Help with a proof')
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByRole('button', { name: 'Recover join' })).toBeVisible({ timeout: 8000 })
  const pending = (await saved(page)).pending
  expect(pending.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(pending).not.toHaveProperty('email')
  await page.reload()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  const state = await operation(instructor, 'queue:subscribe', { ...queue, role: 'instructor' })
  expect(state.state.students).toHaveLength(1)
  const first = await saved(page)
  await page.reload()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  expect((await saved(page)).studentId).toBe(first.studentId)
})

test('leave dialog traps focus, cancels, handles errors and confirms departure', async ({ page }) => {
  await otherStudent()
  await page.goto(`/queue/${queue.queueId}`); await join(page)
  await page.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/spot \(#2\)/)).toBeVisible()
  await action('queue:call-next')
  await expect(dialog.getByText(/spot \(#1\)/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Stay in Queue' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Leave Queue', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Stay in Queue' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Leave Queue', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  rejectLeave = true
  await dialog.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’ve left the queue.' })).toBeVisible()
  await expect(dialog).not.toBeVisible()
})

test('offline freezes actions, reconnect restores current called state, refresh preserves identity', async ({ page, context }) => {
  await page.goto(`/queue/${queue.queueId}`); await join(page)
  const before = await saved(page)
  await context.setOffline(true)
  await expect(page.getByText('Connection interrupted · Reconnecting')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Leave Queue', exact: true })).toBeDisabled()
  await expect(page.getByText(/Last synchronized/).first()).toBeVisible()
  await action('queue:call-next')
  await context.setOffline(false)
  await expect(page.getByRole('heading', { name: 'You’re next!' })).toBeVisible({ timeout: 15000 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'You’re next!' })).toBeVisible()
  expect((await saved(page)).studentId).toBe(before.studentId)
})

test('removed and queue-ended reconcile an open modal and disallow rejoin after end', async ({ page }) => {
  await page.goto(`/queue/${queue.queueId}`); await join(page)
  await page.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  await action('student:remove', { studentId: (await saved(page)).studentId })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('heading', { name: 'You were removed from the queue.' })).toBeVisible()
  await page.getByRole('button', { name: 'Rejoin Queue' }).click()
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await action('queue:end')
  await expect(page.getByRole('heading', { name: 'Office hours have ended.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rejoin Queue' })).toHaveCount(0)
})

test('invalid queue, missing route, and invalid saved credentials are actionable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Open the queue link', { exact: false })).toBeVisible()
  await page.goto('/queue/missing-queue')
  await expect(page.getByText('This queue could not be found.', { exact: false })).toBeVisible()
  await page.goto(`/queue/${queue.queueId}`)
  await page.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ version: 1, queueId: id, studentId: 'invalid', membershipToken: 'invalid' })), { key: storageKey(), id: queue.queueId })
  await page.reload()
  await expect(page.getByText('Your saved membership credentials are invalid.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Join Queue' })).toHaveCount(0)
})

test('desktop, laptop and mobile layouts use available width without overflow', async ({ page }) => {
  await page.goto(`/queue/${queue.queueId}`)
  await expect(page.getByRole('button', { name: 'Join Queue' })).toBeEnabled()
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const summary = await page.locator('.queue-summary').boundingBox()
    const form = await page.locator('.form-card').boundingBox()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width > 640) { expect(form!.x).toBeGreaterThan(summary!.x + summary!.width); expect(form!.width + summary!.width).toBeGreaterThan(width * .65) }
    else expect(form!.y).toBeGreaterThan(summary!.y + summary!.height)
    await page.screenshot({ path: `test-results/join-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await join(page)
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/waiting-${width}.png`, fullPage: true })
  }
  await action('queue:call-next')
  await expect(page.getByRole('heading', { name: 'You’re next!' })).toBeVisible()
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/called-${width}.png`, fullPage: true })
  }
  await action('student:done', { studentId: (await saved(page)).studentId })
  await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeVisible()
  await page.screenshot({ path: 'test-results/completed-mobile.png', fullPage: true })
})

test('leave timeout reconciles rather than blindly repeating the mutation', async ({ page }) => {
  await page.goto(`/queue/${queue.queueId}`); await join(page)
  let attempts = 0
  for (const socket of app.io.sockets.sockets.values()) {
    socket.use((packet: unknown[], next: () => void) => {
      if (packet[0] === 'student:leave') { attempts++; packet[2] = () => {} }
      next()
    })
  }
  await page.getByRole('button', { name: 'Leave Queue', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Leave Queue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’ve left the queue.' })).toBeVisible()
  await expect(page.getByText('Departure was not confirmed.', { exact: false })).toBeVisible({ timeout: 8000 })
  expect(attempts).toBe(1)
})

test('stale revisions and snapshots for another identity are ignored', async ({ page }) => {
  const other = await otherStudent()
  await page.goto(`/queue/${queue.queueId}`); await join(page)
  const own = await saved(page)
  const observer = await connect()
  const snapshot = (await operation(observer, 'queue:subscribe', { queueId: queue.queueId, role: 'student', membershipToken: own.membershipToken })).state
  await action('queue:call-next')
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  for (const socket of app.io.sockets.sockets.values()) {
    socket.emit('queue:state', snapshot)
    socket.emit('queue:state', { ...other.state, revision: snapshot.revision + 1000 })
  }
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Private Other Student', { exact: true })).toHaveCount(0)
  await action('student:done', { studentId: other.studentId })
  await action('queue:call-next')
  await expect(page.getByRole('heading', { name: 'You’re next!' })).toBeVisible()
})

test('unacknowledged join recovers on reconnect with the saved original key', async ({ page }) => {
  dropJoin = true
  await page.goto(`/queue/${queue.queueId}`)
  await page.getByLabel('Your name').fill('Recovery Student')
  await page.getByLabel('What would you like help with?').fill('Recovery test question')
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByRole('button', { name: 'Recover join' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: 'Recover join' }).click()
  await expect(page.getByLabel('Position 1', { exact: true })).toBeVisible()
  const state = await operation(instructor, 'queue:subscribe', { ...queue, role: 'instructor' })
  expect(state.state.students).toHaveLength(1)
})

test('storage failure blocks joins and invalid email is explained', async ({ page }) => {
  await page.goto(`/queue/${queue.queueId}`)
  await page.getByLabel('Your name').fill('Test Student')
  await page.getByLabel('What would you like help with?').fill('Test question')
  await page.getByLabel('Email (optional)').fill('bad-address')
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByText('Enter a valid email address, or leave it blank.')).toBeVisible()
  await page.getByLabel('Email (optional)').fill('')
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Unavailable') } })
  await page.getByRole('button', { name: 'Join Queue' }).click()
  await expect(page.getByText('Allow browser storage before joining', { exact: false })).toBeVisible()
  const state = await operation(instructor, 'queue:subscribe', { ...queue, role: 'instructor' })
  expect(state.state.students).toHaveLength(0)
})
