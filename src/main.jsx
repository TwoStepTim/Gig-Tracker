import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, isSupabaseConfigured } from './supabase'
import './styles.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const LS_SHIFTS   = 'gigtrak-shifts-v1'
const LS_SETTINGS = 'gigtrak-settings-v1'

const DEFAULT_SETTINGS = {
  mpg:      '30',
  gasPrice: '3.50',
  wearRate: '0.08',
  irsRate:  '0.67'
}

const PLATFORMS = [
  'DoorDash', 'Amazon Flex', 'Uber Eats',
  'Instacart', "Domino's", 'Grubhub', 'Other'
]

const FILTER_OPTIONS = [
  { key: 'thisWeek',  label: 'This Week'  },
  { key: 'lastWeek',  label: 'Last Week'  },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'taxYear',   label: 'Tax Year'   },
  { key: 'all',       label: 'All Time'   },
  { key: 'custom',    label: 'Custom'     },
]

// ─── Utilities ────────────────────────────────────────────────────────────────

const $m = v => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const $n = (v, d = 1) => Number(v || 0).toFixed(d)

function toISODate(d)  { return d.toISOString().slice(0, 10) }
function todayISO()    { return toISODate(new Date()) }

function getWeekBounds(offsetWeeks = 0) {
  const today = new Date()
  const dow   = today.getDay()
  const base  = new Date(today); base.setDate(today.getDate() - dow); base.setHours(0,0,0,0)
  const start = new Date(base);  start.setDate(base.getDate() + offsetWeeks * 7)
  const end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999)
  return { start: toISODate(start), end: toISODate(end) }
}

function getMonthBounds() {
  const t = new Date()
  return {
    start: toISODate(new Date(t.getFullYear(), t.getMonth(), 1)),
    end:   toISODate(new Date(t.getFullYear(), t.getMonth() + 1, 0))
  }
}

