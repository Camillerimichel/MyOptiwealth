import { SocietiesBlock } from '@/components/crm/societies-block';

export default function CrmSocietiesPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">CRM - Societes</h1>
      <SocietiesBlock />
    </section>
  );
}
