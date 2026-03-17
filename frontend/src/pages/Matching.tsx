import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransactions, getReceipts, updateMatch, createMatch, acknowledgeMatch, markNoReceipt, deleteMatch } from "@/integrations/api/api";
import type { Transaction, Receipt } from "@/integrations/api/types";
import { useState } from "react";

interface Props {
  reportId: string | null;
}

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

  const confirmMut = useMutation({
    mutationFn: (matchId: string) => updateMatch(matchId, { confirmed: true }),
    onSuccess: invalidate,
  });

  const confirmAllMut = useMutation({
    mutationFn: async () => {
      const autoUnconfirmed = transactions.filter(
        (t) => t.match && t.match.match_type === "auto" && !t.match.confirmed
      );
      await Promise.all(autoUnconfirmed.map((t) => updateMatch(t.match!.id, { confirmed: true })));
    },
    onSuccess: invalidate,
  });

  const assignMut = useMutation({
    mutationFn: ({ txId, rxId }: { txId: string; rxId: string }) => createMatch(txId, rxId),
    onSuccess: invalidate,
  });

  const ackMut = useMutation({
    mutationFn: (matchId: string) => acknowledgeMatch(matchId),
    onSuccess: invalidate,
  });

  const noReceiptMut = useMutation({
    mutationFn: (txId: string) => markNoReceipt(txId),
    onSuccess: invalidate,
  });

  const unmatchMut = useMutation({
    mutationFn: (matchId: string) => deleteMatch(matchId),
    onSuccess: invalidate,
  });

  if (!reportId) return <div className="p-8 text-muted-foreground">Kein Bericht ausgewählt.</div>;
  if (!transactions.length) return <div className="p-8 text-muted-foreground">Noch keine Buchungen geladen.</div>;

  const autoUnconfirmedCount = transactions.filter(
    (t) => t.match && t.match.match_type === "auto" && !t.match.confirmed
  ).length;

  const matchedRxIds = new Set(transactions.filter((t) => t.match?.receipt_id).map((t) => t.match!.receipt_id!));
  const unmatchedReceipts = receipts.filter((r) => !matchedRxIds.has(r.id));

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Belegabgleich</h2>
        {autoUnconfirmedCount > 0 && (
          <button
            onClick={() => confirmAllMut.mutate()}
            disabled={confirmAllMut.isPending}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Alle {autoUnconfirmedCount} Auto-Matches bestätigen
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Transactions */}
        <div>
          <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-2">
            Buchungen ({transactions.length})
          </h3>
          <div className="border border-border rounded-lg overflow-hidden">
            {transactions.map((tx, i) => (
              <TxRow
                key={tx.id}
                tx={tx}
                isFirst={i === 0}
                isSelected={selectedTxId === tx.id}
                receipts={receipts}
                onClick={() => setSelectedTxId(selectedTxId === tx.id ? null : tx.id)}
                onConfirm={() => confirmMut.mutate(tx.match!.id)}
                onUnmatch={() => unmatchMut.mutate(tx.match!.id)}
                onAcknowledge={() => ackMut.mutate(tx.match!.id)}
                onNoReceipt={() => noReceiptMut.mutate(tx.id)}
                onAssign={(rxId) => assignMut.mutate({ txId: tx.id, rxId })}
                unmatchedReceipts={unmatchedReceipts}
              />
            ))}
          </div>
        </div>

        {/* Receipts */}
        <div>
          <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-2">
            Belege ({receipts.length}) — {unmatchedReceipts.length} ohne Buchung
          </h3>
          <div className="border border-border rounded-lg overflow-hidden">
            {receipts.map((rx, i) => (
              <RxRow key={rx.id} rx={rx} isFirst={i === 0} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TxRow({
  tx, isFirst, isSelected, receipts, unmatchedReceipts,
  onClick, onConfirm, onUnmatch, onAcknowledge, onNoReceipt, onAssign,
}: {
  tx: Transaction;
  isFirst: boolean;
  isSelected: boolean;
  receipts: Receipt[];
  unmatchedReceipts: Receipt[];
  onClick: () => void;
  onConfirm: () => void;
  onUnmatch: () => void;
  onAcknowledge: () => void;
  onNoReceipt: () => void;
  onAssign: (rxId: string) => void;
}) {
  const m = tx.match;
  const matchedRx = m?.receipt_id ? receipts.find((r) => r.id === m.receipt_id) : null;

  let statusBg = "bg-red-50";
  let statusLabel = "❌ Kein Beleg";
  if (!tx.needs_receipt) { statusBg = "bg-gray-50"; statusLabel = "— nicht erforderlich"; }
  else if (m?.match_type === "acknowledged_missing") { statusBg = "bg-orange-50"; statusLabel = "⚠ Quittiert fehlend"; }
  else if (m?.match_type === "no_receipt_needed") { statusBg = "bg-gray-50"; statusLabel = "— kein Beleg nötig"; }
  else if (m?.confirmed) { statusBg = "bg-green-50"; statusLabel = "✅ Belegt"; }
  else if (m?.match_type === "auto") { statusBg = "bg-yellow-50"; statusLabel = "🟡 Auto (unbestätigt)"; }

  return (
    <div className={`${!isFirst ? "border-t border-border" : ""} ${statusBg}`}>
      <div
        className="flex items-start gap-2 px-3 py-3 cursor-pointer hover:brightness-95"
        onClick={onClick}
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{tx.booking_date}</p>
          <p className="text-sm font-medium truncate">{tx.description}</p>
          {matchedRx && (
            <p className="text-xs text-green-700 truncate">→ {matchedRx.extracted_vendor || matchedRx.filename}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium">{Math.abs(tx.amount).toFixed(2)} {tx.currency}</p>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>
      </div>

      {isSelected && (
        <div className="px-3 pb-3 flex flex-wrap gap-2 text-xs">
          {m && !m.confirmed && m.match_type === "auto" && (
            <button onClick={onConfirm} className="px-2 py-1 bg-green-600 text-white rounded">Bestätigen</button>
          )}
          {m?.receipt_id && (
            <button onClick={onUnmatch} className="px-2 py-1 bg-gray-200 rounded">Trennen</button>
          )}
          {m && !m.confirmed && (
            <button onClick={onAcknowledge} className="px-2 py-1 bg-orange-200 rounded">Quittieren (fehlt)</button>
          )}
          {tx.needs_receipt && !m && (
            <button onClick={onNoReceipt} className="px-2 py-1 bg-gray-200 rounded">Kein Beleg nötig</button>
          )}
          {unmatchedReceipts.length > 0 && (
            <select
              className="px-2 py-1 border border-border rounded text-xs"
              defaultValue=""
              onChange={(e) => e.target.value && onAssign(e.target.value)}
            >
              <option value="">Beleg zuweisen...</option>
              {unmatchedReceipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.extracted_vendor || r.filename} {r.extracted_amount ? `(${r.extracted_amount.toFixed(2)} €)` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function RxRow({ rx, isFirst }: { rx: Receipt; isFirst: boolean }) {
  const isMatched = !!rx.match;
  return (
    <div className={`flex items-center gap-3 px-3 py-3 text-sm ${!isFirst ? "border-t border-border" : ""} ${isMatched ? "bg-green-50" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{rx.extracted_vendor || rx.filename}</p>
        <p className="text-xs text-muted-foreground truncate">{rx.filename}</p>
      </div>
      <div className="text-right shrink-0 text-xs">
        {rx.extracted_amount != null && <p className="font-medium">{rx.extracted_amount.toFixed(2)} €</p>}
        {rx.extracted_date && <p className="text-muted-foreground">{rx.extracted_date}</p>}
      </div>
      {isMatched ? (
        <span className="text-xs text-green-600">✓</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}
