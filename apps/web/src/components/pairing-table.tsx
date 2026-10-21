import type { BatchPairing, PairingIssue } from "#lib/batch-pairing";
import { cx } from "#lib/cx";
import { fileKey } from "#lib/file-key";
import { Button, Icon, Input } from "#ui";

const ISSUE: Record<PairingIssue, string> = {
  orphan: "Chybí textový popis",
  duplicate: "Číslo případu se opakuje",
  unknown: "Z názvu nepoznáme typ",
};

interface PairingTableProps {
  pairing: BatchPairing;
  disabled: boolean;
  onRemove: (...files: (File | undefined)[]) => void;
  onRename: (stem: string, name: string) => void;
  className?: string | undefined;
}

export function PairingTable({ pairing, disabled, onRemove, onRename, className }: PairingTableProps) {
  const removeButton = (files: (File | undefined)[], label: string) => (
    <Button
      size="xs"
      variant="ghost"
      shape="square"
      aria-label={label}
      tooltip={label}
      disabled={disabled}
      onClick={() => onRemove(...files)}
    >
      <Icon name="close" />
    </Button>
  );

  return (
    <div className={cx("overflow-auto rounded-box border border-base-300 bg-base-100", className)}>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Případ</th>
            <th>Textový popis</th>
            <th>Sektorová mapa</th>
            <th className="w-0" />
          </tr>
        </thead>
        <tbody>
          {pairing.cases.map((entry) => (
            <tr key={entry.stem}>
              <td className="min-w-40">
                <Input
                  size="sm"
                  variant="ghost"
                  aria-label={`Název případu ${entry.report.name}`}
                  value={entry.name}
                  maxLength={255}
                  required
                  disabled={disabled}
                  className="w-full px-1 font-medium"
                  onChange={(event) => onRename(entry.stem, event.target.value)}
                />
              </td>
              <td className="truncate">{entry.report.name}</td>
              <td className={cx("truncate", entry.sheet === undefined && "opacity-50")}>
                {entry.sheet?.name ?? "—"}
              </td>
              <td className="text-right">{removeButton([entry.report, entry.sheet], "Odebrat případ")}</td>
            </tr>
          ))}
          {pairing.problems.map(({ file, issue }) => (
            <tr key={fileKey(file)} className="text-error">
              <td className="flex items-center gap-1.5">
                <Icon name="circleAlert" className="size-4 shrink-0" />
                {ISSUE[issue]}
              </td>
              <td colSpan={2} className="truncate">
                {file.name}
              </td>
              <td className="text-right">{removeButton([file], "Odebrat soubor")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
