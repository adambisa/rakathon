import { createLink } from "@tanstack/react-router";

import { Anchor, ButtonAnchor } from "#ui/link";

export const Link = createLink(Anchor);

export const ButtonLink = createLink(ButtonAnchor);
