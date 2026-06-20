import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Network,
  Database,
  Calculator,
  Plug,
  Server,
  Sun,
  Moon,
  Users,
  LogOut,
  User as UserIcon,
  History,
  KeyRound,
  Activity,
  Stethoscope,
  Plug2,
  ChevronDown,
  BookOpen,
  ExternalLink,
  Inbox,
  Cloud,
  Shield,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import GlobalSearch from './GlobalSearch.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { api, setDemoMode, setDemoBlockHandler } from '../api.js';
import { useToast } from './Toast.jsx';

const NAV_BASE = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sites', label: 'Sites & Subnets', icon: Network },
  { to: '/devices', label: 'Equipamentos', icon: Server },
  { to: '/catalogs', label: 'Catálogos', icon: Database },
  { to: '/cidr', label: 'Calculadora CIDR', icon: Calculator },
];

// Externos abrem em nova aba. URL inferida do hostname atual.
function buildWikiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:8090';
  return `http://${window.location.hostname}:8090`;
}

const NAV_ADMIN = [
  { to: '/admin/integrations', label: 'Integrações', icon: Plug2 },
  { to: '/admin/cloud-accounts', label: 'Cloud Accounts', icon: Cloud },
  { to: '/admin/validation', label: 'Validação', icon: Shield },
  { to: '/admin/pending-discoveries', label: 'Aprovações', icon: Inbox, badge: 'pending' },
  { to: '/admin/network-health', label: 'Saúde da rede', icon: Stethoscope },
  { to: '/admin/users', label: 'Usuários', icon: Users },
  { to: '/admin/audit', label: 'Auditoria', icon: History },
  { to: '/integrations', label: 'Documentação API', icon: Plug },
];

function PendingBadge() {
  const { data } = useQuery({
    queryKey: ['pending-discoveries-stats'],
    queryFn: api.pendingDiscoveriesStats,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const count = data?.counts?.PENDING ?? 0;
  if (!count) return null;
  return (
    <span className="ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 tabular-nums min-w-[20px] text-center">
      {count}
    </span>
  );
}

function avatarColor(seed) {
  const palette = [
    'from-brand-500 to-brand-700',
    'from-fuchsia-500 to-pink-700',
    'from-emerald-500 to-teal-700',
    'from-amber-500 to-orange-700',
    'from-violet-500 to-indigo-700',
    'from-rose-500 to-red-700',
  ];
  let hash = 0;
  for (const c of seed || '?') hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('bagre.theme') || 'light'
      : 'light',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { data: cfg } = useQuery({
    queryKey: ['app-config'],
    queryFn: api.config,
    staleTime: 60_000,
  });
  const demoBanner = cfg?.demo?.enabled ? cfg.demo.banner : null;
  const isDemo = !!cfg?.demo?.enabled;
  const toast = useToast();

  // Liga a trava de escrita do cliente no modo demo + avisa ao tentar escrever.
  useEffect(() => {
    setDemoMode(isDemo);
  }, [isDemo]);
  useEffect(() => {
    setDemoBlockHandler(() =>
      toast.info(
        'Isto é apenas uma demonstração — esta ação não altera nada. Baixe o Bagre para usar de verdade.',
        { title: 'Somente demonstração' },
      ),
    );
    return () => setDemoBlockHandler(() => {});
  }, [toast]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('bagre.theme', theme);
  }, [theme]);

  useEffect(() => {
    function onClick(e) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const nav = [...NAV_BASE, ...(user?.role === 'ADMIN' ? NAV_ADMIN : [])];
  const initials = (user?.name || user?.email || '?').slice(0, 2).toUpperCase();
  const gradient = avatarColor(user?.email);

  return (
    <div className="min-h-screen flex bg-slate-50/50 dark:bg-slate-950">
      <aside className="w-64 shrink-0 border-r border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hidden md:flex md:flex-col">
        <div className="px-5 pt-7 pb-5">
          <div className="flex items-center gap-2.5">
            <img
              src="/bagre-mascot.png"
              alt="Bagre"
              className="w-10 h-10 shrink-0 select-none"
              draggable="false"
            />
            <div>
              <div className="text-[15px] font-semibold tracking-tight leading-none">
                Bagre
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">
                IPAM
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-0.5">
          {nav.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-all duration-150',
                  isActive
                    ? 'bg-brand-50 text-brand-700 font-medium dark:bg-brand-900/30 dark:text-brand-300'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand-600 rounded-r" />
                  )}
                  <Icon size={16} />
                  <span className="flex-1">{label}</span>
                  {badge === 'pending' && <PendingBadge />}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 space-y-2">
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn-ghost w-full justify-start text-[13px]"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            <span>Tema {theme === 'dark' ? 'claro' : 'escuro'}</span>
          </button>
          <div className="px-3 pt-1 text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
            Sistema desenvolvido por
            <br />
            <span className="font-medium text-slate-500 dark:text-slate-400">
              Fabricio Cruz
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {demoBanner && (
          <div className="bg-amber-500 text-amber-950 text-center text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-2">
            <Activity size={13} />
            {demoBanner}
          </div>
        )}
        <header className="sticky top-0 z-20 h-14 border-b border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-6 flex items-center gap-4">
          <GlobalSearch />
          <div className="ml-auto relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <div
                className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} text-white flex items-center justify-center text-[11px] font-semibold shadow-soft`}
              >
                {initials}
              </div>
              <div className="hidden md:block text-left">
                <div className="text-[13px] leading-tight font-medium">
                  {user?.name || user?.email?.split('@')[0]}
                </div>
                <div className="text-[10px] text-slate-500 leading-tight font-mono">
                  {user?.role}
                </div>
              </div>
              <ChevronDown size={14} className="text-slate-400 hidden md:block" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-60 card shadow-card py-1 z-40 animate-slide-down">
                <div className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800">
                  <div className="text-sm font-medium truncate">{user?.email}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {user?.role === 'ADMIN' ? 'Administrador' : 'Somente leitura'}
                  </div>
                </div>
                {!isDemo && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/profile');
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2"
                  >
                    <UserIcon size={14} /> Meu perfil
                  </button>
                )}
                <button
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 dark:hover:bg-rose-900/30 flex items-center gap-2 text-rose-600"
                >
                  <LogOut size={14} /> Sair
                </button>
              </div>
            )}
          </div>
        </header>
        <div className="flex-1 px-8 py-8 overflow-auto animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
