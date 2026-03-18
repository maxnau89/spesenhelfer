import { useState } from "react";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import { Abgleich } from "@/pages/Abgleich";
import { Login } from "@/pages/Login";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <div className="flex items-center justify-center h-screen text-muted-foreground">Lade...</div>;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reportId, setReportId] = useState<string | null>(searchParams.get("report"));

  const handleReportChange = (id: string) => {
    setReportId(id);
    setSearchParams({ report: id });
  };

  return (
    <Layout reportId={reportId ?? undefined} onReportChange={handleReportChange}>
      <Routes>
        <Route path="/" element={<Abgleich reportId={reportId} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppContent />
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
