export interface ApiLogEntry {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  success: boolean;
  errorMessage: string | null;
}

export interface ApiCostSummary {
  totalCost: number;
  totalCalls: number;
  byProvider: { provider: string; cost: number; calls: number }[];
}
