/** Must match `PAUSE_REASONS` in `backend/app/services/kiosk_work_report_service.py`. */
export const WORK_REPORT_PAUSE_REASONS = [
  "seřízení",
  "čekání na materiál",
  "čekání na kontrolu",
  "porucha stroje",
  "oběd",
  "jiný důvod",
] as const;

export type WorkReportPauseReason = (typeof WORK_REPORT_PAUSE_REASONS)[number];
