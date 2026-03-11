import {
  Zap, Component, Triangle, CreditCard, FolderTree,
  Server, Database, Rocket, Smartphone, Globe,
} from "lucide-react";
import type { TemplateEntry } from "../../types/project-templates";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  zap: Zap,
  component: Component,
  triangle: Triangle,
  "credit-card": CreditCard,
  "folder-tree": FolderTree,
  server: Server,
  database: Database,
  rocket: Rocket,
  smartphone: Smartphone,
  globe: Globe,
};

function formatStars(stars?: number): string {
  if (!stars) return "";
  if (stars >= 1000) return `${(stars / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(stars);
}

interface TemplateCardProps {
  template: TemplateEntry;
  onSelect: (template: TemplateEntry) => void;
}

export default function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const Icon = ICON_MAP[template.icon] ?? Zap;
  const maxTags = 3;
  const visibleTags = template.tags.slice(0, maxTags);
  const extraCount = template.tags.length - maxTags;

  return (
    <button
      onClick={() => onSelect(template)}
      className="text-left p-4 rounded-xl border border-border hover:border-accent/40 bg-bg-subtle hover:bg-bg-elevated transition-all group flex flex-col gap-2.5"
    >
      {/* Header: icon + name */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-bg-elevated group-hover:bg-accent/10 flex items-center justify-center shrink-0 transition-colors">
          <Icon size={16} className="text-text-dim group-hover:text-accent transition-colors" />
        </div>
        <span className="text-text-primary text-ui font-medium truncate">
          {template.name}
        </span>
      </div>

      {/* Description */}
      <p className="text-text-secondary text-label leading-relaxed line-clamp-2">
        {template.description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {visibleTags.map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated text-text-dim"
          >
            {tag}
          </span>
        ))}
        {extraCount > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated text-text-ghost">
            +{extraCount}
          </span>
        )}
      </div>

      {/* Footer: stars + license */}
      <div className="flex items-center gap-3 mt-auto">
        {template.stars && (
          <span className="text-[10px] text-text-ghost">
            {formatStars(template.stars)} stars
          </span>
        )}
        <span className="text-[10px] text-text-ghost">{template.license}</span>
        {template.scaffold_type === "cli" && (
          <span className="text-[10px] text-accent/60 ml-auto">CLI</span>
        )}
      </div>
    </button>
  );
}
