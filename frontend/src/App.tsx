import { useState } from "react";
import { BrowserRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Upload } from "@/pages/Upload";
import { Matching } from "@/pages/Matching";
import { Export } from "@/pages/Export";

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

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
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
