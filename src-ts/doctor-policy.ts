// src-ts/doctor-policy.ts
import type { DoctorReport } from "./types.js";

export function shouldFailDoctorGate(report: DoctorReport, failOnWarn: boolean): boolean {
  if (report.overall === "FAIL") return true;
  if (failOnWarn && report.overall === "WARN") return true;
  return false;
}

