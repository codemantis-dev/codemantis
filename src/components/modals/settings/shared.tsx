export { type SettingsTab, NAV_ITEMS, CHANGELOG_PROVIDERS } from "./constants";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-text-primary font-medium mb-4">{children}</h3>;
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <label className="text-ui text-text-secondary">{label}</label>
      {children}
    </div>
  );
}
