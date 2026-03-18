export interface Match {
  id: string;
  transaction_id: string;
  receipt_id: string | null;
  extra_receipt_ids: string[];
  match_type: "auto" | "manual" | "acknowledged_missing" | "no_receipt_needed";
  confidence: number;
  confirmed: boolean;
  notes: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  report_id: string;
  booking_date: string;
  value_date: string | null;
  description: string;
  amount: number;
  currency: string;
  category: string | null;
  needs_receipt: boolean;
  match: Match | null;
}

export interface Receipt {
  id: string;
  report_id: string;
  filename: string;
  extracted_date: string | null;
  extracted_amount: number | null;
  extracted_currency: string | null;
  extracted_vendor: string | null;
  extraction_confidence: number;
  extraction_method: "pdfplumber" | "vision_llm";
  match: Match | null;
}

export interface Report {
  id: string;
  year: number;
  month: number;
  status: "draft" | "ready" | "exported";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportStats {
  total_transactions: number;
  total_spend: number;
  matched: number;
  missing_receipts: number;
  orphaned_receipts: number;
  ready_to_export: boolean;
}

export interface ReportDashboard {
  report: Report;
  stats: ReportStats;
}

export interface TodoItem {
  transaction_id: string;
  booking_date: string;
  description: string;
  amount: number;
  currency: string;
}

export interface TodoList {
  report_id: string;
  missing_count: number;
  items: TodoItem[];
}
