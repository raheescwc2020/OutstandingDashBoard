
import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer
} from "recharts";

/* ─── THEME ─────────────────────────────────────────────────────── */
const T = {
  bg:    "#070d1a",
  bg2:   "#0c1424",
  bg3:   "#101d32",
  card:  "#0f1829",
  border:"#1a2b47",
  b2:    "#243c60",
  text:  "#dce8ff",
  t2:    "#7a9cc8",
  t3:    "#3a5070",
  accent:"#2f7de1",
  a2:    "#5b9ef7",
  a3:    "#93c4fd",
  gold:  "#f0a429",
  red:   "#e84848",
  green: "#1abf8a",
  teal:  "#0ec4b0",
  pur:   "#8b67f0",
};
const PAL = ["#2f7de1","#1abf8a","#f0a429","#e84848","#8b67f0","#0ec4b0","#f97316","#ec4899","#06b6d4","#84cc16","#a78bfa","#34d399","#fbbf24","#f87171","#60a5fa","#2dd4bf","#fb923c"];

/* ─── UTILS ──────────────────────────────────────────────────────── */
const fi  = v => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
const fs  = v => {
  const n = Number(v) || 0;
  if (n >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
  if (n >= 1e5) return "₹" + (n / 1e5).toFixed(1) + " L";
  return "₹" + Math.round(n).toLocaleString("en-IN");
};
const getFY = dt => {
  if (!dt || isNaN(dt)) return "Unknown";
  const m = dt.getMonth() + 1, y = dt.getFullYear();
  return m >= 4 ? `FY ${y}-${String(y + 1).slice(2)}` : `FY ${y - 1}-${String(y).slice(2)}`;
};
const cleanName = s => String(s || "").replace(/\s*\(\d+\)\s*$/, "").trim();
const parseDate = raw => {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === "number") {
    // Excel serial -> use UTC date parts to avoid timezone shift (IST +5:30 shifts midnight back 1 day)
    const utc = new Date((raw - 25569) * 86400 * 1000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }
  const s = String(raw);
  const parts = s.split(/[/-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number);
    // dd/mm/yyyy
    if (a <= 31 && b <= 12 && c > 1000) return new Date(c, b - 1, a);
    // mm/dd/yyyy
    if (b <= 31 && a <= 12 && c > 1000) return new Date(c, a - 1, b);
    return new Date(a, b - 1, c);
  }
  return new Date(s);
};

/* ─── PARSE XLSX ─────────────────────────────────────────────────── */
function parseWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Find header row — look for "Sr" or "Branch" in first few cols, fallback to row 2
  let hdrRow = raw.findIndex(r =>
    String(r[0]).toLowerCase().includes("sr") ||
    String(r[2]).toLowerCase().includes("branch") ||
    String(r[1]).toLowerCase().includes("region")
  );
  if (hdrRow < 0) hdrRow = 2; // fallback: assume row 3 is header (0-indexed row 2)
  const rows = raw.slice(hdrRow + 1);
  const data = [];
  rows.forEach(r => {
    const sn = Number(r[0]);
    if (!sn || isNaN(sn)) return;
    const dt = parseDate(r[7]);
    data.push({
      srNo:        sn,
      region:      String(r[1] || ""),
      branch:      cleanName(r[2]),
      party:       cleanName(r[3]),
      invoiceNo:   String(r[4] || ""),
      invoiceDate: dt,
      invoiceType: String(r[8] || ""),
      billAmt:     Number(r[9]) || 0,
      paidAmt:     Number(r[10]) || 0,
      outstanding: Number(r[11]) || 0,
      reason:      String(r[12] || ""),
      fy:          getFY(dt),
    });
  });
  return data;
}

