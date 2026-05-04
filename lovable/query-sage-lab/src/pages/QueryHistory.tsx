import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useQueryHistory, QueryHistoryEntry } from '@/hooks/useQueryHistory';
import { useSharedQueries } from '@/hooks/useSharedQueries';
import Layout from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ShareDialog } from '@/components/ShareDialog';
import {
  Star, StarOff, Trash2, Search, Copy, Share2, Clock,
  CheckCircle, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react';

export default function QueryHistory() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { entries, loading, fetchHistory, toggleFavorite, deleteEntry } = useQueryHistory();
  const { createShare } = useSharedQueries();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('history');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEntry, setShareEntry] = useState<QueryHistoryEntry | null>(null);

  useEffect(() => {
    if (user) {
      fetchHistory({ favoritesOnly: tab === 'favorites', search: search || undefined });
    }
  }, [user, tab, search, fetchHistory]);

  const handleCopySQL = (sql: string) => {
    navigator.clipboard.writeText(sql);
    toast({ title: t('queryHistory.copied') });
  };

  const handleShare = (entry: QueryHistoryEntry) => {
    setShareEntry(entry);
    setShareOpen(true);
  };

  const formatTime = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">{t('queryHistory.title')}</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center gap-4 mb-4">
            <TabsList>
              <TabsTrigger value="history">
                <Clock className="h-4 w-4 mr-1" />
                {t('queryHistory.history')}
              </TabsTrigger>
              <TabsTrigger value="favorites">
                <Star className="h-4 w-4 mr-1" />
                {t('queryHistory.favorites')}
              </TabsTrigger>
            </TabsList>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('queryHistory.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <TabsContent value="history" className="space-y-2">
            {renderEntries()}
          </TabsContent>
          <TabsContent value="favorites" className="space-y-2">
            {renderEntries()}
          </TabsContent>
        </Tabs>

        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          sqlText={shareEntry?.sql_text || ''}
          resultColumns={[]}
          resultData={[]}
          rowCount={shareEntry?.row_count || 0}
        />
      </div>
    </Layout>
  );

  function renderEntries() {
    if (loading) return <p className="text-muted-foreground">{t('common.loading')}</p>;
    if (entries.length === 0) return <p className="text-muted-foreground">{t('queryHistory.noEntries')}</p>;

    return entries.map((entry) => {
      const isExpanded = expandedId === entry.id;
      const sqlPreview = entry.sql_text.length > 120 ? entry.sql_text.slice(0, 120) + '...' : entry.sql_text;

      return (
        <div key={entry.id} className="flex gap-0 dock-row-hover">
          <div className={`dock-rail ${entry.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
          <div className="flex-1 pl-3 py-3 border-b border-border/40">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {entry.status === 'success' ? (
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
                {entry.row_count != null && (
                  <span className="text-xs text-muted-foreground">{entry.row_count} rows</span>
                )}
                <span className="text-xs text-muted-foreground">{formatTime(entry.execution_time_ms)}</span>
              </div>
              <button
                className="text-left w-full"
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                <code className="text-sm font-mono break-all">
                  {isExpanded ? entry.sql_text : sqlPreview}
                </code>
                {entry.sql_text.length > 120 && (
                  isExpanded
                    ? <ChevronUp className="inline h-3 w-3 ml-1" />
                    : <ChevronDown className="inline h-3 w-3 ml-1" />
                )}
              </button>
              {entry.error_message && (
                <p className="text-xs text-red-500 mt-1">{entry.error_message}</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleCopySQL(entry.sql_text)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleFavorite(entry.id, entry.is_favorite)}>
                {entry.is_favorite ? <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" /> : <StarOff className="h-3.5 w-3.5" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleShare(entry)}>
                <Share2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => deleteEntry(entry.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          </div>
        </div>
      );
    });
  }
}
