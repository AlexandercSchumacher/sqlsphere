import { useEffect, useState } from 'react';
import {
  Download as DownloadIcon,
  Apple,
  Monitor,
  Terminal,
  CheckCircle,
  ArrowRight,
  Plug,
  ShieldCheck,
  Zap,
  Globe,
  Construction,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import Layout from '@/components/Layout';

// Download URLs are routed through the backend so Supabase stays hidden.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? '';

const AGENT_VERSION = '1.2.0';

const DOWNLOADS = {
  windows: {
    label: 'Windows',
    subtitle: 'Windows 10 / 11 — 64-bit',
    icon: Monitor,
    file: 'SQLSphere-Agent-Windows-Setup.exe',
    format: 'Installer (.exe)',
    url: `${BACKEND_URL}/api/download/windows`,
  },
  mac: {
    label: 'macOS',
    subtitle: 'Intel & Apple Silicon',
    icon: Apple,
    file: 'SQLSphere-Agent-Mac.dmg',
    format: 'Disk Image (.dmg)',
    url: `${BACKEND_URL}/api/download/mac`,
  },
  linux: {
    label: 'Linux',
    subtitle: 'Ubuntu, Debian, Fedora & more',
    icon: Terminal,
    file: 'SQLSphere-Agent-Linux',
    format: 'Portable binary',
    url: `${BACKEND_URL}/api/download/linux`,
  },
} as const;

type Platform = keyof typeof DOWNLOADS;

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Fully local & private',
    desc: 'Your data never leaves your machine. Queries run 100 % on your hardware.',
  },
  {
    icon: Plug,
    title: 'Connects any local DB',
    desc: 'PostgreSQL, MySQL, and SQL Server — all on localhost or your private network.',
  },
  {
    icon: Globe,
    title: 'Works with SQLSphere cloud',
    desc: 'Use the AI chat, visualisations, and import tools from the web app — powered by your local data.',
  },
  {
    icon: Zap,
    title: 'Auto-reconnect & tray icon',
    desc: 'Runs quietly in the system tray. Starts with your computer if you want it to.',
  },
];

const STEPS = [
  {
    number: '01',
    title: 'Get your connection code',
    body: 'Open SQLSphere → Connections → "Add Local Connection". A unique code will be generated for you.',
  },
  {
    number: '02',
    title: 'Download & run the agent',
    body: 'Download the binary for your OS below. On first launch you may need to approve it in your security settings.',
  },
  {
    number: '03',
    title: 'Enter your settings',
    body: 'Paste the connection code and fill in your database host, credentials, and click Connect.',
  },
  {
    number: '04',
    title: "You're live",
    body: "The agent status turns green and SQLSphere can now query your local database. The agent runs silently in the tray.",
  },
];

