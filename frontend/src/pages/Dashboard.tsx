import { useQuery } from "@tanstack/react-query";
import { getReportDashboard, getTodo } from "@/integrations/api/api";

interface Props {
  reportId: string | null;
}

export function Dashboard({ reportId }: Props) {
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["dashboard", reportId],
    queryFn: () => getReportDashboard(reportId!),
    enabled: !!reportId,
  });

  const { data: todo } = useQuery({
    queryKey: ["todo", reportId],
    queryFn: () => getTodo(reportId!),
    enabled: !!reportId,
  });

  if (!reportId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Kein Bericht ausgewählt — erstelle einen neuen Bericht in der Seitenleiste.
      </div>
    );
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Lade...</div>;
  if (!dashboard) return <div className="p-8 text-red-500">Fehler beim Laden</div>;

  const { stats } = dashboard;

  return (
    <div className="p-8 max-w-4xl">
      <h2 className="text-2xl font-semibold mb-6">
        Übersicht — {MONTHS_DE[dashboard.report.month]} {dashboard.report.year}
      </h2>

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Umsätze" value={stats.total_transactions} color="blue" />
        <StatCard
          label="Belegt"
          value={stats.matched}
          color="green"
          sub={`von ${stats.total_transactions}`}
        />
        <StatCard
          label="Fehlende Belege"
          value={stats.missing_receipts}
          color={stats.missing_receipts > 0 ? "red" : "green"}
        />
        <StatCard
          label="Ausgaben gesamt"
          value={`${stats.total_spend.toFixed(2)} €`}
          color="gray"
          isText
        />
      </div>

      {/* Orphaned receipts warning */}
      {stats.orphaned_receipts > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          ⚠ {stats.orphaned_receipts} Beleg{stats.orphaned_receipts > 1 ? "e" : ""} ohne Buchung
        </div>
      )}

      {/* Ready banner */}
      {stats.ready_to_export && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
          ✅ Alle Buchungen belegt — bereit zum Export!
        </div>
      )}

      {/* Todo list */}
      {todo && todo.missing_count > 0 && (
        <div>
          <h3 className="text-lg font-medium mb-3 text-red-700">
            Fehlende Belege ({todo.missing_count})
          </h3>
          <div className="border border-border rounded-lg overflow-hidden">
            {todo.items.map((item, i) => (
              <div
                key={item.transaction_id}
                className={`flex items-center justify-between px-4 py-3 text-sm ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="flex gap-4">
                  <span className="text-muted-foreground w-24">{item.booking_date}</span>
                  <span className="text-foreground">{item.description}</span>
                </div>
                <span className="font-medium text-foreground">
                  {Math.abs(item.amount).toFixed(2)} {item.currency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  sub,
  isText = false,
}: {
  label: string;
  value: string | number;
  color: "blue" | "green" | "red" | "gray";
  sub?: string;
  isText?: boolean;
}) {
  const colors: Record<string, string> = {
    blue: "text-blue-600",
    green: "text-green-600",
    red: "text-red-600",
    gray: "text-foreground",
  };
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

const MONTHS_DE = [
  "", "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
