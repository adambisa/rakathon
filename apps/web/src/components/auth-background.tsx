import { AuthReportGraphic } from "#components/auth-report-graphic";
import { PaperGraphic } from "#ui/paper-graphic";

export function AuthBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <AuthReportGraphic className="auth-background-report absolute -right-80 w-[520px] opacity-60 sm:-right-64 sm:w-[600px] sm:opacity-100 lg:-right-52 xl:-right-32" />
      <PaperGraphic
        fold="top-right"
        className="absolute -bottom-56 -left-64 w-[440px] opacity-60 sm:-bottom-52 sm:-left-48 sm:w-[520px] sm:opacity-100 lg:-left-24 xl:-left-8"
      />
    </div>
  );
}
