import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTransactions, getReceipts, getReportDashboard,
  uploadStatement, uploadReceipts, runAutoMatch,
  updateMatch, createMatch, acknowledgeMatch, markNoReceipt,
  deleteMatch, setSplitReceipt, clearSplitReceipt,
  getReceiptThumbnailBlob, getExportStatus,
  getEigenbelegGruende, createEigenbeleg,
} from "@/integrations/api/api";
import type { Receipt, Transaction } from "@/integrations/api/types";

interface Props { reportId: string | null }

const TOKEN_KEY = "wsai_auth_token";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// ── helpers ──────────────────────────────────────────────────────────────────

function receiptLabel(rx: Receipt): string {
  if (rx.extracted_vendor && rx.extracted_vendor.length > 3) return rx.extracted_vendor;
  return rx.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

// Approximate EUR conversion rates (static; good enough for display purposes)
const EUR_RATES: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.19, CHF: 1.03, SEK: 0.087, NOK: 0.085, DKK: 0.134,
  PLN: 0.23, CZK: 0.040, HUF: 0.0026, JPY: 0.0062, CNY: 0.127, CAD: 0.68,
  AUD: 0.60, SGD: 0.68, MXN: 0.054, BRL: 0.18, INR: 0.011, KRW: 0.00067,
  TRY: 0.028, ZAR: 0.049, AED: 0.25, SAR: 0.25, THB: 0.026, HKD: 0.118,
  NZD: 0.55, IDR: 0.000057, MYR: 0.20, PHP: 0.016, ILS: 0.25, CLP: 0.00096,
  TWD: 0.028, PKR: 0.0033, SKK: 0.0332,  // SKK fixed rate (1 EUR = 30.126 SKK)
};

function formatReceiptAmount(rx: Receipt): string {
  const { extracted_amount: amt, extracted_currency: cur } = rx;
  if (amt == null) return "";
  if (!cur || cur === "EUR") return `${amt.toFixed(2)} €`;
  const rate = EUR_RATES[cur.toUpperCase()];
  const eurApprox = rate ? (amt * rate).toFixed(2) : null;
  return eurApprox ? `${amt.toFixed(2)} ${cur} (ca. ${eurApprox} €)` : `${amt.toFixed(2)} ${cur}`;
}

function statusOf(tx: Transaction): "missing" | "unconfirmed" | "confirmed" | "skipped" {
  if (!tx.needs_receipt) return "skipped";
  const m = tx.match;
  if (!m) return "missing";
  if (m.match_type === "acknowledged_missing" || m.match_type === "no_receipt_needed") return "skipped";
  if (m.confirmed) return "confirmed";
  return "unconfirmed";
}

const STATUS_ORDER = { missing: 0, unconfirmed: 1, confirmed: 2, skipped: 3 };

// ── Thumbnail hook ────────────────────────────────────────────────────────────

function useThumb(receiptId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!receiptId) return;
    let active = true;
    getReceiptThumbnailBlob(receiptId).then((u) => {
      if (!active) { URL.revokeObjectURL(u); return; }
      if (prev.current) URL.revokeObjectURL(prev.current);
      prev.current = u;
      setUrl(u);
    }).catch(() => {});
    return () => { active = false; };
  }, [receiptId]);
  return url;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <img src={url} alt="Beleg" className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none">✕</button>
    </div>
  );
}

// ── Attached receipt chip (shown inside transaction row) ──────────────────────

