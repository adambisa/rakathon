import { Anchor } from "#ui";

export function ProductFooter() {
  return (
    <footer className="text-center text-[0.6875rem] tracking-wide text-base-content/50">
      Oficiální interní produkt{" "}
      <Anchor href="https://www.mou.cz" target="_blank" rel="noopener noreferrer" className="link-hover">
        MOÚ
      </Anchor>
    </footer>
  );
}
