export interface BusinessHoursEntry {
  weekday: number;
  opens: string;
  closes: string;
}

export interface BusinessHoursData {
  summaryLabel: string;
  entries: BusinessHoursEntry[];
}
