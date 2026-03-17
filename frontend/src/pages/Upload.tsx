import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadStatement, uploadReceipts, runAutoMatch, getTransactions, getReceipts } from "@/integrations/api/api";
import type { Receipt, Transaction } from "@/integrations/api/types";

interface Props {
  reportId: string | null;
}

export function Upload({ reportId }: Props) {
  const qc = useQueryClient();
  const [statementFile, setStatementFile] = useState<File | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);

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

  const statementMut = useMutation({
    mutationFn: (f: File) => uploadStatement(reportId!, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions", reportId] });
      qc.invalidateQueries({ queryKey: ["dashboard", reportId] });
      setStatementFile(null);
    },
  });

  const receiptsMut = useMutation({
    mutationFn: (files: File[]) => uploadReceipts(reportId!, files),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts", reportId] });
      qc.invalidateQueries({ queryKey: ["dashboard", reportId] });
      setReceiptFiles([]);
    },
  });

  const matchMut = useMutation({
    mutationFn: () => runAutoMatch(reportId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions", reportId] });
      qc.invalidateQueries({ queryKey: ["receipts", reportId] });
      qc.invalidateQueries({ queryKey: ["dashboard", reportId] });
      qc.invalidateQueries({ queryKey: ["todo", reportId] });
    },
  });

  const onDropStatement = useCallback((accepted: File[]) => {
    if (accepted[0]) setStatementFile(accepted[0]);
  }, []);

  const onDropReceipts = useCallback((accepted: File[]) => {
    setReceiptFiles((prev) => [...prev, ...accepted]);
  }, []);

  const { getRootProps: getStatementProps, getInputProps: getStatementInputProps, isDragActive: isDragStatement } =
    useDropzone({ onDrop: onDropStatement, accept: { "application/pdf": [".pdf"] }, maxFiles: 1 });

  const { getRootProps: getReceiptsProps, getInputProps: getReceiptsInputProps, isDragActive: isDragReceipts } =
    useDropzone({ onDrop: onDropReceipts, accept: { "application/pdf": [".pdf"] } });

  if (!reportId) {
    return <div className="p-8 text-muted-foreground">Kein Bericht ausgewählt.</div>;
  }

  const canAutoMatch = transactions.length > 0 && receipts.length > 0;

  return (
    <div className="p-8 max-w-4xl">
      <h2 className="text-2xl font-semibold mb-6">Dokumente hochladen</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* CC Statement drop zone */}
        <div>
          <h3 className="font-medium mb-2">Kreditkartenabrechnung</h3>
          <div
            {...getStatementProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragStatement ? "border-primary bg-blue-50" : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getStatementInputProps()} />
            {statementFile ? (
              <p className="text-sm text-foreground">{statementFile.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground">PDF hierher ziehen oder klicken</p>
            )}
          </div>
          {statementFile && (
            <button
              onClick={() => statementMut.mutate(statementFile)}
              disabled={statementMut.isPending}
              className="mt-2 w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {statementMut.isPending ? "Verarbeite..." : "Hochladen & Verarbeiten"}
            </button>
          )}
          {statementMut.isError && (
            <p className="text-xs text-red-500 mt-1">{(statementMut.error as Error).message}</p>
          )}
          {transactions.length > 0 && (
            <p className="text-xs text-green-600 mt-2">✓ {transactions.length} Buchungen geladen</p>
          )}
        </div>

        {/* Receipts drop zone */}
        <div>
          <h3 className="font-medium mb-2">Belege ({receipts.length} gespeichert)</h3>
          <div
            {...getReceiptsProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragReceipts ? "border-primary bg-blue-50" : "border-border hover:border-primary/50"
            }`}
          >
            <input {...getReceiptsInputProps()} />
            {receiptFiles.length > 0 ? (
              <p className="text-sm text-foreground">{receiptFiles.length} Datei(en) bereit</p>
            ) : (
              <p className="text-sm text-muted-foreground">Mehrere PDFs hochladen</p>
            )}
          </div>
          {receiptFiles.length > 0 && (
            <button
              onClick={() => receiptsMut.mutate(receiptFiles)}
              disabled={receiptsMut.isPending}
              className="mt-2 w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {receiptsMut.isPending ? `Verarbeite ${receiptFiles.length} Dateien...` : `${receiptFiles.length} Beleg(e) hochladen`}
            </button>
          )}
          {receiptsMut.isError && (
            <p className="text-xs text-red-500 mt-1">{(receiptsMut.error as Error).message}</p>
          )}
        </div>
      </div>

      {/* Auto-match button */}
      <div className="mb-8">
        <button
          onClick={() => matchMut.mutate()}
          disabled={!canAutoMatch || matchMut.isPending}
          className="px-6 py-2 bg-green-600 text-white rounded-md text-sm font-medium disabled:opacity-50 hover:bg-green-700 transition-colors"
        >
          {matchMut.isPending ? "Gleiche ab..." : "Auto-Abgleich starten"}
        </button>
        {!canAutoMatch && (
          <p className="text-xs text-muted-foreground mt-1">Lade zuerst Abrechnung und Belege hoch.</p>
        )}
        {matchMut.isSuccess && (
          <p className="text-xs text-green-600 mt-1">✓ {matchMut.data.length} Matches gefunden</p>
        )}
      </div>

      {/* Receipts list */}
      {receipts.length > 0 && (
        <div>
          <h3 className="font-medium mb-2">Hochgeladene Belege</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            {receipts.map((r, i) => (
              <ReceiptRow key={r.id} receipt={r} isFirst={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReceiptRow({ receipt, isFirst }: { receipt: Receipt; isFirst: boolean }) {
  const confidence = Math.round(receipt.extraction_confidence * 100);
  const color = confidence >= 70 ? "text-green-600" : confidence >= 40 ? "text-yellow-600" : "text-red-500";
  return (
    <div className={`flex items-center gap-4 px-4 py-3 text-sm ${!isFirst ? "border-t border-border" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{receipt.extracted_vendor || receipt.filename}</p>
        <p className="text-xs text-muted-foreground">{receipt.filename}</p>
      </div>
      <div className="text-right shrink-0">
        {receipt.extracted_amount != null && (
          <p className="font-medium">{receipt.extracted_amount.toFixed(2)} €</p>
        )}
        {receipt.extracted_date && (
          <p className="text-xs text-muted-foreground">{receipt.extracted_date}</p>
        )}
      </div>
      <div className={`text-xs font-medium w-12 text-right ${color}`}>{confidence}%</div>
      <div className="text-xs text-muted-foreground w-16 text-right">
        {receipt.extraction_method === "vision_llm" ? "🤖 OCR" : "📄 Text"}
      </div>
      {receipt.match && (
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">✓ zugeordnet</span>
      )}
    </div>
  );
}
