import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTransactions, getReceipts, updateMatch, createMatch,
  acknowledgeMatch, markNoReceipt, deleteMatch,
  setSplitReceipt, clearSplitReceipt, getReceiptThumbnailBlob,
} from "@/integrations/api/api";
import type { Receipt, Transaction } from "@/integrations/api/types";

interface Props { reportId: string | null }

// ── helpers ──────────────────────────────────────────────────────────────────

function receiptLabel(rx: Receipt): string {
  if (rx.extracted_vendor && rx.extracted_vendor.length > 3) return rx.extracted_vendor;
  // Clean filename: strip extension, replace _ / - with spaces, title-case
  return rx.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function fmtAmount(v: number | null | undefined, currency = "EUR"): string {
  if (v == null) return "—";
  return `${Math.abs(v).toFixed(2)} ${currency}`;
}

function statusOf(tx: Transaction): "missing" | "unconfirmed" | "confirmed" | "skipped" {
  if (!tx.needs_receipt) return "skipped";
  const m = tx.match;
  if (!m) return "missing";
  if (m.match_type === "acknowledged_missing") return "skipped";
  if (m.match_type === "no_receipt_needed") return "skipped";
  if (m.confirmed) return "confirmed";
  return "unconfirmed";
}

const STATUS_BORDER: Record<string, string> = {
  missing:     "border-l-4 border-l-red-500",
  unconfirmed: "border-l-4 border-l-yellow-400",
  confirmed:   "border-l-4 border-l-green-500",
  skipped:     "border-l-4 border-l-gray-300",
};

const STATUS_BG: Record<string, string> = {
  missing:     "bg-red-50",
  unconfirmed: "bg-yellow-50",
  confirmed:   "bg-green-50",
  skipped:     "bg-gray-50",
};

const STATUS_LABEL: Record<string, string> = {
  missing:     "Kein Beleg",
  unconfirmed: "Auto — nicht bestätigt",
  confirmed:   "Belegt ✓",
  skipped:     "Kein Beleg nötig",
};

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

// ── ReceiptCard ───────────────────────────────────────────────────────────────

function ReceiptCard({
  rx, isMatched, isSplit, dimmed, onClick, selected,
}: {
  rx: Receipt; isMatched: boolean; isSplit: boolean; dimmed: boolean;
  onClick?: () => void; selected?: boolean;
}) {
  const thumb = useThumb(rx.id);
  const label = receiptLabel(rx);
  return (
    <div
      onClick={onClick}
      className={[
        "flex gap-3 p-3 rounded-lg border transition-all",
        selected ? "border-blue-400 ring-1 ring-blue-300" : "border-border",
        isMatched ? "bg-green-50" : isSplit ? "bg-blue-50" : "bg-card",
        dimmed ? "opacity-40" : "",
        onClick ? "cursor-pointer hover:brightness-95" : "",
      ].join(" ")}
    >
      {/* Thumbnail */}
      <div className="shrink-0 w-12 h-16 rounded overflow-hidden border border-border bg-muted flex items-center justify-center">
        {thumb
          ? <img src={thumb} alt="" className="w-full h-full object-cover object-top" />
          : <span className="text-[10px] text-muted-foreground">PDF</span>}
      </div>
      {/* Meta */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{rx.filename}</p>
        <div className="flex gap-2 mt-1 text-xs">
          {rx.extracted_amount != null && (
            <span className="font-semibold">{rx.extracted_amount.toFixed(2)} €</span>
          )}
          {rx.extracted_date && (
            <span className="text-muted-foreground">{rx.extracted_date}</span>
          )}
          {isMatched && <span className="text-green-600 font-medium">✓ Zugeordnet</span>}
          {isSplit && <span className="text-blue-600 font-medium">⊕ Aufteilung</span>}
        </div>
      </div>
    </div>
  );
}

// ── TxRow ─────────────────────────────────────────────────────────────────────

function TxRow({
  tx, isFirst, isSelected, allReceipts, unmatchedReceipts,
  onClick, onConfirm, onUnmatch, onAcknowledge, onNoReceipt,
  onAssign, onSetSplit, onClearSplit,
}: {
  tx: Transaction; isFirst: boolean; isSelected: boolean;
  allReceipts: Receipt[]; unmatchedReceipts: Receipt[];
  onClick: () => void; onConfirm: () => void; onUnmatch: () => void;
  onAcknowledge: () => void; onNoReceipt: () => void;
  onAssign: (rxId: string) => void;
  onSetSplit: (rxId: string) => void;
  onClearSplit: () => void;
}) {
  const m = tx.match;
  const status = statusOf(tx);
  const matchedRx = m?.receipt_id ? allReceipts.find((r) => r.id === m.receipt_id) : null;
  const splitRx = m?.extra_receipt_ids?.length
    ? allReceipts.find((r) => r.id === m.extra_receipt_ids[0])
    : null;

  return (
    <div className={[
      !isFirst ? "border-t border-border" : "",
      STATUS_BG[status],
      STATUS_BORDER[status],
    ].join(" ")}>
      {/* Main row */}
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:brightness-95"
        onClick={onClick}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{tx.booking_date}</p>
          <p className="text-sm font-semibold truncate">{tx.description}</p>
          {matchedRx && (
            <p className="text-xs text-green-700 truncate mt-0.5">
              → {receiptLabel(matchedRx)}
              {splitRx && <span className="ml-1 text-blue-700"> + {receiptLabel(splitRx)}</span>}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold">{fmtAmount(tx.amount, tx.currency)}</p>
          <p className={`text-xs mt-0.5 ${status === "missing" ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
            {STATUS_LABEL[status]}
          </p>
        </div>
      </div>

      {/* Expanded panel */}
      {isSelected && (
        <div className="px-4 pb-4 space-y-3">
          {/* Linked receipts preview */}
          {matchedRx && (
            <div className="space-y-2">
              <ReceiptCard rx={matchedRx} isMatched isSplit={false} dimmed={false} />
              {splitRx && (
                <div className="relative">
                  <ReceiptCard rx={splitRx} isMatched={false} isSplit dimmed={false} />
                  <button
                    onClick={onClearSplit}
                    className="absolute top-2 right-2 text-xs text-red-500 hover:text-red-700"
                    title="Aufteilung entfernen"
                  >✕</button>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 text-xs">
            {m && !m.confirmed && m.match_type === "auto" && (
              <button onClick={onConfirm} className="px-3 py-1.5 bg-green-600 text-white rounded-md font-medium">
                Bestätigen
              </button>
            )}
            {m?.receipt_id && (
              <button onClick={onUnmatch} className="px-3 py-1.5 bg-white border border-border rounded-md">
                Trennen
              </button>
            )}
            {m && !m.confirmed && m.match_type !== "acknowledged_missing" && m.match_type !== "no_receipt_needed" && (
              <button onClick={onAcknowledge} className="px-3 py-1.5 bg-orange-100 text-orange-800 rounded-md">
                Quittieren (fehlt)
              </button>
            )}
            {tx.needs_receipt && !m && (
              <button onClick={onNoReceipt} className="px-3 py-1.5 bg-white border border-border rounded-md">
                Kein Beleg nötig
              </button>
            )}
          </div>

          {/* Assign receipt */}
          {unmatchedReceipts.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Beleg zuweisen:</p>
              <select
                className="w-full px-2 py-1.5 border border-border rounded-md text-xs"
                defaultValue=""
                onChange={(e) => e.target.value && onAssign(e.target.value)}
              >
                <option value="">Beleg wählen…</option>
                {unmatchedReceipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {receiptLabel(r)}{r.extracted_amount ? ` (${r.extracted_amount.toFixed(2)} €)` : ""}
                    {r.extracted_date ? ` — ${r.extracted_date}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Add split receipt (only when primary receipt already linked) */}
          {m?.receipt_id && !splitRx && unmatchedReceipts.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">
                ⊕ Zweiten Beleg hinzufügen (DB Hin+Rückfahrt):
              </p>
              <select
                className="w-full px-2 py-1.5 border border-blue-300 rounded-md text-xs"
                defaultValue=""
                onChange={(e) => e.target.value && onSetSplit(e.target.value)}
              >
                <option value="">Zweiten Beleg wählen…</option>
                {unmatchedReceipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {receiptLabel(r)}{r.extracted_amount ? ` (${r.extracted_amount.toFixed(2)} €)` : ""}
                    {r.extracted_date ? ` — ${r.extracted_date}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Matching({ reportId }: Props) {
  const qc = useQueryClient();
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions", reportId],
    queryFn: () => getTransactions(reportId!),
    enabled: !!reportId,
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ["receipts", reportId],
    queryFn: () => getReceipts(reportId!),
    enabled: !!reportId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transactions", reportId] });
    qc.invalidateQueries({ queryKey: ["receipts", reportId] });
    qc.invalidateQueries({ queryKey: ["dashboard", reportId] });
    qc.invalidateQueries({ queryKey: ["todo", reportId] });
  };

  const confirmMut = useMutation({ mutationFn: (matchId: string) => updateMatch(matchId, { confirmed: true }), onSuccess: invalidate });
  const confirmAllMut = useMutation({
    mutationFn: async () => {
      const pending = transactions.filter((t) => t.match?.match_type === "auto" && !t.match.confirmed);
      await Promise.all(pending.map((t) => updateMatch(t.match!.id, { confirmed: true })));
    },
    onSuccess: invalidate,
  });
  const assignMut = useMutation({ mutationFn: ({ txId, rxId }: { txId: string; rxId: string }) => createMatch(txId, rxId), onSuccess: invalidate });
  const ackMut = useMutation({ mutationFn: (matchId: string) => acknowledgeMatch(matchId), onSuccess: invalidate });
  const noReceiptMut = useMutation({ mutationFn: (txId: string) => markNoReceipt(txId), onSuccess: invalidate });
  const unmatchMut = useMutation({ mutationFn: (matchId: string) => deleteMatch(matchId), onSuccess: invalidate });
  const splitMut = useMutation({ mutationFn: ({ matchId, rxId }: { matchId: string; rxId: string }) => setSplitReceipt(matchId, rxId), onSuccess: invalidate });
  const clearSplitMut = useMutation({ mutationFn: (matchId: string) => clearSplitReceipt(matchId), onSuccess: invalidate });

  if (!reportId) return <div className="p-8 text-muted-foreground">Kein Bericht ausgewählt.</div>;
  if (!transactions.length) return <div className="p-8 text-muted-foreground">Noch keine Buchungen geladen.</div>;

  const autoUnconfirmedCount = transactions.filter((t) => t.match?.match_type === "auto" && !t.match.confirmed).length;

  // Which receipt IDs are assigned (primary or split)
  const assignedRxIds = new Set<string>();
  for (const t of transactions) {
    if (t.match?.receipt_id) assignedRxIds.add(t.match.receipt_id);
    for (const eid of t.match?.extra_receipt_ids ?? []) assignedRxIds.add(eid);
  }
  const unmatchedReceipts = receipts.filter((r) => !assignedRxIds.has(r.id));

  // Sort: missing → unconfirmed → confirmed → skipped
  const ORDER = { missing: 0, unconfirmed: 1, confirmed: 2, skipped: 3 };
  const sorted = [...transactions].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)]);

  const missingCount = transactions.filter((t) => statusOf(t) === "missing").length;

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold">Belegabgleich</h2>
          {missingCount > 0 && (
            <p className="text-sm text-red-600 mt-0.5">{missingCount} Buchung{missingCount > 1 ? "en" : ""} ohne Beleg</p>
          )}
        </div>
        {autoUnconfirmedCount > 0 && (
          <button
            onClick={() => confirmAllMut.mutate()}
            disabled={confirmAllMut.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {autoUnconfirmedCount} Auto-Match{autoUnconfirmedCount > 1 ? "es" : ""} bestätigen
          </button>
        )}
      </div>

      <div className="grid grid-cols-5 gap-5">
        {/* Left: Transactions (3/5) */}
        <div className="col-span-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Buchungen ({transactions.length})
          </h3>
          <div className="rounded-xl border border-border overflow-hidden shadow-sm">
            {sorted.map((tx, i) => (
              <TxRow
                key={tx.id}
                tx={tx}
                isFirst={i === 0}
                isSelected={selectedTxId === tx.id}
                allReceipts={receipts}
                unmatchedReceipts={unmatchedReceipts}
                onClick={() => setSelectedTxId(selectedTxId === tx.id ? null : tx.id)}
                onConfirm={() => confirmMut.mutate(tx.match!.id)}
                onUnmatch={() => unmatchMut.mutate(tx.match!.id)}
                onAcknowledge={() => ackMut.mutate(tx.match!.id)}
                onNoReceipt={() => noReceiptMut.mutate(tx.id)}
                onAssign={(rxId) => assignMut.mutate({ txId: tx.id, rxId })}
                onSetSplit={(rxId) => splitMut.mutate({ matchId: tx.match!.id, rxId })}
                onClearSplit={() => clearSplitMut.mutate(tx.match!.id)}
              />
            ))}
          </div>
        </div>

        {/* Right: Receipts (2/5) */}
        <div className="col-span-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Belege ({receipts.length})
            {unmatchedReceipts.length > 0 && (
              <span className="ml-2 text-orange-500">{unmatchedReceipts.length} nicht zugeordnet</span>
            )}
          </h3>
          <div className="space-y-2">
            {receipts.map((rx) => {
              const isPrimary = transactions.some((t) => t.match?.receipt_id === rx.id);
              const isSplit = transactions.some((t) => t.match?.extra_receipt_ids?.includes(rx.id));
              return (
                <ReceiptCard
                  key={rx.id}
                  rx={rx}
                  isMatched={isPrimary}
                  isSplit={isSplit}
                  dimmed={false}
                />
              );
            })}
            {receipts.length === 0 && (
              <p className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded-xl">
                Noch keine Belege hochgeladen
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
