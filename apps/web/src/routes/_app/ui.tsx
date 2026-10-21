import { createFileRoute } from "@tanstack/react-router";
import { Fragment, type ReactNode, useState } from "react";

import {
  CaseStatus,
  DocumentKind,
  DocumentStatus,
  lesionsFromRedcapRows,
  lesionsFromSectorMap,
  type SectorLesion,
} from "@prostapaper/contracts";

import { fileKey } from "#lib/file-key";
import { icons } from "#lib/icons";
import { toast } from "#lib/toast";
import { trpcClient } from "#trpc";
import {
  Anchor,
  Badge,
  type BadgeVariant,
  Button,
  ButtonAnchor,
  ButtonLink,
  Card,
  CaseStatusBadge,
  ConfidenceBadge,
  DocumentKindBadge,
  DocumentStatusBadge,
  Dropzone,
  Expandable,
  type FileRejection,
  Icon,
  type IconName,
  Input,
  Join,
  JsonView,
  Link,
  Modal,
  SectorDiagram,
  type Size,
  SIZES,
  Skeleton,
  type Tone,
  TONES,
  type TooltipPosition,
  VARIANTS,
} from "#ui";

export const Route = createFileRoute("/_app/ui")({ component: UiShowcase });

const BADGE_VARIANTS: BadgeVariant[] = ["solid", "outline", "soft"];
const TOOLTIP_POSITIONS: TooltipPosition[] = ["top", "bottom", "left", "right"];
const CONFIDENCES: (number | null)[] = [0.97, 0.9, 0.82, 0.7, 0.41, null];
const ICON_NAMES = Object.keys(icons) as IconName[];

function UiShowcase() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Knihovna komponent</h1>
        <p className="text-sm opacity-70">
          Tenké obálky nad daisyUI 5 · téma <code>mou</code> · <code>#ui</code>
        </p>
      </header>
      <ButtonsSection />
      <BadgesSection />
      <LinksSection />
      <IconsSection />
      <InputsSection />
      <DropzoneSection />
      <CardsSection />
      <ModalSection />
      <ToastSection />
      <SkeletonSection />
      <JsonViewSection />
      <SectorDiagramSection />
    </div>
  );
}

interface SectionProps {
  heading: string;
  children: ReactNode;
}

function Section({ heading, children }: SectionProps) {
  return (
    <Card heading={heading}>
      <div className="flex flex-col gap-5">{children}</div>
    </Card>
  );
}

interface RowProps {
  label: string;
  children: ReactNode;
}

function Row({ label, children }: RowProps) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center">
      <span className="px-3 font-mono text-xs opacity-60">{label}</span>
      <div className="flex flex-wrap items-center gap-3 px-3 py-1">{children}</div>
    </div>
  );
}

interface MatrixProps<V extends string> {
  variants: readonly V[];
  render: (variant: V, tone: Tone) => ReactNode;
}

