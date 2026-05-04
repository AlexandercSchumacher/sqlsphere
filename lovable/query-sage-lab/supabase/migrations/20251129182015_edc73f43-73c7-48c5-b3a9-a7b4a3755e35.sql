-- Create table for tracking user usage (daily limits)
CREATE TABLE public.user_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  messages_sent integer NOT NULL DEFAULT 0,
  imports_count integer NOT NULL DEFAULT 0,
  visualizations_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, usage_date)
);

-- Create table for tracking total imports (lifetime count for free tier limit)
CREATE TABLE public.user_lifetime_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  total_imports integer NOT NULL DEFAULT 0,
  total_visualizations integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_lifetime_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_usage
CREATE POLICY "Users can view their own usage"
ON public.user_usage
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own usage"
ON public.user_usage
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own usage"
ON public.user_usage
FOR UPDATE
USING (auth.uid() = user_id);

-- RLS policies for user_lifetime_usage
CREATE POLICY "Users can view their own lifetime usage"
ON public.user_lifetime_usage
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lifetime usage"
ON public.user_lifetime_usage
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lifetime usage"
ON public.user_lifetime_usage
FOR UPDATE
USING (auth.uid() = user_id);

-- Add triggers for updated_at
CREATE TRIGGER update_user_usage_updated_at
BEFORE UPDATE ON public.user_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_lifetime_usage_updated_at
BEFORE UPDATE ON public.user_lifetime_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();