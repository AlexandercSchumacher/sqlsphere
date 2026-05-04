import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Code } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type ConfirmActionDataset = {
  sql?: string;
  columns?: string[];
  rows?: any[];
  row_count?: number;
  truncated?: boolean;
};

interface ConfirmActionModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (objectName?: string) => void;
  message: string;
  explanation?: string;
  preview?: ConfirmActionDataset | any[];
  diff?: ConfirmActionDataset | any[];
  isCreate?: boolean;
  sql?: string;
}

const formatDataset = (dataset?: ConfirmActionDataset | any[]) => {
  if (!dataset) {
    return { rows: [], columns: [], truncated: false, sql: undefined };
  }

  if (Array.isArray(dataset)) {
    const columns = dataset.length > 0 ? Object.keys(dataset[0]) : [];
    return { rows: dataset, columns, truncated: false, sql: undefined, rowCount: dataset.length };
  }

  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const columns =
    dataset.columns && dataset.columns.length > 0
      ? dataset.columns
      : rows.length > 0
      ? Object.keys(rows[0])
      : [];

  return {
    rows,
    columns,
    truncated: dataset.truncated ?? false,
    sql: dataset.sql,
    rowCount: dataset.row_count,
  };
};

export const ConfirmActionModal = ({
  open,
  onClose,
  onConfirm,
  message,
  explanation,
  preview,
  diff,
  isCreate = false,
  sql,
}: ConfirmActionModalProps) => {
  const { t } = useTranslation();
  const [showPreviewSql, setShowPreviewSql] = useState(false);
  // For CREATE operations, show SQL by default
  const [showDiffSql, setShowDiffSql] = useState(isCreate);
  const [objectName, setObjectName] = useState('');
  
  const previewData = formatDataset(preview);
  const diffData = formatDataset(diff);
  const hasPreview = !!(preview && (previewData.rows.length > 0 || previewData.sql));
  const hasDiff = !!(diff && (diffData.rows.length > 0 || diffData.sql));
  
  // Extract object name from SQL for CREATE operations
  useEffect(() => {
    if (isCreate && sql && !objectName) {
      // Try to extract object name from CREATE statements
      const createViewMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`\[]?(\w+)["`\]]?\.)?["`\[]?(\w+)["`\]]?/i);
      const createTableMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`\[]?(\w+)["`\]]?\.)?["`\[]?(\w+)["`\]]?/i);
      const createProcMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|PROC|FUNCTION)\s+(?:["`\[]?(\w+)["`\]]?\.)?["`\[]?(\w+)["`\]]?/i);
      
      const match = createViewMatch || createTableMatch || createProcMatch;
      if (match) {
        const name = match[2] || match[1];
        if (name) {
          setObjectName(name);
        }
      }
    }
  }, [isCreate, sql, objectName]);

  const renderDataset = (dataset: ReturnType<typeof formatDataset>, showSql: boolean, setShowSql: (show: boolean) => void) => {
    const { rows, columns, truncated, sql, rowCount } = dataset;

    const hasRows = rows && rows.length > 0;

    if (!hasRows && !sql) {
      return <p className="text-muted-foreground text-sm p-4">{t('chat.noDataAvailable')}</p>;
    }

    return (
      <div className="space-y-3">
        {sql && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSql(!showSql)}
              className="mb-2"
            >
              <Code className="h-4 w-4 mr-2" />
              {showSql ? t('chat.hideSQL') : t('chat.showSQL')}
            </Button>
            {showSql && (
              <pre className="bg-muted/60 text-sm p-3 rounded border border-muted/50 overflow-x-auto mb-3">
                {sql}
              </pre>
            )}
          </div>
        )}
        {hasRows && (
          <>
      <ScrollArea className="h-[300px] w-full">
              <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                        <TableHead key={col} className="whitespace-nowrap">{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
                    {rows.map((row, idx) => (
              <TableRow key={idx}>
                {columns.map((col) => (
                          <TableCell key={col} className="whitespace-nowrap">{String(row?.[col] ?? '')}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
              </div>
      </ScrollArea>
            <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
              <span>
                {t('chat.rowsShown')}: {rows.length}
                {typeof rowCount === 'number' ? ` / ${rowCount}` : ''}
              </span>
              {truncated && <span>{t('chat.resultsLimited', { count: rows.length })}</span>}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('chat.confirmDataChange')}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        {explanation && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{explanation}</AlertDescription>
          </Alert>
        )}

        {isCreate && (
          <div className="space-y-2">
            <Label htmlFor="object-name">{t('chat.objectName')}</Label>
            <Input
              id="object-name"
              value={objectName}
              onChange={(e) => setObjectName(e.target.value)}
              placeholder={t('chat.objectNamePlaceholder')}
            />
          </div>
        )}

        {(hasPreview || hasDiff) && (
          <Tabs defaultValue={hasPreview ? 'preview' : 'diff'} className="flex-1 overflow-hidden">
            <TabsList>
              {hasPreview && <TabsTrigger value="preview">{t('chat.preview')}</TabsTrigger>}
              {hasDiff && <TabsTrigger value="diff">{isCreate || !diffData.rows?.length ? t('chat.sqlCode') : t('chat.difference')}</TabsTrigger>}
            </TabsList>
            {hasPreview && (
              <TabsContent value="preview" className="mt-2 space-y-3">
                {renderDataset(previewData, showPreviewSql, setShowPreviewSql)}
              </TabsContent>
            )}
            {hasDiff && (
              <TabsContent value="diff" className="mt-2 space-y-3">
                {/* Show SQL code directly without extra button for CREATE operations */}
                {diffData.sql && (
                  <div>
                    {isCreate ? (
                      <pre className="bg-muted/60 text-sm p-3 rounded border border-muted/50 overflow-x-auto mb-3">
                        {diffData.sql}
                      </pre>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDiffSql(!showDiffSql)}
                          className="mb-2"
                        >
                          <Code className="h-4 w-4 mr-2" />
                          {showDiffSql ? t('chat.hideSQL') : t('chat.showSQL')}
                        </Button>
                        {showDiffSql && (
                          <pre className="bg-muted/60 text-sm p-3 rounded border border-muted/50 overflow-x-auto mb-3">
                            {diffData.sql}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                )}
                {diffData.rows && diffData.rows.length > 0 && (
                  <ScrollArea className="h-[300px] w-full">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {diffData.columns.map((col) => (
                              <TableHead key={col} className="whitespace-nowrap">{col}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {diffData.rows.map((row, idx) => (
                            <TableRow key={idx}>
                              {diffData.columns.map((col) => (
                                <TableCell key={col} className="whitespace-nowrap">{String(row?.[col] ?? '')}</TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm(objectName || undefined)}>{t('common.execute')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