function getTaxYearBounds() {
  const y = new Date().getFullYear()
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

function filterShifts(shifts, filter, customRange) {
  let bounds = null
  if      (filter === 'thisWeek')                               bounds = getWeekBounds(0)
  else if (filter === 'lastWeek')                               bounds = getWeekBounds(-1)
  else if (filter === 'thisMonth')                              bounds = getMonthBounds()
  else if (filter === 'taxYear')                                bounds = getTaxYearBounds()
  else if (filter === 'custom' && customRange.start && customRange.end) bounds = customRange

  const sorted = [...shifts].sort((a, b) => b.date.localeCompare(a.date))
  return bounds ? sorted.filter(s => s.date >= bounds.start && s.date <= bounds.end) : sorted
}

function minutesBetween(a, b) {
  if (!a || !b) return 0
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  let s = ah * 60 + am, e = bh * 60 + bm
  if (e < s) e += 1440
  return e - s
}

function calcShift(form, settings) {
  const miles    = Math.max(0, Number(form.endMileage) - Number(form.startMileage))
  const earnings = Number(form.earnings || 0)
  const mpg      = Number(settings.mpg      || 30)
  const gasPrice = Number(settings.gasPrice || 3.5)
  const wearRate = Number(settings.wearRate || 0.08)
  const irsRate  = Number(settings.irsRate  || 0.67)
  const gasCost  = mpg > 0 ? (miles / mpg) * gasPrice : 0
  const wearCost = miles * wearRate
  const netProfit = earnings - gasCost - wearCost
  const hours    = minutesBetween(form.startTime, form.endTime) / 60
  const taxDeduction = miles * irsRate
  return {
    miles, earnings, gasCost, wearCost, netProfit, hours,
    grossHourly:  hours > 0 ? earnings  / hours : 0,
    netHourly:    hours > 0 ? netProfit / hours : 0,
    taxDeduction
  }
}

function summarize(shifts) {
  return shifts.reduce((acc, s) => ({
    earnings:     acc.earnings     + Number(s.earnings     || 0),
    miles:        acc.miles        + Number(s.miles        || 0),
    gasCost:      acc.gasCost      + Number(s.gasCost      || 0),
    wearCost:     acc.wearCost     + Number(s.wearCost     || 0),
    netProfit:    acc.netProfit    + Number(s.netProfit    || 0),
    hours:        acc.hours        + Number(s.hours        || 0),
    taxDeduction: acc.taxDeduction + Number(s.taxDeduction || 0),
  }), { earnings: 0, miles: 0, gasCost: 0, wearCost: 0, netProfit: 0, hours: 0, taxDeduction: 0 })
}

function fmt12(t) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, mo, d] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[Number(mo)-1]} ${Number(d)}, ${y}`
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function lsLoad(key, fb) { try { return JSON.parse(localStorage.getItem(key)) || fb } catch { return fb } }
function lsSave(key, val) { localStorage.setItem(key, JSON.stringify(val)) }

// ─── Supabase helpers ─────────────────────────────────────────────────────────

function toRow(s) {
  return {
    id: s.id, date: s.date, platform: s.platform,
    start_mileage: s.startMileage, end_mileage: s.endMileage,
    earnings: s.earnings, start_time: s.startTime || null,
    end_time: s.endTime || null, notes: s.notes || '',
    miles: s.miles, gas_cost: s.gasCost, wear_cost: s.wearCost,
    net_profit: s.netProfit, hours: s.hours,
    gross_hourly: s.grossHourly, net_hourly: s.netHourly,
    tax_deduction: s.taxDeduction,
    created_at: s.createdAt || new Date().toISOString()
  }
}

function fromRow(r) {
  return {
    id: r.id, date: r.date, platform: r.platform,
    startMileage: Number(r.start_mileage || 0),
    endMileage:   Number(r.end_mileage   || 0),
    earnings:     Number(r.earnings      || 0),
    startTime: r.start_time || '', endTime: r.end_time || '',
    notes: r.notes || '',
    miles:        Number(r.miles         || 0),
    gasCost:      Number(r.gas_cost      || 0),
    wearCost:     Number(r.wear_cost     || 0),
    netProfit:    Number(r.net_profit    || 0),
    hours:        Number(r.hours         || 0),
    grossHourly:  Number(r.gross_hourly  || 0),
    netHourly:    Number(r.net_hourly    || 0),
    taxDeduction: Number(r.tax_deduction || 0),
    createdAt: r.created_at
  }
}

async function dbLoad() {
  if (!isSupabaseConfigured) return lsLoad(LS_SHIFTS, [])
  const { data, error } = await supabase.from('shifts').select('*')
    .order('date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(fromRow)
}

async function dbInsert(shift) {
  if (!isSupabaseConfigured) {
    lsSave(LS_SHIFTS, [shift, ...lsLoad(LS_SHIFTS, [])])
    return shift
  }
  const { data, error } = await supabase.from('shifts').insert([toRow(shift)]).select().single()
  if (error) throw error
  return fromRow(data)
}

async function dbUpdate(shift) {
  if (!isSupabaseConfigured) {
    lsSave(LS_SHIFTS, lsLoad(LS_SHIFTS, []).map(s => s.id === shift.id ? shift : s))
    return shift
  }
  const { data, error } = await supabase.from('shifts').update(toRow(shift)).eq('id', shift.id).select().single()
  if (error) throw error
  return fromRow(data)
}

async function dbDelete(id) {
  if (!isSupabaseConfigured) {
    lsSave(LS_SHIFTS, lsLoad(LS_SHIFTS, []).filter(s => s.id !== id))
    return
  }
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw error
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = {
  Plus: () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  X:    () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Trash: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  Edit: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Chevron: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
  Download: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Settings: () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  FileText: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  Cloud: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>,
  CloudOff: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9.59 4.59A8 8 0 1116.4 19H5a5 5 0 01-1.7-9.7"/></svg>,
  Refresh: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
}

// ─── Shared shift form fields ─────────────────────────────────────────────────

function ShiftFormFields({ form, set }) {
  return (
    <>
      <div className="row2">
        <label>Date
          <input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
        </label>
        <label>Platform
          <select value={form.platform} onChange={e => set('platform', e.target.value)}>
            {PLATFORMS.map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <div className="row2">
        <label>Start Mileage
          <input type="number" value={form.startMileage} onChange={e => set('startMileage', e.target.value)}
            placeholder="102340" required />
        </label>
        <label>End Mileage
          <input type="number" value={form.endMileage} onChange={e => set('endMileage', e.target.value)}
            placeholder="102409" required />
        </label>
      </div>

      <label>Money Earned
        <div className="input-prefix-wrap">
          <span className="input-prefix">$</span>
          <input type="number" step="0.01" min="0" value={form.earnings}
            onChange={e => set('earnings', e.target.value)} placeholder="0.00" required />
        </div>
      </label>

      <div className="row2">
        <label>Start Time
          <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
        </label>
        <label>End Time
          <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} />
        </label>
      </div>

      <label>Notes
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Route, weather, anything worth remembering…" rows={3} />
      </label>
    </>
  )
}

// ─── AddShiftModal ─────────────────────────────────────────────────────────────

const blankForm = () => ({
  date: todayISO(), platform: 'DoorDash',
  startMileage: '', endMileage: '', earnings: '',
  startTime: '', endTime: '', notes: ''
})

function AddShiftModal({ onClose, onSave, saving, error }) {
  const [form, setForm] = useState(blankForm())
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up">
        <div className="modal-hd">
          <span className="modal-title">New Shift</span>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><Icon.X /></button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="shift-form">
          <ShiftFormFields form={form} set={set} />
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Shift'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── EditShiftModal ────────────────────────────────────────────────────────────

function EditShiftModal({ shift, onClose, onSave, saving, error }) {
  const [form, setForm] = useState({
    date:         shift.date,
    platform:     shift.platform,
    startMileage: String(shift.startMileage),
    endMileage:   String(shift.endMileage),
    earnings:     String(shift.earnings),
    startTime:    shift.startTime || '',
    endTime:      shift.endTime   || '',
    notes:        shift.notes     || ''
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up">
        <div className="modal-hd">
          <span className="modal-title">Edit Shift</span>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><Icon.X /></button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <form onSubmit={e => { e.preventDefault(); onSave(form) }} className="shift-form">
          <ShiftFormFields form={form} set={set} />
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── ShiftDetailModal ──────────────────────────────────────────────────────────

function ShiftDetailModal({ shift: s, onClose, onDelete, onEdit }) {
  const timeRange = s.startTime && s.endTime
    ? `${fmt12(s.startTime)} – ${fmt12(s.endTime)}`
    : s.startTime ? fmt12(s.startTime) : null

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up detail-modal">
        <div className="modal-hd">
          <div>
            <div className="detail-platform">{s.platform}</div>
            <div className="detail-date">{fmtDate(s.date)}</div>
          </div>
          <div className="modal-hd-actions">
            <button className="btn-icon btn-edit" onClick={onEdit} aria-label="Edit shift" title="Edit shift">
              <Icon.Edit />
            </button>
            <button className="btn-icon btn-danger" onClick={() => { onDelete(s.id); onClose() }} aria-label="Delete shift">
              <Icon.Trash />
            </button>
            <button className="btn-icon" onClick={onClose} aria-label="Close"><Icon.X /></button>
          </div>
        </div>

        <div className="detail-hero">
          <div className="detail-hero-item">
            <span className="dh-label">Earned</span>
            <span className="dh-value">{$m(s.earnings)}</span>
          </div>
          <div className="detail-hero-divider" />
          <div className="detail-hero-item">
            <span className="dh-label">Net Profit</span>
            <span className="dh-value dh-profit">{$m(s.netProfit)}</span>
          </div>
          <div className="detail-hero-divider" />
          <div className="detail-hero-item">
            <span className="dh-label">Miles</span>
            <span className="dh-value">{$n(s.miles)} mi</span>
          </div>
        </div>

        <div className="detail-grid">
          <div className="detail-section">
            <div className="ds-title">Trip</div>
            <div className="ds-row"><span>Start Mileage</span><span>{Number(s.startMileage).toLocaleString()} mi</span></div>
            <div className="ds-row"><span>End Mileage</span><span>{Number(s.endMileage).toLocaleString()} mi</span></div>
            <div className="ds-row"><span>Miles Driven</span><span>{$n(s.miles)} mi</span></div>
            {timeRange && <div className="ds-row"><span>Time</span><span>{timeRange}</span></div>}
            {s.hours > 0 && <div className="ds-row"><span>Hours</span><span>{$n(s.hours, 2)} hrs</span></div>}
          </div>

          <div className="detail-section">
            <div className="ds-title">Costs</div>
            <div className="ds-row"><span>Gas Cost</span><span>{$m(s.gasCost)}</span></div>
            <div className="ds-row"><span>Wear Cost</span><span>{$m(s.wearCost)}</span></div>
            <div className="ds-row ds-row-accent"><span>Net Profit</span><span>{$m(s.netProfit)}</span></div>
          </div>

          {s.hours > 0 && (
            <div className="detail-section">
              <div className="ds-title">Hourly</div>
              <div className="ds-row"><span>Gross / hr</span><span>{$m(s.grossHourly)}</span></div>
              <div className="ds-row ds-row-accent"><span>Net / hr</span><span>{$m(s.netHourly)}</span></div>
            </div>
          )}

          <div className="detail-section">
            <div className="ds-title">Tax Record</div>
            <div className="ds-row"><span>Mileage Deduction</span><span className="tax-val">{$m(s.taxDeduction)}</span></div>
            <div className="ds-row"><span>Miles</span><span>{$n(s.miles)} mi</span></div>
          </div>
        </div>

        {s.notes && (
          <div className="detail-notes">
            <div className="ds-title">Notes</div>
            <p>{s.notes}</p>
          </div>
        )}

        {/* Edit shortcut at the bottom for easy thumb reach on mobile */}
        <button className="btn-edit-full" onClick={onEdit}>
          <Icon.Edit /> Edit this shift
        </button>
      </div>
    </div>
  )
}

// ─── SettingsModal ─────────────────────────────────────────────────────────────

function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...settings })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up">
        <div className="modal-hd">
          <span className="modal-title">Settings</span>
          <button className="btn-icon" onClick={onClose}><Icon.X /></button>
        </div>
        <p className="settings-sub">Used for profit and tax calculations. Not shown in shift entry.</p>
        <div className="shift-form">
          <div className="row2">
            <label>MPG
              <input type="number" step="0.1" value={form.mpg} onChange={e => set('mpg', e.target.value)} />
            </label>
            <label>Gas Price / gal
              <div className="input-prefix-wrap">
                <span className="input-prefix">$</span>
                <input type="number" step="0.01" value={form.gasPrice} onChange={e => set('gasPrice', e.target.value)} />
              </div>
            </label>
          </div>
          <div className="row2">
            <label>Wear Rate / mile
              <div className="input-prefix-wrap">
                <span className="input-prefix">$</span>
                <input type="number" step="0.01" value={form.wearRate} onChange={e => set('wearRate', e.target.value)} />
              </div>
            </label>
            <label>IRS Rate / mile
              <div className="input-prefix-wrap">
                <span className="input-prefix">$</span>
                <input type="number" step="0.001" value={form.irsRate} onChange={e => set('irsRate', e.target.value)} />
              </div>
            </label>
          </div>
          <button className="btn-primary" onClick={() => { onSave(form); onClose() }}>Save Settings</button>
        </div>
      </div>
    </div>
  )
}

// ─── TaxReportModal ────────────────────────────────────────────────────────────

function TaxReportModal({ shifts, onClose }) {
  const year = new Date().getFullYear()
  const yearShifts = shifts.filter(s => s.date.startsWith(String(year)))
  const totals = summarize(yearShifts)

  function exportJSON() {
    const blob = new Blob([JSON.stringify(shifts, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `gigtrak-${year}.json`; a.click()
  }

  function exportCSV() {
    const headers = ['id','date','platform','startMileage','endMileage','miles','earnings',
      'gasCost','wearCost','netProfit','hours','grossHourly','netHourly','taxDeduction','startTime','endTime','notes']
    const rows = shifts.map(s => headers.map(h => JSON.stringify(s[h] ?? '')).join(','))
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `gigtrak-${year}.csv`; a.click()
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up">
        <div className="modal-hd">
          <span className="modal-title">Tax Year {year}</span>
          <button className="btn-icon" onClick={onClose}><Icon.X /></button>
        </div>
        <div className="tax-report">
          <div className="tax-row"><span>Total Miles</span><strong>{$n(totals.miles)} mi</strong></div>
          <div className="tax-row tax-row-highlight"><span>IRS Mileage Deduction</span><strong>{$m(totals.taxDeduction)}</strong></div>
          <div className="tax-row"><span>Total Earnings</span><strong>{$m(totals.earnings)}</strong></div>
          <div className="tax-row"><span>Total Gas Cost</span><strong>{$m(totals.gasCost)}</strong></div>
          <div className="tax-row"><span>Total Wear Cost</span><strong>{$m(totals.wearCost)}</strong></div>
          <div className="tax-row"><span>Total Hours</span><strong>{$n(totals.hours, 1)} hrs</strong></div>
          <div className="tax-row tax-row-highlight"><span>Net Profit</span><strong>{$m(totals.netProfit)}</strong></div>
          <div className="tax-row tax-row-muted"><span>Shifts logged</span><strong>{yearShifts.length}</strong></div>
        </div>
        <div className="export-row">
          <button className="btn-export" onClick={exportJSON}><Icon.Download /> Export JSON</button>
          <button className="btn-export" onClick={exportCSV}><Icon.Download /> Export CSV</button>
        </div>
      </div>
    </div>
  )
}

// ─── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`stat-card${accent ? ' stat-card-accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [shifts,      setShifts]      = useState([])
  const [settings,    setSettings]    = useState(() => ({ ...DEFAULT_SETTINGS, ...lsLoad(LS_SETTINGS, {}) }))
  const [filter,      setFilter]      = useState('thisWeek')
  const [customRange, setCustomRange] = useState({ start: '', end: '' })
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [modal,       setModal]       = useState(null) // 'add'|'detail'|'edit'|'settings'|'tax'
  const [activeShift, setActiveShift] = useState(null)

  useEffect(() => { refresh() }, [])

  async function refresh() {
    setLoading(true); setError('')
    try   { setShifts(await dbLoad()) }
    catch (e) { setError(e.message || 'Could not load shifts.') }
    finally { setLoading(false) }
  }

  function saveSettings(s) { setSettings(s); lsSave(LS_SETTINGS, s) }

  const visible = useMemo(() => filterShifts(shifts, filter, customRange), [shifts, filter, customRange])
  const totals  = useMemo(() => summarize(visible), [visible])

  // ── Add ──────────────────────────────────────────────────────────────────────
  async function handleAddShift(form) {
    setError('')
    if (!form.startMileage || !form.endMileage || !form.earnings) {
      setError('Start mileage, end mileage, and earnings are required.')
      return
    }
    const calc  = calcShift(form, settings)
    const shift = {
      id: crypto.randomUUID(), ...form,
      startMileage: Number(form.startMileage),
      endMileage:   Number(form.endMileage),
      createdAt:    new Date().toISOString(),
      ...calc
    }
    setSaving(true)
    try {
      const saved = await dbInsert(shift)
      setShifts(p => [saved, ...p])
      setModal(null)
    } catch (e) { setError(e.message || 'Could not save shift.') }
    finally { setSaving(false) }
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────
  async function handleEditShift(form) {
    setError('')
    if (!form.startMileage || !form.endMileage || !form.earnings) {
      setError('Start mileage, end mileage, and earnings are required.')
      return
    }
    const calc  = calcShift(form, settings)
    const updated = {
      ...activeShift,
      ...form,
      startMileage: Number(form.startMileage),
      endMileage:   Number(form.endMileage),
      ...calc
    }
    setSaving(true)
    try {
      const saved = await dbUpdate(updated)
      setShifts(p => p.map(s => s.id === saved.id ? saved : s))
      setActiveShift(saved) // refresh detail view
      setModal('detail')    // return to detail after saving
    } catch (e) { setError(e.message || 'Could not save changes.') }
    finally { setSaving(false) }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(id) {
    const prev = shifts
    setShifts(p => p.filter(s => s.id !== id))
    try { await dbDelete(id) }
    catch (e) { setShifts(prev); setError(e.message || 'Could not delete shift.') }
  }

  function openShift(s) { setActiveShift(s); setModal('detail') }

  const filterLabel = FILTER_OPTIONS.find(f => f.key === filter)?.label || ''

  return (
    <>
      <div className="app">
        {/* Header */}
        <header className="app-header">
          <div className="app-logo">
            <span className="logo-mark">G</span>
            <span className="logo-text">GigTrak</span>
          </div>
          <div className="header-actions">
            <span className={`sync-badge${isSupabaseConfigured ? ' synced' : ''}`}>
              {isSupabaseConfigured ? <Icon.Cloud /> : <Icon.CloudOff />}
              {isSupabaseConfigured ? 'Synced' : 'Local'}
            </span>
            <button className="btn-ghost" onClick={refresh}            title="Refresh"><Icon.Refresh /></button>
            <button className="btn-ghost" onClick={() => setModal('tax')}      title="Tax Report"><Icon.FileText /></button>
            <button className="btn-ghost" onClick={() => setModal('settings')} title="Settings"><Icon.Settings /></button>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError('')}><Icon.X /></button>
          </div>
        )}

        {/* Filters */}
        <div className="filter-bar">
          <div className="filter-chips">
            {FILTER_OPTIONS.map(o => (
              <button key={o.key} className={`chip${filter === o.key ? ' chip-active' : ''}`}
                onClick={() => setFilter(o.key)}>{o.label}</button>
            ))}
          </div>
          {filter === 'custom' && (
            <div className="custom-range">
              <input type="date" value={customRange.start}
                onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} />
              <span>to</span>
              <input type="date" value={customRange.end}
                onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="stats-row">
          <StatCard label="Earnings"   value={$m(totals.earnings)}                  sub={`${$n(totals.hours, 1)} hrs`} accent />
          <StatCard label="Net Profit" value={$m(totals.netProfit)}                 sub="after costs"                  accent />
          <StatCard label="Miles"      value={`${$n(totals.miles)} mi`}             sub={`${visible.length} shift${visible.length !== 1 ? 's' : ''}`} />
          <StatCard label="Gas + Wear" value={$m(totals.gasCost + totals.wearCost)} sub={`${$n(totals.hours, 1)} hrs`} />
        </div>

        {/* Shift list */}
        <div className="period-label">{filterLabel}</div>

        {loading && <div className="state-msg">Loading shifts…</div>}
        {!loading && visible.length === 0 && (
          <div className="state-msg">
            No shifts yet for this period.
            <button className="btn-link" onClick={() => setModal('add')}>Add your first shift →</button>
          </div>
        )}

        <div className="shift-list">
          {visible.map(s => (
            <button key={s.id} className="shift-card" onClick={() => openShift(s)}>
              <div className="sc-left">
                <div className="sc-platform">{s.platform}</div>
                <div className="sc-date">{fmtDate(s.date)}</div>
              </div>
              <div className="sc-right">
                <div className="sc-earnings">{$m(s.earnings)}</div>
                <div className="sc-profit">{$m(s.netProfit)} net</div>
              </div>
              <Icon.Chevron />
            </button>
          ))}
        </div>
      </div>

      {/* FAB */}
      <button className="fab" onClick={() => { setError(''); setModal('add') }} aria-label="Add shift">
        <Icon.Plus />
      </button>

      {/* Modals */}
      {modal === 'add' && (
        <AddShiftModal
          onClose={() => setModal(null)}
          onSave={handleAddShift}
          saving={saving}
          error={error}
        />
      )}

      {modal === 'detail' && activeShift && (
        <ShiftDetailModal
          shift={activeShift}
          onClose={() => setModal(null)}
          onDelete={handleDelete}
          onEdit={() => { setError(''); setModal('edit') }}
        />
      )}

      {modal === 'edit' && activeShift && (
        <EditShiftModal
          shift={activeShift}
          onClose={() => setModal('detail')}
          onSave={handleEditShift}
          saving={saving}
          error={error}
        />
      )}

      {modal === 'settings' && (
        <SettingsModal settings={settings} onSave={saveSettings} onClose={() => setModal(null)} />
      )}

      {modal === 'tax' && (
        <TaxReportModal shifts={shifts} onClose={() => setModal(null)} />
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(<App />)
