import { httpClient } from "./httpClient";
import type { Match, Receipt, Report, ReportDashboard, TodoList, Transaction } from "./types";

// Reports
export const getReports = () => httpClient.get<Report[]>("/api/v1/reports");
export const createReport = (year: number, month: number) =>
  httpClient.post<Report>("/api/v1/reports", { body: { year, month } });
export const getReportDashboard = (id: string) =>
  httpClient.get<ReportDashboard>(`/api/v1/reports/${id}`);
export const deleteReport = (id: string) => httpClient.delete(`/api/v1/reports/${id}`);
export const getTodo = (id: string) => httpClient.get<TodoList>(`/api/v1/reports/${id}/todo`);

// Transactions
export const uploadStatement = (reportId: string, file: File): Promise<Transaction[]> => {
  const fd = new FormData();
  fd.append("file", file);
  return httpClient.post<Transaction[]>(`/api/v1/reports/${reportId}/statement`, { body: fd });
};
export const getTransactions = (reportId: string) =>
  httpClient.get<Transaction[]>(`/api/v1/reports/${reportId}/transactions`);
export const updateTransaction = (txId: string, data: { category?: string; needs_receipt?: boolean }) =>
  httpClient.patch<Transaction>(`/api/v1/transactions/${txId}`, { body: data });

// Receipts
export const uploadReceipts = (reportId: string, files: File[]): Promise<Receipt[]> => {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  return httpClient.post<Receipt[]>(`/api/v1/reports/${reportId}/receipts`, { body: fd });
};
export const getReceipts = (reportId: string) =>
  httpClient.get<Receipt[]>(`/api/v1/reports/${reportId}/receipts`);
export const deleteReceipt = (receiptId: string) => httpClient.delete(`/api/v1/receipts/${receiptId}`);

// Matches
export const runAutoMatch = (reportId: string) =>
  httpClient.post<Match[]>(`/api/v1/reports/${reportId}/match`, {});
export const getMatches = (reportId: string) =>
  httpClient.get<Match[]>(`/api/v1/reports/${reportId}/matches`);
export const createMatch = (transactionId: string, receiptId: string | null) =>
  httpClient.post<Match>("/api/v1/matches", { body: { transaction_id: transactionId, receipt_id: receiptId, match_type: "manual" } });
export const updateMatch = (matchId: string, data: { receipt_id?: string | null; confirmed?: boolean; match_type?: string }) =>
  httpClient.patch<Match>(`/api/v1/matches/${matchId}`, { body: data });
export const deleteMatch = (matchId: string) => httpClient.delete(`/api/v1/matches/${matchId}`);
export const acknowledgeMatch = (matchId: string) =>
  httpClient.post<Match>(`/api/v1/matches/${matchId}/acknowledge`, {});
export const markNoReceipt = (txId: string) =>
  httpClient.post<Match>(`/api/v1/transactions/${txId}/no-receipt`, {});

// Export
export const getExportStatus = (reportId: string) =>
  httpClient.get<{ ready: boolean; has_statement: boolean; missing_receipts: number }>(`/api/v1/reports/${reportId}/export/status`);
export const exportPdfUrl = (reportId: string) => `/api/v1/reports/${reportId}/export/pdf`;
