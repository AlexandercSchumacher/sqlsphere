-- Add database_type column to chat_sessions table
ALTER TABLE public.chat_sessions 
ADD COLUMN database_type text;