import { PaperGraphic } from "#ui/paper-graphic";

import Microscope from "~icons/healthicons/microscope-outline-24px";

interface AuthReportGraphicProps {
  className?: string | undefined;
}

export function AuthReportGraphic({ className }: AuthReportGraphicProps) {
  return (
    <PaperGraphic fold="bottom-left" className={className}>
      <g fill="currentColor" className="text-base-content/10">
        <rect x="174" y="326" width="88" height="12" rx="6" />
        <rect x="270" y="326" width="52" height="12" rx="6" />
        <rect x="174" y="350" width="42" height="6" rx="3" />
        <rect x="224" y="350" width="60" height="6" rx="3" />
        <rect x="438" y="326" width="48" height="22" rx="11" fillOpacity="0.5" />
        <g>
          <rect x="174" y="394" width="44" height="7" rx="3.5" />
          <rect x="227" y="394" width="72" height="7" rx="3.5" />
          <rect x="308" y="394" width="32" height="7" rx="3.5" />
          <rect x="349" y="394" width="56" height="7" rx="3.5" />
          <rect x="414" y="394" width="60" height="7" rx="3.5" />
          <rect x="174" y="412" width="25" height="7" rx="3.5" />
          <rect x="214" y="412" width="38" height="7" rx="3.5" />
          <rect x="260" y="412" width="55" height="7" rx="3.5" />
          <rect x="332" y="412" width="30" height="7" rx="3.5" />
          <rect x="370" y="412" width="48" height="7" rx="3.5" />
          <rect x="426" y="412" width="40" height="7" rx="3.5" />
          <rect x="174" y="440" width="60" height="5" rx="2.5" />
          <rect x="242" y="440" width="34" height="5" rx="2.5" />
          <rect x="284" y="440" width="48" height="5" rx="2.5" />
          <rect x="174" y="452" width="30" height="5" rx="2.5" />
          <rect x="212" y="452" width="52" height="5" rx="2.5" />
        </g>
      </g>
      <rect
        x="206"
        y="405"
        width="118"
        height="21"
        rx="5"
        fill="var(--color-primary)"
        fillOpacity="0.07"
        className="auth-report-fill"
      />
      <rect
        x="206"
        y="405"
        width="118"
        height="21"
        rx="5"
        pathLength="1"
        stroke="var(--color-primary)"
        strokeOpacity="0.4"
        strokeWidth="1.5"
        className="auth-report-highlight"
      />
      <path
        d="M324 415.5h28q32 0 32 32V466"
        pathLength="1"
        stroke="var(--color-primary)"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="auth-report-connector"
      />
      <g className="auth-report-finding">
        <rect
          x="190"
          y="466"
          width="228"
          height="80"
          rx="18"
          fill="var(--color-base-100)"
          stroke="currentColor"
          className="text-base-content/10"
        />
        <g className="auth-report-finding-icon">
          <rect
            x="206"
            y="484"
            width="44"
            height="44"
            rx="12"
            fill="var(--color-primary)"
            fillOpacity="0.06"
          />
          <Microscope x="214" y="492" width="28" height="28" className="text-primary/60" />
        </g>
        <rect
          x="266"
          y="490"
          width="88"
          height="6"
          rx="3"
          fill="currentColor"
          className="auth-report-finding-label text-base-content/15"
        />
        <rect
          x="266"
          y="508"
          width="124"
          height="9"
          rx="4.5"
          fill="var(--color-primary)"
          fillOpacity="0.25"
          className="auth-report-finding-value"
        />
      </g>
    </PaperGraphic>
  );
}