const INSTALL_NOTES: Record<Platform, { steps: string[] }> = {
  windows: {
    steps: [
      'Run the downloaded installer.',
      'Follow the setup wizard — choose install location and shortcuts.',
      'If Windows SmartScreen appears, click "More info" → "Run anyway".',
      'Launch SQLSphere Agent from the Start Menu or desktop shortcut.',
    ],
  },
  mac: {
    steps: [
      'Open the downloaded `.dmg` file.',
      'Drag SQLSphere Agent into the Applications folder.',
      'If macOS blocks it, open System Settings → Privacy & Security → click "Open Anyway".',
      'Launch SQLSphere Agent from Applications.',
    ],
  },
  linux: {
    steps: [
      'Download the binary and open a terminal in the same folder.',
      'Make it executable:  `chmod +x SQLSphere-Agent-Linux`',
      'Run it:  `./SQLSphere-Agent-Linux`',
      'Enter your connection code and database credentials.',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
const Download = () => {
  const [detected, setDetected] = useState<Platform | null>(null);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  const handleDownload = (platform: Platform) => {
    window.open(DOWNLOADS[platform].url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Layout>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent/80 text-white">
        <div className="absolute inset-0 noise-bg pointer-events-none" />
        <div className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}
        />
        <div className="relative container mx-auto px-6 py-24 text-center max-w-3xl">
          <Badge className="mb-5 bg-amber-500/20 text-amber-100 border-amber-300/30 hover:bg-amber-500/30 text-sm px-3 py-1.5 animate-fade-up">
            <Construction className="h-3.5 w-3.5 mr-1.5 inline" />
            Coming Soon
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold mb-5 leading-tight animate-fade-up delay-75">
            SQLSphere Local Agent
          </h1>
          <p className="text-lg sm:text-xl text-white/80 leading-relaxed animate-fade-up delay-150">
            A lightweight background app that bridges SQLSphere's AI-powered
            cloud interface with your own local databases — securely and privately.
          </p>
          <div className="mt-10 animate-fade-up delay-200">
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white/80 text-sm font-medium">
              <Construction className="h-4 w-4" />
              The Local Agent is currently under development and will be available soon.
            </div>
          </div>
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div className="bg-muted/30 border-b border-border/50">
        <div className="container mx-auto px-6 py-16 max-w-5xl">
          <h2 className="text-2xl font-bold text-center mb-12">How the Agent Works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {STEPS.map((step) => (
              <div key={step.number} className="relative">
                <div className="text-4xl font-bold text-primary/15 mb-2 select-none">
                  {step.number}
                </div>
                <h3 className="font-semibold mb-1.5 text-sm">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Download cards ───────────────────────────────────────────────── */}
      <div className="container mx-auto px-6 py-16 max-w-4xl">
        <h2 className="text-2xl font-bold text-center mb-10">Download for your OS</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {(Object.entries(DOWNLOADS) as [Platform, typeof DOWNLOADS[Platform]][]).map(([key, info]) => {
            const Icon = info.icon;
            const isDetected = key === detected;
            return (
              <div key={key} className="relative">
                {isDetected && (
                  <Badge className="bg-primary text-primary-foreground text-xs px-2.5 py-0.5 mb-3 inline-block">Recommended for you</Badge>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className={`p-2.5 rounded-xl ${isDetected ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`h-5 w-5 ${isDetected ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">{info.label}</h3>
                    <p className="text-xs text-muted-foreground">{info.subtitle}</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-muted-foreground">
                    Format: <span className="font-medium text-foreground">{info.format}</span>
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{info.file}</p>
                </div>
                <Button
                  className="w-full gap-2 h-10"
                  variant={isDetected ? 'default' : 'outline'}
                  disabled
                >
                  <Construction className="h-4 w-4" />
                  Coming Soon
                </Button>
              </div>
            );
          })}
        </div>

        {/* ── Features ──────────────────────────────────────────────────── */}
        <Separator className="my-16" />
        <h2 className="text-2xl font-bold text-center mb-10">What you get</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div key={feat.title} className="flex gap-0 p-5 group">
                <div className="dock-rail bg-primary opacity-40 group-hover:opacity-100 transition-opacity" />
                <div className="flex gap-4 pl-3">
                  <div className="shrink-0 mt-0.5">
                    <div className="p-2.5 rounded-xl bg-primary/8">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm mb-1">{feat.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Installation notes ────────────────────────────────────────── */}
        <Separator className="my-16" />
        <h2 className="text-2xl font-bold text-center mb-10">Installation</h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {(Object.entries(INSTALL_NOTES) as [Platform, { steps: string[] }][]).map(([key, info]) => {
            const Icon = DOWNLOADS[key].icon;
            return (
              <div key={key}>
                <h3 className="flex items-center gap-2 text-base font-semibold mb-4">
                  <Icon className="h-4 w-4" />
                  {DOWNLOADS[key].label}
                </h3>
                <ol className="space-y-2.5">
                  {info.steps.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                      <span className="shrink-0 font-bold text-primary/70">{i + 1}.</span>
                      <span dangerouslySetInnerHTML={{ __html: step.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded-md text-foreground text-xs font-mono">$1</code>') }} />
                    </li>
                  ))}
                </ol>
                <Button
                  size="sm" variant="ghost"
                  className="w-full mt-4 gap-1 text-muted-foreground"
                  disabled
                >
                  <Construction className="h-3 w-3" />
                  Coming Soon
                </Button>
              </div>
            );
          })}
        </div>

        {/* ── Security note ─────────────────────────────────────────────── */}
        <div className="mt-14 p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 flex gap-4">
          <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
              Your data stays on your machine
            </h3>
            <p className="text-sm text-emerald-700 dark:text-emerald-400/80 leading-relaxed">
              The SQLSphere Agent only ever sends query <em>results</em> to the backend — not your raw data.
              All SQL execution happens locally. Your credentials are stored encrypted on your device and never transmitted.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Download;
