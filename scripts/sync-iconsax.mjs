import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Global, Setting } from "iconsax-react";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("iconsax/manifest.json");
const manifest = require(manifestPath);
const names = JSON.parse(readFileSync(new URL("../components/iconsax-names.json", import.meta.url), "utf8"));

// These variants are missing from the current Iconsax manifest.
const legacy = { global: Global, setting: Setting };
const variants = ["twotone", "bulk"];

function withoutOpacity(path) {
  return path.replace(/ opacity="[^"]*"/, "");
}

function actionGlyph(name, variant, svg, data) {
  const paths = svg.match(/<path\b[^>]*\/>/g) ?? [];
  if (name === "add") {
    return variant === "bulk" ? paths[1].replace("/>", ' stroke="currentColor" stroke-width=".55" stroke-linejoin="round"/>')
      : paths.map((path) => withoutOpacity(path).replace('stroke-width="1.5"', 'stroke-width="2"')).join("");
  }
  if (name === "3-dots-more") {
    const dots = data.bulk.match(/<path\b[^>]*\/>/g).slice(1).join("").replaceAll('fill="white"', 'fill="currentColor"');
    return variant === "bulk" ? dots : dots.replace("<path ", '<path opacity=".5" ');
  }
  if (name === "tick-circle") return '<g transform="translate(12 12) scale(1.3) translate(-12 -12)">' + withoutOpacity(paths[1]) + "</g>";
  if (name === "minimize-display") {
    const pivot = variant === "bulk" ? [15.5, 8.5] : [17.25, 6.75];
    const [x, y] = pivot;
    const flip = (paths, cx, cy) => '<g transform="rotate(180 ' + cx + " " + cy + ')">' + paths.map(withoutOpacity).join("") + "</g>";
    return variant === "bulk" ? flip([paths[1]], x, y) + flip([paths[2]], 24 - x, 24 - y)
      : flip([paths[1], paths[2]], x, y) + flip([paths[0], paths[3]], 24 - x, 24 - y);
  }
  if (name === "maximize-4" && variant === "bulk") return paths.slice(1).join("");
  return svg;
}

const glyphs = Object.fromEntries([...new Set(Object.values(names))].map((name) => {
  const sourceName = name === "minimize-display" ? "maximize-4" : name;
  const entry = manifest[sourceName];
  if (!entry) throw new Error("Unknown Iconsax icon: " + name);
  const data = require(resolve(dirname(manifestPath), "data", entry.category + ".json"))[sourceName];
  const pair = Object.fromEntries(variants.map((variant) => {
    const previous = legacy[name];
    const source = data[variant] ?? (previous ? renderToStaticMarkup(createElement(previous, {
      variant: variant === "twotone" ? "TwoTone" : "Bulk",
    })) : undefined);
    const svg = source?.match(/^<svg\b[^>]*\bviewBox="0 0 24 24"[^>]*>([\s\S]*)<\/svg>$/);
    if (!svg || /<(?:script|foreignObject|iframe|image)\b|\son\w+\s*=|\b(?:href|src)\s*=/i.test(svg[1])) {
      throw new Error("Unsupported Iconsax SVG: " + name + "/" + variant);
    }
    const glyph = svg[1].trim()
      .replace(/\b(fill|stroke)="(?!none")[^"]+"/g, '$1="currentColor"')
      .replace(/\bid="([^"]+)"/g, 'id="ICON_ID_$1"')
      .replace(/url\(#([^)]+)\)/g, 'url(#ICON_ID_$1)');
    return [variant, actionGlyph(name, variant, glyph, data)];
  }));
  return [name, pair];
}));

writeFileSync(new URL("../components/iconsax-glyphs.json", import.meta.url), JSON.stringify(glyphs, null, 2) + "\n");
