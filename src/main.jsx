import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CalendarDays, Car, DollarSign, Download, Fuel, Plus, ReceiptText, Trash2, RefreshCw, Cloud, CloudOff, X, ChevronRight } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './supabase'
import './styles.css'

const LOCAL_STORAGE_KEY = 'gig-tracker-shifts-v3'
const IRS_MILEAGE_RATE = 0.725

// Defaults for the add form — no gas/mpg/wear/purpose fields
const defaultForm = {
  date: new Date().toISOString().slice(0, 10),
  platform: 'DoorDash',
  startMileage: '',
  endMileage: '',
  earnings: '',
  startTime: '',
  endTime: '',
  notes: ''
}

// Persisted vehicle settings used for cost calculations (not shown in modal)
const defaultSettings = {
  gasPrice: '3.50',
  mpg: '32',
  wearRate: '0.25'
}

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem('gig-tracker-settings') || '{}') }
  } catch {
    return defaultSettings
  }
}

function money(value) {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function num(value, digits = 1) {
  return Number(value || 0).toFixed(digits)
}

function fmt12(time) {
  if (!time) return '—'
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

function getWeekStart(dateString) {
  const d = new Date(`${dateString}T00:00:00`)
  const day = d.getDay()
  const diff = d.getDate() - day
  const start = new Date(d.setDate(diff))
  start.setHours(0, 0, 0, 0)
  return start
}

function isSameWeek(dateString, offsetWeeks = 0) {
  const target = getWeekStart(new Date().toISOString().slice(0, 10))
  target.setDate(target.getDate() + offsetWeeks * 7)
  return getWeekStart(dateString).toISOString().slice(0, 10) === target.toISOString().slice(0, 10)
}

function minutesBetween(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let startMins = sh * 60 + sm
  let endMins = eh * 60 + em
  if (endMins < startMins) endMins += 24 * 60
  return endMins - startMins
}

function calculateShift(form, settings) {
  const s = settings || loadSettings()
  const miles = Math.max(0, Number(form.endMileage) - Number(form.startMileage))
  const earnings = Number(form.earnings || 0)
  const mpg = Number(s.mpg || 0)
  const gasPrice = Number(s.gasPrice || 0)
  const wearRate = Number(s.wearRate || 0)
  const gasCost = mpg ? (miles / mpg) * gasPrice : 0
  const wearCost = miles * wearRate
  const netProfit = earnings - gasCost - wearCost
  const mins = minutesBetween(form.startTime, form.endTime)
  const hours = mins / 60
  const taxDeduction = miles * IRS_MILEAGE_RATE

  return {
    miles,
    earnings,
    gasCost,
    wearCost,
    netProfit,
    hours,
    grossHourly: hours ? earnings / hours : 0,
    netHourly: hours ? netProfit / hours : 0,
    taxDeduction
  }
}

function summarize(shifts) {
  return shifts.reduce((acc, shift) => {
    acc.earnings += Number(shift.earnings || 0)
    acc.miles += Number(shift.miles || 0)
    acc.gasCost += Number(shift.gasCost || 0)
    acc.wearCost += Number(shift.wearCost || 0)
    acc.netProfit += Number(shift.netProfit || 0)
    acc.hours += Number(shift.hours || 0)
    acc.taxDeduction += Number(shift.taxDeduction || 0)
    return acc
  }, { earnings: 0, miles: 0, gasCost: 0, wearCost: 0, netProfit: 0, hours: 0, taxDeduction: 0 })
}

function toDbShift(shift) {
  return {
    id: shift.id,
    date: shift.date,
    platform: shift.platform,
    start_mileage: shift.startMileage,
    end_mileage: shift.endMileage,
    earnings: shift.earnings,
    start_time: shift.startTime || null,
    end_time: shift.endTime || null,
    gas_price: shift.gasPrice,
    mpg: shift.mpg,
    wear_rate: shift.wearRate,
    business_purpose: shift.businessPurpose || '',
    notes: shift.notes,
    miles: shift.miles,
    gas_cost: shift.gasCost,
    wear_cost: shift.wearCost,
    net_profit: shift.netProfit,
    hours: shift.hours,
    gross_hourly: shift.grossHourly,
    net_hourly: shift.netHourly,
    tax_deduction: shift.taxDeduction,
    created_at: shift.createdAt
  }
}

function fromDbShift(row) {
  return {
    id: row.id,
    date: row.date,
    platform: row.platform,
    startMileage: Number(row.start_mileage || 0),
    endMileage: Number(row.end_mileage || 0),
    earnings: Number(row.earnings || 0),
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    gasPrice: Number(row.gas_price || 0),
    mpg: Number(row.mpg || 0),
    wearRate: Number(row.wear_rate || 0),
    businessPurpose: row.business_purpose || '',
    notes: row.notes || '',
    miles: Number(row.miles || 0),
    gasCost: Number(row.gas_cost || 0),
    wearCost: Number(row.wear_cost || 0),
    netProfit: Number(row.net_profit || 0),
    hours: Number(row.hours || 0),
    grossHourly: Number(row.gross_hourly || 0),
    netHourly: Number(row.net_hourly || 0),
    taxDeduction: Number(row.tax_deduction || 0),
    createdAt: row.created_at
  }
}

function loadLocalShifts() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || []
  } catch {
    return []
  }
}

