import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Scale } from "lucide-react";
import { PageHeader } from "../client/src/components/page-header";

function PlainIcon({ className }: { className?: string }) {
  return createElement("span", { className, "data-testid": "plain-icon" });
}

const lucideMarkup = renderToStaticMarkup(
  createElement(PageHeader, {
    title: "Sourcing & RFQs",
    icon: Scale,
  }),
);
assert.match(lucideMarkup, /<svg/);
assert.match(lucideMarkup, /Sourcing &amp; RFQs/);

const componentMarkup = renderToStaticMarkup(
  createElement(PageHeader, {
    title: "Plain component",
    icon: PlainIcon,
  }),
);
assert.match(componentMarkup, /data-testid="plain-icon"/);

const elementMarkup = renderToStaticMarkup(
  createElement(PageHeader, {
    title: "Existing element",
    icon: createElement("span", { "data-testid": "existing-icon" }),
  }),
);
assert.match(elementMarkup, /data-testid="existing-icon"/);

console.log("PageHeader renders Lucide forwardRef icons, component icons, and existing elements.");
