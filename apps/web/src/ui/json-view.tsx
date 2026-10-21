import { JsonView as LiteJsonView, type Props as LiteProps } from "react-json-view-lite";

import { cx } from "#lib/cx";

const styles: NonNullable<LiteProps["style"]> = {
  container: "font-mono text-sm leading-6",
  basicChildStyle: "ml-4",
  label: "text-base-content/70 mr-1",
  clickableLabel: "text-base-content/70 mr-1 cursor-pointer hover:underline",
  nullValue: "text-base-content/40",
  undefinedValue: "text-base-content/40",
  numberValue: "text-info",
  stringValue: "text-success",
  booleanValue: "text-warning",
  otherValue: "text-base-content",
  punctuation: "text-base-content/50",
  expandIcon: "mr-1 cursor-pointer select-none text-base-content/50 before:content-['▸']",
  collapseIcon: "mr-1 cursor-pointer select-none text-base-content/50 before:content-['▾']",
  collapsedContent: "text-base-content/40 cursor-pointer after:content-['…']",
  childFieldsContainer: "",
  ariaLables: { collapseJson: "Sbalit", expandJson: "Rozbalit" },
  stringifyStringValues: false,
};

export interface JsonViewProps {
  data: object;
  className?: string | undefined;
  expandDepth?: number | undefined;
}

export function JsonView({ data, className, expandDepth = 2 }: JsonViewProps) {
  return (
    <div className={cx("min-w-0 overflow-x-auto", className)}>
      <LiteJsonView
        data={data}
        style={styles}
        shouldExpandNode={(level) => level < expandDepth}
        clickToExpandNode
      />
    </div>
  );
}