/* ─── AGGREGATIONS ───────────────────────────────────────────────── */
function aggregate(data) {
  const byBranch = {}, byParty = {}, byFY = {}, byType = {}, byMonth = {};
  data.forEach(r => {
    // branch
    if (!byBranch[r.branch]) byBranch[r.branch] = { o: 0, bill: 0, n: 0 };
    byBranch[r.branch].o += r.outstanding;
    byBranch[r.branch].bill += r.billAmt;
    byBranch[r.branch].n++;
    // party
    if (!byParty[r.party]) byParty[r.party] = { o: 0, n: 0, byFY: {} };
    byParty[r.party].o += r.outstanding;
    byParty[r.party].n++;
    byParty[r.party].byFY[r.fy] = (byParty[r.party].byFY[r.fy] || 0) + r.outstanding;
    // fy
    if (!byFY[r.fy]) byFY[r.fy] = { o: 0, bill: 0, n: 0 };
    byFY[r.fy].o += r.outstanding;
    byFY[r.fy].bill += r.billAmt;
    byFY[r.fy].n++;
    // type
    if (!byType[r.invoiceType]) byType[r.invoiceType] = 0;
    byType[r.invoiceType] += r.outstanding;
    // monthly
    if (r.invoiceDate) {
      const key = r.invoiceDate.toISOString().slice(0, 7);
      if (!byMonth[key]) byMonth[key] = 0;
      byMonth[key] += r.outstanding;
    }
  });

  const branches = Object.entries(byBranch).map(([b, v]) => ({ b, ...v })).sort((a, b) => b.o - a.o);
  const parties  = Object.entries(byParty).map(([p, v]) => ({ p, ...v })).sort((a, b) => b.o - a.o);
  const fys      = Object.entries(byFY).map(([fy, v]) => ({ fy, ...v })).sort((a, b) => a.fy.localeCompare(b.fy));
  const types    = Object.entries(byType).map(([t, o]) => ({ t, o })).sort((a, b) => b.o - a.o);
  const monthly  = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
    m: new Date(k + "-01").toLocaleString("en-IN", { month: "short", year: "2-digit" }),
    v
  }));
  const total = data.reduce((s, r) => s + r.outstanding, 0);

  // party pie: top 7 + others
  const top7p = parties.slice(0, 7);
  const othersP = parties.slice(7).reduce((s, r) => s + r.o, 0);
  const partyPie = [...top7p.map((r, i) => ({ name: r.p.length > 22 ? r.p.slice(0, 22) + "…" : r.p, value: r.o, color: PAL[i] })), { name: "Others", value: othersP, color: "#374151" }];

  // branch pie: top 7 + others
  const top7b = branches.slice(0, 7);
  const othersB = branches.slice(7).reduce((s, r) => s + r.o, 0);
  const branchPie = [...top7b.map((r, i) => ({ name: r.b.replace("CW ", "").replace("CWC ", ""), value: r.o, color: PAL[i] })), { name: "Others", value: othersB, color: "#374151" }];

  return { branches, parties, fys, types, monthly, total, partyPie, branchPie };
}

/* ─── COMPONENTS ─────────────────────────────────────────────────── */

const TT = ({ active, payload, label, fmtVal = fs }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.b2}`, borderRadius: 8, padding: "10px 14px", fontSize: 11 }}>
      <div style={{ color: T.t2, marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || T.text, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: p.color || T.accent }} />
          <span style={{ color: T.t2 }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{fmtVal(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const Card = ({ children, style = {} }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>
);

const CardTitle = ({ children, color = T.accent }) => (
  <div style={{ fontSize: 10, fontWeight: 700, color: T.t2, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: color }} />
    {children}
  </div>
);

const KPI = ({ val, lbl, sub, color }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", borderBottom: `2px solid ${color}`, flex: 1, minWidth: 140 }}>
    <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", marginBottom: 2 }}>{val}</div>
    <div style={{ fontSize: 10, fontWeight: 600, color: T.t2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{lbl}</div>
    {sub && <div style={{ fontSize: 10, color: T.t3, marginTop: 2 }}>{sub}</div>}
  </div>
);

const InlineBar = ({ val, max, color = T.accent }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 90 }}>
    <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${(val / max * 100).toFixed(1)}%`, height: "100%", background: color, borderRadius: 2 }} />
    </div>
    <span style={{ fontSize: 9, color: T.t3, minWidth: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
      {(val / max * 100).toFixed(1)}%
    </span>
  </div>
);

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={600}>{`${(percent * 100).toFixed(1)}%`}</text>;
}

