import { io, type Socket } from 'socket.io-client'

export type Queue = { queueId: string; title: string; status: 'open' | 'ended'; waitingCount: number; calledCount: number }
export type Entry = { studentId: string; name: string; category: string; reason: string; email: string | null; status: 'waiting' | 'called' | 'done' | 'removed' | 'left' | 'queue-ended'; position: number | null }
export type StudentState = { role: 'student'; queue: Queue; revision: number; student: Entry }
export type Details = { name: string; category: string; reason: string; email?: string }
type Join = Details & { queueId: string; idempotencyKey: string }
type Saved = { version: 1; pending: Join } | { version: 1; queueId: string; studentId: string; membershipToken: string }
type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
export type View = { queue?: Queue; state?: StudentState; ready: boolean; busy: boolean; error?: string; fatal?: string; lastSync?: number; recovering: boolean; prefill?: Details }
const messages: Record<string, string> = {
  QUEUE_NOT_FOUND: 'This queue could not be found. Check the shared link with your instructor.',
  INVALID_PAYLOAD: 'The request was not accepted. Check your details and queue link.',
  UNAUTHORIZED: 'Your saved membership credentials are invalid. Ask your instructor for help; your membership cannot be recovered by name or email.',
  QUEUE_ENDED: 'This queue has ended.',
  RATE_LIMITED: 'Too many join attempts. Wait a minute, then try again.',
  CAPACITY_REACHED: 'This queue has reached its capacity. Please contact the instructor.',
  IDEMPOTENCY_CONFLICT: 'The saved join request conflicts with an earlier attempt. Contact the instructor for help.',
}
export function freshKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
export function validate(details: Details) {
  const errors: Record<string, string> = {}
  for (const [key, max] of [['name', 100], ['category', 100], ['reason', 1000]] as const) {
    const length = [...details[key].trim()].length
    if (!length || length > max) errors[key] = `Enter ${key === 'reason' ? 'a question' : key === 'category' ? 'a topic' : 'your name'} (1–${max} characters).`
  }
  if (details.email && (!/^[^\s@]+@[^\s@]+$/.test(details.email) || [...details.email].length > 254)) errors.email = 'Enter a valid email address, or leave it blank.'
  return errors
}