function Matrix<V extends string>({ variants, render }: MatrixProps<V>) {
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[7rem_repeat(7,auto)] items-center justify-items-start">
        <span />
        {TONES.map((tone) => (
          <span key={tone} className="px-3 py-2 font-mono text-xs opacity-60">
            {tone}
          </span>
        ))}
        {variants.map((variant) => (
          <Fragment key={variant}>
            <span className="px-3 py-2 font-mono text-xs opacity-60">{variant}</span>
            {TONES.map((tone) => (
              <div key={tone} className="px-3 py-2">
                {render(variant, tone)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ButtonsSection() {
  return (
    <Section heading="Button">
      <Matrix
        variants={VARIANTS}
        render={(variant, tone) => (
          <Button size="sm" variant={variant} tone={tone}>
            Akce
          </Button>
        )}
      />
      <Row label="size">
        {SIZES.map((size) => (
          <Button key={size} size={size} tone="primary">
            {size}
          </Button>
        ))}
      </Row>
      <Row label="state">
        <Button tone="primary" loading>
          Ukládám
        </Button>
        <Button tone="primary" disabled>
          Disabled
        </Button>
        <Button tone="primary" active>
          Active
        </Button>
        <Button shape="square" aria-label="Square">
          ■
        </Button>
        <Button shape="circle" aria-label="Circle">
          ●
        </Button>
        <Button shape="wide" variant="outline">
          Wide
        </Button>
      </Row>
      <Row label="tooltip">
        {TOOLTIP_POSITIONS.map((position) => (
          <Button
            key={position}
            size="sm"
            variant="outline"
            tooltip={`Nápověda ${position}`}
            tooltipPosition={position}
          >
            {position}
          </Button>
        ))}
        <Button size="sm" tone="primary" disabled tooltip="Nejprve zkontrolujte červená pole">
          Schválit
        </Button>
      </Row>
    </Section>
  );
}

function BadgesSection() {
  return (
    <Section heading="Badge · ConfidenceBadge">
      <Matrix
        variants={BADGE_VARIANTS}
        render={(variant, tone) => (
          <Badge size="sm" variant={variant} tone={tone}>
            {tone}
          </Badge>
        )}
      />
      <Row label="size">
        {SIZES.map((size) => (
          <Badge key={size} size={size} tone="primary">
            {size}
          </Badge>
        ))}
      </Row>
      <Row label="document status">
        {DocumentStatus.options.map((status) => (
          <DocumentStatusBadge key={status} size="sm" status={status} />
        ))}
      </Row>
      <Row label="document kind">
        {DocumentKind.options.map((kind) => (
          <DocumentKindBadge key={kind} size="sm" kind={kind} />
        ))}
      </Row>
      <Row label="case status">
        {CaseStatus.options.map((status) => (
          <CaseStatusBadge key={status} size="sm" status={status} />
        ))}
      </Row>
      <Row label="icon">
        {SIZES.map((size) => (
          <Badge key={size} size={size} tone="info" variant="outline" icon="microscope">
            {size}
          </Badge>
        ))}
        <Badge size="sm" variant="outline" icon="prostate" tooltip="Sektor označen v extrakci">
          sektor
        </Badge>
      </Row>
      <Row label="confidence">
        {CONFIDENCES.map((value) => (
          <ConfidenceBadge key={value ?? "null"} size="sm" value={value} />
        ))}
      </Row>
      <Row label="outline">
        {CONFIDENCES.map((value) => (
          <ConfidenceBadge key={value ?? "null"} size="sm" variant="outline" value={value} />
        ))}
      </Row>
    </Section>
  );
}

function LinksSection() {
  return (
    <Section heading="Link · ButtonLink">
      <Row label="Link">
        <Link to="/">default</Link>
        {TONES.map((tone) => (
          <Link key={tone} to="/" tone={tone}>
            {tone}
          </Link>
        ))}
        <Anchor href="https://daisyui.com/components/" target="_blank" rel="noreferrer" tone="primary">
          externí (Anchor) ↗
        </Anchor>
      </Row>
      <Row label="ButtonLink">
        <ButtonLink to="/" size="sm" tone="primary">
          Domů
        </ButtonLink>
        <ButtonLink to="/ui" size="sm" variant="outline" activeProps={{ className: "btn-active" }}>
          Aktivní
        </ButtonLink>
        <ButtonAnchor href="https://daisyui.com" target="_blank" rel="noreferrer" size="sm" variant="ghost">
          Externí (ButtonAnchor) ↗
        </ButtonAnchor>
      </Row>
    </Section>
  );
}

function IconsSection() {
  return (
    <Section heading="Icon · Health Icons (24px outline)">
      <Row label="size">
        {SIZES.map((size) => (
          <span key={size} className="flex items-center gap-1 font-mono text-xs opacity-60">
            <Icon name="prostate" size={size} /> {size}
          </span>
        ))}
        <span className="flex items-center gap-1 text-sm text-primary">
          <Icon name="prostate" label="Prostata" /> currentColor
        </span>
      </Row>
      <div className="grid grid-cols-6 gap-2">
        {ICON_NAMES.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1 rounded-box border border-base-300 p-3">
            <Icon name={name} size="lg" />
            <span className="font-mono text-xs opacity-60">{name}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function InputsSection() {
  return (
    <Section heading="Input">
      <Row label="size">
        {SIZES.map((size) => (
          <Input key={size} size={size} placeholder={size} className="w-28" />
        ))}
      </Row>
      <Row label="tone">
        {TONES.map((tone) => (
          <Input key={tone} size="sm" tone={tone} placeholder={tone} className="w-28" />
        ))}
      </Row>
      <Row label="misc">
        <Input size="sm" variant="ghost" placeholder="ghost" className="w-28" />
        <Input size="sm" disabled placeholder="disabled" className="w-28" />
        <Join>
          <Input size="sm" placeholder="join" className="join-item w-40" />
          <Button size="sm" tone="primary" className="join-item">
            Odeslat
          </Button>
        </Join>
      </Row>
    </Section>
  );
}

function DropzoneSection() {
  const [accepted, setAccepted] = useState<File[]>([]);
  const [rejected, setRejected] = useState<FileRejection[]>([]);
  const onFiles = (nextAccepted: File[], nextRejected: FileRejection[]) => {
    setAccepted(nextAccepted);
    setRejected(nextRejected);
  };
  let summary = "Zatím nic";
  if (accepted.length + rejected.length > 0) {
    summary = `${accepted.length} přijato · ${rejected.length} odmítnuto`;
  }

  let tone: Tone | undefined;
  if (rejected.length > 0) {
    tone = "error";
  } else if (accepted.length > 0) {
    tone = "success";
  }

  return (
    <Section heading="Dropzone · react-dropzone">
      <Row label="result">
        <Badge size="sm" tone={tone}>
          {summary}
        </Badge>
        {accepted.map((file) => (
          <Badge key={fileKey(file)} size="sm" variant="outline" icon="documentsAccepted">
            {file.name}
          </Badge>
        ))}
      </Row>
      <div className="grid gap-4 @2xl/main:grid-cols-2">
        <Dropzone size="sm" onFiles={onFiles} accept={{ "application/pdf": [".pdf"] }} multiple={false} />
        <Dropzone
          size="sm"
          onFiles={onFiles}
          accept={{ "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] }}
          maxSize={2_000_000}
          maxFiles={3}
          title="Snímky histologie"
        />
        <Dropzone size="sm" onFiles={onFiles} disabled title="disabled" hint="Čeká na přihlášení" />
        <Dropzone size="sm" onFiles={onFiles} loading title="loading" hint="Nahrávám předchozí dávku" />
      </div>
      <Dropzone
        size="lg"
        onFiles={onFiles}
        accept={{ "application/pdf": [".pdf"], "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] }}
        maxSize={20_000_000}
      />
    </Section>
  );
}

function CardsSection() {
  return (
    <Section heading="Card">
      <div className="grid gap-4 @4xl/main:grid-cols-3">
        <Card
          heading="shadow (výchozí)"
          actions={
            <Button size="sm" tone="primary">
              Schválit
            </Button>
          }
        >
          <p>Obsah karty. Akce vpravo dole.</p>
        </Card>
        <Card
          heading="border"
          variant="border"
          actions={
            <>
              <Button size="sm" variant="ghost">
                Zrušit
              </Button>
              <Button size="sm" tone="primary">
                Uložit
              </Button>
            </>
          }
        >
          <p>Dvě akce, ghost + primary.</p>
        </Card>
        <Card heading="dash" variant="dash">
          <p>Bez akcí. Hodí se pro prázdný stav / drop-zone.</p>
        </Card>
      </div>
      <div className="grid gap-4 @4xl/main:grid-cols-3">
        {(["xs", "sm", "lg"] as const).map((size) => (
          <Card key={size} heading={`size ${size}`} size={size} variant="border">
            <p>Hustota přes velikost.</p>
          </Card>
        ))}
      </div>
      <Card
        side
        variant="border"
        heading="side + figure"
        figure={<div className="h-full w-32 bg-base-300" />}
        actions={<Button size="sm">Otevřít</Button>}
      >
        <p>Obrázek vlevo, obsah vpravo — náhled strany.</p>
      </Card>
    </Section>
  );
}

function ModalSection() {
  const [size, setSize] = useState<Size>("md");
  const [open, setOpen] = useState(false);
  const [strictOpen, setStrictOpen] = useState(false);
  const openWith = (next: Size) => {
    setSize(next);
    setOpen(true);
  };
  const close = () => setOpen(false);

  return (
    <Section heading="Modal">
      <Row label="size">
        {SIZES.map((candidate) => (
          <Button key={candidate} size="sm" variant="outline" onClick={() => openWith(candidate)}>
            {candidate}
          </Button>
        ))}
      </Row>
      <Row label="strict">
        <Button size="sm" tone="error" variant="outline" onClick={() => setStrictOpen(true)}>
          Bez zavření mimo
        </Button>
      </Row>
      <Modal
        open={open}
        onClose={close}
        size={size}
        title={`Modal · ${size}`}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              Zrušit
            </Button>
            <Button tone="primary" onClick={close}>
              Potvrdit
            </Button>
          </>
        }
      >
        <p>Zavře se křížkem, Esc, kliknutím mimo nebo akcí.</p>
      </Modal>
      <Modal
        open={strictOpen}
        onClose={() => setStrictOpen(false)}
        dismissible={false}
        title="Opravdu smazat?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setStrictOpen(false)}>
              Ne
            </Button>
            <Button tone="error" onClick={() => setStrictOpen(false)}>
              Smazat
            </Button>
          </>
        }
      >
        <p>Žádný křížek ani backdrop — jen explicitní volba.</p>
      </Modal>
    </Section>
  );
}

function ToastSection() {
  const triggerTrpcError = async () => {
    try {
      await trpcClient.case.get.query({ caseId: "00000000-0000-0000-0000-000000000000" });
    } catch (error) {
      toast.error(error);
    }
  };
  const triggerUnknownError = () => toast.error(new Error("boom"));

  return (
    <Section heading="Toast · toast.success / toast.error / toast.info">
      <Row label="tone">
        <Button size="sm" tone="success" variant="outline" onClick={() => toast.success("Uloženo.")}>
          success
        </Button>
        <Button
          size="sm"
          tone="error"
          variant="outline"
          onClick={() => toast.error("Vlastní chybová hláška.")}
        >
          error
        </Button>
        <Button
          size="sm"
          tone="info"
          variant="outline"
          onClick={() => toast.info("Zpracování běží na pozadí.")}
        >
          info
        </Button>
      </Row>
      <Row label="z chyby">
        <Button size="sm" variant="outline" onClick={() => void triggerTrpcError()}>
          tRPC NOT_FOUND
        </Button>
        <Button size="sm" variant="outline" onClick={triggerUnknownError}>
          neznámá chyba
        </Button>
      </Row>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section heading="Skeleton">
      <Row label="řádek">
        <div className="flex w-full max-w-md items-center justify-between gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton round className="h-5 w-16" />
        </div>
      </Row>
      <Row label="blok">
        <Skeleton className="h-28 w-full max-w-md" />
      </Row>
      <Row label="avatar">
        <Skeleton round className="h-10 w-10" />
      </Row>
      <p className="text-sm opacity-70">
        Používá se jen v <code>pendingComponent</code> routy; router ho ukáže až po 300 ms a nechá aspoň 300
        ms.
      </p>
    </Section>
  );
}

const SAMPLE_RECORD = {
  psaNgPerMl: 4.1,
  specimen: { weightGrams: 40.2, dimensionsMm: null, seminalVesiclesPresent: true },
  tumourType: ["acinar_adenocarcinoma"],
  grade: { primary: 4, secondary: 3, tertiary: null, score: 7, gradeGroup: 3, percentPattern4: 60 },
  margins: { status: "not_involved", sites: [], types: [], lengthMm: null },
  lymphNodes: { status: "present", examined: 13, involved: 0, extranodalExtension: null },
  staging: { descriptors: [], pT: "T2c", pN: "N0", pM: "not_applicable", rClassification: "R0" },
};

function JsonViewSection() {
  return (
    <Section heading="JsonView · react-json-view-lite">
      <Row label="záznam">
        <JsonView data={SAMPLE_RECORD} className="w-full max-w-2xl rounded-box bg-base-200 p-3" />
      </Row>
    </Section>
  );
}

const SAMPLE_SHEET_LESIONS = lesionsFromSectorMap({
  pages: [
    {
      page: 1,
      foci: [
        {
          sectors: [
            { id: "base_PZpl_L", share: 0.62, coverage: 0.4 },
            { id: "mid_PZpl_L", share: 0.3, coverage: 0.18 },
            { id: "base_PZa_L", share: 0.08, coverage: 0.04 },
          ],
          marked: ["base_PZpl_L", "mid_PZpl_L"],
        },
        { sectors: [{ id: "apex_TZp_R", share: 1, coverage: 0.35 }], marked: ["apex_TZp_R"] },
        { sectors: [{ id: "sv_L", share: 1, coverage: 0.22 }], marked: ["sv_L"] },
      ],
    },
  ],
});

const SAMPLE_RECORD_LESIONS: SectorLesion[] = [
  {
    marked: ["pzpm_mid_rs", "pzpl_base_rs"],
    candidates: [],
    detail: {},
    gradeGroup: null,
  },
];

const SAMPLE_REDCAP_LESIONS = lesionsFromRedcapRows([
  {
    record_id: "CMP-1",
    redcap_repeat_instrument: "surgery_c61_resected_lesion",
    redcap_repeat_instance: "1",
    sur_prostate_regions___tza_mid_rs: "1",
    sur_prostate_regions___tza_mid_ls: "1",
    sur_prostate_regions___as_mid_rs: "1",
    sur_prostate_regions___urethra: "1",
  },
]);

function SectorDiagramSection() {
  return (
    <Section heading="SectorDiagram · sektorová mapa">
      <div className="grid gap-6 @3xl/main:grid-cols-3">
        <Expandable title="Sektorová mapa">
          <SectorDiagram lesions={SAMPLE_SHEET_LESIONS} aria-label="Z analýzy listu" />
        </Expandable>
        <SectorDiagram lesions={SAMPLE_RECORD_LESIONS} aria-label="Ze záznamu" />
        <SectorDiagram lesions={SAMPLE_REDCAP_LESIONS} aria-label="Z řádku REDCap" />
      </div>
    </Section>
  );
}