function AttachedReceiptChip({
  rx, isSplit, onRemove, onLightbox, onClearSplit,
}: {
  rx: Receipt; isSplit?: boolean;
  onRemove?: () => void; onLightbox: (url: string) => void; onClearSplit?: () => void;
}) {
  const thumb = useThumb(rx.id);
  return (
    <div className={`relative flex gap-1.5 items-center p-1.5 rounded-lg border text-xs w-48 ${
      isSplit ? "bg-blue-50 border-blue-200" : "bg-green-50 border-green-200"
    }`}>
      <div
        className="shrink-0 w-8 h-11 rounded overflow-hidden border border-border bg-muted cursor-pointer hover:opacity-80"
        onClick={() => thumb && onLightbox(thumb)}
        title="Vergrößern"
      >
        {thumb
          ? <img src={thumb} alt="" className="w-full h-full object-cover object-top" />
          : <span className="text-[8px] text-muted-foreground flex items-center justify-center h-full">PDF</span>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold truncate leading-tight" title={receiptLabel(rx)}>{receiptLabel(rx)}</p>
        {rx.extracted_amount != null && <p className="text-muted-foreground">{formatReceiptAmount(rx)}</p>}
        {rx.extracted_date && <p className="text-muted-foreground">{rx.extracted_date}</p>}
      </div>
      {/* Remove button */}
      {(onRemove || onClearSplit) && (
        <button
          onClick={isSplit ? onClearSplit : onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-border text-muted-foreground hover:text-red-500 hover:border-red-300 text-[10px] flex items-center justify-center shadow-sm"
          title="Trennen"
        >✕</button>
      )}
    </div>
  );
}

// ── Drop zone (shown when transaction has no receipt) ─────────────────────────

function DropZone({ isDragOver, onClick }: { isDragOver: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-center w-48 h-[52px] rounded-lg border-2 border-dashed text-xs transition-colors cursor-pointer ${
        isDragOver
          ? "border-blue-400 bg-blue-50 text-blue-600"
          : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
      }`}
    >
      {isDragOver ? "Ablegen ↓" : "Beleg ablegen"}
    </div>
  );
}

// ── Transaction row ───────────────────────────────────────────────────────────

function TxRow({
  tx, isFirst, isExpanded, dragOverTxId, allReceipts, unmatchedReceipts, assignReceiptId,
  onClick, onDrop, onDragOver, onDragLeave,
  onConfirm, onUnmatch, onAcknowledge, onNoReceipt,
  onAssign, onSetSplit, onClearSplit, onLightbox, onAssignSelected, onEigenbeleg,
}: {
  tx: Transaction; isFirst: boolean; isExpanded: boolean;
  dragOverTxId: string | null; allReceipts: Receipt[];
  unmatchedReceipts: Receipt[]; assignReceiptId: string | null;
  onClick: () => void;
  onDrop: (rxId: string) => void;
  onDragOver: () => void; onDragLeave: () => void;
  onConfirm: () => void; onUnmatch: () => void;
  onAcknowledge: () => void; onNoReceipt: () => void;
  onAssign: (rxId: string) => void; onSetSplit: (rxId: string) => void;
  onClearSplit: () => void; onLightbox: (url: string) => void;
  onAssignSelected: () => void; onEigenbeleg: () => void;
}) {
  const m = tx.match;
  const status = statusOf(tx);
  const matchedRx = m?.receipt_id ? allReceipts.find(r => r.id === m.receipt_id) : null;
  const splitRx = m?.extra_receipt_ids?.length ? allReceipts.find(r => r.id === m.extra_receipt_ids[0]) : null;
  const isDragOver = dragOverTxId === tx.id;

  const borderColor = { missing: "border-l-red-500", unconfirmed: "border-l-yellow-400", confirmed: "border-l-green-500", skipped: "border-l-gray-300" }[status];
  const bgColor = { missing: "bg-red-50", unconfirmed: "bg-yellow-50", confirmed: "bg-green-50/60", skipped: "bg-gray-50" }[status];

  return (
    <div className={`border-t border-border ${isFirst ? "border-t-0" : ""}`}>
      {/* Main row */}
      <div
        className={`flex items-center gap-0 border-l-4 ${borderColor} ${bgColor} ${isDragOver ? "ring-2 ring-blue-400 ring-inset" : ""} transition-all`}
        onDragOver={e => { e.preventDefault(); onDragOver(); }}
        onDragLeave={onDragLeave}
        onDrop={e => {
          e.preventDefault();
          const rxId = e.dataTransfer.getData("receiptId");
          if (rxId) onDrop(rxId);
        }}
      >
        {/* Transaction info — clickable */}
        <div
          className="flex-1 flex items-center gap-4 px-4 py-3 cursor-pointer hover:brightness-95 min-w-0"
          onClick={assignReceiptId ? onAssignSelected : onClick}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{tx.booking_date}</p>
            <p className="text-sm font-semibold truncate">{tx.description}</p>
            {assignReceiptId && <p className="text-xs text-blue-600 font-medium">↗ Hier zuweisen</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold">{Math.abs(tx.amount).toFixed(2)} {tx.currency}</p>
            <p className={`text-xs ${status === "missing" ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
              {{ missing: "Kein Beleg", unconfirmed: "Auto", confirmed: "✓ Belegt", skipped: "Nicht nötig" }[status]}
            </p>
          </div>
        </div>

        {/* Receipt attachment zone */}
        <div className="shrink-0 px-3 py-2 flex gap-2 items-center border-l border-border/50">
          {matchedRx ? (
            <>
              <AttachedReceiptChip
                rx={matchedRx}
                onRemove={onUnmatch}
                onLightbox={onLightbox}
              />
              {splitRx ? (
                <AttachedReceiptChip
                  rx={splitRx}
                  isSplit
                  onClearSplit={onClearSplit}
                  onLightbox={onLightbox}
                />
              ) : (
                /* Drop zone for second (split) receipt — always show when first receipt is attached */
                <div
                  className="w-6 h-11 rounded border-2 border-dashed border-border/50 flex items-center justify-center text-muted-foreground/50 text-[10px] hover:border-blue-300 transition-colors cursor-pointer"
                  title="Zweiten Beleg ablegen (Hin+Rückfahrt)"
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation();
                    const rxId = e.dataTransfer.getData("receiptId");
                    if (rxId) onSetSplit(rxId);
                  }}
                >+</div>
              )}
            </>
          ) : (
            status !== "skipped" && (
              <DropZone isDragOver={isDragOver} onClick={assignReceiptId ? onAssignSelected : onClick} />
            )
          )}
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && !assignReceiptId && (
        <div className="px-4 pb-3 pt-2 border-l-4 border-l-transparent bg-background border-t border-border/40 space-y-2">
          <div className="flex flex-wrap gap-2">
            {m && !m.confirmed && m.match_type === "auto" && (
              <Btn variant="green" onClick={onConfirm}>Bestätigen</Btn>
            )}
            {m?.receipt_id && <Btn variant="gray" onClick={onUnmatch}>Trennen</Btn>}
            {m && !m.confirmed && m.match_type !== "acknowledged_missing" && m.match_type !== "no_receipt_needed" && (
              <Btn variant="orange" onClick={onAcknowledge}>Quittieren (fehlt)</Btn>
            )}
            {tx.needs_receipt && !m && (
              <Btn variant="gray" onClick={onNoReceipt}>Kein Beleg nötig</Btn>
            )}
            {(status === "missing" || status === "unconfirmed") && (
              <Btn variant="orange" onClick={onEigenbeleg}>Eigenbeleg erstellen</Btn>
            )}
          </div>
          {unmatchedReceipts.length > 0 && (
            <select
              className="w-full max-w-xs px-2 py-1.5 border border-border rounded-md text-xs"
              defaultValue=""
              onChange={e => e.target.value && onAssign(e.target.value)}
            >
              <option value="">Beleg manuell zuweisen…</option>
              {unmatchedReceipts.map(r => (
                <option key={r.id} value={r.id}>
                  {receiptLabel(r)}{r.extracted_amount ? ` · ${formatReceiptAmount(r)}` : ""}
                  {r.extracted_date ? ` · ${r.extracted_date}` : ""}
                </option>
              ))}
            </select>
          )}
          {m?.receipt_id && !splitRx && unmatchedReceipts.length > 0 && (
            <select
              className="w-full max-w-xs px-2 py-1.5 border border-blue-300 rounded-md text-xs"
              defaultValue=""
              onChange={e => e.target.value && onSetSplit(e.target.value)}
            >
              <option value="">⊕ Zweiten Beleg (DB Hin+Rückfahrt)…</option>
              {unmatchedReceipts.map(r => (
                <option key={r.id} value={r.id}>
                  {receiptLabel(r)}{r.extracted_amount ? ` · ${formatReceiptAmount(r)}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function Btn({ variant, onClick, children }: { variant: "green" | "orange" | "gray"; onClick: () => void; children: React.ReactNode }) {
  const cls = { green: "bg-green-600 text-white hover:bg-green-700", orange: "bg-orange-100 text-orange-800 hover:bg-orange-200", gray: "bg-white border border-border hover:bg-muted" }[variant];
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${cls}`}>{children}</button>;
}

// ── Draggable receipt card (pool) ─────────────────────────────────────────────

function DraggableReceiptCard({
  rx, isSelected, onSelect, onLightbox,
}: {
  rx: Receipt; isSelected: boolean; onSelect: () => void; onLightbox: (url: string) => void;
}) {
  const thumb = useThumb(rx.id);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("receiptId", rx.id);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={onSelect}
      className={`flex gap-2 p-2 rounded-xl border cursor-grab active:cursor-grabbing transition-all select-none ${
        dragging ? "opacity-40 scale-95" :
        isSelected ? "border-blue-400 ring-2 ring-blue-300 bg-blue-50" :
        "border-border bg-card hover:border-primary/50 hover:shadow-sm"
      }`}
    >
      {/* Drag handle */}
      <div className="shrink-0 flex flex-col items-center gap-0.5 pt-1 text-muted-foreground/40">
        <span className="text-[10px] leading-none">⠿</span>
      </div>
      {/* Thumbnail */}
      <div
        className="shrink-0 w-10 h-14 rounded overflow-hidden border border-border bg-muted cursor-pointer hover:opacity-80"
        onClick={e => { e.stopPropagation(); if (thumb) onLightbox(thumb); }}
      >
        {thumb
          ? <img src={thumb} alt="" className="w-full h-full object-cover object-top" />
          : <span className="text-[8px] text-muted-foreground flex items-center justify-center h-full text-center leading-tight px-0.5">PDF</span>}
      </div>
      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate leading-tight">{receiptLabel(rx)}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{rx.filename}</p>
        {rx.extracted_amount != null && <p className="text-xs font-medium mt-0.5">{formatReceiptAmount(rx)}</p>}
        {rx.extracted_date && <p className="text-[10px] text-muted-foreground">{rx.extracted_date}</p>}
        {isSelected && <p className="text-[10px] text-blue-600 font-medium mt-0.5">↗ Buchung klicken</p>}
      </div>
    </div>
  );
}

// ── Upload strip ──────────────────────────────────────────────────────────────

function UploadStrip({ reportId, txCount, rxCount, onInvalidate, onMatchPending }: { reportId: string; txCount: number; rxCount: number; onInvalidate: () => void; onMatchPending: (pending: boolean) => void }) {
  const [stmtFile, setStmtFile] = useState<File | null>(null);
  const [rxFiles, setRxFiles] = useState<File[]>([]);

  const stmtMut = useMutation({ mutationFn: (f: File) => uploadStatement(reportId, f), onSuccess: () => { setStmtFile(null); onInvalidate(); } });
  const rxMut = useMutation({ mutationFn: (files: File[]) => uploadReceipts(reportId, files), onSuccess: () => { setRxFiles([]); onInvalidate(); } });
  const matchMut = useMutation({
    mutationFn: () => { onMatchPending(true); return runAutoMatch(reportId); },
    onSettled: () => onMatchPending(false),
    onSuccess: onInvalidate,
  });

  const { getRootProps: sr, getInputProps: si, isDragActive: sd } = useDropzone({ onDrop: useCallback((f: File[]) => f[0] && setStmtFile(f[0]), []), accept: { "application/pdf": [".pdf"] }, maxFiles: 1 });
  const { getRootProps: rr, getInputProps: ri, isDragActive: rd } = useDropzone({ onDrop: useCallback((f: File[]) => setRxFiles(p => [...p, ...f]), []), accept: { "application/pdf": [".pdf"] } });

  const step1Done = txCount > 0;
  const step2Done = rxCount > 0;
  const step3Done = matchMut.isSuccess;

  // step number badge
  const Badge = ({ n, done, active }: { n: number; done: boolean; active: boolean }) => (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${done ? "bg-green-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
      {done ? "✓" : n}
    </div>
  );

  // connector line between steps
  const Connector = ({ done }: { done: boolean }) => (
    <div className={`hidden sm:block flex-1 h-px mt-3 mx-2 transition-colors ${done ? "bg-green-400" : "bg-border"}`} />
  );

  return (
    <div className="border-b border-border bg-muted/20 px-5 py-4">
      <div className="flex items-start gap-0">

        {/* Step 1 — Abrechnung */}
        <div className="flex-1 min-w-36">
          <div className="flex items-center gap-2 mb-2">
            <Badge n={1} done={step1Done} active={!step1Done} />
            <span className="text-xs font-semibold">Abrechnung</span>
            {step1Done && <span className="text-[10px] text-green-600">{txCount} Buchungen</span>}
          </div>
          <div {...sr()} className={`border-2 border-dashed rounded-lg px-3 py-2 text-center cursor-pointer text-xs transition-colors ${sd ? "border-primary bg-blue-50" : step1Done ? "border-green-300 bg-green-50/50" : "border-border hover:border-primary/50"}`}>
            <input {...si()} />
            {stmtFile ? <span className="font-medium">{stmtFile.name}</span> : <span className="text-muted-foreground">{step1Done ? "Erneut hochladen" : "Kontoauszug PDF"}</span>}
          </div>
          {stmtFile && <button onClick={() => stmtMut.mutate(stmtFile)} disabled={stmtMut.isPending} className="mt-1 w-full py-1 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-50">{stmtMut.isPending ? "Verarbeite…" : "Einlesen"}</button>}
          {stmtMut.isError && <p className="text-[11px] text-red-500 mt-0.5">{(stmtMut.error as Error).message}</p>}
        </div>

        <Connector done={step1Done} />

        {/* Step 2 — Belege */}
        <div className="flex-1 min-w-36">
          <div className="flex items-center gap-2 mb-2">
            <Badge n={2} done={step2Done} active={step1Done && !step2Done} />
            <span className="text-xs font-semibold">Belege</span>
            {step2Done && <span className="text-[10px] text-green-600">{rxCount} Belege</span>}
          </div>
          <div {...rr()} className={`border-2 border-dashed rounded-lg px-3 py-2 text-center cursor-pointer text-xs transition-colors ${rd ? "border-primary bg-blue-50" : step2Done ? "border-green-300 bg-green-50/50" : "border-border hover:border-primary/50"}`}>
            <input {...ri()} />
            {rxFiles.length > 0 ? <span className="font-medium">{rxFiles.length} Datei(en) ausgewählt</span> : <span className="text-muted-foreground">{step2Done ? "Weitere hochladen" : "Belege PDFs"}</span>}
          </div>
          {rxFiles.length > 0 && <button onClick={() => rxMut.mutate(rxFiles)} disabled={rxMut.isPending} className="mt-1 w-full py-1 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-50">{rxMut.isPending ? "Verarbeite…" : `${rxFiles.length} hochladen`}</button>}
          {rxMut.isError && <p className="text-[11px] text-red-500 mt-0.5">{(rxMut.error as Error).message}</p>}
        </div>

        <Connector done={step2Done} />

        {/* Step 3 — Auto-Abgleich */}
        <div className="flex-1 min-w-36">
          <div className="flex items-center gap-2 mb-2">
            <Badge n={3} done={step3Done} active={step1Done && step2Done && !step3Done} />
            <span className="text-xs font-semibold">Auto-Abgleich</span>
            {step3Done && <span className="text-[10px] text-green-600">{matchMut.data?.length} Matches</span>}
          </div>
          <button
            onClick={() => matchMut.mutate()}
            disabled={!step1Done || !step2Done || matchMut.isPending}
            className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${step1Done && step2Done ? "bg-green-600 hover:bg-green-700 text-white" : "bg-muted text-muted-foreground cursor-not-allowed"}`}
          >
            {matchMut.isPending && (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {matchMut.isPending ? "Gleiche ab…" : step3Done ? "Erneut abgleichen" : "Jetzt abgleichen"}
          </button>
          {!step1Done && <p className="text-[10px] text-muted-foreground text-center mt-1">Erst Abrechnung hochladen</p>}
          {step1Done && !step2Done && <p className="text-[10px] text-muted-foreground text-center mt-1">Erst Belege hochladen</p>}
        </div>
      </div>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ reportId, missingTxs, onEigenbeleg }: {
  reportId: string;
  missingTxs: Transaction[];
  onEigenbeleg: (tx: Transaction) => void;
}) {
  const { data: dash } = useQuery({ queryKey: ["dashboard", reportId], queryFn: () => getReportDashboard(reportId) });
  const { data: expStatus } = useQuery({ queryKey: ["export-status", reportId], queryFn: () => getExportStatus(reportId) });
  const [showMissingPrompt, setShowMissingPrompt] = useState(false);

  const doExport = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${API_BASE}/api/v1/reports/${reportId}/export/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { alert("Export fehlgeschlagen"); return; }
    const MONTHS_DE = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
    const month = dash?.report?.month;
    const year = dash?.report?.year;
    const filename = month && year
      ? `KKA Maximilian Naumow ${MONTHS_DE[month - 1]} ${year}.pdf`
      : "Spesenabrechnung.pdf";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (missingTxs.length > 0) {
      setShowMissingPrompt(true);
    } else {
      doExport();
    }
  };

  if (!dash) return null;
  const { stats } = dash;
  return (
    <>
      {showMissingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowMissingPrompt(false)}>
          <div className="bg-background rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-base">Fehlende Belege</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{missingTxs.length} Buchung{missingTxs.length !== 1 ? "en" : ""} ohne Beleg</p>
            </div>
            <div className="px-6 py-3 max-h-60 overflow-y-auto space-y-1">
              {missingTxs.map(tx => (
                <div key={tx.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{tx.description}</p>
                    <p className="text-[10px] text-muted-foreground">{tx.booking_date} · {Math.abs(tx.amount).toFixed(2)} {tx.currency}</p>
                  </div>
                  <button
                    onClick={() => { setShowMissingPrompt(false); onEigenbeleg(tx); }}
                    className="shrink-0 px-2 py-1 text-[10px] font-medium bg-orange-100 text-orange-800 hover:bg-orange-200 rounded"
                  >
                    Hier Eigenbeleg erstellen
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4">
              <button onClick={() => setShowMissingPrompt(false)} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">
                Abbrechen
              </button>
              <button onClick={() => { setShowMissingPrompt(false); doExport(); }} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                Trotzdem exportieren
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-5 px-5 py-2 border-b border-border bg-background text-xs">
        <span className="text-muted-foreground">Gesamt: <strong className="text-foreground">{stats.total_spend.toFixed(2)} €</strong></span>
        <span className="text-green-700">Belegt: <strong>{stats.matched}</strong>/{stats.total_transactions}</span>
        {stats.missing_receipts > 0 && <span className="text-red-600 font-semibold">{stats.missing_receipts} fehlen</span>}
        {stats.orphaned_receipts > 0 && <span className="text-orange-500">{stats.orphaned_receipts} Belege ohne Buchung</span>}
        <div className="ml-auto flex items-center gap-3">
          {stats.ready_to_export && <span className="text-green-600 font-medium">✅ Bereit</span>}
          <button onClick={handleExport} disabled={!expStatus?.can_export} className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-40 hover:bg-primary/90">
            PDF herunterladen
          </button>
        </div>
      </div>
    </>
  );
}

// ── Eigenbeleg dialog ─────────────────────────────────────────────────────────

const EUR_RATES_FE: Record<string, number> = {
  EUR: 1, USD: 0.92, GBP: 1.19, CHF: 1.03, SEK: 0.087, NOK: 0.085, DKK: 0.134,
  PLN: 0.23, CZK: 0.040, HUF: 0.0026, JPY: 0.0062, CHY: 0.127, CAD: 0.68,
  AUD: 0.60, SGD: 0.68, MXN: 0.054, BRL: 0.18, INR: 0.011, KRW: 0.00067,
  TRY: 0.028, ZAR: 0.049, AED: 0.25, SAR: 0.25, THB: 0.026, HKD: 0.118,
  SKK: 0.0332,
};

function EigenbelegDialog({
  reportId, tx, onClose, onCreated,
}: {
  reportId: string;
  tx: Transaction;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: gruendeData } = useQuery({
    queryKey: ["eigenbeleg-gruende"],
    queryFn: getEigenbelegGruende,
    staleTime: Infinity,
  });

  const gruende = gruendeData?.gruende ?? [
    "Tap-to-Pay mit Kreditkarte, belegloses Zahlen, kein Online-Auszug generierbar",
    "Verlust des Zahlungsbelegs",
    "Beleg wurde nicht ausgestellt (Automat / Self-Checkout)",
    "Technischer Fehler beim Erstellen des Belegs",
    "Buchung über Drittanbieter, kein separater Beleg erhältlich",
  ];

  const txAmt = Math.abs(tx.amount);
  const [currency, setCurrency] = useState("EUR");
  const [betragOriginal, setBetragOriginal] = useState(txAmt.toFixed(2));
  const [betragEur, setBetragEur] = useState(txAmt.toFixed(2));
  const [empfaenger, setEmpfaenger] = useState(tx.description);
  const [verwendungszweck, setVerwendungszweck] = useState("");
  const [grund, setGrund] = useState(gruende[0]);
  const [ort, setOrt] = useState("Stuttgart");
  const [ausgabedatum, setAusgabedatum] = useState(tx.booking_date);
  const [name, setName] = useState("Maximilian Naumow");

  // Keep EUR amount in sync when original amount / currency changes
  const handleOriginalChange = (v: string) => {
    setBetragOriginal(v);
    const num = parseFloat(v.replace(",", "."));
    if (!isNaN(num)) {
      const rate = EUR_RATES_FE[currency.toUpperCase()] ?? 1;
      setBetragEur((num * rate).toFixed(2));
    }
  };
  const handleCurrencyChange = (v: string) => {
    setCurrency(v);
    const num = parseFloat(betragOriginal.replace(",", "."));
    if (!isNaN(num)) {
      const rate = EUR_RATES_FE[v.toUpperCase()] ?? 1;
      setBetragEur((num * rate).toFixed(2));
    }
  };

  const mut = useMutation({
    mutationFn: () => createEigenbeleg(reportId, {
      transaction_id: tx.id,
      betrag_original: parseFloat(betragOriginal.replace(",", ".")),
      currency,
      betrag_eur: parseFloat(betragEur.replace(",", ".")),
      eur_rate: currency !== "EUR" ? (EUR_RATES_FE[currency.toUpperCase()] ?? undefined) : undefined,
      empfaenger,
      verwendungszweck,
      grund,
      ort,
      ausgabedatum,
      name,
    }),
    onSuccess: () => { onCreated(); onClose(); },
  });

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const labelCls = "block text-xs font-semibold text-muted-foreground mb-0.5";
  const inputCls = "w-full border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-base">Eigenbeleg erstellen</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tx.description} · {Math.abs(tx.amount).toFixed(2)} {tx.currency} · {tx.booking_date}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Amount row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelCls}>Betrag (Original)</label>
              <div className="flex gap-2">
                <input value={betragOriginal} onChange={e => handleOriginalChange(e.target.value)}
                  className={inputCls + " flex-1"} />
                <select value={currency} onChange={e => handleCurrencyChange(e.target.value)}
                  className="border border-border rounded-md px-2 py-1.5 text-sm">
                  {["EUR","USD","GBP","CHF","SEK","NOK","DKK","PLN","CZK","HUF","JPY","CAD","AUD","SKK"].map(c =>
                    <option key={c} value={c}>{c}</option>
                  )}
                </select>
              </div>
            </div>
            {currency !== "EUR" && (
              <div className="w-32">
                <label className={labelCls}>Betrag (EUR)</label>
                <input value={betragEur} onChange={e => setBetragEur(e.target.value)}
                  className={inputCls} />
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Empfänger</label>
            <textarea value={empfaenger} onChange={e => setEmpfaenger(e.target.value)} rows={2}
              className={inputCls + " resize-none"} />
          </div>

          <div>
            <label className={labelCls}>Verwendungszweck</label>
            <textarea value={verwendungszweck} onChange={e => setVerwendungszweck(e.target.value)} rows={2}
              className={inputCls + " resize-none"} />
          </div>

          <div>
            <label className={labelCls}>Grund für Eigenbeleg</label>
            <select value={grund} onChange={e => setGrund(e.target.value)} className={inputCls}>
              {gruende.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <textarea value={grund} onChange={e => setGrund(e.target.value)} rows={2}
              className={inputCls + " mt-1 resize-none text-xs"} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelCls}>Ausgabedatum</label>
              <input type="date" value={ausgabedatum} onChange={e => setAusgabedatum(e.target.value)}
                className={inputCls} />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Ort</label>
              <input value={ort} onChange={e => setOrt(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">
            Abbrechen
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {mut.isPending ? "Erstelle PDF…" : "Eigenbeleg erstellen"}
          </button>
        </div>
        {mut.isError && (
          <p className="px-6 pb-4 text-xs text-red-500">{(mut.error as Error).message}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Abgleich({ reportId }: Props) {
  const qc = useQueryClient();
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [assignReceiptId, setAssignReceiptId] = useState<string | null>(null);
  const [dragOverTxId, setDragOverTxId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [eigenbelegTx, setEigenbelegTx] = useState<Transaction | null>(null);

  const { data: transactions = [] } = useQuery({ queryKey: ["transactions", reportId], queryFn: () => getTransactions(reportId!), enabled: !!reportId });
  const { data: receipts = [] } = useQuery({ queryKey: ["receipts", reportId], queryFn: () => getReceipts(reportId!), enabled: !!reportId });

  const invalidate = useCallback(() => {
    ["transactions", "receipts", "dashboard", "todo", "export-status"].forEach(k =>
      qc.invalidateQueries({ queryKey: [k, reportId] })
    );
  }, [qc, reportId]);

  const confirmMut    = useMutation({ mutationFn: (id: string) => updateMatch(id, { confirmed: true }), onSuccess: invalidate });
  const confirmAllMut = useMutation({
    mutationFn: async () => {
      const pending = transactions.filter(t => t.match?.match_type === "auto" && !t.match.confirmed);
      await Promise.all(pending.map(t => updateMatch(t.match!.id, { confirmed: true })));
    },
    onSuccess: invalidate,
  });
  const assignMut     = useMutation({ mutationFn: ({ txId, rxId }: { txId: string; rxId: string }) => createMatch(txId, rxId), onSuccess: invalidate });
  const ackMut        = useMutation({ mutationFn: (id: string) => acknowledgeMatch(id), onSuccess: invalidate });
  const noReceiptMut  = useMutation({ mutationFn: (id: string) => markNoReceipt(id), onSuccess: invalidate });
  const unmatchMut    = useMutation({ mutationFn: (id: string) => deleteMatch(id), onSuccess: invalidate });
  const splitMut      = useMutation({ mutationFn: ({ matchId, rxId }: { matchId: string; rxId: string }) => setSplitReceipt(matchId, rxId), onSuccess: invalidate });
  const clearSplitMut = useMutation({ mutationFn: (id: string) => clearSplitReceipt(id), onSuccess: invalidate });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setAssignReceiptId(null); setLightboxUrl(null); setEigenbelegTx(null); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!reportId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <p className="text-lg font-medium">Kein Bericht ausgewählt</p>
        <p className="text-sm">Erstelle einen neuen Bericht in der Seitenleiste.</p>
      </div>
    );
  }

  const assignedRxIds = new Set<string>();
  for (const t of transactions) {
    if (t.match?.receipt_id) assignedRxIds.add(t.match.receipt_id);
    for (const id of t.match?.extra_receipt_ids ?? []) assignedRxIds.add(id);
  }
  const unmatchedReceipts = receipts.filter(r => !assignedRxIds.has(r.id));
  const autoUnconfirmedCount = transactions.filter(t => t.match?.match_type === "auto" && !t.match.confirmed).length;
  const missingCount = transactions.filter(t => statusOf(t) === "missing").length;
  const sorted = [...transactions].sort((a, b) => STATUS_ORDER[statusOf(a)] - STATUS_ORDER[statusOf(b)]);

  const handleDrop = (txId: string, rxId: string) => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;
    setDragOverTxId(null);
    // If tx already has a receipt, add as split; otherwise assign as primary
    if (tx.match?.receipt_id) {
      splitMut.mutate({ matchId: tx.match.id, rxId });
    } else {
      assignMut.mutate({ txId, rxId });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      {eigenbelegTx && (
        <EigenbelegDialog
          reportId={reportId}
          tx={eigenbelegTx}
          onClose={() => setEigenbelegTx(null)}
          onCreated={invalidate}
        />
      )}

      {isMatching && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm gap-4">
          <svg className="animate-spin h-10 w-10 text-green-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm font-medium text-foreground">Auto-Abgleich läuft…</p>
          <p className="text-xs text-muted-foreground">Belege werden den Buchungen zugeordnet</p>
        </div>
      )}

      <UploadStrip reportId={reportId} txCount={transactions.length} rxCount={receipts.length} onInvalidate={invalidate} onMatchPending={setIsMatching} />
      <StatsBar reportId={reportId} missingTxs={sorted.filter(t => statusOf(t) === "missing")} onEigenbeleg={setEigenbelegTx} />

      {assignReceiptId && (
        <div className="flex items-center justify-between px-5 py-1.5 bg-blue-600 text-white text-xs">
          <span>Beleg ausgewählt — klicke eine Buchung zum Zuweisen</span>
          <button onClick={() => setAssignReceiptId(null)} className="text-white/80 hover:text-white">Abbrechen ✕</button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── Transaction list ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-background/95 backdrop-blur border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Buchungen ({transactions.length})
              {missingCount > 0 && <span className="ml-2 text-red-500 normal-case font-normal">{missingCount} ohne Beleg</span>}
            </span>
            {autoUnconfirmedCount > 0 && (
              <button onClick={() => confirmAllMut.mutate()} disabled={confirmAllMut.isPending} className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium disabled:opacity-50">
                {autoUnconfirmedCount} bestätigen
              </button>
            )}
          </div>

          {transactions.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Lade die Kreditkartenabrechnung oben hoch.</div>
          ) : (
            sorted.map((tx, i) => (
              <TxRow
                key={tx.id}
                tx={tx}
                isFirst={i === 0}
                isExpanded={selectedTxId === tx.id}
                dragOverTxId={dragOverTxId}
                allReceipts={receipts}
                unmatchedReceipts={unmatchedReceipts}
                assignReceiptId={assignReceiptId}
                onClick={() => setSelectedTxId(selectedTxId === tx.id ? null : tx.id)}
                onDrop={(rxId) => handleDrop(tx.id, rxId)}
                onDragOver={() => setDragOverTxId(tx.id)}
                onDragLeave={() => setDragOverTxId(null)}
                onConfirm={() => confirmMut.mutate(tx.match!.id)}
                onUnmatch={() => unmatchMut.mutate(tx.match!.id)}
                onAcknowledge={() => ackMut.mutate(tx.match!.id)}
                onNoReceipt={() => noReceiptMut.mutate(tx.id)}
                onAssign={(rxId) => assignMut.mutate({ txId: tx.id, rxId })}
                onSetSplit={(rxId) => splitMut.mutate({ matchId: tx.match!.id, rxId })}
                onClearSplit={() => clearSplitMut.mutate(tx.match!.id)}
                onLightbox={setLightboxUrl}
                onAssignSelected={() => {
                  if (assignReceiptId) {
                    handleDrop(tx.id, assignReceiptId);
                    setAssignReceiptId(null);
                  }
                }}
                onEigenbeleg={() => setEigenbelegTx(tx)}
              />
            ))
          )}
        </div>

        {/* ── Receipt pool (right sidebar) ── */}
        <div className="w-72 border-l border-border flex flex-col shrink-0 overflow-hidden">
          <div className="sticky top-0 px-3 py-2 bg-background/95 backdrop-blur border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Belege offen
              {unmatchedReceipts.length > 0 && (
                <span className="ml-1.5 text-orange-500 normal-case font-normal">{unmatchedReceipts.length}</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Ziehen oder klicken zum Zuweisen</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {unmatchedReceipts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {receipts.length > 0 ? "Alle Belege zugeordnet ✓" : "Noch keine Belege hochgeladen"}
              </p>
            ) : (
              unmatchedReceipts.map(rx => (
                <DraggableReceiptCard
                  key={rx.id}
                  rx={rx}
                  isSelected={assignReceiptId === rx.id}
                  onSelect={() => setAssignReceiptId(assignReceiptId === rx.id ? null : rx.id)}
                  onLightbox={setLightboxUrl}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
