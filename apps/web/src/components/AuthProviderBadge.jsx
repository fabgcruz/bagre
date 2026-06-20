import { Building2, KeyRound, User } from 'lucide-react';

// Selo de ORIGEM da autenticação do usuário. Evidência de que o login veio de um
// diretório (LDAP/Active Directory) ou IdP (OIDC), e não de uma conta local.
// Lê o authProvider que o backend gravou no bind real.
const META = {
  ldap: {
    label: 'LDAP / AD',
    icon: Building2,
    cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  oidc: {
    label: 'SSO',
    icon: KeyRound,
    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
  local: {
    label: 'Local',
    icon: User,
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
};

export default function AuthProviderBadge({ provider, externalId, groups = [], detail = false }) {
  const m = META[provider] || META.local;
  const Icon = m.icon;
  // Tooltip com o DN e os grupos do diretório (a "prova" do LDAP).
  const title =
    provider === 'ldap'
      ? [externalId && `DN: ${externalId}`, groups.length && `Grupos: ${groups.join(', ')}`]
          .filter(Boolean)
          .join('\n')
      : undefined;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        title={title}
        className={`inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${m.cls}`}
      >
        <Icon size={12} />
        {m.label}
      </span>
      {detail && provider === 'ldap' && (externalId || groups.length > 0) && (
        <span className="text-[11px] leading-tight text-slate-400 font-mono break-all">
          {externalId}
          {groups.length > 0 && (
            <>
              {externalId && ' · '}
              grupos: {groups.join(', ')}
            </>
          )}
        </span>
      )}
    </span>
  );
}
