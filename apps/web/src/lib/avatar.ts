import { Avatar, Style } from "@dicebear/core";
import squircles from "@dicebear/styles/squircles.json" with { type: "json" };
import waves from "@dicebear/styles/waves.json" with { type: "json" };

export type AvatarStyle = "waves" | "squircles";

const STYLES: Record<AvatarStyle, Style> = {
  waves: new Style(waves),
  squircles: new Style(squircles),
};

const BACKGROUND_VARIABLES = [
  "--color-primary",
  "--color-secondary",
  "--color-info",
  "--color-success",
  "--color-warning",
];
const FOREGROUND_VARIABLES = ["--color-base-100"];

function themeColors(variables: string[]): string[] {
  const computed = getComputedStyle(document.documentElement);

  return variables.map((name) => computed.getPropertyValue(name).trim()).filter((value) => value !== "");
}

/** Deterministic avatar seeded by full name; the SVG animates itself and honours `prefers-reduced-motion`. */
export function avatarForName(name: string, style: AvatarStyle = "squircles"): string {
  const foreground = themeColors(FOREGROUND_VARIABLES);

  return new Avatar(STYLES[style], {
    seed: name,
    size: 48,
    backgroundColor: themeColors(BACKGROUND_VARIABLES),
    waveColor: foreground,
    shapeColor: foreground,
    animationVariant: ["fastest"],
  }).toDataUri();
}