function saveLocalShifts(shifts) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(shifts))
}

async function loadShifts() {
  if (!isSupabaseConfigured) return loadLocalShifts()

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(fromDbShift)
}

async function insertShift(shift) {
  if (!isSupabaseConfigured) {
    const next = [shift, ...loadLocalShifts()]
    saveLocalShifts(next)
    return shift
  }

  const { data, error } = await supabase
    .from('shifts')
    .insert([toDbShift(shift)])
    .select()
    .single()

  if (error) throw error
  return fromDbShift(data)
}

async function removeShift(id) {
  if (!isSupabaseConfigured) {
    saveLocalShifts(loadLocalShifts().filter(shift => shift.id !== id))
    return
  }

  const { error } = await supabase
    .from('shifts')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <p>{label}</p>
      <h3>{value}</h3>
      {sub && <span>{sub}</span>}
    </div>
  )
}

function DetailRow({ label, value, accent }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={accent ? 'detail-value accent' : 'detail-value'}>{value}</span>
    </div>
  )
}

// ─── Add Shift Modal ──────────────────────────────────────────────────────────

function AddShiftModal({ onClose, onSave, saving, errorMessage }) {
  const [form, setForm] = useState(defaultForm)

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSave(form)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 style={{ margin: 0 }}><Plus size={20} /> Add Shift</h2>
          <button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {errorMessage && <div className="error-box" style={{ marginBottom: 16 }}>{errorMessage}</div>}

        <form onSubmit={handleSubmit} className="form">
          <div className="field-row">
            <label>Date
              <input type="date" value={form.date} onChange={e => updateField('date', e.target.value)} required />
            </label>
            <label>Platform
              <select value={form.platform} onChange={e => updateField('platform', e.target.value)}>
                <option>DoorDash</option>
                <option>Amazon Flex</option>
                <option>Domino's</option>
                <option>Uber Eats</option>
                <option>Instacart</option>
                <option>Other</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>Start Mileage
              <input type="number" value={form.startMileage} onChange={e => updateField('startMileage', e.target.value)} placeholder="102340" required />
            </label>
            <label>End Mileage
              <input type="number" value={form.endMileage} onChange={e => updateField('endMileage', e.target.value)} placeholder="102409" required />
            </label>
          </div>

          <label>Money Earned
            <input type="number" step="0.01" value={form.earnings} onChange={e => updateField('earnings', e.target.value)} placeholder="82.00" required />
          </label>

          <div className="field-row">
            <label>Start Time
              <input type="time" value={form.startTime} onChange={e => updateField('startTime', e.target.value)} />
            </label>
            <label>End Time
              <input type="time" value={form.endTime} onChange={e => updateField('endTime', e.target.value)} />
            </label>
          </div>

          <label>Notes
            <textarea value={form.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Route notes, tips, anything unusual…" />
          </label>

          <button className="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Shift'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Shift Detail Modal ───────────────────────────────────────────────────────

function ShiftDetailModal({ shift, onClose, onDelete }) {
  if (!shift) return null

  function handleDelete() {
    onDelete(shift.id)
    onClose()
  }

  const timeRange = shift.startTime && shift.endTime
    ? `${fmt12(shift.startTime)} – ${fmt12(shift.endTime)}`
    : shift.startTime
      ? `From ${fmt12(shift.startTime)}`
      : '—'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal detail-modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{shift.date}</p>
            <h2 style={{ margin: 0 }}>{shift.platform}</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="icon-button delete-button" onClick={handleDelete} aria-label="Delete shift"><Trash2 size={18} /></button>
            <button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
        </div>

        <div className="detail-highlight-row">
          <div className="detail-highlight">
            <span className="detail-highlight-label">Earnings</span>
            <span className="detail-highlight-value earnings">{money(shift.earnings)}</span>
          </div>
          <div className="detail-highlight">
            <span className="detail-highlight-label">Net Profit</span>
            <span className="detail-highlight-value profit">{money(shift.netProfit)}</span>
          </div>
        </div>

        <div className="detail-section">
          <DetailRow label="Miles Driven" value={`${num(shift.miles)} mi`} />
          <DetailRow label="Time" value={timeRange} />
          {shift.hours > 0 && <DetailRow label="Hours" value={`${num(shift.hours, 2)} hrs`} />}
        </div>

        <div className="detail-section">
          <DetailRow label="Gas Cost" value={money(shift.gasCost)} />
          <DetailRow label="Wear Cost" value={money(shift.wearCost)} />
          <DetailRow label="Tax Deduction" value={money(shift.taxDeduction)} accent />
        </div>

        {shift.hours > 0 && (
          <div className="detail-section">
            <DetailRow label="Gross Hourly" value={money(shift.grossHourly)} />
            <DetailRow label="Net Hourly" value={money(shift.netHourly)} accent />
          </div>
        )}

        {shift.notes && (
          <div className="detail-notes">
            <p className="detail-notes-label">Notes</p>
            <p className="detail-notes-text">{shift.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [shifts, setShifts] = useState([])
  const [filter, setFilter] = useState('thisWeek')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedShift, setSelectedShift] = useState(null)

  useEffect(() => { refreshShifts() }, [])

  async function refreshShifts() {
    setLoading(true)
    setErrorMessage('')
    try {
      const data = await loadShifts()
      setShifts(data)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not load shifts.')
    } finally {
      setLoading(false)
    }
  }

  const filteredShifts = useMemo(() => {
    const sorted = [...shifts].sort((a, b) => {
      if (a.date === b.date) return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      return String(b.date || '').localeCompare(String(a.date || ''))
    })
    if (filter === 'thisWeek') return sorted.filter(s => isSameWeek(s.date, 0))
    if (filter === 'previousWeek') return sorted.filter(s => isSameWeek(s.date, -1))
    if (filter === 'year') return sorted.filter(s => String(s.date).startsWith(String(new Date().getFullYear())))
    return sorted
  }, [shifts, filter])

  const totals = summarize(filteredShifts)

  async function handleSaveShift(form) {
    setErrorMessage('')

    if (!form.startMileage || !form.endMileage || !form.earnings) {
      setErrorMessage('Start mileage, end mileage, and money earned are required.')
      return
    }

    const settings = loadSettings()
    const calc = calculateShift(form, settings)

    const newShift = {
      id: crypto.randomUUID(),
      ...form,
      startMileage: Number(form.startMileage),
      endMileage: Number(form.endMileage),
      earnings: calc.earnings,
      gasPrice: Number(settings.gasPrice || 0),
      mpg: Number(settings.mpg || 0),
      wearRate: Number(settings.wearRate || 0),
      businessPurpose: '',
      notes: form.notes,
      createdAt: new Date().toISOString(),
      ...calc
    }

    setSaving(true)
    try {
      const savedShift = await insertShift(newShift)
      setShifts(prev => [savedShift, ...prev])
      setShowAddModal(false)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save shift.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteShift(id) {
    setErrorMessage('')
    const oldShifts = shifts
    setShifts(prev => prev.filter(s => s.id !== id))
    try {
      await removeShift(id)
    } catch (error) {
      console.error(error)
      setShifts(oldShifts)
      setErrorMessage(error.message || 'Could not delete shift.')
    }
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(shifts, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gig-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app">
      {/* Hero */}
      <section className="hero">
        <div>
          <p className="eyebrow">Personal Gig Tracker</p>
          <h1>Track miles, money, gas, wear &amp; tax estimates.</h1>
          <p className="muted">
            {isSupabaseConfigured
              ? 'Supabase sync is active. Your phone and computer share the same shifts.'
              : 'Local mode active. Add .env values to enable Supabase sync.'}
          </p>
        </div>
        <div className="hero-actions">
          <span className={isSupabaseConfigured ? 'sync-pill connected' : 'sync-pill'}>
            {isSupabaseConfigured ? <Cloud size={16} /> : <CloudOff size={16} />}
            {isSupabaseConfigured ? 'Synced' : 'Local'}
          </span>
          <button className="secondary" onClick={refreshShifts}><RefreshCw size={16} /> Refresh</button>
          <button className="secondary" onClick={exportData}><Download size={16} /> Export</button>
        </div>
      </section>

      {errorMessage && <section className="error-box">{errorMessage}</section>}

      {/* Filters */}
      <section className="filter-row">
        <button className={filter === 'thisWeek' ? 'active' : ''} onClick={() => setFilter('thisWeek')}>This Week</button>
        <button className={filter === 'previousWeek' ? 'active' : ''} onClick={() => setFilter('previousWeek')}>Previous Week</button>
        <button className={filter === 'year' ? 'active' : ''} onClick={() => setFilter('year')}>Tax Year</button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
      </section>

      {/* Stats */}
      <section className="stats-grid">
        <StatCard icon={<DollarSign size={20} />} label="Earnings" value={money(totals.earnings)} sub={`${num(totals.hours)} hrs`} />
        <StatCard icon={<Car size={20} />} label="Miles" value={`${num(totals.miles)} mi`} sub={`${money(totals.netProfit)} net`} />
        <StatCard icon={<Fuel size={20} />} label="Gas + Wear" value={money(totals.gasCost + totals.wearCost)} sub={`${money(totals.gasCost)} gas`} />
        <StatCard icon={<ReceiptText size={20} />} label="Mileage Deduction" value={money(totals.taxDeduction)} sub={`at $${IRS_MILEAGE_RATE}/mi`} />
      </section>

      {/* Shift List */}
      <section className="panel shift-panel">
        <h2><CalendarDays size={20} /> Shifts</h2>
        {loading && <p className="muted">Loading shifts…</p>}
        {!loading && filteredShifts.length === 0 && (
          <p className="muted">No shifts in this view yet. Tap <strong>+</strong> to add one.</p>
        )}
        <div className="shift-list">
          {filteredShifts.map(shift => (
            <article className="shift" key={shift.id} onClick={() => setSelectedShift(shift)} role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setSelectedShift(shift)}>
              <div className="shift-main">
                <div className="shift-top">
                  <strong className="shift-platform">{shift.platform}</strong>
                  <span className="shift-date">{shift.date}</span>
                </div>
                <div className="shift-numbers">
                  <span className="shift-earnings">{money(shift.earnings)}</span>
                  <span className="shift-sep">·</span>
                  <span className="shift-profit">Net {money(shift.netProfit)}</span>
                </div>
              </div>
              <ChevronRight size={16} className="shift-chevron" />
            </article>
          ))}
        </div>
      </section>

      {/* Floating Add Button */}
      <button className="fab" onClick={() => { setErrorMessage(''); setShowAddModal(true) }} aria-label="Add shift">
        <Plus size={28} />
      </button>

      {/* Add Shift Modal */}
      {showAddModal && (
        <AddShiftModal
          onClose={() => setShowAddModal(false)}
          onSave={handleSaveShift}
          saving={saving}
          errorMessage={errorMessage}
        />
      )}

      {/* Shift Detail Modal */}
      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          onClose={() => setSelectedShift(null)}
          onDelete={deleteShift}
        />
      )}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
