import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConnection } from '@/hooks/useConnection';
import { cn } from '@/lib/utils';

interface ConnectionOption {
  id: string;
  name: string;
}

interface ConnectionDropdownProps {
  value: string;
  onValueChange: (connectionId: string) => void | Promise<void>;
  placeholder: string;
  noConnectionsText: string;
  className?: string;
  disabled?: boolean;
}

export function ConnectionDropdown({
  value,
  onValueChange,
  placeholder,
  noConnectionsText,
  className,
  disabled = false,
}: ConnectionDropdownProps) {
  const { connections: sharedConnections } = useConnection();
  const connections = sharedConnections as ConnectionOption[];
  const hasConnections = connections.length > 0;

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || !hasConnections}>
      <SelectTrigger
        className={cn(
          'h-9 w-full min-w-[220px] max-w-[320px] text-sm font-medium',
          className,
        )}
      >
        <SelectValue placeholder={hasConnections ? placeholder : noConnectionsText} />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[var(--radix-select-trigger-width)]">
        {hasConnections ? (
          connections.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              {connection.name}
            </SelectItem>
          ))
        ) : (
          <SelectItem value="__no_connections__" disabled>
            {noConnectionsText}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
