import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SiteFormModal from '../components/SiteFormModal.jsx';
import SubnetFormModal from '../components/SubnetFormModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

function UsageBar({ used, total }) {
  const pct = total ? (used / total) * 100 : 0;
  const tone = pct > 80 ? 'bg-rose-500' : pct > 50 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 card py-1 z-30">
          {items.map((it, i) => (
            <button
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 ${
                it.danger ? 'text-rose-600' : ''
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sites() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: api.sites,
  });
  const [q, setQ] = useState('');

  const [siteModal, setSiteModal] = useState({ open: false, initial: null });
  const [subnetModal, setSubnetModal] = useState({
    open: false,
    siteId: null,
    siteCode: null,
    initial: null,
  });
  const [confirm, setConfirm] = useState(null);
  const [formError, setFormError] = useState(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return sites;
    const needle = q.toLowerCase();
    return sites
      .map((s) => ({
        ...s,
        subnets: s.subnets.filter(
          (sub) =>
            sub.name.toLowerCase().includes(needle) ||
            (sub.cidr || '').includes(needle) ||
            s.code.toLowerCase().includes(needle),
        ),
      }))
      .filter((s) => s.code.toLowerCase().includes(needle) || s.subnets.length);
  }, [sites, q]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['sites'] });
    qc.invalidateQueries({ queryKey: ['stats'] });
    qc.invalidateQueries({ queryKey: ['stats', 'by-site'] });
  };

  const createSite = useMutation({
    mutationFn: api.createSite,
    onSuccess: (s) => {
      setSiteModal({ open: false, initial: null });
      setFormError(null);
      invalidateAll();
      toast.success(`Site ${s.code} criado.`);
    },
    onError: (e) => setFormError(e.message),
  });
  const updateSite = useMutation({
    mutationFn: ({ id, data }) => api.updateSite(id, data),
    onSuccess: (s) => {
      setSiteModal({ open: false, initial: null });
      setFormError(null);
      invalidateAll();
      toast.success(`Site ${s.code} atualizado.`);
    },
    onError: (e) => setFormError(e.message),
  });
  const deleteSite = useMutation({
    mutationFn: api.deleteSite,
    onSuccess: () => {
      const code = confirm?.code;
      setConfirm(null);
      invalidateAll();
      if (code) toast.success(`Site ${code} removido.`);
    },
    onError: (e) => toast.error(e.message),
  });
  const createSubnet = useMutation({
    mutationFn: api.createSubnet,
    onSuccess: (s) => {
      setSubnetModal({ open: false, siteId: null, siteCode: null, initial: null });
      setFormError(null);
      invalidateAll();
      toast.success(
        s.ipsCreated
          ? `Subnet ${s.name} criada com ${s.ipsCreated} IPs.`
          : `Subnet ${s.name} criada.`,
      );
    },
    onError: (e) => setFormError(e.message),
  });
  const updateSubnet = useMutation({
    mutationFn: ({ id, data }) => api.updateSubnet(id, data),
    onSuccess: (s) => {
      setSubnetModal({ open: false, siteId: null, siteCode: null, initial: null });
      setFormError(null);
      invalidateAll();
      toast.success(`Subnet ${s.name} atualizada.`);
    },
    onError: (e) => setFormError(e.message),
  });
  const deleteSubnet = useMutation({
    mutationFn: api.deleteSubnet,
    onSuccess: () => {
      const name = confirm?.name;
      setConfirm(null);
      invalidateAll();
      if (name) toast.success(`Subnet ${name} removida.`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Sites & Subnets"
        description="Cada site é uma localização (data center, escritório). Dentro dele ficam as subnets — clique em uma para ver e editar os IPs."
        actions={
          canEdit && (
            <button
              onClick={() => {
                setFormError(null);
                setSiteModal({ open: true, initial: null });
              }}
              className="btn-primary"
            >
              <Plus size={14} /> Novo site
            </button>
          )
        }
      />

      <div className="mb-5 max-w-md">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por site, subnet ou CIDR…"
            className="input pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          {sites.length === 0
            ? 'Nenhum site cadastrado ainda. Crie o primeiro com "Novo site".'
            : 'Nenhum site corresponde ao filtro.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((site) => {
            const total = site.subnets.reduce((acc, s) => acc + s.ipCount, 0);
            const used = site.subnets.reduce((acc, s) => acc + s.usedCount, 0);
            return (
              <div key={site.id} className="card p-5">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{site.code}</h3>
                    {site.name && site.name !== site.code && (
                      <div className="text-xs text-slate-500 truncate">{site.name}</div>
                    )}
                  </div>
                  {canEdit && (
                    <ActionMenu
                      items={[
                        {
                          label: 'Nova subnet',
                          icon: <Plus size={14} />,
                          onClick: () => {
                            setFormError(null);
                            setSubnetModal({
                              open: true,
                              siteId: site.id,
                              siteCode: site.code,
                              initial: null,
                            });
                          },
                        },
                        {
                          label: 'Editar site',
                          icon: <Pencil size={14} />,
                          onClick: () => {
                            setFormError(null);
                            setSiteModal({ open: true, initial: site });
                          },
                        },
                        {
                          label: 'Excluir site',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: () =>
                            setConfirm({
                              type: 'site',
                              id: site.id,
                              code: site.code,
                              subnetCount: site.subnets.length,
                              ipCount: total,
                            }),
                        },
                      ]}
                    />
                  )}
                </div>
                <div className="text-xs text-slate-500 mb-3">
                  {site.subnets.length} subnet{site.subnets.length !== 1 ? 's' : ''} ·{' '}
                  {used.toLocaleString()} de {total.toLocaleString()} IPs em uso
                </div>
                <div className="space-y-1">
                  {site.subnets.map((sub) => {
                    const pct = sub.ipCount ? (sub.usedCount / sub.ipCount) * 100 : 0;
                    return (
                      <div
                        key={sub.id}
                        className="group flex items-center gap-2 px-2 py-2 -mx-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                      >
                        <Link
                          to={`/subnets/${sub.id}`}
                          className="flex-1 min-w-0 flex items-center gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {sub.name}
                              </span>
                              {sub.cidr && (
                                <code className="text-[10px] text-slate-400 font-mono">
                                  {sub.cidr}
                                </code>
                              )}
                            </div>
                            <div className="mt-1.5">
                              <UsageBar used={sub.usedCount} total={sub.ipCount} />
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-mono text-slate-600 dark:text-slate-400">
                              {sub.usedCount}/{sub.ipCount}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {pct.toFixed(0)}%
                            </div>
                          </div>
                          <ChevronRight
                            size={14}
                            className="text-slate-300 group-hover:text-brand-500 transition shrink-0"
                          />
                        </Link>
                        {canEdit && (
                          <ActionMenu
                            items={[
                              {
                                label: 'Editar subnet',
                                icon: <Pencil size={14} />,
                                onClick: () => {
                                  setFormError(null);
                                  setSubnetModal({
                                    open: true,
                                    siteId: site.id,
                                    siteCode: site.code,
                                    initial: sub,
                                  });
                                },
                              },
                              {
                                label: 'Excluir subnet',
                                icon: <Trash2 size={14} />,
                                danger: true,
                                onClick: () =>
                                  setConfirm({
                                    type: 'subnet',
                                    id: sub.id,
                                    name: sub.name,
                                    siteCode: site.code,
                                    ipCount: sub.ipCount,
                                  }),
                              },
                            ]}
                          />
                        )}
                      </div>
                    );
                  })}
                  {canEdit && site.subnets.length === 0 && (
                    <button
                      onClick={() => {
                        setFormError(null);
                        setSubnetModal({
                          open: true,
                          siteId: site.id,
                          siteCode: site.code,
                          initial: null,
                        });
                      }}
                      className="w-full text-left text-sm text-slate-500 hover:text-brand-600 px-2 py-2 -mx-2 rounded-md border border-dashed border-slate-200 dark:border-slate-700 hover:border-brand-300 transition flex items-center gap-2"
                    >
                      <Plus size={14} /> Adicionar primeira subnet
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Site form modal */}
      <SiteFormModal
        open={siteModal.open}
        initial={siteModal.initial}
        loading={createSite.isPending || updateSite.isPending}
        error={formError}
        onClose={() => setSiteModal({ open: false, initial: null })}
        onSubmit={(data) => {
          if (siteModal.initial) {
            updateSite.mutate({ id: siteModal.initial.id, data });
          } else {
            createSite.mutate(data);
          }
        }}
      />

      {/* Subnet form modal */}
      <SubnetFormModal
        open={subnetModal.open}
        initial={subnetModal.initial}
        siteCode={subnetModal.siteCode}
        loading={createSubnet.isPending || updateSubnet.isPending}
        error={formError}
        onClose={() =>
          setSubnetModal({ open: false, siteId: null, siteCode: null, initial: null })
        }
        onSubmit={(data) => {
          if (subnetModal.initial) {
            updateSubnet.mutate({ id: subnetModal.initial.id, data });
          } else {
            createSubnet.mutate({ ...data, siteId: subnetModal.siteId });
          }
        }}
      />

      {/* Confirm delete dialogs */}
      <ConfirmDialog
        open={confirm?.type === 'site'}
        onClose={() => setConfirm(null)}
        onConfirm={() => deleteSite.mutate(confirm.id)}
        loading={deleteSite.isPending}
        title="Excluir site?"
        confirmLabel="Excluir definitivamente"
        destructive
        message={
          confirm?.type === 'site' && (
            <>
              Você está prestes a remover o site{' '}
              <strong className="font-mono">{confirm.code}</strong> com{' '}
              <strong>{confirm.subnetCount}</strong> subnet(s) e{' '}
              <strong>{confirm.ipCount.toLocaleString()}</strong> IPs.
              <div className="mt-2 text-xs text-rose-600">
                Essa ação é definitiva e não pode ser desfeita.
              </div>
            </>
          )
        }
      />
      <ConfirmDialog
        open={confirm?.type === 'subnet'}
        onClose={() => setConfirm(null)}
        onConfirm={() => deleteSubnet.mutate(confirm.id)}
        loading={deleteSubnet.isPending}
        title="Excluir subnet?"
        confirmLabel="Excluir definitivamente"
        destructive
        message={
          confirm?.type === 'subnet' && (
            <>
              Você está prestes a remover a subnet{' '}
              <strong>{confirm.name}</strong> do site{' '}
              <strong className="font-mono">{confirm.siteCode}</strong> e seus{' '}
              <strong>{confirm.ipCount}</strong> IPs.
              <div className="mt-2 text-xs text-rose-600">
                Essa ação é definitiva.
              </div>
            </>
          )
        }
      />
    </div>
  );
}
