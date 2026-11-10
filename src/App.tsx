import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { StudentClient, validate } from './student/client'
import type { Details, Entry, View } from './student/client'
import './App.css'

function Mark({ check = false }: { check?: boolean }) {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{check ? <path d="m5 12 4 4L19 6" /> : <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-11 4h4" /></>}</svg>
}
function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }
function Header() { return <header className="app-header"><a className="brand" href="/" aria-label="MyOfficeHours home"><span className="brand-icon"><Mark /></span>MyOfficeHours</a><span className="header-label">STUDENT QUEUE</span></header> }
function JoinForm({ client, view }: { client: StudentClient; view: View }) {
  const [details, setDetails] = useState<Details>(view.prefill || { name: '', category: 'Exam preparation', reason: '', email: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const form = useRef<HTMLFormElement>(null)
  function submit(event: FormEvent) {
    event.preventDefault()
    const data = { name: details.name.trim(), category: details.category.trim(), reason: details.reason.trim(), ...(details.email?.trim() ? { email: details.email.trim() } : {}) }
    const next = validate(data); setErrors(next)
    if (Object.keys(next).length) { form.current?.querySelector<HTMLElement>(`[name="${Object.keys(next)[0]}"]`)?.focus(); return }
    void client.join(data)
  }
  function field(name: keyof Details) { return { id: name, name, value: details[name] || '', onChange: (e: { target: { value: string } }) => setDetails({ ...details, [name]: e.target.value }), 'aria-invalid': !!errors[name], 'aria-describedby': errors[name] ? `${name}-error` : undefined } }
  function error(name: string) { return errors[name] ? <span className="field-error" id={`${name}-error`}>{errors[name]}</span> : null }
  return <Card className="form-card"><div className="section-heading"><span className="eyebrow">YOUR DETAILS</span><h2>Let’s get you in line.</h2><p>Tell us a little about what you’re working on.</p></div><form ref={form} noValidate onSubmit={submit}>
    <fieldset disabled={!view.ready || view.busy || view.recovering}>
      <div className="field-pair"><div className="field"><label htmlFor="name">Your name</label><input autoComplete="name" placeholder="First and last name" {...field('name')} />{error('name')}</div><div className="field"><label htmlFor="course">Course / queue</label><input id="course" value={view.queue?.title || ''} readOnly /><small>Set by the shared queue.</small></div></div>
      <div className="field"><label htmlFor="category">Question topic</label><select {...field('category')}>{['Exam preparation', 'Homework', 'Lab', 'Concept review', 'Other'].includes(details.category) ? null : <option>{details.category}</option>}{['Exam preparation', 'Homework', 'Lab', 'Concept review', 'Other'].map(topic => <option key={topic}>{topic}</option>)}</select>{error('category')}</div>
      <div className="field"><label htmlFor="reason">What would you like help with?</label><textarea rows={3} placeholder="A short description helps the instructor prepare." {...field('reason')} />{error('reason')}<small>Up to 1,000 characters. Only you and the instructor can see your details.</small></div>
      <div className="field"><label htmlFor="email">Email <span className="optional">(optional)</span></label><input type="email" autoComplete="email" placeholder="you@university.edu" {...field('email')} />{error('email')}<small>Contact information for the instructor. Automatic alerts are not available.</small></div>
      <button className="button primary join-button" type="submit">{view.busy ? 'Joining…' : 'Join Queue'}<span aria-hidden="true">→</span></button>
    </fieldset>
  </form></Card>
}
function Sync({ view }: { view: View }) { return <p className={`sync ${view.ready ? '' : 'stale'}`}><span className="dot" />{view.ready ? 'Connected · Live updates' : view.lastSync ? `Last synchronized ${new Date(view.lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : 'Awaiting synchronization'}</p> }
function LeaveDialog({ entry, view, client, close }: { entry: Entry; view: View; client: StudentClient; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const safe = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal(); safe.current?.focus()
    return () => { element.close(); previous?.focus() }
  }, [])
  return <dialog ref={dialog} className="leave-dialog" aria-labelledby="leave-title" aria-describedby="leave-description" onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <span className="dialog-symbol" aria-hidden="true">↗</span><h2 id="leave-title">Leave the queue?</h2><p id="leave-description">{entry.status === 'called' ? 'You’ve been called. Leaving gives up your turn.' : `You’ll lose your current spot (#${entry.position}).`} You can join again while the queue is open.</p>
    {view.error && <p className="error" role="alert">{view.error}</p>}
    {!view.ready && <p className="muted">Waiting for the current server state before you can leave.</p>}
    <button ref={safe} className="button primary" onClick={close}>Stay in Queue</button><button className="button danger" disabled={!view.ready || view.busy} onClick={() => void client.leave()}>{view.busy ? 'Confirming…' : 'Leave Queue'}</button>
  </dialog>
}
function StudentPage({ queueId }: { queueId: string }) {
  const [client] = useState(() => new StudentClient(queueId))
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const [leaveOpen, setLeaveOpen] = useState<string | undefined>(undefined)
  useEffect(() => client.start(), [client])
  const entry = view.state?.student
  const active = entry?.status === 'waiting' || entry?.status === 'called'
  const ended = view.queue?.status === 'ended'
  const called = entry?.status === 'called'
  const completed = entry?.status === 'done'
  const terminalTitle = ended && !completed ? 'Office hours have ended.' : completed ? 'Session complete.' : entry?.status === 'removed' ? 'You were removed from the queue.' : 'You’ve left the queue.'
  return <>
    {(!view.ready && view.lastSync && !view.fatal) && <div className="connection-banner" role="status"><span aria-hidden="true">⚠</span><div><strong>Connection interrupted · Reconnecting</strong><p>{entry ? 'Showing your last known membership while we restore the current server state.' : 'Showing the last known queue information. Waiting for the current server state.'} Actions are paused.</p><Sync view={view} /></div></div>}
    {view.error && <div className="error-banner" role="alert"><div>{view.error}</div><button className="button secondary compact" disabled={view.busy} onClick={client.retry}>{view.recovering ? 'Recover join' : 'Retry connection'}</button></div>}
    {view.fatal ? <Card className="empty-state"><span className="eyebrow">QUEUE UNAVAILABLE</span><h1>We couldn’t open your queue.</h1><p>{view.fatal}</p></Card> : !view.queue ? <Card className="empty-state"><span className="eyebrow">CONNECTING</span><h1>Opening office hours…</h1><p>Fetching the current queue from the server.</p>{!view.busy && <button className="button secondary" onClick={client.retry}>Try again</button>}</Card> : <>
      <div className="page-heading"><div><span className="eyebrow">OFFICE HOURS</span><h1>{view.queue.title}</h1></div><span className={`queue-badge ${ended ? 'closed' : ''}`}><span className="dot" />{ended ? 'Queue closed' : 'Queue open'}</span></div>
      {!entry && !ended ? <div className="join-layout"><aside><Card className="queue-summary"><span className="summary-icon"><Mark /></span><h2>A little help. A step forward.</h2><p>Join office hours and get time with your instructor, one question at a time.</p><div className="summary-count"><strong>{view.queue.waitingCount}</strong><span>{view.queue.waitingCount === 1 ? 'student waiting' : 'students waiting'}</span></div><Sync view={view} /></Card><p className="aside-note">Keep this page open to see when you’re called. You can also return in this browser to restore your membership.</p></aside><div>{view.recovering && <div className="connection-banner" role="status"><div><strong>Restoring your join request</strong><p>Your original details are saved. Recover the confirmation before starting another membership.</p></div></div>}<JoinForm client={client} view={view} /></div></div> : active ? <div className={`status-layout ${called ? 'called-layout' : ''}`}>
        <Card className={`position-card ${called ? 'success-card' : ''} ${!view.ready ? 'stale-card' : ''}`}>
          {called ? <><span className="success-icon"><Mark check /></span><span className="eyebrow">IT’S YOUR TURN</span><h2 className="called-title">You’re next!</h2><p className="status-subtitle">The instructor has called you.</p></> : <><h2>You’re in the queue.</h2><div className="position" aria-label={`Position ${entry.position}`}>#{entry.position}</div><p className="ahead">{Math.max(0, (entry.position ?? 1) - 1)} {entry.position === 2 ? 'student' : 'students'} ahead</p><p className="muted">{entry.position === 1 ? 'You’re first in line. Wait for the instructor to call you.' : 'Your position updates as the queue moves.'}</p></>}
          <Sync view={view} />
        </Card>
        <aside className="details-column"><Card><span className="eyebrow">YOUR VISIT</span><h2>{entry.name}</h2><dl><dt>Question topic</dt><dd>{entry.category}</dd><dt>Your question</dt><dd>{entry.reason}</dd><dt>Queue</dt><dd>{view.queue.title}</dd></dl></Card><Card className="leave-card"><h3>Plans changed?</h3><p>You can leave the queue at any time.</p><button className="button danger" disabled={!view.ready || view.busy} onClick={() => setLeaveOpen(entry.studentId)}>Leave Queue</button></Card></aside>
      </div> : <div className="terminal-layout"><Card className={`terminal-card ${completed ? 'success-card' : ''}`}><span className="success-icon"><Mark check={completed} /></span><span className="eyebrow">{completed ? 'ALL SET' : 'QUEUE UPDATE'}</span><h2>{terminalTitle}</h2><p>{completed ? 'Your session was marked as done. Thanks for stopping by.' : ended ? 'This queue is closed and no longer accepts new students.' : entry?.status === 'removed' ? 'Contact your instructor if you have questions about this change.' : 'Your departure has been confirmed by the server.'}</p>{entry && <div className="visit-chip">{entry.name} · {entry.category}</div>}<Sync view={view} /></Card><Card className="next-step"><span className="eyebrow">WHAT’S NEXT</span><h2>{ended ? 'See you next time.' : 'Need more help?'}</h2><p>{ended ? 'Ask your instructor for a link to their next office-hours queue.' : 'You can join again. Review your details before taking a new spot in line.'}</p>{!ended && entry && <button className="button secondary" disabled={!view.ready || view.busy} onClick={client.rejoin}>Rejoin Queue <span aria-hidden="true">→</span></button>}</Card></div>}
    </>}
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{entry ? `${entry.status === 'called' ? 'You’re next! The instructor has called you.' : entry.status === 'done' ? 'Session complete.' : entry.status === 'waiting' ? `You’re in the queue. Position ${entry.position}.` : terminalTitle}` : ''}</div>
    {leaveOpen === entry?.studentId && active && !view.fatal && <LeaveDialog entry={entry} view={view} client={client} close={() => setLeaveOpen(undefined)} />}
  </>
}
export default function App() {
  const match = /^\/queue\/([^/]+)\/?$/.exec(window.location.pathname)
  let queueId = ''
  try { queueId = match ? decodeURIComponent(match[1]) : '' } catch { /* Invalid URL is shown below. */ }
  return <><Header /><main className="app-main">{queueId ? <StudentPage key={queueId} queueId={queueId} /> : <Card className="empty-state"><span className="eyebrow">WELCOME TO OFFICE HOURS</span><h1>A question is a good place to start.</h1><p>Open the queue link shared by your instructor to join their office hours.</p><p className="muted">Queue links use /queue/ followed by the queue ID.</p></Card>}<footer>MyOfficeHours <span aria-hidden="true">·</span> A little time. A clearer understanding.</footer></main></>
}
