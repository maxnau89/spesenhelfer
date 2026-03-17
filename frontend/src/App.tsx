import { useState } from "react";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Upload } from "@/pages/Upload";
import { Matching } from "@/pages/Matching";
import { Export } from "@/pages/Export";
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
        <Route path="/" element={<Dashboard reportId={reportId} />} />
        <Route path="/upload" element={<Upload reportId={reportId} />} />
        <Route path="/matching" element={<Matching reportId={reportId} />} />
        <Route path="/export" element={<Export reportId={reportId} />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
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
