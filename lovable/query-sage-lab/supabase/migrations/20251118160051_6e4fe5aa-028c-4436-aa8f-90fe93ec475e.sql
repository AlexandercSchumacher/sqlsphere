-- Add soft delete column to chat_sessions
ALTER TABLE public.chat_sessions 
ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Add index for better query performance when filtering active sessions
CREATE INDEX idx_chat_sessions_is_active ON public.chat_sessions(user_id, is_active) WHERE is_active = true;

-- Add deleted_at timestamp for audit trail
ALTER TABLE public.chat_sessions 
ADD COLUMN deleted_at timestamp with time zone;