import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createReport, deleteReport, getReports, updateReport } from "@/integrations/api/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Report } from "@/integrations/api/types";

const MONTHS_DE = [
  "", "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function defaultLabel(r: Report) {
  return `${MONTHS_DE[r.month]} ${r.year}`;
}

function reportLabel(r: Report) {
  return r.notes?.trim() || defaultLabel(r);
}

interface LayoutProps {
  children: React.ReactNode;
  reportId?: string;
  onReportChange?: (id: string) => void;
}

export function Layout({ children, reportId, onReportChange }: LayoutProps) {
  const [creating, setCreating] = useState(false);
  const { email, logout } = useAuth();
  const queryClient = useQueryClient();

  const { data: reports = [], refetch } = useQuery({
    queryKey: ["reports"],
    queryFn: getReports,
  });

  const handleCreate = async () => {
    const now = new Date();
    try {
      setCreating(true);
      const r = await createReport(now.getFullYear(), now.getMonth() + 1);
      await refetch();
      onReportChange?.(r.id);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Abrechnung wirklich löschen?")) return;
    await deleteReport(id);
    await refetch();
    if (reportId === id) onReportChange?.("");
  };

  const handleRename = async (id: string, notes: string) => {
    await updateReport(id, notes);
    await refetch();
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 border-r border-border bg-muted/30 flex flex-col p-4 gap-4 shrink-0">
        <div>
          <h1 className="font-semibold text-base text-foreground">Spesenhelfer</h1>
          <p className="text-xs text-muted-foreground">Kreditkarte & Reisekosten</p>
        </div>

        <hr className="border-border" />

        {/* Report list */}
        <div className="flex flex-col gap-1 flex-1 min-h-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
            Abrechnungen
          </p>
          <div className="overflow-y-auto flex-1 flex flex-col gap-1">
            {reports.map((r) => (
              <ReportEntry
                key={r.id}
                report={r}
                selected={r.id === reportId}
                onSelect={() => onReportChange?.(r.id)}
                onRename={(notes) => handleRename(r.id, notes)}
                onDelete={() => handleDelete(r.id)}
              />
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md text-left transition-colors"
          >
            {creating ? "…" : "+ Neue Abrechnung"}
          </button>
        </div>

        {/* User / logout */}
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground truncate px-1 mb-2">{email}</p>
          <button
            onClick={logout}
            className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            Abmelden
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}

function ReportEntry({
  report,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  report: Report;
  selected: boolean;
  onSelect: () => void;
  onRename: (notes: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [displayLabel, setDisplayLabel] = useState(reportLabel(report));
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep displayLabel in sync when report prop updates (after refetch)
  // but not while editing
  if (!editing && reportLabel(report) !== displayLabel && displayLabel === reportLabel(report)) {
    setDisplayLabel(reportLabel(report));
  }

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const current = reportLabel(report);
    setInputValue(current === defaultLabel(report) ? "" : current);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = async () => {
    setEditing(false);
    const trimmed = inputValue.trim();
    const newLabel = trimmed || defaultLabel(report);
    setDisplayLabel(newLabel);
    await onRename(trimmed); // empty string clears the custom name
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setEditing(false); }
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          ref={inputRef}
          autoFocus
          value={inputValue}
          placeholder={defaultLabel(report)}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-full text-sm bg-background border border-primary/60 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center rounded-md transition-colors ${
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex-1 text-left px-3 py-2 text-sm truncate"
      >
        {displayLabel}
      </button>

      {/* Action icons — visible on hover */}
      <div className="flex items-center gap-0.5 pr-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <StatusDot status={report.status} selected={selected} />
        <button
          onClick={startEdit}
          title="Umbenennen"
          className={`p-0.5 rounded ${selected ? "hover:bg-white/20" : "hover:bg-muted-foreground/20"}`}
        >
          <PencilIcon className={selected ? "text-primary-foreground/70" : "text-muted-foreground"} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Löschen"
          className={`p-0.5 rounded ${selected ? "hover:bg-red-400/30" : "hover:bg-red-100"}`}
        >
          <TrashIcon className={selected ? "text-primary-foreground/70" : "text-muted-foreground hover:text-red-500"} />
        </button>
      </div>

      {/* Status dot when not hovered */}
      <div className="group-hover:hidden pr-2 shrink-0">
        <StatusDot status={report.status} selected={selected} />
      </div>
    </div>
  );
}

function StatusDot({ status, selected }: { status: Report["status"]; selected: boolean }) {
  const colors: Record<string, string> = {
    draft:    selected ? "bg-yellow-300" : "bg-yellow-400",
    ready:    selected ? "bg-green-300"  : "bg-green-400",
    exported: selected ? "bg-blue-300"   : "bg-blue-400",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] ?? "bg-gray-300"}`} />;
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M11.013 1.427a1.75 1.75 0 0 1 2.474 2.474L4.92 12.468l-3.535.884.884-3.535L11.013 1.427z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5zM4.5 2.5H2a.5.5 0 0 0 0 1h.553l.822 9.236A1.5 1.5 0 0 0 4.87 14h6.26a1.5 1.5 0 0 0 1.495-1.264L13.447 3.5H14a.5.5 0 0 0 0-1h-2.5v-1A1.5 1.5 0 0 0 10 0H6A1.5 1.5 0 0 0 4.5 1.5v1z"
        fill="currentColor"
      />
    </svg>
  );
}
