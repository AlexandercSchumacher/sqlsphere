import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSharedQueries } from '@/hooks/useSharedQueries';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Copy, Check } from 'lucide-react';

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sqlText: string;
  resultColumns: string[];
  resultData: any[];
  rowCount: number;
}

export function ShareDialog({ open, onOpenChange, sqlText, resultColumns, resultData, rowCount }: ShareDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { createShare } = useSharedQueries();
  const { subscription } = useSubscription();
  const [title, setTitle] = useState('');
  const [expiryDays, setExpiryDays] = useState('1');
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const maxDays = subscription.tier === 'business' ? 365 : subscription.tier === 'pro' ? 30 : 1;

  const handleCreate = async () => {
    if (!title.trim()) {
      toast({ title: t('shareDialog.titleRequired'), variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const token = await createShare({
        title: title.trim(),
        sqlText,
        resultColumns,
        resultData: resultData.slice(0, 500),
        rowCount,
        expiresInDays: parseInt(expiryDays),
      });
      if (token) {
        const link = `${window.location.origin}/share/${token}`;
        setGeneratedLink(link);
      }
    } catch {
      toast({ title: t('shareDialog.error'), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast({ title: t('shareDialog.linkCopied') });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (val: boolean) => {
    if (!val) {
      setTitle('');
      setGeneratedLink('');
      setCopied(false);
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shareDialog.title')}</DialogTitle>
        </DialogHeader>

        {!generatedLink ? (
          <div className="space-y-4">
            <div>
              <Label>{t('shareDialog.queryTitle')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('shareDialog.titlePlaceholder')} />
            </div>
            <div>
              <Label>{t('shareDialog.expiresIn')}</Label>
              <Select value={expiryDays} onValueChange={setExpiryDays}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 {t('shareDialog.day')}</SelectItem>
                  {maxDays >= 7 && <SelectItem value="7">7 {t('shareDialog.days')}</SelectItem>}
                  {maxDays >= 30 && <SelectItem value="30">30 {t('shareDialog.days')}</SelectItem>}
                  {maxDays >= 90 && <SelectItem value="90">90 {t('shareDialog.days')}</SelectItem>}
                  {maxDays >= 365 && <SelectItem value="365">365 {t('shareDialog.days')}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? t('common.loading') : t('shareDialog.createLink')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input value={generatedLink} readOnly className="font-mono text-sm" />
              <Button size="icon" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>{t('common.close')}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
