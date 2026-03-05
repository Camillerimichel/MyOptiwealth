import { ContactsBlock } from '@/components/crm/contacts-block';

export default async function CrmContactsPage({
  searchParams,
}: {
  searchParams?: Promise<{ societyId?: string; societyKey?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">CRM - Contacts</h1>
      <ContactsBlock selectedSocietyId={params?.societyId ?? ''} selectedSocietyKey={params?.societyKey ?? ''} />
    </section>
  );
}
