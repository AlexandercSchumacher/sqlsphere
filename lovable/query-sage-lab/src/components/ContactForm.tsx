import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Send, Loader2 } from 'lucide-react';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
  email: z.string().trim().email('Invalid email address').max(255, 'Email too long'),
  subject: z.string().trim().min(1, 'Subject is required').max(200, 'Subject too long'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(2000, 'Message too long'),
});

type ContactFormData = z.infer<typeof contactSchema>;

const ContactForm = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: '',
      email: '',
      subject: '',
      message: '',
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke('send-contact-email', {
        body: data,
      });

      if (error) throw error;

      toast({
        title: t('contact.success.title'),
        description: t('contact.success.description'),
      });
      form.reset();
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast({
        title: t('contact.error.title'),
        description: t('contact.error.description'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex gap-0">
      <div className="dock-rail w-1.5 bg-primary" />
      <div className="flex-1 pl-4">
      <div className="mb-6">
        <h3 className="text-lg font-semibold">{t('contact.form.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('contact.form.description')}</p>
      </div>
      <div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contact.form.name')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('contact.form.namePlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contact.form.email')}</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder={t('contact.form.emailPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contact.form.subject')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('contact.form.subjectPlaceholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('contact.form.message')}</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder={t('contact.form.messagePlaceholder')} 
                      className="min-h-[120px] resize-none"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('contact.form.sending')}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t('contact.form.send')}
                </>
              )}
            </Button>
          </form>
        </Form>
      </div>
      </div>
    </div>
  );
};

export default ContactForm;