export class StudentClient {
  private socket: Socket
  private saved?: Saved
  private storageKey: string
  private listeners = new Set<() => void>()
  private epoch = 0
  private revision = -1
  private accepting = false
  private timer?: ReturnType<typeof setInterval>
  private value: View = { ready: false, busy: false, recovering: false }
  private queueId: string
  constructor(queueId: string, origin = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001') {
    this.queueId = queueId
    this.storageKey = `myofficehours:student:v1:${queueId}`
    this.socket = io(origin, { autoConnect: false, reconnection: true, timeout: 6000 })
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.version !== 1 || (data.pending ? data.pending.queueId !== queueId || typeof data.pending.idempotencyKey !== 'string' || Object.keys(validate(data.pending)).length : data.queueId !== queueId || typeof data.membershipToken !== 'string' || typeof data.studentId !== 'string')) throw Error()
        this.saved = data
        if ('pending' in data) this.value = { ...this.value, recovering: true, prefill: data.pending }
      }
    } catch { this.value = { ...this.value, fatal: 'Your saved membership credentials are invalid. Ask your instructor for help before starting another membership.' } }
  }
  private onConnect = () => { void this.reconcile() }
  private onDisconnect = () => {
    this.epoch++; this.accepting = false
    this.update({ ready: false, busy: false, error: undefined })
  }
  private onConnectError = () => this.update({ ready: false, busy: false, error: 'Unable to connect. Check your connection and that the office-hours server is available.' })
  private onState = (state: StudentState) => { if (this.accepting) this.receive(state) }

  getSnapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<View>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(listener => listener()) }
  start() {
    this.socket.on('connect', this.onConnect)
    this.socket.on('disconnect', this.onDisconnect)
    this.socket.on('connect_error', this.onConnectError)
    this.socket.on('queue:state', this.onState)
    if (!this.value.fatal) this.socket.connect()
    this.timer = setInterval(() => { if (!this.saved && this.value.ready && !this.value.busy) void this.readPublic(this.epoch) }, 10000)
    return () => {
      this.epoch++; this.accepting = false
      clearInterval(this.timer)
      this.socket.off('connect', this.onConnect)
      this.socket.off('disconnect', this.onDisconnect)
      this.socket.off('connect_error', this.onConnectError)
      this.socket.off('queue:state', this.onState)
      this.socket.disconnect()
    }
  }
  private async request<T>(event: string, payload: unknown): Promise<Ack<T> | undefined> {
    if (!this.socket.connected) return
    return new Promise(resolve => this.socket.timeout(5000).emit(event, payload, (error: Error | null, ack: Ack<T>) => resolve(error ? undefined : ack)))
  }
  private save(data: Saved) {
    // Never send a new join unless its exact recovery request is durably saved.
    localStorage.setItem(this.storageKey, JSON.stringify(data)); this.saved = data
  }
  private fail(code: string) {
    const message = messages[code] || 'The server could not complete this action. Refresh the current state and try again.'
    const fatal = ['QUEUE_NOT_FOUND', 'UNAUTHORIZED', 'IDEMPOTENCY_CONFLICT', 'INVALID_PAYLOAD'].includes(code)
    this.update({ busy: false, ready: false, error: fatal ? undefined : message, fatal: fatal ? message : undefined })
  }
  private receive(state: StudentState, initial = false) {
    if (!this.saved || 'pending' in this.saved || state.role !== 'student' || state.queue.queueId !== this.queueId || state.student.studentId !== this.saved.studentId || (!initial && state.revision <= this.revision)) return
    this.revision = state.revision
    this.update({ state, queue: state.queue, lastSync: Date.now() })
  }
  private async readPublic(epoch: number) {
    const ack = await this.request<{ queue: Queue; revision: number }>('queue:get', { queueId: this.queueId })
    if (epoch !== this.epoch) return false
    if (!ack) { this.update({ busy: false, ready: false, error: 'No response from the server. Retry to fetch the current queue.' }); return false }
    if (!ack.ok) { this.fail(ack.error.code); return false }
    this.update({ queue: ack.data.queue, lastSync: Date.now() }); return true
  }
  retry = () => { if (this.socket.connected) void this.reconcile(); else this.socket.connect() }
  private async reconcile() {
    const epoch = ++this.epoch
    this.accepting = false
    this.update({ ready: false, busy: true, error: undefined })
    if (this.saved && !('pending' in this.saved)) {
      const ack = await this.request<{ state: StudentState }>('queue:subscribe', { queueId: this.queueId, role: 'student', membershipToken: this.saved.membershipToken })
      if (epoch !== this.epoch) return
      if (!ack) { this.update({ busy: false, error: 'Could not restore your membership. Retry to synchronize with the server.' }); return }
      if (!ack.ok) { this.fail(ack.error.code); return }
      this.revision = -1; this.accepting = true; this.receive(ack.data.state, true)
      this.update({ ready: true, busy: false }); return
    }
    if (!(await this.readPublic(epoch))) return
    if (this.saved && 'pending' in this.saved) { await this.sendJoin(this.saved.pending, epoch); return }
    this.update({ ready: true, busy: false })
  }
  join = async (details: Details) => {
    if (!this.value.ready || this.value.busy || this.saved || Object.keys(validate(details)).length) return
    const payload = { ...details, queueId: this.queueId, idempotencyKey: freshKey() }
    try { this.save({ version: 1, pending: payload }) } catch { this.update({ error: 'Allow browser storage before joining so your membership can be restored safely.' }); return }
    this.update({ recovering: true, prefill: details, busy: true, ready: false, error: undefined })
    this.accepting = false
    await this.sendJoin(payload, ++this.epoch)
  }
  private async sendJoin(payload: Join, epoch: number) {
    const ack = await this.request<{ queueId: string; studentId: string; membershipToken: string; state: StudentState }>('student:join', payload)
    if (epoch !== this.epoch) return
    if (!ack) { this.update({ busy: false, ready: false, error: 'Join confirmation was interrupted. Retry the saved request to recover your membership safely.' }); return }
    if (!ack.ok) {
      // An explicit failure proves no new membership was created. Keep the key for retry.
      if (ack.error.code === 'QUEUE_ENDED') this.update({ recovering: false })
      this.fail(ack.error.code); return
    }
    const credentials: Saved = { version: 1, queueId: this.queueId, studentId: ack.data.studentId, membershipToken: ack.data.membershipToken }
    try { this.save(credentials) } catch { this.saved = credentials /* original pending payload remains recoverable on refresh */ }
    this.revision = -1; this.accepting = true; this.receive(ack.data.state, true)
    this.update({ ready: true, busy: false, recovering: false, error: undefined })
  }
  leave = async () => {
    if (!this.value.ready || this.value.busy || !this.saved || 'pending' in this.saved) return
    const epoch = this.epoch
    this.update({ busy: true, error: undefined })
    const ack = await this.request<{ state: StudentState }>('student:leave', { queueId: this.queueId, membershipToken: this.saved.membershipToken })
    if (epoch !== this.epoch) return
    if (ack?.ok) { this.receive(ack.data.state); this.update({ busy: false }); return }
    const message = ack ? (messages[ack.error.code] || 'Unable to leave. Your membership has been refreshed; try again if you still want to leave.') : 'Departure was not confirmed. Your membership has been refreshed; review its current status before trying again.'
    await this.reconcile()
    if (!this.value.fatal) this.update({ error: message })
  }
  rejoin = () => {
    if (!this.value.ready || this.value.busy || this.value.queue?.status !== 'open' || !this.value.state || ['waiting', 'called'].includes(this.value.state.student.status)) return
    const { name, category, reason, email } = this.value.state.student
    try { localStorage.removeItem(this.storageKey) } catch { this.update({ error: 'Allow browser storage to start a new membership safely.' }); return }
    this.saved = undefined; this.accepting = false; this.revision = -1
    // Disconnect also cancels the old server subscription before showing a new identity.
    this.socket.disconnect()
    this.update({ state: undefined, ready: false, prefill: { name, category, reason, ...(email ? { email } : {}) }, error: undefined })
    this.socket.connect()
  }
}
