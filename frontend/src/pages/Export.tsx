import { useQuery } from "@tanstack/react-query";
import { getTransactions, getReceipts, getExportStatus, exportPdfUrl } from "@/integrations/api/api";

interface Props {
  reportId: string | null;
}

export function Export({ reportId }: Props) {
  const { data: status } = useQuery({
    queryKey: ["export-status", reportId],
    queryFn: () => getExportStatus(reportId!),
    enabled: !!reportId,
  });

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

  if (!reportId) return <div className="p-8 text-muted-foreground">Kein Bericht ausgewählt.</div>;

  const matched = transactions.filter((t) => t.match?.receipt_id);
  const matchedRxIds = new Set(matched.map((t) => t.match!.receipt_id!));
  const orphanedReceipts = receipts.filter((r) => !matchedRxIds.has(r.id));

  return (
    <div className="p-8 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-6">Export</h2>

      {/* Status */}
      {status && (
        <div className={`p-4 rounded-lg border mb-6 ${status.ready ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
          {status.ready ? (
            <p className="text-green-800 font-medium">✅ Bereit zum Export</p>
          ) : (
            <div className="text-yellow-800">
              <p className="font-medium">⚠ Noch nicht bereit</p>
              {!status.has_statement && <p className="text-sm mt-1">Kreditkartenabrechnung fehlt</p>}
              {status.missing_receipts > 0 && (
                <p className="text-sm mt-1">{status.missing_receipts} Buchung(en) ohne bestätigten Beleg</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Download button */}
      <a
        href={exportPdfUrl(reportId)}
        download
        className={`inline-block px-6 py-3 rounded-md font-medium text-sm mb-8 ${
          status?.ready
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-muted text-muted-foreground cursor-not-allowed pointer-events-none"
        }`}
      >
        PDF-Paket herunterladen
      </a>

      {/* Summary table */}
      <h3 className="font-medium mb-3">Paketinhalt</h3>
      <div className="border border-border rounded-lg overflow-hidden text-sm">
        <div className="px-4 py-2 bg-muted font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Kreditkartenabrechnung
        </div>
        <div className="px-4 py-3 border-t border-border">
          {status?.has_statement ? "✓ statement.pdf" : "— noch nicht hochgeladen"}
        </div>

        <div className="px-4 py-2 bg-muted font-medium text-muted-foreground text-xs uppercase tracking-wide border-t border-border">
          Belege (nach Buchungsdatum)
        </div>
        {transactions
          .filter((t) => t.match?.receipt_id)
          .sort((a, b) => a.booking_date.localeCompare(b.booking_date))
          .map((tx) => {
            const rx = receipts.find((r) => r.id === tx.match?.receipt_id);
            return (
              <div key={tx.id} className="flex items-center justify-between px-4 py-2 border-t border-border">
                <div>
                  <span className="text-muted-foreground w-24 inline-block">{tx.booking_date}</span>
                  <span>{tx.description}</span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="text-muted-foreground">{rx?.extracted_vendor || rx?.filename}</span>
                  <span className="font-medium">{Math.abs(tx.amount).toFixed(2)} €</span>
                </div>
              </div>
            );
          })}

        {orphanedReceipts.length > 0 && (
          <>
            <div className="px-4 py-2 bg-yellow-50 font-medium text-yellow-700 text-xs uppercase tracking-wide border-t border-border">
              Belege ohne Buchung ({orphanedReceipts.length})
            </div>
            {orphanedReceipts.map((rx) => (
              <div key={rx.id} className="px-4 py-2 border-t border-border text-muted-foreground">
                {rx.extracted_vendor || rx.filename}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
