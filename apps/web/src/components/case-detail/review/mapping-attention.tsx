import type { MappingAttention, MappingAttentionItem } from "#lib/mapping-review";
import { Badge, Button, Icon } from "#ui";

interface MappingAttentionListProps {
  attention: MappingAttention;
  onSelect: (item: MappingAttentionItem) => void;
}

export function MappingAttentionList({ attention, onSelect }: MappingAttentionListProps) {
  return (
    <section
      aria-labelledby="mapping-attention-title"
      className="rounded-box border border-base-300 bg-base-200/40 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 id="mapping-attention-title" className="font-semibold">
            K ověření
          </h3>
          <Badge size="sm" variant="outline">
            {attention.items.length}
          </Badge>
        </div>
      </div>
      {attention.items.length === 0 && (
        <p className="mt-2 text-sm text-base-content/60">
          Žádné položky k dořešení. Stav potvrzení najdete u jednotlivých sekcí.
        </p>
      )}
      {attention.items.length > 0 && (
        <details className="mt-3 border-t border-base-300 pt-2">
          <summary className="review-disclosure px-2 py-2.5 text-sm font-medium">
            <Icon name="chevronDown" size="sm" />
            <span>Zobrazit všechny položky ({attention.items.length})</span>
          </summary>
          <ul className="mt-2 grid max-h-80 gap-2 overflow-y-auto p-1">
            {attention.items.map((item) => (
              <li key={item.key}>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex h-auto w-full items-center justify-start gap-3 rounded-box border border-base-300 bg-base-100 p-3 text-left whitespace-normal transition-colors hover:border-base-content/25"
                  onClick={() => onSelect(item)}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${attentionIconClass(item.priority)}`}
                  >
                    <Icon name={attentionIcon(item.priority)} size="sm" />
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium wrap-anywhere">{item.label}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed font-normal text-base-content/70">
                      {item.message}
                    </span>
                  </span>
                  <Icon
                    name="chevronDown"
                    size="xs"
                    className="ml-auto shrink-0 -rotate-90 text-base-content/40"
                  />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function attentionIcon(priority: number) {
  if (priority === 0) return "circleAlert";
  if (priority === 1) return "map";

  return "clipboardList";
}

function attentionIconClass(priority: number) {
  if (priority === 0) return "bg-error/10 text-error";

  return "bg-base-200 text-base-content/70";
}