/* ─── UPLOAD SCREEN ──────────────────────────────────────────────── */
function UploadScreen({ onData }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef();

  const handle = file => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls"].includes(ext)) { setError("Please upload an Excel file (.xlsx or .xls)"); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const rows = parseWorkbook(wb);
        if (!rows.length) { setError("No invoice data found. Check the file format."); return; }
        onData(rows, file.name);
      } catch (err) { setError("Failed to parse file: " + err.message); }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ width: 480, textAlign: "center" }}>
        {/* Logo / title */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.text, marginBottom: 6 }}>Outstanding Invoice</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.a2, marginBottom: 12 }}>Dashboard</div>
          <div style={{ fontSize: 13, color: T.t2 }}>Upload your Excel report to generate a full interactive dashboard with branch-wise, party-wise, and financial year analytics.</div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]); }}
          onClick={() => ref.current.click()}
          style={{
            border: `2px dashed ${dragging ? T.accent : T.b2}`,
            borderRadius: 16, padding: "40px 24px", cursor: "pointer",
            background: dragging ? "rgba(47,125,225,0.06)" : T.card,
            transition: "all .2s", marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 6 }}>Drag & drop your Excel file here</div>
          <div style={{ fontSize: 12, color: T.t2, marginBottom: 16 }}>or click to browse</div>
          <div style={{ display: "inline-block", padding: "8px 20px", background: T.accent, borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#fff" }}>
            Choose File
          </div>
          <div style={{ marginTop: 12, fontSize: 10, color: T.t3 }}>Supports .xlsx · .xls — Outstanding Invoice Report format</div>
        </div>
        <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => handle(e.target.files[0])} />
        {error && <div style={{ color: T.red, fontSize: 12, marginTop: 8, background: "rgba(232,72,72,0.1)", border: `1px solid ${T.red}`, borderRadius: 8, padding: "8px 12px" }}>{error}</div>}

        {/* Upload screen footer */}
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${T.border}` }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(47,125,225,0.07)", border: `1px solid ${T.border}`,
            borderRadius: 10, padding: "10px 18px",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: T.teal, boxShadow: `0 0 7px ${T.teal}`,
            }} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 10, color: T.t3, marginBottom: 2 }}>© 2026 · All rights reserved</div>
              <div style={{ fontSize: 10, color: T.t2 }}>
                Developed & Deployed by{" "}
                <span style={{ color: T.a2, fontWeight: 700 }}>Rahees Mohammed R</span>
              </div>
              <div style={{ fontSize: 9.5, color: T.t3, marginTop: 1 }}>
                Project Manager · Central Warehousing Corporation
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── SIDEBAR ────────────────────────────────────────────────────── */
const MENU = [
  { id: "overview",  icon: "⚡", label: "Overview" },
  { id: "branch",    icon: "🏢", label: "Branch-wise" },
  { id: "party",     icon: "🤝", label: "Party-wise" },
  { id: "fy",        icon: "📅", label: "Financial Year" },
  { id: "trend",     icon: "📈", label: "Trend & Type" },
  { id: "list",      icon: "📋", label: "Outstanding List" },
];

function Sidebar({ active, setActive, fileName, onReset }) {
  return (
    <div style={{ width: 210, minHeight: "100vh", background: T.bg2, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Brand */}
      <div style={{ padding: "18px 16px 14px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
          <span style={{ color: T.a2 }}>RO</span> Outstanding
        </div>
        <div style={{ fontSize: 9, color: T.t3, marginTop: 3, lineHeight: 1.4, wordBreak: "break-all" }}>{fileName}</div>
      </div>
      {/* Nav */}
      <nav style={{ flex: 1, padding: "10px 8px" }}>
        {MENU.map(m => (
          <button
            key={m.id}
            onClick={() => setActive(m.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "9px 12px", borderRadius: 8, marginBottom: 2, border: "none", cursor: "pointer",
              background: active === m.id ? "rgba(47,125,225,0.15)" : "transparent",
              color: active === m.id ? T.a2 : T.t2,
              fontSize: 12, fontWeight: active === m.id ? 600 : 400,
              borderLeft: active === m.id ? `3px solid ${T.accent}` : "3px solid transparent",
              transition: "all .15s", textAlign: "left",
            }}
          >
            <span style={{ fontSize: 14 }}>{m.icon}</span> {m.label}
          </button>
        ))}
      </nav>
      {/* Reset */}
      <div style={{ padding: "12px 8px", borderTop: `1px solid ${T.border}` }}>
        <button onClick={onReset} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.t3, fontSize: 11, cursor: "pointer", transition: "all .15s" }}
          onMouseEnter={e => e.target.style.color = T.red}
          onMouseLeave={e => e.target.style.color = T.t3}
        >⬆ Upload new file</button>
      </div>
      {/* Footer */}
      <div style={{
        padding: "14px 14px 16px",
        borderTop: `1px solid ${T.border}`,
        background: "rgba(0,0,0,0.2)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 5, marginBottom: 7,
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 4,
            background: `linear-gradient(135deg, ${T.accent}, ${T.teal})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, flexShrink: 0,
          }}>©</div>
          <span style={{ fontSize: 9, fontWeight: 600, color: T.t2, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Copyright 2026
          </span>
        </div>
        <div style={{
          fontSize: 9, color: T.t3, lineHeight: 1.65,
          paddingLeft: 2,
        }}>
          <div style={{ color: T.t2, fontWeight: 500, marginBottom: 2 }}>All rights reserved.</div>
          <div style={{ marginBottom: 5, color: T.t3 }}>
            Developed & Deployed by
          </div>
          <div style={{
            background: `linear-gradient(135deg, rgba(47,125,225,0.12), rgba(14,196,176,0.08))`,
            border: `1px solid ${T.border}`,
            borderRadius: 6, padding: "7px 9px",
          }}>
            <div style={{ color: T.a2, fontWeight: 700, fontSize: 10, marginBottom: 2 }}>
              Rahees Mohammed R
            </div>
            <div style={{ color: T.t2, fontSize: 9, fontWeight: 500, marginBottom: 1 }}>
              Project Manager
            </div>
            <div style={{
              color: T.t3, fontSize: 8.5, lineHeight: 1.5,
              borderTop: `1px solid ${T.border}`, marginTop: 4, paddingTop: 4,
            }}>
              Central Warehousing<br />Corporation
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── OVERVIEW PAGE ──────────────────────────────────────────────── */
function OverviewPage({ data, agg }) {
  const { branches, parties, fys, types, total, partyPie } = agg;
  const topBranch = branches[0];
  const topParty  = parties[0];

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <KPI val={fs(total)} lbl="Total Outstanding" sub={`${data.length} invoices · all branches`} color={T.accent} />
        <KPI val={fs(fys.find(f => f.fy.includes("2025-26"))?.o || 0)} lbl="FY 2025-26" sub="Current financial year" color={T.red} />
        <KPI val={fs(topBranch?.o || 0)} lbl="Top Branch" sub={topBranch?.b || ""} color={T.gold} />
        <KPI val={fs(topParty?.o || 0)} lbl="Top Party" sub={`${topParty?.p?.slice(0, 28) || ""} (${topParty?.n || 0} inv)`} color={T.green} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Branch bar */}
        <Card>
          <CardTitle>Branch-wise outstanding</CardTitle>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={branches.slice(0, 12)} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="b" tick={{ fill: T.t2, fontSize: 8 }} width={130} axisLine={false} tickLine={false} tickFormatter={v => v.replace("CW ", "").replace("CWC ", "").slice(0, 18)} />
              <Tooltip content={<TT />} />
              <Bar dataKey="o" name="Outstanding" radius={[0, 3, 3, 0]}>
                {branches.slice(0, 12).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Party pie */}
        <Card>
          <CardTitle>Top parties vs others</CardTitle>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={partyPie} cx="45%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {partyPie.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* FY bar */}
        <Card>
          <CardTitle color={T.pur}>Financial Year comparison</CardTitle>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fys} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="fy" tick={{ fill: T.t2, fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
              <Bar dataKey="o" name="Outstanding" fill={T.red} radius={[4, 4, 0, 0]} />
              <Bar dataKey="bill" name="Billed" fill="rgba(47,125,225,0.35)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Type pie */}
        <Card>
          <CardTitle color={T.teal}>Invoice type split</CardTitle>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={types.map((t, i) => ({ ...t, name: t.t, value: t.o, color: PAL[i] }))} cx="45%" cy="50%" outerRadius={80} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {types.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

/* ─── BRANCH PAGE ────────────────────────────────────────────────── */
function BranchPage({ agg }) {
  const { branches, branchPie } = agg;
  const max = branches[0]?.o || 1;
  const total = branches.reduce((s, r) => s + r.o, 0);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <CardTitle>Outstanding by branch</CardTitle>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={branches} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="b" tick={{ fill: T.t2, fontSize: 8 }} width={140} axisLine={false} tickLine={false} tickFormatter={v => v.replace("CW ", "").replace("CWC ", "").slice(0, 20)} />
              <Tooltip content={<TT />} />
              <Bar dataKey="o" name="Outstanding" radius={[0, 3, 3, 0]}>
                {branches.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CardTitle>Branch share</CardTitle>
          <ResponsiveContainer width="100%" height={340}>
            <PieChart>
              <Pie data={branchPie} cx="45%" cy="48%" innerRadius={60} outerRadius={110} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {branchPie.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card>
        <CardTitle>Branch-wise outstanding table</CardTitle>
        <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {["#", "Branch", "Bill Amt (₹)", "Paid Amt (₹)", "Outstanding (₹)", "Invoices", "Collection %", "Share"].map((h, i) => (
                  <th key={i} style={{ background: T.bg3, color: T.t2, padding: "7px 10px", textAlign: i > 1 ? "right" : "left", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: `1px solid ${T.b2}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branches.map((r, i) => {
                const paid = r.bill - r.o;
                const coll = r.bill > 0 ? (paid / r.bill * 100).toFixed(1) : "—";
                const cc = parseFloat(coll) > 80 ? T.green : parseFloat(coll) > 50 ? T.gold : T.red;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid rgba(26,43,71,0.4)` }}>
                    <td style={{ padding: "6px 10px", color: T.t3 }}>{i + 1}</td>
                    <td style={{ padding: "6px 10px", color: T.text }}>{r.b}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(r.bill)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(paid)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: T.a3, fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(r.o)}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>{r.n}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", color: cc, fontWeight: 600 }}>{coll}%</td>
                    <td style={{ padding: "6px 10px", minWidth: 100 }}><InlineBar val={r.o} max={max} color={PAL[i % PAL.length]} /></td>
                  </tr>
                );
              })}
              <tr style={{ background: "rgba(47,125,225,0.07)", fontWeight: 700 }}>
                <td style={{ padding: "7px 10px" }} colSpan={2}><span style={{ color: T.a3 }}>TOTAL</span></td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: T.a3, fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(branches.reduce((s, r) => s + r.bill, 0))}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: T.a3, fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(branches.reduce((s, r) => s + r.bill - r.o, 0))}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: T.a3, fontVariantNumeric: "tabular-nums", fontSize: 10 }}>{fi(total)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: T.a3 }}>{branches.reduce((s, r) => s + r.n, 0)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ─── PARTY PAGE ─────────────────────────────────────────────────── */
function PartyPage({ agg }) {
  const { parties, partyPie, fys } = agg;
  const fyKeys = fys.map(f => f.fy);
  const max = parties[0]?.o || 1;
  const total = parties.reduce((s, r) => s + r.o, 0);
  const fyColors = { "FY 2022-23": T.pur, "FY 2023-24": T.teal, "FY 2024-25": T.gold, "FY 2025-26": T.red };

  // FY26 pie
  const fy26Sorted = [...parties].sort((a, b) => (b.byFY["FY 2025-26"] || 0) - (a.byFY["FY 2025-26"] || 0));
  const top8_26 = fy26Sorted.slice(0, 8);
  const others26 = fy26Sorted.slice(8).reduce((s, r) => s + (r.byFY["FY 2025-26"] || 0), 0);
  const pie26 = [...top8_26.map((r, i) => ({ name: r.p.length > 20 ? r.p.slice(0, 20) + "…" : r.p, value: r.byFY["FY 2025-26"] || 0, color: PAL[i] })), { name: "Others", value: others26, color: "#374151" }];

  // stacked bar top 10
  const top10 = parties.slice(0, 10).map(r => ({ name: r.p.length > 22 ? r.p.slice(0, 22) + "…" : r.p, ...Object.fromEntries(fyKeys.map(k => [k, r.byFY[k] || 0])) }));

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <CardTitle>Top parties — all years (donut)</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={partyPie} cx="45%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {partyPie.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CardTitle>FY 2025-26 — top 8 vs others</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pie26} cx="45%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {pie26.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card style={{ marginBottom: 14 }}>
        <CardTitle>Top 10 parties — FY stacked bar</CardTitle>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={top10} margin={{ left: 10, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="name" tick={{ fill: T.t2, fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
            <Tooltip content={<TT />} />
            <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            {fyKeys.map(fy => <Bar key={fy} dataKey={fy} stackId="s" fill={fyColors[fy] || T.accent} radius={fy === fyKeys[fyKeys.length - 1] ? [3, 3, 0, 0] : [0, 0, 0, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <CardTitle>Party-wise outstanding with FY breakup</CardTitle>
        <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Party Name</th>
                {fyKeys.map(k => <th key={k} style={th}>{k.replace("FY ", "FY ")}</th>)}
                <th style={th}>Total (₹)</th>
                <th style={th}>Inv</th>
                <th style={th}>Share</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid rgba(26,43,71,0.4)` }}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left", maxWidth: 200, whiteSpace: "normal" }}>{r.p}</td>
                  {fyKeys.map(k => <td key={k} style={td}>{r.byFY[k] > 0 ? <span style={{ color: T.text }}>{fi(r.byFY[k])}</span> : <span style={{ color: T.t3 }}>—</span>}</td>)}
                  <td style={{ ...td, fontWeight: 700, color: T.a3 }}>{fi(r.o)}</td>
                  <td style={td}>{r.n}</td>
                  <td style={{ ...td, minWidth: 90 }}><InlineBar val={r.o} max={max} color={PAL[i % PAL.length]} /></td>
                </tr>
              ))}
              <tr style={{ background: "rgba(47,125,225,0.07)", fontWeight: 700 }}>
                <td style={{ ...td }} colSpan={2}><span style={{ color: T.a3 }}>GRAND TOTAL</span></td>
                {fyKeys.map(k => <td key={k} style={{ ...td, color: T.a3 }}>{fi(agg.fys.find(f => f.fy === k)?.o || 0)}</td>)}
                <td style={{ ...td, color: T.a3 }}>{fi(total)}</td>
                <td style={{ ...td, color: T.a3 }}>{parties.reduce((s, r) => s + r.n, 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const th = { background: T.bg3, color: T.t2, padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", position: "sticky", top: 0, whiteSpace: "nowrap", borderBottom: `1px solid ${T.b2}`, zIndex: 2 };
const td = { padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 10, color: T.text };

/* ─── FY PAGE ────────────────────────────────────────────────────── */
function FYPage({ agg }) {
  const { fys, parties } = agg;
  const total = fys.reduce((s, r) => s + r.o, 0);
  const fyColors = ["#8b67f0", "#0ec4b0", "#f0a429", "#e84848"];

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <CardTitle>Outstanding vs billed by FY</CardTitle>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={fys} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
              <XAxis dataKey="fy" tick={{ fill: T.t2, fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
              <Bar dataKey="o" name="Outstanding" fill={T.red} radius={[4, 4, 0, 0]} />
              <Bar dataKey="bill" name="Billed" fill="rgba(47,125,225,0.35)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CardTitle>FY distribution</CardTitle>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={fys.map((f, i) => ({ name: f.fy, value: f.o, color: fyColors[i] }))} cx="45%" cy="50%" innerRadius={55} outerRadius={100} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {fys.map((_, i) => <Cell key={i} fill={fyColors[i]} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card style={{ marginBottom: 14 }}>
        <CardTitle>FY-wise summary</CardTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>{["Financial Year", "Bill Amount (₹)", "Outstanding (₹)", "Invoices", "Collection %", "Share"].map((h, i) => (
              <th key={i} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {fys.map((r, i) => {
              const coll = r.bill > 0 ? ((r.bill - r.o) / r.bill * 100).toFixed(1) : "—";
              const cc = parseFloat(coll) > 85 ? T.green : parseFloat(coll) > 50 ? T.gold : T.red;
              return (
                <tr key={i} style={{ borderBottom: `1px solid rgba(26,43,71,0.4)` }}>
                  <td style={{ ...td, textAlign: "left", color: T.text, fontWeight: 600 }}>{r.fy}</td>
                  <td style={td}>{fi(r.bill)}</td>
                  <td style={{ ...td, fontWeight: 700, color: T.a3 }}>{fi(r.o)}</td>
                  <td style={td}>{r.n}</td>
                  <td style={{ ...td, color: cc, fontWeight: 600 }}>{coll}%</td>
                  <td style={{ ...td, minWidth: 100 }}><InlineBar val={r.o} max={total} color={fyColors[i]} /></td>
                </tr>
              );
            })}
            <tr style={{ background: "rgba(47,125,225,0.07)", fontWeight: 700 }}>
              <td style={{ ...td, textAlign: "left", color: T.a3 }}>TOTAL</td>
              <td style={{ ...td, color: T.a3 }}>{fi(fys.reduce((s, r) => s + r.bill, 0))}</td>
              <td style={{ ...td, color: T.a3 }}>{fi(total)}</td>
              <td style={{ ...td, color: T.a3 }}>{fys.reduce((s, r) => s + r.n, 0)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </Card>

      {fys.slice().reverse().map((f, revIdx) => {
        const origIdx = fys.indexOf(f);
        const fyParties = parties.filter(p => (p.byFY[f.fy] || 0) > 0).map(p => ({ ...p, fyO: p.byFY[f.fy] || 0 })).sort((a, b) => b.fyO - a.fyO);
        const fyTotal = f.o;
        const maxFy = fyParties[0]?.fyO || 1;
        if (!fyParties.length) return null;
        return (
          <Card key={f.fy} style={{ marginBottom: 14 }}>
            <CardTitle color={fyColors[origIdx]}>{f.fy} — party breakdown · {fi(fyTotal)} total</CardTitle>
            <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr>
                  {["#", "Party Name", "Outstanding (₹)", "Invoices", "Share of FY"].map((h, i) => (
                    <th key={i} style={{ ...th, textAlign: i <= 1 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {fyParties.map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid rgba(26,43,71,0.4)` }}>
                      <td style={{ ...td, textAlign: "left", color: T.t3 }}>{i + 1}</td>
                      <td style={{ ...td, textAlign: "left", color: T.text, maxWidth: 220, whiteSpace: "normal" }}>{r.p}</td>
                      <td style={{ ...td, fontWeight: 700, color: T.a3 }}>{fi(r.fyO)}</td>
                      <td style={td}>{r.n}</td>
                      <td style={{ ...td, minWidth: 120 }}><InlineBar val={r.fyO} max={maxFy} color={fyColors[origIdx]} /></td>
                    </tr>
                  ))}
                  <tr style={{ background: "rgba(47,125,225,0.07)" }}>
                    <td colSpan={2} style={{ ...td, textAlign: "left", color: T.a3, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...td, color: T.a3, fontWeight: 700 }}>{fi(fyTotal)}</td>
                    <td style={{ ...td, color: T.a3 }}>{fyParties.reduce((s, r) => s + r.n, 0)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── TREND PAGE ─────────────────────────────────────────────────── */
function TrendPage({ agg }) {
  const { monthly, types } = agg;
  return (
    <div style={{ padding: 20 }}>
      <Card style={{ marginBottom: 14 }}>
        <CardTitle>Monthly outstanding trend</CardTitle>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={monthly} margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
            <XAxis dataKey="m" tick={{ fill: T.t2, fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
            <Tooltip content={<TT />} />
            <Line type="monotone" dataKey="v" name="Outstanding" stroke={T.accent} strokeWidth={2} dot={{ r: 3, fill: T.accent, strokeWidth: 1, stroke: T.bg }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <CardTitle color={T.teal}>Invoice type — donut</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={types.map((t, i) => ({ name: t.t, value: t.o, color: PAL[i] }))} cx="45%" cy="48%" innerRadius={55} outerRadius={100} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {types.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
              </Pie>
              <Tooltip content={<TT />} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: T.t2, fontSize: 9 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CardTitle color={T.gold}>Invoice type — bar</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={types} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: T.t2, fontSize: 9 }} tickFormatter={fs} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="t" tick={{ fill: T.t2, fontSize: 9 }} width={130} axisLine={false} tickLine={false} />
              <Tooltip content={<TT />} />
              <Bar dataKey="o" name="Outstanding" radius={[0, 3, 3, 0]}>
                {types.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

/* ─── OUTSTANDING LIST PAGE ──────────────────────────────────────── */
function ListPage({ data }) {
  const [search, setSearch]   = useState("");
  const [branchF, setBranchF] = useState("All");
  const [fyF, setFyF]         = useState("All");
  const [typeF, setTypeF]     = useState("All");
  const [sort, setSort]       = useState({ key: "outstanding", dir: -1 });
  const [page, setPage]       = useState(1);
  const PER_PAGE = 30;

  const branches  = useMemo(() => ["All", ...Array.from(new Set(data.map(r => r.branch))).sort()], [data]);
  const fys       = useMemo(() => ["All", ...Array.from(new Set(data.map(r => r.fy))).sort()], [data]);
  const types     = useMemo(() => ["All", ...Array.from(new Set(data.map(r => r.invoiceType))).sort()], [data]);

  const filtered = useMemo(() => {
    let d = data;
    if (branchF !== "All") d = d.filter(r => r.branch === branchF);
    if (fyF !== "All")     d = d.filter(r => r.fy === fyF);
    if (typeF !== "All")   d = d.filter(r => r.invoiceType === typeF);
    if (search) {
      const s = search.toLowerCase();
      d = d.filter(r => r.party.toLowerCase().includes(s) || r.invoiceNo.toLowerCase().includes(s) || r.branch.toLowerCase().includes(s));
    }
    d = [...d].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return d;
  }, [data, search, branchF, fyF, typeF, sort]);

  const pages  = Math.ceil(filtered.length / PER_PAGE);
  const paged  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totOut = filtered.reduce((s, r) => s + r.outstanding, 0);

  const sortBy = key => setSort(s => ({ key, dir: s.key === key ? -s.dir : -1 }));
  const sortIcon = k => sort.key === k ? <span style={{ color: T.accent, marginLeft: 2 }}>{sort.dir === -1 ? "↓" : "↑"}</span> : null;

  const sel = { background: T.bg3, border: `1px solid ${T.border}`, color: T.text, padding: "5px 10px", borderRadius: 6, fontSize: 11, outline: "none" };
  const inp = { ...sel, flex: 1, minWidth: 160 };

  return (
    <div style={{ padding: 20 }}>
      {/* Filters */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input style={inp} placeholder="Search party, invoice, branch…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <select style={sel} value={branchF} onChange={e => { setBranchF(e.target.value); setPage(1); }}>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
          <select style={sel} value={fyF} onChange={e => { setFyF(e.target.value); setPage(1); }}>
            {fys.map(f => <option key={f}>{f}</option>)}
          </select>
          <select style={sel} value={typeF} onChange={e => { setTypeF(e.target.value); setPage(1); }}>
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
          <div style={{ marginLeft: "auto", fontSize: 11, color: T.t2 }}>
            <span style={{ color: T.a3, fontWeight: 700 }}>{filtered.length}</span> records · <span style={{ color: T.gold, fontWeight: 700 }}>{fs(totOut)}</span> outstanding
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                {[
                  ["#", null], ["Branch", "branch"], ["Party", "party"], ["Invoice No.", "invoiceNo"],
                  ["Date", "invoiceDate"], ["FY", "fy"], ["Type", "invoiceType"],
                  ["Bill Amt", "billAmt"], ["Paid", "paidAmt"], ["Outstanding", "outstanding"], ["Reason", null]
                ].map(([h, k], i) => (
                  <th key={i} onClick={k ? () => sortBy(k) : undefined}
                    style={{ ...th, textAlign: i >= 7 ? "right" : "left", cursor: k ? "pointer" : "default", userSelect: "none" }}>
                    {h}{k && sortIcon(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid rgba(26,43,71,0.4)` }}>
                  <td style={{ ...td, textAlign: "left", color: T.t3 }}>{(page - 1) * PER_PAGE + i + 1}</td>
                  <td style={{ ...td, textAlign: "left", color: T.text, maxWidth: 120, whiteSpace: "normal" }}>{r.branch}</td>
                  <td style={{ ...td, textAlign: "left", color: T.text, maxWidth: 160, whiteSpace: "normal" }}>{r.party}</td>
                  <td style={{ ...td, textAlign: "left", color: T.t2 }}>{r.invoiceNo}</td>
                  <td style={{ ...td, textAlign: "left", color: T.t2 }}>{r.invoiceDate ? r.invoiceDate.toLocaleDateString("en-IN") : "—"}</td>
                  <td style={{ ...td, textAlign: "left" }}><span style={{ background: "rgba(47,125,225,0.12)", color: T.a3, padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600 }}>{r.fy}</span></td>
                  <td style={{ ...td, textAlign: "left", color: T.t2, fontSize: 9, maxWidth: 100, whiteSpace: "normal" }}>{r.invoiceType}</td>
                  <td style={{ ...td, color: T.text }}>{fi(r.billAmt)}</td>
                  <td style={{ ...td, color: T.green }}>{fi(r.paidAmt)}</td>
                  <td style={{ ...td, fontWeight: 700, color: r.outstanding > 0 ? T.red : T.green }}>{fi(r.outstanding)}</td>
                  <td style={{ ...td, textAlign: "left", color: T.t3, fontSize: 9, maxWidth: 180, whiteSpace: "normal" }}>{r.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{ padding: "4px 10px", background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 6, color: T.t2, fontSize: 10, cursor: "pointer" }}>‹ Prev</button>
            {Array.from({ length: Math.min(pages, 9) }, (_, i) => {
              const p = pages <= 9 ? i + 1 : page <= 5 ? i + 1 : page >= pages - 4 ? pages - 8 + i : page - 4 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  style={{ padding: "4px 9px", background: p === page ? T.accent : T.bg3, border: `1px solid ${p === page ? T.accent : T.border}`, borderRadius: 6, color: p === page ? "#fff" : T.t2, fontSize: 10, cursor: "pointer" }}>{p}</button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              style={{ padding: "4px 10px", background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 6, color: T.t2, fontSize: 10, cursor: "pointer" }}>Next ›</button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── MAIN APP ───────────────────────────────────────────────────── */
export default function App() {
  const [rawData,   setRawData]   = useState(null);
  const [fileName,  setFileName]  = useState("");
  const [activePage, setActivePage] = useState("overview");

  const agg = useMemo(() => rawData ? aggregate(rawData) : null, [rawData]);

  const handleData = (rows, name) => {
    setRawData(rows);
    setFileName(name);
    setActivePage("overview");
  };

  if (!rawData) return <UploadScreen onData={handleData} />;

  const pages = {
    overview: <OverviewPage data={rawData} agg={agg} />,
    branch:   <BranchPage agg={agg} />,
    party:    <PartyPage agg={agg} />,
    fy:       <FYPage agg={agg} />,
    trend:    <TrendPage agg={agg} />,
    list:     <ListPage data={rawData} />,
  };

  const pgTitle = { overview: "Overview", branch: "Branch-wise", party: "Party-wise", fy: "Financial Year", trend: "Trend & Type", list: "Outstanding List" };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: "'DM Sans', sans-serif", color: T.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; background: #070d1a; }
        body { font-family: 'DM Sans', sans-serif; color: #dce8ff; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0c1424; }
        ::-webkit-scrollbar-thumb { background: #1a2b47; border-radius: 3px; }
        select option { background: #0c1424; }
        @keyframes fadein { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .page-anim { animation: fadein 0.25s ease; }
        a { color: inherit; text-decoration: none; }
      `}</style>

      <Sidebar active={activePage} setActive={setActivePage} fileName={fileName} onReset={() => { setRawData(null); setFileName(""); }} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Top bar */}
        <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,15,30,0.95)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${T.border}`, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{pgTitle[activePage]}</span>
            <span style={{ fontSize: 10, color: T.t3, marginLeft: 10 }}>RO KOCHI Outstanding Report</span>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: T.t2 }}>
            <span><span style={{ color: T.a3, fontWeight: 700 }}>{rawData.length}</span> records</span>
            <span><span style={{ color: T.gold, fontWeight: 700 }}>{fs(agg.total)}</span> outstanding</span>
          </div>
        </div>

        {/* Page content */}
        <div className="page-anim" key={activePage}>
          {pages[activePage]}
        </div>

        {/* Bottom footer bar */}
        <div style={{
          borderTop: `1px solid ${T.border}`,
          background: "rgba(7,13,26,0.95)",
          padding: "10px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 5,
              background: `linear-gradient(135deg, ${T.accent}, ${T.teal})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0,
            }}>©</div>
            <span style={{ fontSize: 10, color: T.t3 }}>
              Copyright 2026 · All rights reserved
            </span>
            <span style={{
              display: "inline-block", width: 1, height: 12,
              background: T.border, margin: "0 2px",
            }} />
            <span style={{ fontSize: 10, color: T.t2 }}>
              Outstanding Invoice Dashboard · RO KOCHI
            </span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(47,125,225,0.07)",
            border: `1px solid ${T.border}`,
            borderRadius: 8, padding: "5px 12px",
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: T.teal,
              boxShadow: `0 0 6px ${T.teal}`,
            }} />
            <span style={{ fontSize: 10, color: T.t2 }}>
              Developed & Deployed by{" "}
              <span style={{ color: T.a2, fontWeight: 700 }}>Rahees Mohammed R</span>
              <span style={{ color: T.t3, margin: "0 5px" }}>·</span>
              <span style={{ color: T.t2 }}>Project Manager</span>
              <span style={{ color: T.t3, margin: "0 5px" }}>·</span>
              <span style={{ color: T.t2 }}>Central Warehousing Corporation</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
