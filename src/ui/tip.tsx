// A visual tooltip for an icon-only control (G-UI-R). Tooltips are not associated with their
// triggers (R05-A D9): the trigger keeps its own accessible name; this only shows it on hover
// and keyboard focus.
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./registry/tooltip";

export function Tip(p: {
  label: ReactNode;
  /** The trigger element (a Button with an aria-label). */
  render: ReactElement;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={p.render}>{p.children}</TooltipTrigger>
      <TooltipContent side={p.side ?? "top"}>{p.label}</TooltipContent>
    </Tooltip>
  );
}
