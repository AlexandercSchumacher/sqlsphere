/**
 * Dialog where the recruiter pastes an Anthropic or OpenAI API key.
 *
 * Triggered automatically when the user tries to use the AI chat
 * without any key configured (in env or localStorage), and also
 * available manually via a key icon in the chat panel header so the
 * user can swap or update keys later.
 */

import { useEffect, useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LlmProvider,
  clearLlmKey,
  getStoredLlmKeys,
  setLlmKey,
} from "@/lib/llmKeys";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called after the user successfully saves a key. Useful for the
   * caller to retry the chat send that triggered the dialog.
   */
  onSaved?: (provider: LlmProvider) => void;
  /**
   * Optional hint about why the dialog opened (e.g. backend returned
   * AI_KEY_MISSING). Shown above the inputs.
   */
  reason?: "missing" | "manual" | "auth-failed";
}

const PROVIDER_LABELS: Record<LlmProvider, { name: string; placeholder: string; consoleHref: string; consoleLabel: string }> = {
  anthropic: {
    name: "Anthropic Claude",
    placeholder: "sk-ant-api03-...",
    consoleHref: "https://console.anthropic.com/settings/keys",
    consoleLabel: "console.anthropic.com",
  },
  openai: {
    name: "OpenAI GPT",
    placeholder: "sk-...",
    consoleHref: "https://platform.openai.com/api-keys",
    consoleLabel: "platform.openai.com",
  },
};

export const ApiKeyDialog = ({ open, onOpenChange, onSaved, reason }: ApiKeyDialogProps) => {
  const [provider, setProvider] = useState<LlmProvider>("anthropic");
  const [anthropicValue, setAnthropicValue] = useState("");
  const [openaiValue, setOpenaiValue] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);

  // Load any previously-saved key when the dialog opens, so users can see
  // what's there and decide to replace or clear it.
  useEffect(() => {
    if (!open) return;
    const stored = getStoredLlmKeys();
    setAnthropicValue(stored.anthropic);
    setOpenaiValue(stored.openai);
    if (stored.active) {
      setProvider(stored.active);
    } else if (stored.anthropic) {
      setProvider("anthropic");
    } else if (stored.openai) {
      setProvider("openai");
    }
  }, [open]);

  const handleSave = () => {
    const value = provider === "anthropic" ? anthropicValue : openaiValue;
    if (!value.trim()) return;
    setLlmKey(provider, value.trim());
    onSaved?.(provider);
    onOpenChange(false);
  };

  const handleClear = (p: LlmProvider) => {
    clearLlmKey(p);
    if (p === "anthropic") setAnthropicValue("");
    if (p === "openai") setOpenaiValue("");
  };

  const currentValue = provider === "anthropic" ? anthropicValue : openaiValue;
  const meta = PROVIDER_LABELS[provider];
  const reasonText =
    reason === "missing"
      ? "AI chat needs an API key. Paste your Anthropic or OpenAI key below to enable it."
      : reason === "auth-failed"
      ? "Your saved key was rejected. Update or replace it below."
      : "Update your stored API keys. Stored only in this browser.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Enable AI Chat
          </DialogTitle>
          <DialogDescription>{reasonText}</DialogDescription>
        </DialogHeader>

        <Tabs value={provider} onValueChange={(v) => setProvider(v as LlmProvider)} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="anthropic">Anthropic Claude</TabsTrigger>
            <TabsTrigger value="openai">OpenAI GPT</TabsTrigger>
          </TabsList>

          <TabsContent value="anthropic" className="mt-4 space-y-3">
            <Label htmlFor="anthropic-key">Anthropic API key</Label>
            <Input
              id="anthropic-key"
              type={showCurrent ? "text" : "password"}
              placeholder={PROVIDER_LABELS.anthropic.placeholder}
              value={anthropicValue}
              onChange={(e) => setAnthropicValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </TabsContent>

          <TabsContent value="openai" className="mt-4 space-y-3">
            <Label htmlFor="openai-key">OpenAI API key</Label>
            <Input
              id="openai-key"
              type={showCurrent ? "text" : "password"}
              placeholder={PROVIDER_LABELS.openai.placeholder}
              value={openaiValue}
              onChange={(e) => setOpenaiValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => setShowCurrent((v) => !v)}
          >
            {showCurrent ? "Hide key" : "Show key"}
          </button>
          <a
            href={meta.consoleHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Get a key at {meta.consoleLabel}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <p className="text-xs text-muted-foreground">
          The key is stored only in this browser's localStorage and sent
          via a request header to the FastAPI backend running on your
          machine. It never goes through any third-party server.
        </p>

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {currentValue ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleClear(provider)}
              className="text-destructive hover:text-destructive"
            >
              Remove saved key
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!currentValue.trim()}>
              Save key
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
