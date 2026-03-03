interface ModulePlaceholderProps {
  title: string;
  description: string;
}

export function ModulePlaceholder({ title, description }: ModulePlaceholderProps) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-panel">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">{title}</h1>
      <p className="mt-2 text-sm text-[#555248]">{description}</p>
    </section>
  );
}
