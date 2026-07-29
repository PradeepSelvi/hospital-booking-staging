import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { getReportOverview, getHospitalGeoPoints, getAppointmentReport } from '../../services/admin'
import { paiseToRupees } from '../../services/payments'
import { toast } from 'react-toastify'
import { SkeletonReports } from '../../components/SkeletonLoader'
import ReportMap from '../../components/ReportMap'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Tooltip, Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Filler, Tooltip, Legend)

const PRESETS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last year', days: 365 },
]

function iso(d) { return d.toISOString().split('T')[0] }
function money(paise) {
  return `₹${Number(paiseToRupees(paise || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}
function fmtDay(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Build the view-model from appointment rows when the server RPC is unavailable.
function fallbackOverview(appointments, from, to) {
  const count = (s) => appointments.filter(a => a.status === s).length
  const byDoctor = {}
  const byCity = {}
  appointments.forEach(a => {
    const name = a.doctors?.profiles?.name ?? 'Unknown'
    byDoctor[name] = byDoctor[name] || { name, specialization: a.doctors?.specialization ?? '', total: 0, completed: 0, cancelled: 0 }
    byDoctor[name].total++
    if (a.status === 'COMPLETED') byDoctor[name].completed++
    if (a.status === 'CANCELLED') byDoctor[name].cancelled++
  })
  return {
    range: { from, to },
    appointments: {
      total: appointments.length,
      pending: count('PENDING'), confirmed: count('CONFIRMED'),
      completed: count('COMPLETED'), cancelled: count('CANCELLED'),
    },
    revenue: { collected_paise: 0, pending_paise: 0, refunded_paise: 0, paid_count: 0, online_count: 0, offline_count: 0 },
    daily: [],
    top_doctors: Object.values(byDoctor).sort((a, b) => b.total - a.total).slice(0, 10),
    by_city: Object.values(byCity),
    new_users: { patients: 0, doctors: 0, hospitals: 0 },
    _degraded: true,
  }
}

export default function Reports() {
  const [overview, setOverview] = useState(null)
  const [appointments, setAppointments] = useState([])
  const [geoPoints, setGeoPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [activePreset, setActivePreset] = useState('30')

  // Chart instance refs — used to snapshot charts as images for the PDF.
  const trendRef = useRef(null)
  const donutRef = useRef(null)
  const revenueRef = useRef(null)
  const doctorsRef = useRef(null)
  const cityRef = useRef(null)

  const loadData = useCallback(async (from, to) => {
    try {
      setLoading(true)
      const [ov, apts, geo] = await Promise.all([
        getReportOverview(from, to).catch(() => null),
        getAppointmentReport({ from_date: from, to_date: to }).catch(() => []),
        getHospitalGeoPoints().catch(() => []),
      ])
      setAppointments(apts)
      setGeoPoints(geo)
      setOverview(ov || fallbackOverview(apts, from, to))
    } catch (err) {
      toast.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - 30)
    setFromDate(iso(from))
    setToDate(iso(to))
    loadData(iso(from), iso(to))
  }, [loadData])

  function applyPreset(days, key) {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    setActivePreset(key)
    setFromDate(iso(from))
    setToDate(iso(to))
    loadData(iso(from), iso(to))
  }

  function handleCustomFilter() {
    if (!fromDate || !toDate) return toast.info('Pick both dates')
    if (fromDate > toDate) return toast.error('Start date must be before end date')
    setActivePreset('')
    loadData(fromDate, toDate)
  }

  // ── CSV export (detailed appointment rows) ──
  function escapeCSV(value) {
    const str = String(value ?? '')
    // Prevent CSV/formula injection: prefix cells starting with = + - @.
    const guarded = /^[=+\-@]/.test(str) ? `'${str}` : str
    if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n')) {
      return `"${guarded.replace(/"/g, '""')}"`
    }
    return guarded
  }

  function exportDetailedCSV() {
    if (appointments.length === 0) return toast.info('No detailed rows to export')
    setExporting(true)
    try {
      const headers = ['ID', 'Patient', 'Doctor', 'Specialization', 'Date', 'Time', 'Status', 'Reason']
      const rows = appointments.map(a => [
        a.id, a.profiles?.name ?? '', a.doctors?.profiles?.name ?? '',
        a.doctors?.specialization ?? '', a.appointment_date,
        a.slot_start_time?.substring(0, 5) ?? '', a.status, a.reason ?? '',
      ].map(escapeCSV))
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
      downloadBlob('\uFEFF' + csv, `medibook_appointments_${fromDate}_to_${toDate}.csv`, 'text/csv;charset=utf-8')
      toast.success('Detailed report downloaded')
    } finally {
      setExporting(false)
    }
  }

  // ── Summary CSV (aggregates) ──
  function exportSummaryCSV() {
    if (!overview) return
    const a = overview.appointments, r = overview.revenue
    const lines = [
      ['MediBook — Summary Report'],
      ['Range', `${fromDate} to ${toDate}`],
      [],
      ['Appointments'],
      ['Total', a.total], ['Pending', a.pending], ['Confirmed', a.confirmed],
      ['Completed', a.completed], ['Cancelled', a.cancelled],
      ['Completion rate', `${completionRate}%`],
      [],
      ['Revenue'],
      ['Collected (INR)', paiseToRupees(r.collected_paise)],
      ['Pending (INR)', paiseToRupees(r.pending_paise)],
      ['Refunded (INR)', paiseToRupees(r.refunded_paise)],
      ['Paid transactions', r.paid_count], ['Online', r.online_count], ['Offline', r.offline_count],
      [],
      ['Top Doctors'],
      ['Doctor', 'Specialization', 'Total', 'Completed', 'Cancelled'],
      ...overview.top_doctors.map(d => [d.name, d.specialization, d.total, d.completed, d.cancelled ?? 0]),
      [],
      ['Appointments by City'],
      ['City', 'Appointments'],
      ...overview.by_city.map(c => [c.city, c.appointments]),
    ]
    const csv = lines.map(row => (Array.isArray(row) ? row.map(escapeCSV).join(',') : '')).join('\n')
    downloadBlob('\uFEFF' + csv, `medibook_summary_${fromDate}_to_${toDate}.csv`, 'text/csv;charset=utf-8')
    toast.success('Summary downloaded')
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const el = document.createElement('a')
    el.href = url
    el.download = filename
    el.click()
    URL.revokeObjectURL(url)
  }

  function downloadPDF() {
    if (!overview) return
    const A = overview.appointments, R = overview.revenue
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))

    // Snapshot each rendered chart as a PNG (charts may be absent if no data).
    const img = (ref) => {
      try { return ref.current?.toBase64Image?.('image/png', 1) || null } catch { return null }
    }
    const charts = {
      trend: img(trendRef),
      donut: img(donutRef),
      revenue: img(revenueRef),
      doctors: img(doctorsRef),
      city: img(cityRef),
    }

    const chartBlock = (title, src) => src
      ? `<div class="chart-block"><h3>${esc(title)}</h3><img src="${src}" /></div>`
      : ''

    const kpiCards = [
      ['Total Appointments', A.total],
      ['Completed', `${A.completed} (${completionRate}%)`],
      ['Cancelled', A.cancelled],
      ['Revenue Collected', money(R.collected_paise)],
      ['Pending Revenue', money(R.pending_paise)],
      ['Refunded', money(R.refunded_paise)],
    ].map(([l, v]) => `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-l">${esc(l)}</div></div>`).join('')

    const doctorRows = (overview.top_doctors ?? []).map(d => `
      <tr><td>Dr. ${esc(d.name)}</td><td>${esc(d.specialization)}</td>
      <td>${d.total}</td><td>${d.completed}</td><td>${d.cancelled ?? 0}</td></tr>`).join('')

    const cityRows = (overview.by_city ?? []).map(c => `
      <tr><td>${esc(c.city)}</td><td>${c.appointments}</td></tr>`).join('')

    const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>MediBook Report ${esc(fromDate)} to ${esc(toDate)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; margin: 0; padding: 28px 32px; }
        .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #0077B6; padding-bottom:12px; margin-bottom:20px; }
        .brand { font-size:22px; font-weight:800; color:#0077B6; }
        .brand span { color:#03045E; }
        .meta { font-size:12px; color:#555; text-align:right; }
        h2 { font-size:15px; margin:22px 0 10px; color:#03045E; border-left:4px solid #0077B6; padding-left:8px; }
        h3 { font-size:13px; margin:0 0 6px; color:#333; }
        .kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        .kpi { border:1px solid #e2e6ea; border-radius:8px; padding:12px 14px; }
        .kpi-v { font-size:20px; font-weight:800; color:#0077B6; }
        .kpi-l { font-size:11px; color:#666; margin-top:2px; }
        .charts { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:8px; }
        .chart-block { border:1px solid #e2e6ea; border-radius:8px; padding:10px; break-inside:avoid; }
        .chart-block img { width:100%; height:auto; }
        table { width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
        th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #eee; }
        th { background:#f4f7f9; color:#03045E; }
        .footer { margin-top:24px; font-size:10px; color:#999; text-align:center; border-top:1px solid #eee; padding-top:8px; }
        @page { margin: 12mm; }
      </style></head><body>
      <div class="head">
        <div>
          <div class="brand">Medi<span>Book</span></div>
          <div style="font-size:13px;color:#333;margin-top:4px;">Analytics Report</div>
        </div>
        <div class="meta">
          <div><strong>Period:</strong> ${esc(fromDate)} → ${esc(toDate)}</div>
          <div><strong>Generated:</strong> ${esc(generated)}</div>
          <div style="color:#b00;margin-top:4px;">Confidential — Internal Use</div>
        </div>
      </div>

      <h2>Key Metrics</h2>
      <div class="kpis">${kpiCards}</div>

      <h2>Trends &amp; Breakdown</h2>
      <div class="charts">
        ${chartBlock('Appointment Trend', charts.trend)}
        ${chartBlock('Status Breakdown', charts.donut)}
        ${chartBlock('Revenue by Day', charts.revenue)}
        ${chartBlock('Top Doctors', charts.doctors)}
        ${chartBlock('Appointments by City', charts.city)}
      </div>

      ${doctorRows ? `<h2>Doctor-wise Summary</h2>
      <table><thead><tr><th>Doctor</th><th>Specialization</th><th>Total</th><th>Completed</th><th>Cancelled</th></tr></thead>
      <tbody>${doctorRows}</tbody></table>` : ''}

      ${cityRows ? `<h2>Geographic Distribution</h2>
      <table><thead><tr><th>City</th><th>Appointments</th></tr></thead><tbody>${cityRows}</tbody></table>` : ''}

      <div class="footer">MediBook — generated ${esc(generated)}. This document may contain sensitive operational data.</div>
      </body></html>`

    // Print via a hidden iframe — this avoids popup blockers entirely
    // (window.open with 'noopener' returns null and gets blocked). The iframe
    // is same-origin so we can write the report HTML and trigger its print
    // dialog, then clean it up afterwards.
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const cleanup = () => {
      // Remove the iframe once the print dialog has been dismissed.
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }

    const doc = iframe.contentWindow?.document
    if (!doc) {
      cleanup()
      toast.error('Could not generate the PDF report. Please try again.')
      return
    }

    doc.open()
    doc.write(html)
    doc.close()

    // Wait for the document (and chart images) to finish laying out, then
    // trigger the print dialog. Clean up after the dialog closes.
    const triggerPrint = () => {
      try {
        const win = iframe.contentWindow
        win.focus()
        win.onafterprint = cleanup
        win.print()
        // Safety net in case onafterprint never fires (some browsers).
        setTimeout(cleanup, 60000)
      } catch (err) {
        cleanup()
        toast.error('Could not open the print dialog. Please try again.')
      }
    }

    setTimeout(triggerPrint, 400)
  }

  // ── Derived ──
  const completionRate = useMemo(() => {
    const t = overview?.appointments?.total ?? 0
    const c = overview?.appointments?.completed ?? 0
    return t > 0 ? Math.round((c / t) * 100) : 0
  }, [overview])

  if (loading) return <SkeletonReports />
  if (!overview) return null

  const A = overview.appointments
  const R = overview.revenue
  const daily = overview.daily ?? []

  const donutData = {
    labels: ['Pending', 'Confirmed', 'Completed', 'Cancelled'],
    datasets: [{
      data: [A.pending, A.confirmed, A.completed, A.cancelled],
      backgroundColor: ['#F9C74F', '#0077B6', '#2DC653', '#EF233C'],
      borderWidth: 0, hoverOffset: 8,
    }],
  }

  const trendData = {
    labels: daily.map(d => fmtDay(d.day)),
    datasets: [
      { label: 'Total', data: daily.map(d => d.total), borderColor: '#0077B6', backgroundColor: 'rgba(0,119,182,0.1)', fill: true, tension: 0.4, pointRadius: 2 },
      { label: 'Completed', data: daily.map(d => d.completed), borderColor: '#2DC653', backgroundColor: 'rgba(45,198,83,0.08)', fill: true, tension: 0.4, pointRadius: 2 },
    ],
  }

  const revenueData = {
    labels: daily.map(d => fmtDay(d.day)),
    datasets: [{
      label: 'Revenue (₹)',
      data: daily.map(d => Number(paiseToRupees(d.revenue_paise))),
      backgroundColor: 'rgba(45,198,83,0.7)', borderRadius: 4,
    }],
  }

  const topDoctors = overview.top_doctors ?? []
  const doctorBar = {
    labels: topDoctors.slice(0, 8).map(d => `Dr. ${d.name}`),
    datasets: [{ label: 'Appointments', data: topDoctors.slice(0, 8).map(d => d.total), backgroundColor: 'rgba(0,119,182,0.7)', borderRadius: 6, barThickness: 28 }],
  }

  const byCity = overview.by_city ?? []
  const cityBar = {
    labels: byCity.slice(0, 10).map(c => c.city),
    datasets: [{ label: 'Appointments', data: byCity.slice(0, 10).map(c => c.appointments), backgroundColor: 'rgba(76,201,240,0.75)', borderRadius: 6, barThickness: 24 }],
  }

  const barOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#03045E', cornerRadius: 8 } },
    scales: {
      y: { beginAtZero: true, ticks: { font: { family: 'Inter', size: 12 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
      x: { ticks: { font: { family: 'Inter', size: 11 } }, grid: { display: false } },
    },
  }
  const lineOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'top', labels: { usePointStyle: true, font: { family: 'Inter', size: 12 } } }, tooltip: { backgroundColor: '#03045E', cornerRadius: 8 } },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Inter', size: 12 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
      x: { ticks: { font: { family: 'Inter', size: 11 } }, grid: { display: false } },
    },
  }

  const kpis = [
    { label: 'Total Appointments', value: A.total, color: 'var(--primary)', bg: 'rgba(0,119,182,0.1)', icon: 'bi-calendar-check' },
    { label: 'Completed', value: A.completed, sub: `${completionRate}% completion`, color: 'var(--success)', bg: 'rgba(45,198,83,0.1)', icon: 'bi-check-circle' },
    { label: 'Cancelled', value: A.cancelled, color: 'var(--danger)', bg: 'rgba(239,35,60,0.1)', icon: 'bi-x-circle' },
    { label: 'Revenue Collected', value: money(R.collected_paise), sub: `${R.paid_count} payments`, color: '#059669', bg: 'rgba(45,198,83,0.1)', icon: 'bi-cash-stack' },
    { label: 'Pending Revenue', value: money(R.pending_paise), color: 'var(--warning)', bg: 'rgba(249,199,79,0.12)', icon: 'bi-hourglass-split' },
    { label: 'New Users', value: (overview.new_users?.patients ?? 0) + (overview.new_users?.doctors ?? 0) + (overview.new_users?.hospitals ?? 0), sub: `${overview.new_users?.patients ?? 0} patients`, color: 'var(--info)', bg: 'rgba(76,201,240,0.1)', icon: 'bi-person-plus' },
  ]

  return (
    <div id="report-root">
      {/* Header + actions */}
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--dark)', margin: 0 }}>
            Reports &amp; Analytics
          </h4>
          <p style={{ color: 'var(--gray-500)', fontSize: 14, marginTop: 4 }}>
            {fromDate} to {toDate} · {A.total} appointments
            {overview._degraded && <span style={{ color: 'var(--warning)', marginLeft: 8 }}><i className="bi bi-exclamation-triangle me-1" />Live totals only (deploy migration 026 for full analytics)</span>}
          </p>
        </div>
        <div className="d-flex gap-2 flex-wrap report-actions">
          <button className="btn-ghost" onClick={exportDetailedCSV} disabled={exporting}>
            <i className="bi bi-filetype-csv me-1" />Detailed CSV
          </button>
          <button className="btn-ghost" onClick={exportSummaryCSV}>
            <i className="bi bi-file-earmark-spreadsheet me-1" />Summary CSV
          </button>
          <button className="btn-primary-custom" onClick={downloadPDF}>
            <i className="bi bi-file-earmark-pdf me-1" />Download PDF
          </button>
        </div>
      </div>

      {/* Date range */}
      <div className="card-custom p-3 mb-4 report-filter">
        <div className="d-flex gap-2 align-items-center flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.key}
              className={`collab-status-tab ${activePreset === p.key ? 'active' : ''}`}
              onClick={() => applyPreset(p.days, p.key)}
            >
              {p.label}
            </button>
          ))}
          <span style={{ width: 1, height: 24, background: 'var(--gray-200)', margin: '0 4px' }} />
          <input type="date" className="form-input-custom" style={{ width: 150, padding: '8px 12px', fontSize: 14 }} value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)} />
          <span style={{ color: 'var(--gray-400)' }}>→</span>
          <input type="date" className="form-input-custom" style={{ width: 150, padding: '8px 12px', fontSize: 14 }} value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)} />
          <button className="btn-ghost" onClick={handleCustomFilter}>
            <i className="bi bi-funnel me-1" />Apply
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="row g-3 mb-4 stagger-children">
        {kpis.map((k, i) => (
          <div key={i} className="col-6 col-xl-2 col-lg-4">
            <div className="kpi-card">
              <div className="kpi-icon" style={{ background: k.bg, color: k.color }}>
                <i className={`bi ${k.icon}`} />
              </div>
              <div className="kpi-value" style={{ fontSize: 20 }}>{k.value}</div>
              <div className="kpi-label">{k.label}</div>
              {k.sub && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Trend + status */}
      <div className="row g-4 mb-4">
        <div className="col-lg-8">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-graph-up-arrow me-2 text-primary" />Appointment Trend
            </h6>
            <div style={{ height: 280 }}>
              {daily.length > 0 ? <Line ref={trendRef} data={trendData} options={lineOptions} />
                : <div className="d-flex align-items-center justify-content-center h-100"><p style={{ color: 'var(--gray-400)' }}>No daily data</p></div>}
            </div>
          </div>
        </div>
        <div className="col-lg-4">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-pie-chart me-2 text-primary" />Status Breakdown
            </h6>
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {A.total > 0 ? <Doughnut ref={donutRef} data={donutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14, font: { family: 'Inter', size: 12 } } } }, cutout: '65%' }} />
                : <p style={{ color: 'var(--gray-400)' }}>No data</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue by day + top doctors */}
      <div className="row g-4 mb-4">
        <div className="col-lg-7">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-cash-coin me-2 text-primary" />Revenue by Day
            </h6>
            <div style={{ height: 260 }}>
              {daily.some(d => d.revenue_paise > 0) ? <Bar ref={revenueRef} data={revenueData} options={barOptions} />
                : <div className="d-flex align-items-center justify-content-center h-100"><p style={{ color: 'var(--gray-400)' }}>No revenue in range</p></div>}
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-bar-chart me-2 text-primary" />Top Doctors
            </h6>
            <div style={{ height: 260 }}>
              {topDoctors.length > 0 ? <Bar ref={doctorsRef} data={doctorBar} options={barOptions} />
                : <div className="d-flex align-items-center justify-content-center h-100"><p style={{ color: 'var(--gray-400)' }}>No data</p></div>}
            </div>
          </div>
        </div>
      </div>

      {/* Geographic: map + city chart */}
      <div className="row g-4 mb-4">
        <div className="col-lg-7">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
              <i className="bi bi-geo-alt me-2 text-primary" />Hospital Locations ({geoPoints.length})
            </h6>
            <ReportMap points={geoPoints} height="340px" />
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card-custom p-4 h-100">
            <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 20 }}>
              <i className="bi bi-buildings me-2 text-primary" />Appointments by City
            </h6>
            <div style={{ height: 300 }}>
              {byCity.length > 0 ? <Bar ref={cityRef} data={cityBar} options={{ ...barOptions, indexAxis: 'y' }} />
                : <div className="d-flex align-items-center justify-content-center h-100"><p style={{ color: 'var(--gray-400)' }}>No geographic data</p></div>}
            </div>
          </div>
        </div>
      </div>

      {/* Doctor-wise table */}
      {topDoctors.length > 0 && (
        <div className="card-custom p-4 mb-4">
          <h6 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 16 }}>
            <i className="bi bi-table me-2 text-primary" />Doctor-wise Summary
          </h6>
          <div className="table-responsive">
            <table className="table-custom">
              <thead>
                <tr><th>Doctor</th><th>Specialization</th><th>Total</th><th>Completed</th><th>Cancelled</th></tr>
              </thead>
              <tbody>
                {topDoctors.map((d, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>Dr. {d.name}</td>
                    <td style={{ color: 'var(--gray-500)' }}>{d.specialization || '—'}</td>
                    <td>{d.total}</td>
                    <td style={{ color: 'var(--success)' }}>{d.completed}</td>
                    <td style={{ color: 'var(--danger)' }}>{d.cancelled ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
