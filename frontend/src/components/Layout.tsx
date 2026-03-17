import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getReports, createReport } from "@/integrations/api/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Report } from "@/integrations/api/types";

const MONTHS_DE = [
  "", "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

interface LayoutProps {
  children: React.ReactNode;
  reportId?: string;
  onReportChange?: (id: string) => void;
}

export function Layout({ children, reportId, onReportChange }: LayoutProps) {
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const { email, logout } = useAuth();

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

  const navLinks = [
    { to: "/", label: "Dashboard" },
    { to: "/upload", label: "Upload" },
    { to: "/matching", label: "Abgleich" },
    { to: "/export", label: "Export" },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-muted/30 flex flex-col p-4 gap-4 shrink-0">
        <div>
          <h1 className="font-semibold text-lg text-foreground">Spesenhelfer</h1>
          <p className="text-xs text-muted-foreground">Kreditkarte & Reisekosten</p>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={reportId ? `${l.to}?report=${reportId}` : l.to}
              className={`px-3 py-2 rounded-md text-sm transition-colors ${
                location.pathname === l.to
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <hr className="border-border" />

        {/* Report selector */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">Berichte</p>
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => onReportChange?.(r.id)}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                r.id === reportId ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-muted text-foreground"
              }`}
            >
              <span>{MONTHS_DE[r.month]} {r.year}</span>
              <StatusDot status={r.status} />
            </button>
          ))}
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md text-left transition-colors"
          >
            {creating ? "..." : "+ Neuer Bericht"}
          </button>
        </div>

        {/* User / logout */}
        <div className="mt-auto pt-4 border-t border-border">
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
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

function StatusDot({ status }: { status: Report["status"] }) {
  const colors: Record<string, string> = {
    draft: "bg-yellow-400",
    ready: "bg-green-400",
    exported: "bg-blue-400",
  };
  return <span className={`w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-300"}`} />;
}
