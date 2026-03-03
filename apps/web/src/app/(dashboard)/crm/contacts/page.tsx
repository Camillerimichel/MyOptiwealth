import { ContactsBlock } from '@/components/crm/contacts-block';

export default function CrmContactsPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-2xl font-semibold text-[var(--brand)]">CRM - Contacts</h1>
      <ContactsBlock />
    </section>
  );
}
